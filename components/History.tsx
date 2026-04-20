
import React, { useState, useMemo } from 'react';
import { InventoryRecord, PalletType, UserRole, CenterCode, PressCode, Trip, PalletCondition, UserCredentials } from '../types';
import { db } from '../firebase';
import { doc, updateDoc, collection, addDoc } from 'firebase/firestore';

declare var html2pdf: any;

interface Props {
  records: InventoryRecord[];
  trips: Trip[];
  palletTypes: PalletType[];
  role: UserRole;
  userCode: string;
  userCenter: CenterCode | null;
  users: UserCredentials[]; // إضافة قائمة المستخدمين
}

type LabelSize = '10x15' | '3x4';

export const History: React.FC<Props> = ({ records, trips, palletTypes, role, userCode, userCenter, users }) => {
  const [destinationFilter, setDestinationFilter] = useState<CenterCode | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'received' | 'in_transit' | 'pending'>('ALL');
  const [showDamagedOnly, setShowDamagedOnly] = useState(false);
  const [activeChoiceId, setActiveChoiceId] = useState<string | null>(null);
  const [batchPrintTripId, setBatchPrintTripId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<LabelSize>('10x15');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // جلب اسم المنشأة ديناميكياً
  const getEntityName = (code: string) => users.find(u => u.code === code)?.displayName || code;
  const centerOptions = useMemo(() => users.filter(u => u.role === 'center'), [users]);

  const getConditionLabel = (record: InventoryRecord) => {
    if (record.hasDiscrepancy) {
      return { text: record.discrepancyType === 'shortage' ? 'نقص' : 'زيادة', color: 'bg-amber-100 text-amber-700' };
    }
    switch (record.condition) {
      case 'intact': return { text: 'سليمة', color: 'bg-emerald-100 text-emerald-700' };
      case 'external_box_damage': return { text: 'تلف كراتين خارجي', color: 'bg-amber-100 text-amber-700' };
      case 'internal_content_damage': return { text: 'تلف كراتين داخلي', color: 'bg-rose-100 text-rose-700' };
      case 'both': return { text: 'تلف كلاهما (داخلي وخارجي)', color: 'bg-purple-100 text-purple-700' };
      case 'damaged': return { text: 'تالفة', color: 'bg-red-100 text-red-700' };
      default: return { text: 'غير محدد', color: 'bg-slate-100 text-slate-500' };
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      let isVisible = false;
      if (role === 'monitor') isVisible = true;
      else if (role === 'factory') isVisible = record.palletBarcode.includes(userCode);
      else if (role === 'center' && userCenter) isVisible = record.destination === userCenter;
      
      if (isVisible && role !== 'center' && destinationFilter !== 'ALL') isVisible = record.destination === destinationFilter;
      if (isVisible && statusFilter !== 'ALL') isVisible = record.status === statusFilter;
      if (isVisible && showDamagedOnly) isVisible = (record.condition && record.condition !== 'intact') || record.hasDiscrepancy;
      
      return isVisible;
    }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [records, role, userCode, userCenter, destinationFilter, statusFilter, showDamagedOnly]);

  const generateLabelHTML = (record: InventoryRecord, size: LabelSize) => {
    const pType = palletTypes.find(t => t.id === record.palletTypeId);
    const trip = trips.find(t => t.id === record.tripId);
    const tripNumber = trip ? trip.tripNumber : '---';
    const pressCode = trip ? trip.pressCode : (record.palletBarcode.includes('OPK') ? 'OPK' : 'UNI');
    const barcodeImgUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${record.palletBarcode}&scale=4&rotate=N&includetext=false`;
    const isLarge = size === '10x15';

    return `
      <div style="width: 100%; height: 100%; border: ${isLarge ? '8px' : '4px'} solid black; padding: ${isLarge ? '8mm' : '4mm'}; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: white; font-family: 'Tajawal', sans-serif; overflow: hidden; text-align: center; page-break-after: always;">
         <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: ${isLarge ? '4px' : '2px'} solid black; padding-bottom: ${isLarge ? '10px' : '5px'};">
            <div style="display: flex; gap: 10px; align-items: center;">
               <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${record.palletBarcode}" style="width: ${isLarge ? '50px' : '30px'}; height: ${isLarge ? '50px' : '30px'};" />
               <div style="text-align: right;">
                  <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 800;">توصيل الكتب</div>
                  <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900; line-height: 1.1;">مشروع التعليم</div>
               </div>
            </div>
            <div style="background: black; color: white; padding: ${isLarge ? '8px 12px' : '4px 6px'}; border-radius: 6px; text-align: center;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700;">الرحلة</div>
               <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900;">#${tripNumber}</div>
            </div>
         </div>
         <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${isLarge ? '12px' : '6px'};">
            <div style="font-size: ${isLarge ? '13px' : '8px'}; font-weight: 900; color: #333;">PALLET BARCODE</div>
            <img src="${barcodeImgUrl}" style="width: 100%; max-height: ${isLarge ? '85px' : '45px'}; object-fit: contain;" />
            <div style="background: black; color: white; width: 100%; padding: ${isLarge ? '10px' : '5px'}; font-size: ${isLarge ? '26px' : '14px'}; font-weight: 900; font-family: monospace;">
               ${record.palletBarcode}
            </div>
         </div>
         <div style="padding: ${isLarge ? '8px 0' : '4px 0'}; border-top: ${isLarge ? '3px' : '1.5px'} solid black; border-bottom: ${isLarge ? '3px' : '1.5px'} solid black; margin-bottom: 5px;">
            <div style="font-size: ${isLarge ? '24px' : '12px'}; font-weight: 900; line-height: 1.1;">${pType?.stageName || 'غير معروف'}</div>
         </div>
         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <div style="text-align: right; border-left: ${isLarge ? '2px' : '1px'} solid black; padding-left: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المرسل:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900; white-space: nowrap;">${getEntityName(pressCode)}</div>
            </div>
            <div style="text-align: right; padding-right: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المستلم:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900; white-space: nowrap;">${getEntityName(record.destination)}</div>
            </div>
         </div>
      </div>
    `;
  };

  const handlePrintTripBatch = (tripId: string) => {
    const tripRecords = records.filter(r => r.tripId === tripId);
    if (tripRecords.length === 0) return;
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const html = tripRecords.map(r => generateLabelHTML(r, selectedSize)).join('');

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html dir="rtl"><head><title>Batch Print</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; }</style></head><body>${html}<script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},500);};</script></body></html>
      `);
      printWindow.document.close();
    }
    setBatchPrintTripId(null);
  };

  const handleSingleAction = (record: InventoryRecord, mode: 'pdf' | 'print') => {
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const html = generateLabelHTML(record, selectedSize);

    if (mode === 'print') {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html dir="rtl"><head><title>Print Label</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; }</style></head><body>${html}<script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},300);};</script></body></html>
        `);
        printWindow.document.close();
      }
    } else {
      const container = document.createElement('div');
      container.style.width = `${w}mm`; container.style.height = `${h}mm`;
      container.style.position = 'fixed'; container.style.left = '-9999px';
      container.innerHTML = html;
      document.body.appendChild(container);
      const opt = { margin: 0, filename: `Project-${record.palletBarcode}.pdf`, image: { type: 'jpeg', quality: 1 }, html2canvas: { scale: 4, useCORS: true }, jsPDF: { unit: 'mm', format: [w, h], orientation: 'portrait' } };
      html2pdf().from(container).set(opt).save().then(() => { document.body.removeChild(container); });
    }
    setActiveChoiceId(null);
  };

  const handleForceUpdate = async (record: InventoryRecord) => {
    if (window.confirm('هل أنت متأكد من إجبار تعديل وتسجيل حالة هذا الباركود يدوياً؟')) {
       try {
         const updates = { 
            status: record.status === 'pending' ? 'in_transit' : 'received', 
            timestamp: Date.now() 
         };
         
         if (record.status === 'pending') {
            (updates as any).factoryTimestamp = Date.now();
         } else if (record.status === 'in_transit') {
            (updates as any).centerTimestamp = Date.now();
         }

         await updateDoc(doc(db, 'records', record.id), updates);
         
         await addDoc(collection(db, 'system_logs'), {
             timestamp: Date.now(),
             type: 'system_error',
             userId: userCode || 'مجهول',
             message: 'تجاوز بصلاحية الإدارة',
             details: `تم إجبار تغيير حالة الطبلية (${record.palletBarcode}) يدوياً من السجل إلى: ${updates.status}`
         });

         alert('تم تعديل الحالة بنجاح عبر التجاوز اليدوي.');
       } catch (err) {
         console.error('Failed to force update', err);
         alert('حدث خطأ أثناء تعديل الحالة.');
       }
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-24 text-right" dir="rtl">
      {previewImageUrl && (
        <div className="fixed inset-0 z-[8000] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-4 animate-fadeIn" onClick={() => setPreviewImageUrl(null)}>
          <div className="absolute top-6 left-6 z-[8010]"><button className="bg-white/20 hover:bg-white/40 text-white w-12 h-12 rounded-full flex items-center justify-center text-2xl">✕</button></div>
          <div className="w-full max-w-lg bg-white/5 p-2 rounded-[2rem] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <img src={previewImageUrl} className="w-full h-auto rounded-[1.5rem] object-contain max-h-[80vh]" alt="Damage Preview" />
          </div>
        </div>
      )}

      {(activeChoiceId || batchPrintTripId) && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl text-center border-4 border-indigo-900">
             <div className="text-4xl mb-2">📐</div>
             <h3 className="text-xl font-black text-slate-800">{batchPrintTripId ? 'طباعة كامل الرحلة' : 'إعدادات الطباعة'}</h3>
             <div className="space-y-2 text-right">
               <label className="text-[10px] font-black text-slate-400 block uppercase">حجم الورق</label>
               <div className="flex gap-2">
                  <button onClick={() => setSelectedSize('3x4')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '3x4' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>3 × 4 إنش</button>
                  <button onClick={() => setSelectedSize('10x15')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '10x15' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>10 × 15 سم</button>
               </div>
             </div>
             <div className="grid grid-cols-1 gap-3 pt-2">
                <button onClick={() => batchPrintTripId ? handlePrintTripBatch(batchPrintTripId) : handleSingleAction(filteredRecords.find(r => r.id === activeChoiceId)!, 'print')} className="w-full bg-indigo-900 text-white p-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 active:scale-95 transition-all">
                  <span>{batchPrintTripId ? 'بدء الطباعة' : 'طباعة ملصق'}</span><span className="text-lg">📄</span>
                </button>
                {!batchPrintTripId && <button onClick={() => handleSingleAction(filteredRecords.find(r => r.id === activeChoiceId)!, 'pdf')} className="w-full bg-emerald-600 text-white p-5 rounded-2xl font-black text-sm flex items-center justify-center gap-3 active:scale-95 transition-all"><span>تنزيل PDF</span><span className="text-lg">📥</span></button>}
                <button onClick={() => { setActiveChoiceId(null); setBatchPrintTripId(null); }} className="w-full bg-slate-100 text-slate-500 p-4 rounded-2xl font-black text-xs">إلغاء</button>
             </div>
          </div>
        </div>
      )}

      <div className="px-4 space-y-4 pt-2">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-black text-slate-800">
             {role === 'center' ? `سجل استلام ${getEntityName(userCenter || '')}` : 'سجل التحركات'}
          </h2>
          <span className="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-[10px] font-black">{filteredRecords.length} سجل</span>
        </div>
        
        <div className="flex flex-col gap-2 pb-2">
          {role !== 'center' && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar items-center border-b border-slate-100 pb-2">
              <span className="text-[10px] font-black text-slate-400 whitespace-nowrap ml-1">المركز:</span>
              <button onClick={() => setDestinationFilter('ALL')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${destinationFilter === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-white border text-slate-500'}`}>الكل</button>
              {centerOptions.map(center => (
                <button key={center.id} onClick={() => setDestinationFilter(center.code)} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${destinationFilter === center.code ? 'bg-indigo-600 text-white' : 'bg-white border text-slate-500'}`}>{center.displayName}</button>
              ))}
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto no-scrollbar items-center">
            <span className="text-[10px] font-black text-slate-400 whitespace-nowrap ml-1">تصفية:</span>
            <button onClick={() => setStatusFilter('ALL')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${statusFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-50 border text-slate-500'}`}>جميع الحالات</button>
            <button onClick={() => setStatusFilter('received')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${statusFilter === 'received' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600'}`}>تم الاستلام ✅</button>
            <button onClick={() => setStatusFilter('in_transit')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${statusFilter === 'in_transit' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-600'}`}>في الطريق 🚚</button>
            <button onClick={() => setStatusFilter('pending')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${statusFilter === 'pending' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-600'}`}>معلق 🏭</button>
            
            <div className="w-px h-6 bg-slate-200 mx-1 flex-shrink-0"></div>
            
            <button onClick={() => setShowDamagedOnly(!showDamagedOnly)} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${showDamagedOnly ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 border border-rose-100 text-rose-600'}`}>⚠️ المتضرر</button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4">
        {filteredRecords.length === 0 ? (
          <div className="py-20 text-center space-y-3 bg-white rounded-[3rem] border border-dashed border-slate-200">
             <div className="text-4xl opacity-20">📂</div>
             <p className="text-slate-400 font-bold text-xs">لا توجد سجلات متاحة حالياً</p>
          </div>
        ) : (
          filteredRecords.map(record => {
            const isExpanded = expandedId === record.id;
            const cond = getConditionLabel(record);
            const pType = palletTypes.find(t => t.id === record.palletTypeId);

            return (
              <div key={record.id} className={`bg-white rounded-[2.5rem] shadow-sm border transition-all duration-300 overflow-hidden ${isExpanded ? 'ring-2 ring-indigo-500 border-transparent' : 'border-slate-100'}`}>
                <div onClick={() => setExpandedId(isExpanded ? null : record.id)} className={`p-6 flex justify-between items-center cursor-pointer active:bg-slate-50 ${isExpanded ? 'bg-indigo-50/30' : 'bg-white'}`}>
                  <div className="text-right space-y-1">
                    <h3 className="text-sm font-black text-slate-800">{pType?.stageName}</h3>
                    <div className="flex flex-wrap items-center gap-2">
                       <span className="text-[10px] font-bold text-indigo-600 font-mono tracking-widest">{record.palletBarcode}</span>
                       {record.extraCartons && (
                         <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                           {record.isExtraOnly ? `${record.extraCartons} كرتون إضافي فقط` : `+ ${record.extraCartons} كراتين إضافية`}
                         </span>
                       )}
                       {record.missingCartons && (
                         <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100">
                           - {record.missingCartons} كراتين ناقصة
                         </span>
                       )}
                       <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${cond.color}`}>{cond.text}</span>
                       <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                         record.status === 'received' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 
                         record.status === 'in_transit' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 
                         'bg-slate-50 text-slate-400 border border-slate-100'
                       }`}>
                         {record.status === 'received' ? 'تم الاستلام ✓' : record.status === 'in_transit' ? 'في الطريق 🚚' : 'بانتظار التحميل'}
                       </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); setActiveChoiceId(record.id); }} className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center shadow-sm active:scale-95 transition-all text-sm">🖨️</button>
                    <span className={`text-xs transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-6 pb-6 pt-2 space-y-4 animate-slideDown border-t border-slate-50">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50 p-3 rounded-2xl">
                         <span className="text-[9px] font-black text-slate-400 block uppercase mb-1 text-right">الحالة</span>
                         <span className={`text-[10px] font-bold block text-right ${record.status === 'received' ? 'text-emerald-600' : 'text-amber-600'}`}>
                           {record.status === 'received' ? 'تم الاستلام ✓' : record.status === 'in_transit' ? 'في الطريق 🚚' : 'بانتظار التحميل'}
                         </span>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-2xl">
                         <span className="text-[9px] font-black text-slate-400 block uppercase mb-1 text-right">الوجهة</span>
                         <span className="text-[10px] font-bold text-slate-800 block text-right">{getEntityName(record.destination)}</span>
                      </div>
                    </div>

                    {role !== 'center' && (
                      <button 
                        onClick={() => setBatchPrintTripId(record.tripId)}
                        className="w-full bg-indigo-50 text-indigo-700 border border-indigo-100 py-3 rounded-2xl text-[10px] font-black flex items-center justify-center gap-2 active:scale-95 transition-all"
                      >
                        <span>📦 طباعة كافة ملصقات هذه الرحلة</span>
                      </button>
                    )}

                    {role === 'monitor' && record.status !== 'received' && (
                       <button 
                         onClick={() => handleForceUpdate(record)}
                         className="w-full bg-amber-50 text-amber-700 border border-amber-100 py-3 rounded-2xl text-[10px] font-black flex items-center justify-center gap-2 active:scale-95 transition-all mt-2"
                       >
                         <span>⚡ إجبار التمرير وتخطي المسح (لحلول خلل النظام المباشرة)</span>
                       </button>
                    )}

                    {(record.condition && record.condition !== 'intact') && (
                      <div className="bg-rose-50 border border-rose-100 p-4 rounded-3xl space-y-3">
                         <span className="text-[11px] font-black text-rose-800 block text-right">⚠️ تقرير الأضرار</span>
                         <div className="grid grid-cols-2 gap-2">
                            {record.externalDamageQty ? <div className="bg-white/60 p-2 rounded-xl text-center"><span className="text-[8px] font-black text-slate-500 block">تلف خارجي</span><span className="text-xs font-black text-rose-700">{record.externalDamageQty}</span></div> : null}
                            {record.internalDamageQty ? <div className="bg-white/60 p-2 rounded-xl text-center"><span className="text-[8px] font-black text-slate-500 block">تلف داخلي</span><span className="text-xs font-black text-rose-700">{record.internalDamageQty}</span></div> : null}
                         </div>
                      </div>
                    )}

                    {record.hasDiscrepancy && (
                      <div className="bg-amber-50 border border-amber-100 p-4 rounded-3xl space-y-3">
                         <span className="text-[11px] font-black text-amber-800 block text-right">⚖️ تقرير التباين (نقص/زيادة)</span>
                         <div className="grid grid-cols-2 gap-2">
                            {record.discrepancyCartonsQty ? (
                               <div className="bg-white/60 p-2 rounded-xl text-center">
                                  <span className="text-[8px] font-black text-amber-600 block">{record.discrepancyType === 'shortage' ? 'نقص' : 'زيادة'} كراتين</span>
                                  <span className="text-xs font-black text-amber-700">{record.discrepancyCartonsQty}</span>
                               </div>
                            ) : null}
                            {record.discrepancyBundlesQty ? (
                               <div className="bg-white/60 p-2 rounded-xl text-center">
                                  <span className="text-[8px] font-black text-amber-600 block">{record.discrepancyType === 'shortage' ? 'نقص' : 'زيادة'} حزم</span>
                                  <span className="text-xs font-black text-amber-700">{record.discrepancyBundlesQty}</span>
                               </div>
                            ) : null}
                         </div>
                      </div>
                    )}

                    {(record.photos && record.photos.length > 0) && (
                       <div className="bg-slate-50 border border-slate-100 p-4 rounded-3xl space-y-3">
                          <span className="text-[10px] font-black text-slate-600 block text-right">📸 صور الإثبات المرفقة:</span>
                          <div className="grid grid-cols-3 gap-2">
                            {record.photos.map((url, i) => (
                              <div key={i} onClick={() => setPreviewImageUrl(url)} className="aspect-square bg-white rounded-xl overflow-hidden border border-slate-200 cursor-pointer shadow-sm active:scale-95">
                                <img src={url} className="w-full h-full object-cover" alt="evidence" />
                              </div>
                            ))}
                          </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
