
import React, { useState, useMemo, useEffect } from 'react';
import { PalletType, InventoryRecord, Trip, UserRole, PressCode, CenterCode, UserCredentials } from '../types';
import { analyzeInventory } from '../services/geminiService';

interface Props {
  palletTypes: PalletType[];
  records: InventoryRecord[];
  trips: Trip[];
  currentTripId: string;
  role: UserRole;
  userCode: string;
  userCenter: CenterCode | null;
  users: UserCredentials[];
  onSelectCenter: (center: CenterCode) => void;
  onNewTrip: (press: PressCode, center: CenterCode, selections: { typeId: string, count: number }[], semester: string, year: string) => void;
}

type LabelSize = '10x15' | '3x4';

export const SubulLogo: React.FC<{ size?: number; color?: string }> = ({ size = 48, color = "white" }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 30C20 24.4772 24.4772 20 30 20H70C75.5228 20 80 24.4772 80 30V70C80 75.5228 75.5228 80 70 80H30C24.4772 80 20 75.5228 20 70V30Z" fill="url(#paint0_linear)" fillOpacity="0.1"/>
    <path d="M50 25V75M50 25C50 21 46 18 40 18H25V65H40C46 65 50 68 50 72M50 25C50 21 54 18 60 18H75V65H60C54 65 50 68 50 72" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M30 35H40M30 45H40M60 35H70M60 45H70" stroke={color} strokeWidth="4" strokeLinecap="round"/>
    <path d="M15 85C30 75 70 95 85 85" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.5"/>
    <defs>
      <linearGradient id="paint0_linear" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
        <stop stopColor={color}/>
        <stop offset="1" stopColor={color} stopOpacity="0"/>
      </linearGradient>
    </defs>
  </svg>
);

export const Dashboard: React.FC<Props> = ({ palletTypes, records, trips, currentTripId, role, userCode, userCenter, users, onSelectCenter, onNewTrip }) => {
  const [showForm, setShowForm] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [pCode, setPCode] = useState<PressCode>(userCode);
  const [cCode, setCCode] = useState<CenterCode>('');
  const [semester, setSemester] = useState('1'); 
  const [year, setYear] = useState('6'); 
  const [selections, setSelections] = useState<Record<string, number>>({});
  
  const [activeChoiceId, setActiveChoiceId] = useState<string | null>(null);
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const [selectedSize, setSelectedSize] = useState<LabelSize>('10x15');

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const centerOptions = useMemo(() => users.filter(u => u.role === 'center'), [users]);

  useEffect(() => {
    if (centerOptions.length > 0 && !cCode) setCCode(centerOptions[0].code);
  }, [centerOptions, cCode]);

  const isAdmin = useMemo(() => userCode === 'ADMIN', [userCode]);

  const statsRecords = useMemo(() => {
    return (role === 'monitor' || isAdmin) ? records : records.filter(r => {
      if (role === 'factory') return r.palletBarcode.includes(userCode);
      if (role === 'center') return r.destination === userCenter;
      return false;
    });
  }, [records, role, userCode, userCenter, isAdmin]);

  const handleAiAnalysis = async () => {
    setIsAnalyzing(true);
    const result = await analyzeInventory(palletTypes, statsRecords);
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  const currentTrip = useMemo(() => trips.find(t => t.id === currentTripId), [trips, currentTripId]);
  const currentTripRecords = useMemo(() => records.filter(r => r.tripId === currentTripId), [records, currentTripId]);

  const stats = useMemo(() => {
    const received = statsRecords.filter(r => r.status === 'received');
    
    const stageSummary = palletTypes.map(type => {
      const typeReceived = received.filter(r => r.palletTypeId === type.id);
      const palletCount = typeReceived.length;
      const totalCartons = palletCount * type.cartonsPerPallet;
      const totalBundles = totalCartons * type.bundlesPerCarton;
      
      return { ...type, palletCount, totalCartons, totalBundles };
    }).filter(s => s.palletCount > 0);

    const totalBundles = stageSummary.reduce((acc, s) => acc + s.totalBundles, 0);
    const totalCartons = stageSummary.reduce((acc, s) => acc + s.totalCartons, 0);

    // حساب إجمالي عدد الكراتين المتضررة بدقة
    const totalExtDamagedCartons = received.reduce((acc, r) => acc + (r.externalDamageQty || 0), 0);
    const totalIntDamagedCartons = received.reduce((acc, r) => acc + (r.internalDamageQty || 0), 0);
    const totalDamagedCartons = totalExtDamagedCartons + totalIntDamagedCartons;

    return { 
      total: statsRecords.length, 
      received: received.length,
      totalCartons,
      totalBundles,
      stageSummary,
      totalDamagedCartons,
      totalExtDamagedCartons,
      totalIntDamagedCartons,
      palletsWithDamage: received.filter(r => r.condition && r.condition !== 'intact').length,
    };
  }, [statsRecords, palletTypes]);

  const getDisplayName = (code: string) => users.find(u => u.code === code)?.displayName || code;

  const generateLabelContent = (record: InventoryRecord, size: LabelSize) => {
    const pType = palletTypes.find(t => t.id === record?.palletTypeId);
    const trip = trips.find(t => t.id === record.tripId) || currentTrip;
    const barcodeImgUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${record?.palletBarcode}&scale=4&rotate=N&includetext=false`;
    const isLarge = size === '10x15';

    return `
      <div class="label-card" style="width: 100%; height: 100%; border: ${isLarge ? '8px' : '4px'} solid black; padding: ${isLarge ? '8mm' : '4mm'}; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: white; font-family: 'Tajawal', sans-serif; overflow: hidden; text-align: center; page-break-after: always;">
         <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: ${isLarge ? '4px' : '2px'} solid black; padding-bottom: ${isLarge ? '10px' : '5px'};">
            <div style="text-align: right;">
               <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 800;">توصيل الكتب</div>
               <div style="font-size: ${isLarge ? '48px' : '26px'}; font-weight: 900; line-height: 0.9;">سبل</div>
            </div>
            <div style="background: black; color: white; padding: ${isLarge ? '8px 12px' : '4px 6px'}; border-radius: 6px; text-align: center;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700;">الرحلة</div>
               <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900;">#${trip?.tripNumber || '---'}</div>
            </div>
         </div>
         <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${isLarge ? '12px' : '6px'}; padding: 5px 0;">
            <div style="font-size: ${isLarge ? '13px' : '8px'}; font-weight: 900; color: #333;">PALLET BARCODE</div>
            <img src="${barcodeImgUrl}" style="width: 100%; max-height: ${isLarge ? '85px' : '45px'}; object-fit: contain;" />
            <div style="background: black; color: white; width: 100%; padding: ${isLarge ? '10px' : '5px'}; font-size: ${isLarge ? '26px' : '14px'}; font-weight: 900; font-family: monospace;">
               ${record?.palletBarcode}
            </div>
         </div>
         <div style="padding: ${isLarge ? '8px 0' : '4px 0'}; border-top: ${isLarge ? '3px' : '1.5px'} solid black; border-bottom: ${isLarge ? '3px' : '1.5px'} solid black; margin-bottom: 5px;">
            <div style="font-size: ${isLarge ? '24px' : '12px'}; font-weight: 900; line-height: 1.1;">${pType?.stageName}</div>
         </div>
         <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
            <div style="text-align: right; border-left: ${isLarge ? '2px' : '1px'} solid black; padding-left: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المرسل:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900;">${getDisplayName(trip?.pressCode || '')}</div>
            </div>
            <div style="text-align: right; padding-right: 5px;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700; color: #555;">المستلم:</div>
               <div style="font-size: ${isLarge ? '15px' : '9px'}; font-weight: 900;">${getDisplayName(record.destination)}</div>
            </div>
         </div>
      </div>
    `;
  };

  const handlePrintAllBatch = () => {
    if (currentTripRecords.length === 0) return;
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const allLabelsHTML = currentTripRecords.map(record => generateLabelContent(record, selectedSize)).join('');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`<html dir="rtl"><head><title>Trip Labels</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; } .label-card { width: ${w}mm; height: ${h}mm; }</style></head><body>${allLabelsHTML}<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 500); };</script></body></html>`);
        printWindow.document.close();
    }
    setIsBatchPrinting(false);
  };

  const handlePrintSingle = (id: string) => {
    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const record = records.find(r => r.id === id);
    if (!record) return;
    const content = generateLabelContent(record, selectedSize);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(`<html dir="rtl"><head><title>Label</title><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@700;900&display=swap" rel="stylesheet"><style>@page { size: ${w}mm ${h}mm; margin: 0; } body { margin: 0; padding: 0; width: ${w}mm; height: ${h}mm; overflow: hidden; }</style></head><body>${content}<script>window.onload = () => { setTimeout(() => { window.print(); window.close(); }, 300); };</script></body></html>`);
        printWindow.document.close();
    }
    setActiveChoiceId(null);
  };

  const handleNewTripSubmit = () => {
    const selectedEntries = Object.entries(selections) as [string, number][];
    const selectedList = selectedEntries.filter(([_, count]) => count > 0).map(([typeId, count]) => ({ typeId, count }));
    if (selectedList.length === 0) { alert('يرجى اختيار مرحلة واحدة على الأقل'); return; }
    if (!cCode) { alert('يرجى اختيار وجهة الاستلام'); return; }
    onNewTrip(pCode, cCode, selectedList, semester, year);
    setShowForm(false); setSelections({});
    setTimeout(() => setShowLabels(true), 500);
  };

  const isMonitor = role === 'monitor' || isAdmin;
  const showStatsReport = isMonitor || role === 'center';

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <section className="bg-gradient-to-br from-indigo-900 to-indigo-800 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col items-center text-center gap-4">
         <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
         <div className="relative p-2 bg-white/10 backdrop-blur-xl rounded-[2.5rem] shadow-inner border border-white/10">
            <SubulLogo size={80} color="white" />
         </div>
         <div className="space-y-1 relative z-10">
            <h2 className="text-2xl font-black text-white leading-tight">سبل للخدمات اللوجستية</h2>
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-[0.3em]">
               {role === 'center' ? `إدارة استلام ${getDisplayName(userCenter || '')}` : 'نظام تتبع الكتب المدرسية'}
            </p>
         </div>
         {isAdmin && (
            <button onClick={handleAiAnalysis} disabled={isAnalyzing} className={`mt-2 px-6 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95 ${isAnalyzing ? 'animate-pulse' : ''}`}>
              {isAnalyzing ? 'جاري التحليل...' : '✨ تحليل الذكاء الاصطناعي'}
            </button>
         )}
      </section>

      {isAdmin && aiAnalysis && (
        <section className="animate-slideDown">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-t-4 border-indigo-500 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
               <h3 className="text-sm font-black text-indigo-900">✨ توصيات ذكاء سبل</h3>
               <button onClick={() => setAiAnalysis(null)} className="text-[10px] font-bold text-slate-400">إغلاق</button>
            </div>
            <div className="text-xs leading-relaxed text-slate-600 font-bold whitespace-pre-line">{aiAnalysis}</div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">📦</span>
          <span className="text-xl font-black text-slate-800">{stats.total}</span>
          <span className="text-[10px] font-bold text-slate-400">إجمالي {role === 'center' ? 'الوارد' : 'الطبليات'}</span>
        </div>
        <div className="bg-emerald-50 p-6 rounded-[2.5rem] shadow-sm border border-emerald-100 flex flex-col items-center text-center">
          <span className="text-3xl mb-2">✅</span>
          <span className="text-xl font-black text-emerald-700">{stats.received}</span>
          <span className="text-[10px] font-bold text-emerald-500">تم استلامها</span>
        </div>
      </section>

      {showStatsReport && (
        <section className="space-y-4 animate-slideDown">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
               <h2 className="text-lg font-black text-indigo-900">📊 تقرير التلفيات والمخزون</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-indigo-50 p-5 rounded-3xl text-right border border-indigo-100">
                <span className="text-[9px] font-black text-indigo-400 block mb-1 uppercase">إجمالي الكتب (كراتين)</span>
                <span className="text-xl font-black text-indigo-900">{stats.totalCartons.toLocaleString()} كرتون</span>
              </div>
              <div className="bg-emerald-50 p-5 rounded-3xl text-right border border-emerald-100">
                <span className="text-[9px] font-black text-emerald-400 block mb-1 uppercase">إجمالي الحزم</span>
                <span className="text-xl font-black text-emerald-700">{stats.totalBundles.toLocaleString()} حزمة</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-50">
               <div className="bg-rose-50 p-4 rounded-3xl text-center border border-rose-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">⚠️</span>
                  <span className="text-lg font-black text-rose-700 leading-none">{stats.totalDamagedCartons}</span>
                  <span className="text-[7px] font-black text-rose-400 block uppercase mt-1">إجمالي الكراتين التالفة</span>
               </div>
               <div className="bg-amber-50 p-4 rounded-3xl text-center border border-amber-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📦</span>
                  <span className="text-lg font-black text-amber-700 leading-none">{stats.totalExtDamagedCartons}</span>
                  <span className="text-[7px] font-black text-amber-400 block uppercase mt-1">تلف كراتين خارجي</span>
               </div>
               <div className="bg-orange-50 p-4 rounded-3xl text-center border border-orange-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📖</span>
                  <span className="text-lg font-black text-orange-700 leading-none">{stats.totalIntDamagedCartons}</span>
                  <span className="text-[7px] font-black text-orange-400 block uppercase mt-1">تلف كراتين داخلي</span>
               </div>
            </div>
          </div>
        </section>
      )}

      {role === 'factory' && (
        <div className="space-y-3">
            {currentTripId && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setShowLabels(true)} className="bg-white border-2 border-indigo-200 text-indigo-900 p-5 rounded-[2.5rem] font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm">👁️ استعراض الملصقات</button>
                  <button onClick={() => setIsBatchPrinting(true)} className="bg-indigo-900 text-white p-5 rounded-[2.5rem] font-black text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg">🖨️ طباعة الكل</button>
                </div>
            )}
            <button onClick={() => setShowForm(!showForm)} className="w-full bg-white border-2 border-indigo-600 text-indigo-600 p-6 rounded-[2.5rem] font-black text-sm flex items-center justify-center gap-3 shadow-xl hover:bg-indigo-50 transition-all">{showForm ? 'إلغاء' : '➕ إنشاء رحلة توريد جديدة'}</button>
        </div>
      )}

      {showForm && (
        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border border-slate-100 space-y-6 animate-slideDown">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">الوجهة</label>
              <select value={cCode} onChange={e => setCCode(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                {centerOptions.map(center => <option key={center.id} value={center.code}>{center.displayName}</option>)}
              </select>
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">المطبعة</label>
              <div className="w-full bg-slate-100 p-4 rounded-2xl text-xs font-black text-slate-500 text-center">{getDisplayName(pCode)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">الفصل الدراسي</label>
              <select value={semester} onChange={e => setSemester(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                <option value="1">الفصل الأول</option>
                <option value="2">الفصل الثاني</option>
                <option value="3">الفصل الثالث</option>
              </select>
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">العام الدراسي</label>
              <select value={year} onChange={e => setYear(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-bold outline-none ring-1 ring-slate-100">
                <option value="6">1446 هـ</option>
                <option value="7">1447 هـ</option>
                <option value="8">1448 هـ</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 mr-2">تحديد المراحل والكميات</label>
            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto p-2 bg-slate-50 rounded-2xl border border-slate-100">
              {palletTypes.map(type => (
                <div key={type.id} className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm border border-slate-100">
                  <span className="text-[11px] font-black text-slate-700">{type.stageName}</span>
                  <div className="flex items-center gap-2">
                    <button 
                      type="button"
                      onClick={() => setSelections(prev => ({ ...prev, [type.id]: Math.max(0, (prev[type.id] || 0) - 1) }))}
                      className="w-8 h-8 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                    >-</button>
                    <input 
                      type="number" 
                      min="0"
                      value={selections[type.id] || 0}
                      onChange={e => setSelections(prev => ({ ...prev, [type.id]: parseInt(e.target.value) || 0 }))}
                      className="w-12 text-center bg-transparent font-black text-xs outline-none"
                    />
                    <button 
                      type="button"
                      onClick={() => setSelections(prev => ({ ...prev, [type.id]: (prev[type.id] || 0) + 1 }))}
                      className="w-8 h-8 flex items-center justify-center bg-indigo-100 rounded-lg text-indigo-600 font-black"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={handleNewTripSubmit} className="w-full bg-indigo-900 text-white p-6 rounded-[2rem] font-black text-sm shadow-xl active:scale-95 transition-all">إرسال وتجهيز ملصقات سبل</button>
        </div>
      )}

      {(activeChoiceId || isBatchPrinting) && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl text-center border-4 border-indigo-900">
             <div className="text-4xl mb-2">📐</div>
             <h3 className="text-xl font-black text-slate-800">{isBatchPrinting ? 'طباعة كامل الرحلة' : 'إعدادات الطباعة'}</h3>
             <div className="flex gap-2">
                <button onClick={() => setSelectedSize('3x4')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '3x4' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>3 × 4 إنش</button>
                <button onClick={() => setSelectedSize('10x15')} className={`flex-1 py-3 rounded-xl font-black text-xs border-2 transition-all ${selectedSize === '10x15' ? 'bg-indigo-900 text-white border-indigo-900' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>10 × 15 سم</button>
             </div>
             <button onClick={() => isBatchPrinting ? handlePrintAllBatch() : handlePrintSingle(activeChoiceId!)} className="w-full bg-indigo-900 text-white p-5 rounded-2xl font-black text-sm active:scale-95 transition-all">بدء الطباعة</button>
             <button onClick={() => { setActiveChoiceId(null); setIsBatchPrinting(false); }} className="w-full bg-slate-100 text-slate-500 p-4 rounded-2xl font-black text-xs">إلغاء</button>
          </div>
        </div>
      )}

      {showLabels && (
        <div className="fixed inset-0 z-[5000] bg-slate-100 flex flex-col animate-fadeIn overflow-hidden">
          <div className="flex flex-col p-6 bg-white border-b shadow-md no-print gap-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-black text-slate-800">ملصقات الرحلة: #{currentTrip?.tripNumber}</h3>
              <div className="flex gap-2">
                <button onClick={() => setIsBatchPrinting(true)} className="bg-indigo-900 text-white px-4 py-2 rounded-xl font-black text-[10px]">🖨️ طباعة الكل</button>
                <button onClick={() => setShowLabels(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-xl font-black text-[10px]">إغلاق</button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6 items-center bg-slate-200">
             {currentTripRecords.map(record => (
               <div key={record.id} className="w-full max-w-sm bg-white p-5 rounded-3xl shadow-xl flex justify-between items-center">
                  <div className="text-right">
                    <div className="text-xs font-black text-slate-800">{palletTypes.find(t => t.id === record.palletTypeId)?.stageName}</div>
                    <div className="text-[10px] font-bold text-indigo-600 font-mono">{record.palletBarcode}</div>
                  </div>
                  <button onClick={() => setActiveChoiceId(record.id)} className="bg-indigo-900 text-white px-5 py-3 rounded-2xl font-black text-xs">🖨️ طباعة</button>
               </div>
             ))}
          </div>
        </div>
      )}
    </div>
  );
};
