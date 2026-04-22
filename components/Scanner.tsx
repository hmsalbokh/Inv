
import React, { useState, useEffect, useRef } from 'react';
import { InventoryRecord, CenterCode, PalletCondition, PalletType } from '../types';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

interface PhotoStatus {
  id: string;
  url: string; 
  status: 'compressing' | 'uploading' | 'success' | 'error';
  name: string;
  errorMsg?: string;
  blob?: string;
  base64?: string; 
}

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface Props {
  onScan: (barcode: string, conditionData?: { condition: PalletCondition, externalDamageQty?: number, internalDamageQty?: number, photos?: string[], notes?: string, damageDetails?: string, hasDiscrepancy?: boolean, discrepancyType?: 'shortage' | 'excess', discrepancyCartonsQty?: number, discrepancyBundlesQty?: number }) => Promise<{ success: boolean; message: string }> | { success: boolean; message: string };
  currentTruck: string;
  onTruckChange: (val: string) => void;
  role: 'factory' | 'center' | 'monitor';
  currentTripId: string;
  records: InventoryRecord[];
  userCenter: CenterCode | null;
  palletTypes: PalletType[];
  onNotify: (title: string, msg: string) => void;
}

export const Scanner: React.FC<Props> = ({ onScan, currentTruck, onTruckChange, role, currentTripId, records, userCenter, palletTypes, onNotify }) => {
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, text: string }>({ type: null, text: '' });
  const [isCameraScannerActive, setIsCameraScannerActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [handheldCode, setHandheldCode] = useState('');
  const [flashSuccess, setFlashSuccess] = useState(false);
  const [showPendingList, setShowPendingList] = useState(false);
  
  const [showInspection, setShowInspection] = useState(false);
  const [activeBarcode, setActiveBarcode] = useState('');
  
  const [inspectionType, setInspectionType] = useState<'intact' | 'damaged' | 'discrepancy'>('intact');
  const [hasExternalDamage, setHasExternalDamage] = useState(false);
  const [hasInternalDamage, setHasInternalDamage] = useState(false);
  const [extDamagedQty, setExtDamagedQty] = useState<number>(0);
  const [intDamagedQty, setIntDamagedQty] = useState<number>(0);

  const [discrepancyType, setDiscrepancyType] = useState<'shortage' | 'excess'>('shortage');
  const [discrepancyCartons, setDiscrepancyCartons] = useState<number>(0);
  const [discrepancyBundles, setDiscrepancyBundles] = useState<number>(0);
  
  const [userNotes, setUserNotes] = useState('');
  
  const [photoTrack, setPhotoTrack] = useState<PhotoStatus[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const cooldownRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handheldInputRef = useRef<HTMLInputElement>(null);
  const scannerInstanceRef = useRef<any>(null);
  const isProcessingScan = useRef<boolean>(false);
  
  const pendingCodes = records.filter(r => {
    if (r.status === 'cancelled') return false; 
    if (role === 'factory') return r.tripId === currentTripId && r.status === 'pending';
    if (role === 'center') return r.destination === userCenter && r.status === 'in_transit';
    return false;
  });

  const stopScannerSafely = async () => {
    if (scannerInstanceRef.current) {
      try {
        if (scannerInstanceRef.current.isScanning) {
          await scannerInstanceRef.current.stop();
        }
        scannerInstanceRef.current.clear();
      } catch (e) {
        console.warn("Camera Cleanup Warning:", e);
      } finally {
        scannerInstanceRef.current = null;
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    if (isCameraScannerActive) {
      const startScanner = async () => {
        setIsCameraLoading(true);
        isProcessingScan.current = false;
        await new Promise(r => setTimeout(r, 600));
        const Html5Qrcode = (window as any).Html5Qrcode;
        if (!Html5Qrcode) {
          if (mounted) {
            setStatus({ type: 'error', text: 'خطأ: تعذر الوصول لوحدة الكاميرا.' });
            setIsCameraScannerActive(false);
            setIsCameraLoading(false);
          }
          return;
        }
        try {
          const scanner = new Html5Qrcode("reader");
          scannerInstanceRef.current = scanner;
          const config = { 
            fps: 30, 
            qrbox: (vw: number, vh: number) => {
               const width = Math.min(vw * 0.85, 400);
               return { width, height: 250 }; // المستطيل أسهل لقراءة الباركود الطولي (1D)
            }, 
            aspectRatio: 1.0, 
            experimentalFeatures: { useBarCodeDetectorIfSupported: true } 
          };
          
          await scanner.start({ facingMode: "environment" }, config, (text: string) => {
            if (mounted && !isProcessingScan.current) {
              isProcessingScan.current = true;
              processBarcode(text);
              setIsCameraScannerActive(false);
            }
          }, () => {});
          if (mounted) setIsCameraLoading(false);
        } catch (err) {
          if (mounted) {
            setStatus({ type: 'error', text: 'فشل تشغيل الكاميرا.' });
            setIsCameraScannerActive(false);
            setIsCameraLoading(false);
          }
        }
      };
      startScanner();
    } else {
      stopScannerSafely();
    }
    return () => { mounted = false; stopScannerSafely(); };
  }, [isCameraScannerActive]);

  const processBarcode = async (barcode: string) => {
    if (!barcode || cooldownRef.current) return;
    try {
      const cleanBarcode = barcode.trim().toUpperCase();
      if (role === 'center') {
        const record = records.find(r => r.palletBarcode === cleanBarcode);
        if (!record || record.status === 'received' || record.status === 'cancelled') {
          const errMsg = record?.status === 'cancelled' ? 'عذراً، هذه الرحلة تم إلغاؤها ولا يمكن استلام طبلياتها.' : 'الباركود غير موجود أو مستلم مسبقاً.';
          setStatus({ type: 'error', text: errMsg });
          
          try {
             await addDoc(collection(db, 'system_logs'), {
               timestamp: Date.now(),
               type: 'scan_error',
               userId: userCenter || 'مجهول',
               message: record?.status === 'cancelled' ? 'محاولة استلام طبلية لرحلة ملغاة' : 'محاولة مسح باركود خاطئ أو مستلم',
               details: record?.status === 'cancelled' ? `حاول المركز مسح باركود لرحلة ملغاة: ${cleanBarcode}` : `حاول المركز مسح باركود غير صالح: ${cleanBarcode}`
             });
          } catch(e) {}
          
          setTimeout(() => setStatus({ type: null, text: '' }), 3000);
          return;
        }
        // لا نمنع الاستلام إذا كانت الوجهة مختلفة، بل نسمح له بالاستمرار (سيتم إظهار تنبيه لاحقاً)
        setActiveBarcode(cleanBarcode);
        setInspectionType('intact'); setHasExternalDamage(false); setHasInternalDamage(false);
        setExtDamagedQty(0); setIntDamagedQty(0); setUserNotes(''); setPhotoTrack([]);
        setDiscrepancyType('shortage'); setDiscrepancyCartons(0); setDiscrepancyBundles(0);
        setShowInspection(true);
        return;
      }
      cooldownRef.current = true;
      const result = await onScan(cleanBarcode);
      setStatus({ type: result.success ? 'success' : 'error', text: result.message });
      if (result.success) { setFlashSuccess(true); setTimeout(() => setFlashSuccess(false), 400); }
      setTimeout(() => { setStatus({ type: null, text: '' }); cooldownRef.current = false; isProcessingScan.current = false; }, 1000);
    } catch (err) {
      setStatus({ type: 'error', text: 'حدث خطأ أثناء القراءة.' });
      cooldownRef.current = false;
      isProcessingScan.current = false;
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    for (const file of Array.from(files) as File[]) {
      const tempId = generateUUID();
      const localPreview = URL.createObjectURL(file);
      setPhotoTrack(prev => [...prev, { id: tempId, url: '', status: 'compressing', name: file.name, blob: localPreview }]);
      try {
        const reader = new FileReader();
        const encodedData = await new Promise<string>((resolve, reject) => {
          reader.readAsDataURL(file);
          reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 300; // تقليل العرض لضمان صغر حجم الرموز
              let width = img.width;
              let height = img.height;
              if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
              canvas.width = width; canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, width, height); }
              resolve(canvas.toDataURL('image/jpeg', 0.3)); // ضغط عالي لتقليل حجم السلسلة النصية
            };
            img.onerror = () => reject('Error');
          };
        });
        setPhotoTrack(prev => prev.map(p => p.id === tempId ? { ...p, status: 'success', url: encodedData, base64: encodedData } : p));
      } catch (err) {
        setPhotoTrack(prev => prev.map(p => p.id === tempId ? { ...p, status: 'error', errorMsg: 'فشل التشفير' } : p));
      }
    }
    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmInspection = async () => {
    if (isProcessing) return;
    const finalPhotos = photoTrack.filter(p => p.status === 'success' && p.url).map(p => p.url);
    let condition: PalletCondition = 'intact';
    let details = '';
    
    const finalExtQty = (inspectionType === 'damaged' && hasExternalDamage) ? extDamagedQty : 0;
    const finalIntQty = (inspectionType === 'damaged' && hasInternalDamage) ? intDamagedQty : 0;

    let finalHasDiscrepancy = false;
    let finalDescType: 'shortage' | 'excess' | undefined = undefined;
    let finalDescCartons = 0;
    let finalDescBundles = 0;

    if (inspectionType === 'damaged') {
      if (!hasExternalDamage && !hasInternalDamage) { onNotify('تنبيه', 'يرجى تحديد نوع التلف'); return; }
      if (hasExternalDamage && extDamagedQty <= 0) { onNotify('تنبيه', 'حدد عدد الكراتين المتضررة خارجياً'); return; }
      if (hasInternalDamage && intDamagedQty <= 0) { onNotify('تنبيه', 'حدد عدد الكراتين المتضررة داخلياً'); return; }
      
      if (finalPhotos.length === 0) {
        onNotify('تنبيه', 'يجب إضافة صورة واحدة على الأقل لإثبات التلف');
        return;
      }
      
      if (hasExternalDamage && hasInternalDamage) { 
        condition = 'both'; 
        details = `تلف كراتين مزدوج: خارجي (${finalExtQty}), داخلي (${finalIntQty})`; 
      } else if (hasExternalDamage) { 
        condition = 'external_box_damage'; 
        details = `تلف كراتين خارجي: (${finalExtQty})`; 
      } else { 
        condition = 'internal_content_damage'; 
        details = `تلف كراتين داخلي: (${finalIntQty})`; 
      }
    } else if (inspectionType === 'discrepancy') {
      if (discrepancyCartons <= 0 && discrepancyBundles <= 0) { onNotify('تنبيه', 'يرجى تحديد الكمية (كراتين أو حزم) للزيادة أو النقص'); return; }
      if (finalPhotos.length === 0) { onNotify('تنبيه', 'يجب إضافة صورة إثبات للنقص أو الزيادة'); return; }
      condition = 'intact';
      finalHasDiscrepancy = true;
      finalDescType = discrepancyType;
      finalDescCartons = discrepancyCartons;
      finalDescBundles = discrepancyBundles;
      
      const label = discrepancyType === 'shortage' ? 'نقص' : 'زيادة';
      let descParts = [];
      if (discrepancyCartons > 0) descParts.push(`${discrepancyCartons} كرتون`);
      if (discrepancyBundles > 0) descParts.push(`${discrepancyBundles} حزمة`);
      details = `يوجد ${label} في المخزون: ${descParts.join(' و ')}`;
    }

    const result = await onScan(activeBarcode, { 
      condition, 
      externalDamageQty: finalExtQty, 
      internalDamageQty: finalIntQty, 
      photos: finalPhotos, 
      notes: userNotes, 
      damageDetails: details,
      hasDiscrepancy: finalHasDiscrepancy,
      discrepancyType: finalDescType,
      discrepancyCartonsQty: finalDescCartons,
      discrepancyBundlesQty: finalDescBundles
    });

    if (result.success) {
      setShowInspection(false);
      setStatus({ type: 'success', text: result.message });
    } else {
      setStatus({ type: 'error', text: result.message });
    }
    setTimeout(() => setStatus({ type: null, text: '' }), 3000);
  };

  return (
    <div className="flex flex-col gap-4 items-center animate-fadeIn py-2 w-full max-w-sm mx-auto relative h-full text-right" dir="rtl">
      {showPendingList && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end animate-fadeIn">
          <div className="w-full max-w-2xl mx-auto bg-white rounded-t-[3rem] p-8 space-y-4 animate-slideUp max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center border-b pb-4">
               <h2 className="text-lg font-black text-slate-800">الأكواد المتبقية ({pendingCodes.length})</h2>
               <button onClick={() => setShowPendingList(false)} className="bg-slate-100 p-2 rounded-full">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
               {pendingCodes.length === 0 ? (
                 <div className="py-10 text-center text-slate-400 font-bold">🎉 تم إكمال كافة المهام</div>
               ) : (
                 pendingCodes.map((r, i) => (
                   <div key={i} onClick={() => { processBarcode(r.palletBarcode); setShowPendingList(false); }} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex justify-between items-center active:bg-indigo-50 cursor-pointer">
                      <span className="text-[11px] font-black text-indigo-600 tracking-widest">{r.palletBarcode}</span>
                      <span className="text-[10px] font-bold text-slate-400">{palletTypes.find(t => t.id === r.palletTypeId)?.stageName}</span>
                   </div>
                 ))
               )}
            </div>
          </div>
        </div>
      )}

      {showInspection && (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end animate-fadeIn">
          <div className="w-full max-w-2xl mx-auto bg-white rounded-t-[3rem] p-8 animate-slideUp shadow-2xl max-h-[95vh] overflow-y-auto border-t-8 border-indigo-900">
            <div className="flex justify-between items-center sticky top-0 bg-white pb-4 z-10 border-b border-slate-50">
               <div className="text-right">
                 <h2 className="text-xl font-black text-slate-800">إثبات استلام ميداني</h2>
                 <p className="text-[10px] font-bold text-indigo-600 tracking-wider">📦 باركود: {activeBarcode}</p>
               </div>
               <button onClick={() => setShowInspection(false)} className="bg-slate-100 p-2 rounded-full">✕</button>
            </div>
            <div className="space-y-6 mt-6 pb-6 text-right">
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setInspectionType('intact')} className={`p-4 rounded-[1.5rem] border-2 transition-all flex flex-col items-center gap-2 ${inspectionType === 'intact' ? 'bg-emerald-500 text-white border-transparent shadow-lg scale-105 z-10' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                  <span className="text-xl">✅</span><span className="font-black text-[10px]">سليمة</span>
                </button>
                <button onClick={() => setInspectionType('damaged')} className={`p-4 rounded-[1.5rem] border-2 transition-all flex flex-col items-center gap-2 ${inspectionType === 'damaged' ? 'bg-rose-500 text-white border-transparent shadow-lg scale-105 z-10' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                  <span className="text-xl">⚠️</span><span className="font-black text-[10px]">تلفيات</span>
                </button>
                <button onClick={() => setInspectionType('discrepancy')} className={`p-4 rounded-[1.5rem] border-2 transition-all flex flex-col items-center gap-2 ${inspectionType === 'discrepancy' ? 'bg-amber-500 text-white border-transparent shadow-lg scale-105 z-10' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                  <span className="text-xl">⚖️</span><span className="font-black text-[10px]">نقص/زيادة</span>
                </button>
              </div>

              {inspectionType === 'damaged' && (
                <div className="space-y-6 animate-slideDown">
                  <div className={`p-5 rounded-[2rem] border-2 transition-all space-y-4 ${hasExternalDamage ? 'bg-amber-50 border-amber-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-80'}`}>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <input type="checkbox" checked={hasExternalDamage} onChange={() => setHasExternalDamage(!hasExternalDamage)} className="w-5 h-5 accent-amber-600" />
                           <span className="text-xs font-black">تلف كراتين خارجي</span>
                        </div><span className="text-xl">📦</span>
                     </div>
                     {hasExternalDamage && (
                       <div className="flex items-center gap-4 justify-center bg-white/60 p-3 rounded-2xl">
                          <button onClick={() => setExtDamagedQty(Math.max(0, extDamagedQty - 1))} className="w-8 h-8 bg-white border border-amber-200 rounded-lg text-amber-600 font-black">-</button>
                          <span className="text-lg font-black">{extDamagedQty} كرتون</span>
                          <button onClick={() => setExtDamagedQty(extDamagedQty + 1)} className="w-8 h-8 bg-white border border-amber-200 rounded-lg text-amber-600 font-black">+</button>
                       </div>
                     )}
                  </div>

                  <div className={`p-5 rounded-[2rem] border-2 transition-all space-y-4 ${hasInternalDamage ? 'bg-rose-50 border-rose-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-80'}`}>
                     <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <input type="checkbox" checked={hasInternalDamage} onChange={() => setHasInternalDamage(!hasInternalDamage)} className="w-5 h-5 accent-rose-600" />
                           <span className="text-xs font-black">تلف كراتين داخلي</span>
                        </div><span className="text-xl">📖</span>
                     </div>
                     {hasInternalDamage && (
                       <div className="flex items-center gap-4 justify-center bg-white/60 p-3 rounded-2xl">
                          <button onClick={() => setIntDamagedQty(Math.max(0, intDamagedQty - 1))} className="w-8 h-8 bg-white border border-rose-200 rounded-lg text-rose-600 font-black">-</button>
                          <span className="text-lg font-black">{intDamagedQty} كرتون</span>
                          <button onClick={() => setIntDamagedQty(intDamagedQty + 1)} className="w-8 h-8 bg-white border border-rose-200 rounded-lg text-rose-600 font-black">+</button>
                       </div>
                     )}
                  </div>
                </div>
              )}

              {inspectionType === 'discrepancy' && (
                <div className="space-y-6 animate-slideDown">
                  <div className="grid grid-cols-2 gap-3">
                     <button onClick={() => setDiscrepancyType('shortage')} className={`p-4 rounded-[1.5rem] border-2 transition-all font-black text-xs ${discrepancyType === 'shortage' ? 'bg-amber-500 text-white border-transparent' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>نقص في المخزون</button>
                     <button onClick={() => setDiscrepancyType('excess')} className={`p-4 rounded-[1.5rem] border-2 transition-all font-black text-xs ${discrepancyType === 'excess' ? 'bg-indigo-500 text-white border-transparent' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>زيادة في المخزون</button>
                  </div>
                  
                  <div className="bg-slate-50 border-2 border-slate-100 p-5 rounded-[2rem] space-y-4">
                     <div className="flex items-center justify-between bg-white/60 p-3 rounded-2xl border border-slate-100">
                          <span className="text-xs font-black text-slate-600">الكراتين</span>
                          <div className="flex items-center gap-4">
                              <button onClick={() => setDiscrepancyCartons(Math.max(0, discrepancyCartons - 1))} className="w-10 h-10 bg-white border-2 border-slate-200 rounded-xl text-slate-600 font-black text-xl">-</button>
                              <span className="text-xl font-black text-slate-800 w-10 text-center">{discrepancyCartons}</span>
                              <button onClick={() => setDiscrepancyCartons(discrepancyCartons + 1)} className="w-10 h-10 bg-white border-2 border-slate-200 rounded-xl text-slate-600 font-black text-xl">+</button>
                          </div>
                     </div>
                     <div className="flex items-center justify-between bg-white/60 p-3 rounded-2xl border border-slate-100">
                          <span className="text-xs font-black text-slate-600">الحزم</span>
                          <div className="flex items-center gap-4">
                              <button onClick={() => setDiscrepancyBundles(Math.max(0, discrepancyBundles - 1))} className="w-10 h-10 bg-white border-2 border-slate-200 rounded-xl text-slate-600 font-black text-xl">-</button>
                              <span className="text-xl font-black text-slate-800 w-10 text-center">{discrepancyBundles}</span>
                              <button onClick={() => setDiscrepancyBundles(discrepancyBundles + 1)} className="w-10 h-10 bg-white border-2 border-slate-200 rounded-xl text-slate-600 font-black text-xl">+</button>
                          </div>
                     </div>
                  </div>
                </div>
              )}

              {inspectionType !== 'intact' && (
                <div className="space-y-6 animate-fadeIn pt-4 border-t border-slate-100">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 block mr-2 uppercase">ملاحظات الفاحص</label>
                    <textarea value={userNotes} onChange={e => setUserNotes(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-100 p-4 rounded-[1.5rem] text-xs font-bold outline-none" placeholder="أي تفاصيل إضافية..." />
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 block mr-2 uppercase">صور الإثبات</label>
                    <div className="grid grid-cols-3 gap-3">
                        {photoTrack.map((p) => (
                          <div key={p.id} className="relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-100 bg-slate-100">
                            {p.blob && <img src={p.blob} className="w-full h-full object-cover" alt="Proof" />}
                            <button onClick={() => setPhotoTrack(prev => prev.filter(i => i.id !== p.id))} className="absolute top-1 left-1 bg-white/90 p-1 rounded-lg text-rose-600 text-[8px] font-black">✕</button>
                          </div>
                        ))}
                        <button onClick={() => fileInputRef.current?.click()} className="aspect-square border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all">
                          <span className="text-2xl">📸</span><span className="text-[9px] font-black text-slate-500">رفع صورة</span>
                        </button>
                        <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} multiple accept="image/*" className="hidden" capture="environment" />
                    </div>
                  </div>
                </div>
              )}

            </div>
            <div className="pt-6 border-t border-slate-100 pb-10">
               <button onClick={handleConfirmInspection} disabled={isProcessing} className={`w-full p-6 rounded-[2.5rem] font-black text-sm shadow-2xl transition-all ${isProcessing ? 'bg-slate-200 text-slate-400' : 'bg-indigo-900 text-white active:scale-95 shadow-indigo-500/30'}`}>حفظ وتأكيد الاستلام</button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full bg-white p-5 rounded-[2.5rem] shadow-sm border border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-2xl">🚚</div>
          <div className="text-right">
            <span className="text-[10px] font-black text-slate-400 block uppercase">رقم الحاوية</span>
            <span className="text-sm font-black text-slate-800">#{currentTruck}</span>
          </div>
        </div>
        <button onClick={() => setShowPendingList(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md flex items-center gap-2 active:scale-95">
           <span>المتبقي</span>
           <span className="bg-white/20 px-1.5 rounded-md">{pendingCodes.length}</span>
        </button>
      </div>

      <div className="w-full bg-slate-900 p-8 rounded-[3rem] shadow-2xl relative border-4 border-white flex flex-col items-center gap-6 min-h-[460px] justify-center text-center overflow-hidden">
        {!isCameraScannerActive ? (
          <>
            <div className="w-24 h-24 bg-indigo-500/10 rounded-full flex items-center justify-center animate-pulse border-2 border-indigo-500/20 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
               <span className="text-5xl">📡</span>
            </div>
            <div className="space-y-2">
                <h3 className="text-white font-black text-xl">جاهز للمسح</h3>
                <p className="text-indigo-300 text-[10px] font-bold uppercase tracking-widest">يدوي أو عبر الكاميرا</p>
            </div>
            <input 
              ref={handheldInputRef} 
              type="text" 
              value={handheldCode} 
              onChange={e => setHandheldCode(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && processBarcode(handheldCode)} 
              placeholder="الباركود هنا..." 
              className="w-full bg-white/5 border-2 border-white/10 p-5 rounded-2xl text-white text-center text-xl font-black outline-none placeholder:text-white/20 focus:border-indigo-500 transition-colors" 
              autoFocus 
              onBlur={() => !showInspection && !isCameraScannerActive && handheldInputRef.current?.focus()} 
            />
            <button onClick={() => setIsCameraScannerActive(true)} className="group relative w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm py-5 rounded-2xl shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95">
               <span className="text-xl">📸</span>
               <span>تشغيل القارئ الذكي (تلقائي)</span>
               <div className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping"></div>
            </button>
          </>
        ) : (
          <div className="w-full h-full absolute inset-0 bg-black z-[100] flex flex-col animate-fadeIn">
             {isCameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 z-[110] text-white gap-4">
                    <div className="w-14 h-14 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-xs font-black tracking-widest">جاري تشغيل العدسة...</span>
                </div>
             )}
             <div id="reader" className="flex-1 w-full h-full overflow-hidden"></div>
             <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-[105]">
                <div className="w-64 h-64 border-2 border-white/30 rounded-[3rem] relative shadow-[0_0_0_2000px_rgba(0,0,0,0.5)]">
                   <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-indigo-500 rounded-tl-[1.5rem]"></div>
                   <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-indigo-500 rounded-tr-[1.5rem]"></div>
                   <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-indigo-500 rounded-bl-[1.5rem]"></div>
                   <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-indigo-500 rounded-br-[1.5rem]"></div>
                   <div className="absolute top-1/2 left-0 right-0 h-1 bg-indigo-500/80 animate-scanLine shadow-[0_0_20px_rgba(99,102,241,1)]"></div>
                   <div className="absolute -bottom-16 left-0 right-0 text-center">
                      <span className="bg-indigo-600 text-white px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">جاري البحث تلقائياً...</span>
                   </div>
                </div>
             </div>
             <div className="absolute bottom-10 left-0 right-0 flex justify-center z-[120] pointer-events-auto">
                <button 
                  onClick={() => setIsCameraScannerActive(false)} 
                  className="bg-white/10 backdrop-blur-xl text-white border border-white/20 px-12 py-5 rounded-3xl font-black text-sm shadow-2xl active:scale-95 transition-all"
                >
                  إلغاء المسح
                </button>
             </div>
          </div>
        )}
        {flashSuccess && <div className="absolute inset-0 bg-emerald-500/70 backdrop-blur-md animate-pulse z-50"></div>}
      </div>

      {status.text && (
        <div className={`w-[94%] p-6 rounded-[2.5rem] text-center font-black shadow-[0_20px_50px_rgba(0,0,0,0.3)] animate-slideDown fixed top-28 left-1/2 -translate-x-1/2 z-[300] border-4 ${status.type === 'success' ? 'bg-emerald-600 text-white border-emerald-400' : 'bg-rose-600 text-white border-rose-400'}`}>
           <span className="text-sm">{status.text}</span>
        </div>
      )}
    </div>
  );
};
