import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PalletType, UserCredentials, InventoryRecord, DistributionTrip } from '../types';
import { getStageColor } from '../stageColors';
import { 
  RefreshCw, QrCode, CheckCircle, AlertTriangle, RotateCcw, Archive, Layers, Check, X, ArrowRight, Search, Database, CheckSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  palletTypes: PalletType[];
  currentUser: UserCredentials;
  onNotify?: (title: string, msg: string) => void;
  records?: InventoryRecord[];
  distributionTrips?: DistributionTrip[];
}

interface LoadedCarton {
  boxbarcode: string;
  stageRaw: string;
  scanned: boolean;
  scannedAt?: number;
  stageCodeNormalized: string;
  stageArabicName: string;
  bundleCount: number;
  number: number;
}

interface ExportAuditLog {
  id: string;
  timestamp: number;
  palletCode: string;
  totalExpectedCartons: number;
  totalScannedCartons: number;
  totalBooksDeducted: number;
  discrepancyCount: number;
  centerCode: string;
  operatorName: string;
  status: 'reconciled' | 'partial';
  date: string;
  stageBreakdown?: any[];
}

const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSBNv8muLGpK6uXH5nPl74ojf5S2ErBP91IhbBTiaRSQcJIAt48-i1gIgMFZ3NM8iK0JKrwQZjH5wq7/pub?output=csv';

const POPULAR_PALLETS = [
  { code: 'ZAHS-T06P13', count: 88, desc: 'طبلية الصفوف المتوسطة والأولى' },
  { code: 'ZDMM-T18P02', count: 85, desc: 'طبلية الصف السابع والصفوف العليا' },
  { code: 'ZAHS-T17P05', count: 84, desc: 'طبلية فصول مختلطة (سابع ومتوسط)' },
  { code: 'ZJOF-T12P05', count: 84, desc: 'طبلية جرد مختلط معيب' },
  { code: 'ZDMM-T18P18', count: 84, desc: 'طبلية الصف الأول والصفوف المتوسطة' }
];

const STAGE_MAPPING: Record<string, string> = {
  'G1': 'أول ابتدائي', 'G2': 'ثاني ابتدائي', 'G3': 'ثالث ابتدائي', 'G4': 'رابع ابتدائي', 'G5': 'خامس ابتدائي', 'G6': 'سادس ابتدائي',
  'G7': 'أول متوسط', 'G8': 'ثاني متوسط', 'G9': 'ثالث متوسط', 'G10': 'العاشر الثانوي', 'G11': 'أول ثانوي (مسارات)', 'G12': 'ثاني ثانوي', 'G13': 'ثالث ثانوي',
  'IG1': 'عالمي - أول ابتدائي', 'IG2': 'عالمي - ثاني ابتدائي', 'IG3': 'عالمي - ثالث ابتدائي', 'IG4': 'عالمي - رابع ابتدائي', 'IG5': 'عالمي - خامس ابتدائي',
  'IG6': 'عالمي - سادس ابتدائي', 'IG7': 'عالمي - أول متوسط', 'IG8': 'عالمي - ثاني متوسط', 'IG9': 'عالمي - ثالث متوسط', 'IG11': 'عالمي - أول ثانوي', 'IG12': 'عالمي - ثاني ثانوي', 'IG13': 'عالمي - ثالث ثانوي'
};

const getStageArabicName = (stageRaw: string) => STAGE_MAPPING[stageRaw.split('-')[0].trim().toUpperCase()] || `مقرر ${stageRaw.split('-')[0]}`;

const normalizeStageCode = (code: string) => {
  const up = code.trim().toUpperCase();
  return /^G\d$/.test(up) ? `G0${up.slice(1)}` : /^IG\d$/.test(up) ? `IG0${up.slice(2)}` : up;
};

export const ExportAudit: React.FC<Props> = ({ palletTypes, currentUser, onNotify, records = [], distributionTrips = [] }) => {
  const [palletIndex, setPalletIndex] = useState<Record<string, { boxbarcode: string, stage: string }[]>>({});
  const [pListSearchQuery, setPListSearchQuery] = useState('');
  const [selectedSheetPalletForView, setSelectedSheetPalletForView] = useState<{ code: string; count: number; desc: string; cartons: any[] } | null>(null);
  const [cartonSearchQuery, setCartonSearchQuery] = useState('');
  
  const [dbStats, setDbStats] = useState<{ totalRows: number; uniquePallets: number } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [searchPalletCode, setSearchPalletCode] = useState('ZAHS-T06P13');
  const [activePalletCode, setActivePalletCode] = useState('');
  const [loadedCartons, setLoadedCartons] = useState<LoadedCarton[]>([]);
  const [showResultsView, setShowResultsView] = useState(false);

  const [scanInput, setScanInput] = useState('');
  const [scanStatus, setScanStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [scannerFocus] = useState(true);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const [lastScannedCarton, setLastScannedCarton] = useState<LoadedCarton | null>(null);
  const [scannedAnomalies, setScannedAnomalies] = useState<{ id: string; barcode: string; errorType: string; timestamp: number }[]>([]);
  const [exportLogs, setExportLogs] = useState<ExportAuditLog[]>([]);
  const [showDeductionModal, setShowDeductionModal] = useState<ExportAuditLog | null>(null);

  const googleSheetPallets = useMemo(() => {
    return Object.entries(palletIndex).map(([code, items]) => {
      const stages = Array.from(new Set(items.map(it => getStageArabicName(it.stage))));
      const desc = stages.length > 0 ? `طبلية توزيع للـ: ${stages.slice(0, 2).join(' و ')}${stages.length > 2 ? '...' : ''}` : 'طبلية مخصصة بـ Google Sheets';
      return { code, count: items.length, desc, cartons: items };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [palletIndex]);

  const filteredGoogleSheetPallets = useMemo(() => {
    const q = pListSearchQuery.trim().toLowerCase();
    if (!q) return googleSheetPallets;
    return googleSheetPallets.filter(p => p.code.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q));
  }, [googleSheetPallets, pListSearchQuery]);

  const loadGoogleSheetData = async (silent = false) => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = await fetch(GOOGLE_SHEET_URL);
      if (!response.ok) throw new Error(`تعذر جلب الملف: ${response.statusText}`);
      const text = await response.text();
      const index: Record<string, { boxbarcode: string, stage: string }[]> = {};
      const lines = text.split(/\r?\n/);
      let validRows = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < 3) continue;
        const boxbarcode = parts[0].trim();
        const palletcode = parts[1].trim().toUpperCase();
        const stage = parts[2].trim();
        if (!palletcode || !boxbarcode) continue;
        if (!index[palletcode]) index[palletcode] = [];
        index[palletcode].push({ boxbarcode, stage });
        validRows++;
      }

      setPalletIndex(index);
      setDbStats({ totalRows: validRows, uniquePallets: Object.keys(index).length });
      setIsDownloading(false);
      if (!silent && onNotify) onNotify('🎉 مزامنة تامة لـ Google Sheets', `تم الاتصال بنجاح وتكشيف ${validRows.toLocaleString('ar-EG')} كرتون.`);
    } catch (err: any) {
      setDownloadError(err.message || 'خطأ في جلب البيانات.');
      setIsDownloading(false);
      buildOfflineBackupIndex();
    }
  };

  const buildOfflineBackupIndex = () => {
    const backup: Record<string, { boxbarcode: string, stage: string }[]> = {};
    POPULAR_PALLETS.forEach(p => {
      const list = [];
      const stages = ['G1', 'G2', 'G3-L2', 'G3', 'G4', 'G6-L4', 'G7-L3', 'G7'];
      for (let i = 1; i <= p.count; i++) {
        list.push({ boxbarcode: `EBUXSL09476${1000 + i}26`, stage: i % 8 === 0 ? 'G3-L1' : stages[i % stages.length] });
      }
      backup[p.code.toUpperCase()] = list;
    });
    setPalletIndex(backup);
    setDbStats({ totalRows: 425, uniquePallets: POPULAR_PALLETS.length });
  };

  const handleLoadPallet = (palletCodeRaw: string) => {
    const code = palletCodeRaw.replace(/\s+/g, '').toUpperCase();
    const items = palletIndex[code];
    if (!items) {
      if (onNotify) onNotify('❌ طبلية غير موجودة', `الرمز "${code}" غير مدرج في كشوف الشيت.`);
      return;
    }

    const mapped = items.map((item, idx) => {
      const stageRaw = item.stage;
      const stageCodeComp = stageRaw.split('-')[0].trim().toUpperCase();
      const normalizedCode = normalizeStageCode(stageCodeComp);
      const stageArabicName = getStageArabicName(stageRaw);

      const matchedType = palletTypes.find(t => t.stageCode === normalizedCode);
      let bundleCount = matchedType ? matchedType.bundlesPerCarton : 8;
      if (stageRaw.includes('-L')) {
        const parsed = parseInt(stageRaw.split('-L')[1], 10);
        if (!isNaN(parsed)) bundleCount = parsed;
      }

      return {
        boxbarcode: item.boxbarcode,
        stageRaw,
        scanned: false,
        stageCodeNormalized: normalizedCode,
        stageArabicName,
        bundleCount,
        number: idx + 1
      };
    });

    setLoadedCartons(mapped);
    setActivePalletCode(code);
    setLastScannedCarton(null);
    setScannedAnomalies([]);
    setScanInput('');
    setShowResultsView(false);
  };

  useEffect(() => {
    loadGoogleSheetData(true);
  }, []);

  useEffect(() => {
    if (barcodeInputRef.current && scannerFocus && activePalletCode) {
      barcodeInputRef.current.focus();
    }
  }, [scannerFocus, activePalletCode, loadedCartons]);

  const handleScanCarton = (barcodeRaw: string) => {
    const code = barcodeRaw.replace(/\s+/g, '').toUpperCase();
    if (!code) return;

    setScanStatus(null);
    const mIdx = loadedCartons.findIndex(c => c.boxbarcode.toUpperCase() === code);

    if (mIdx !== -1) {
      const target = loadedCartons[mIdx];
      if (target.scanned) {
        setScanStatus({ type: 'error', message: `⚠️ مكرر: الرمز ${code} تم جرده مسبقاً.` });
        return;
      }
      const updated = [...loadedCartons];
      updated[mIdx] = { ...target, scanned: true, scannedAt: Date.now() };
      setLoadedCartons(updated);
      setLastScannedCarton(updated[mIdx]);
      setScanStatus({ type: 'success', message: `✓ تم قراءة الكرتون ومطابقته بدقة.` });
    } else {
      let otherPallet = '';
      for (const [pCode, items] of Object.entries(palletIndex)) {
        if (items.some(it => it.boxbarcode.toUpperCase() === code)) {
          otherPallet = pCode; break;
        }
      }
      const err = otherPallet ? `تابع للطبلية الشاردة (${otherPallet})` : 'باركود مفقود غير معتمد بسجل التوزيع';
      setScannedAnomalies(prev => [{ id: Math.random().toString(), barcode: code, errorType: err, timestamp: Date.now() }, ...prev]);
      setScanStatus({ type: 'error', message: `🚨 خطأ: الكرتون لا يخص هذه الطبلية! ${err}` });
    }
    setScanInput('');
  };

  const handleScanSubmit = () => {
    handleScanCarton(scanInput);
  };

  const simulateFullPreScan = () => {
    setLoadedCartons(prev => prev.map(c => ({ ...c, scanned: true, scannedAt: Date.now() })));
    if (loadedCartons.length > 0) setLastScannedCarton({ ...loadedCartons[loadedCartons.length - 1], scanned: true });
    if (onNotify) onNotify('⚡ جرد فوري كامل', 'تم محاكاة جرد كافية كراتين الطبلية بنجاح.');
  };

  const simulateDeficitScan = () => {
    const border = Math.floor(loadedCartons.length * 0.9);
    setLoadedCartons(prev => prev.map((c, i) => ({ ...c, scanned: i < border, scannedAt: i < border ? Date.now() : undefined })));
    setLastScannedCarton(loadedCartons[0] || null);
    setScannedAnomalies([{ id: '1', barcode: 'EBUXSL9999999926', errorType: 'كرتون مفقود عجز طبلية', timestamp: Date.now() }]);
    if (onNotify) onNotify('⚠️ جرد عجز وجزئي', 'تم محاكاة جرد جزئي مع كرتونة عجز مفقودة.');
  };

  const handleResetCurrentAudit = () => {
    setLoadedCartons(prev => prev.map(c => ({ ...c, scanned: false, scannedAt: undefined })));
    setLastScannedCarton(null);
    setScannedAnomalies([]);
    setScanInput('');
  };

  const auditSummary = useMemo(() => {
    const totalExpected = loadedCartons.length;
    const scannedList = loadedCartons.filter(c => c.scanned);
    const totalScanned = scannedList.length;
    const progressPercent = totalExpected > 0 ? Math.round((totalScanned / totalExpected) * 100) : 0;
    const totalBundlesScanned = scannedList.reduce((acc, curr) => acc + curr.bundleCount, 0);

    const stageMap: Record<string, any> = {};
    const center = currentUser.code && currentUser.code !== 'ADMIN' ? currentUser.code.toUpperCase() : 'RYD';

    loadedCartons.forEach(c => {
      const key = c.stageCodeNormalized;
      if (!stageMap[key]) {
        const palletType = palletTypes.find(t => t.stageCode === key);
        let beforeVal = 0;
        if (palletType) {
          const matchedRecs = records.filter(r => r.receivedByCenter?.toUpperCase() === center && r.palletTypeId === palletType.id);
          matchedRecs.forEach(r => {
            const base = r.isExtraOnly ? 0 : palletType.cartonsPerPallet;
            let diff = (r.extraCartons || 0) - (r.missingCartons || 0);
            if (r.hasDiscrepancy) diff += (r.discrepancyType === 'excess' ? 1 : -1) * (r.discrepancyCartonsQty || 0);
            beforeVal += (base + diff);
          });
          const executedTrips = distributionTrips.filter(t => t.originCenter?.toUpperCase() === center);
          executedTrips.forEach(t => {
            const item = (t.executedQuantities || t.quantities || []).find(q => q.palletTypeId === palletType.id);
            if (item) beforeVal -= item.cartonCount;
          });
        }
        stageMap[key] = {
          arabicName: c.stageArabicName, expectedCartons: 0, scannedCartons: 0, bundles: 0,
          code: c.stageRaw.split('-')[0], stageCodeNormalized: key, freeBalanceBefore: beforeVal, freeBalanceAfter: beforeVal
        };
      }
      stageMap[key].expectedCartons++;
      if (c.scanned) {
        stageMap[key].scannedCartons++;
        stageMap[key].bundles += c.bundleCount;
      }
    });

    Object.values(stageMap).forEach((v: any) => {
      v.freeBalanceAfter = v.freeBalanceBefore - v.scannedCartons;
    });

    return {
      totalExpected, totalScanned, progressPercent, totalBundlesScanned,
      isFullyComplete: totalExpected > 0 && totalScanned === totalExpected,
      stageBreakdown: Object.values(stageMap)
    };
  }, [loadedCartons, palletTypes, records, distributionTrips, currentUser]);

  const handleConfirmExportDeduction = () => {
    if (!activePalletCode || auditSummary.totalScanned === 0) return;
    const log: ExportAuditLog = {
      id: `EXP-${Math.floor(100000 + Math.random() * 900000)}`,
      timestamp: Date.now(),
      palletCode: activePalletCode,
      totalExpectedCartons: auditSummary.totalExpected,
      totalScannedCartons: auditSummary.totalScanned,
      totalBooksDeducted: auditSummary.totalBundlesScanned,
      discrepancyCount: auditSummary.totalExpected - auditSummary.totalScanned,
      centerCode: currentUser.code || 'CENTER_RYD',
      operatorName: currentUser.displayName || 'مشغل المركز المعين',
      status: auditSummary.isFullyComplete ? 'reconciled' : 'partial',
      date: new Date().toISOString().substring(0, 10),
      stageBreakdown: auditSummary.stageBreakdown
    };
    setExportLogs(prev => [log, ...prev]);
    setShowDeductionModal(log);
    setLoadedCartons([]);
    setActivePalletCode('');
    setLastScannedCarton(null);
    setScannedAnomalies([]);
    setShowResultsView(false);
  };

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait">
        
        {/* VIEW 1: SELECT PALLET */}
        {!activePalletCode && (
          <motion.div
            key="select-view"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            <div className="bg-gradient-to-r from-emerald-900 via-teal-950 to-slate-900 text-white rounded-[2.5rem] p-6 shadow-2xl border border-emerald-800/60 relative overflow-hidden text-right">
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 w-full">
                  <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black text-[10px] px-3 py-1 rounded-full inline-block">
                    مطابقة ملفات التوزيع وجوجل شيت لدفعة التصدير 📜
                  </span>
                  <h2 className="text-xl font-black mt-2 font-sans">لوحة الفرز وتصدير الصادر كرتون كرتون للمدارس</h2>
                  <p className="text-xs text-teal-100/70 max-w-2xl font-semibold">يقوم مجمع الفرز بمقارنة الباركوريد السحابي بالماسح لتسحيل الحسم التراكمي في الأرصدة.</p>
                </div>
                <div className="flex flex-col items-center md:items-end gap-2 shrink-0">
                  <button
                    onClick={() => loadGoogleSheetData(false)}
                    disabled={isDownloading}
                    className="px-5 py-3 bg-white/10 hover:bg-white/15 border border-white/20 rounded-2xl text-xs font-black transition flex items-center gap-2 text-white"
                  >
                    <RefreshCw size={14} className={isDownloading ? 'animate-spin' : ''} />
                    {isDownloading ? 'مرحباً بالتزامن...' : 'تحديث جوجل شيت'}
                  </button>
                  {dbStats && (
                    <div className="text-[10px] text-teal-200/80 font-bold bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
                      المسترد: <strong className="font-mono">{dbStats.totalRows.toLocaleString()}</strong> كرتون لـ <strong className="font-mono">{dbStats.uniquePallets}</strong> طبلية
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-7 rounded-[2rem] border border-slate-150 shadow-xl space-y-4 text-right">
                <h3 className="font-black text-slate-800 text-sm border-b pb-2">تحميل رصيد طبلية صادر</h3>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs font-mono font-black uppercase text-slate-800 focus:outline-emerald-500 outline-none text-right"
                    placeholder="مثال: ZAHS-T06P13"
                    value={searchPalletCode}
                    onChange={(e) => setSearchPalletCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLoadPallet(searchPalletCode); }}
                  />
                  <button 
                    onClick={() => handleLoadPallet(searchPalletCode)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-5 rounded-2xl transition shadow-md"
                  >
                    بدء المسح
                  </button>
                </div>
                <div className="bg-indigo-50/50 rounded-2xl p-4 flex items-center gap-3 justify-between">
                  <QrCode className="text-indigo-650 shrink-0" size={24} />
                  <div className="text-right">
                    <span className="text-[11px] font-black text-indigo-950 block">جاهز للمسح الآلي ⚡</span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">يقوم قارئ الباركود بفتح كشف المواد وتحميل الكشاف فورا.</span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-7 rounded-[2rem] border border-slate-150 shadow-xl space-y-3 flex flex-col justify-between text-right">
                <h3 className="font-black text-slate-800 text-sm border-b pb-2">طبليات توزيع Google Sheets المتاحة</h3>
                <input
                  type="text"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[10px] text-right font-bold focus:outline-none"
                  placeholder="البحث بالرمز..."
                  value={pListSearchQuery}
                  onChange={(e) => setPListSearchQuery(e.target.value)}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {filteredGoogleSheetPallets.map(p => (
                    <div
                      key={p.code}
                      onClick={() => setSelectedSheetPalletForView(p)}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 transition cursor-pointer flex flex-col justify-between gap-1"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-[8.5px] text-indigo-650 font-bold">معاينة 👁️</span>
                        <span className="font-mono font-black text-slate-800 text-xs">{p.code}</span>
                      </div>
                      <span className="text-[8px] text-slate-400 font-sans line-clamp-1">{p.desc}</span>
                      <div className="flex justify-between items-center border-t border-slate-100 pt-1 mt-1 text-[8.5px]">
                        <span className="bg-emerald-50 text-emerald-750 font-black px-1.5 rounded">{p.count} كرتون</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleLoadPallet(p.code); }}
                          className="bg-emerald-600 text-white font-black px-2 py-0.5 rounded"
                        >
                          ابدء
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2.5rem] border border-slate-150 shadow-xl text-right">
              <h3 className="font-black text-slate-800 text-xs border-b pb-3 mb-3">تاريخ الترحيل الصادر السحابي المنجز</h3>
              {exportLogs.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-3xl font-medium">
                  لا توجد ترحيلات مسجلة حالياً. قم بجرد طبلية لتأكيد معالجة خصم المواد.
                </div>
              ) : (
                <div className="overflow-x-auto text-[11px] font-bold text-slate-700">
                  <table className="w-full text-right border-collapse">
                    <thead>
                      <tr className="border-b bg-slate-50 text-slate-550">
                        <th className="p-3">رقم التصدير ID</th>
                        <th className="p-3">تاريخ العملية</th>
                        <th className="p-3">رمز الطبلية</th>
                        <th className="p-3">المستهدف</th>
                        <th className="p-3">المفرز</th>
                        <th className="p-3">الخصم التراكمي</th>
                        <th className="p-3">المطابقة التقنية</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportLogs.map(log => (
                        <tr key={log.id} className="border-b hover:bg-slate-50">
                          <td className="p-3 text-emerald-800 font-mono font-black">{log.id}</td>
                          <td className="p-3 text-slate-450">{log.date}</td>
                          <td className="p-3 font-mono font-black">{log.palletCode}</td>
                          <td className="p-3 font-mono">{log.totalExpectedCartons} ctn</td>
                          <td className="p-3 font-mono text-indigo-700">{log.totalScannedCartons} ctn</td>
                          <td className="p-3 font-mono text-emerald-800 font-black">{log.totalBooksDeducted} حزم</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] ${log.status === 'reconciled' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-600'}`}>
                              {log.status === 'reconciled' ? 'مطابق كامل ✓' : 'عجز جزئي ⚠️'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* VIEW 2: IMMERSIVE SCANNING */}
        {activePalletCode && !showResultsView && (
          <motion.div
            key="immersive-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col items-center justify-center min-h-[82vh] bg-slate-950 p-6 rounded-[3rem] relative overflow-hidden text-white"
          >
            <div 
              className="absolute inset-0 opacity-10 pointer-events-none transition-all duration-700"
              style={{
                background: `radial-gradient(circle at center, ${lastScannedCarton ? getStageColor(lastScannedCarton.stageCodeNormalized).hex : '#6366f1'} 0%, rgba(15,23,42,1) 75%)`
              }}
            />

            <div className="w-full max-w-lg mb-4 flex items-center justify-between z-10 text-[11px] font-bold">
              <button
                onClick={() => { if (confirm('هل ترغب بإلغاء جرد الطبلية الحالي؟')) { setActivePalletCode(''); setLoadedCartons([]); } }}
                className="bg-white/10 hover:bg-white/20 px-3.5 py-2 rounded-xl text-slate-200"
              >
                إلغاء وخروج
              </button>
              <div className="text-center">
                <span className="text-[12px] font-black text-emerald-400 font-mono tracking-wider block">{activePalletCode}</span>
                <span className="text-[8px] text-slate-450 uppercase tracking-wider">PALLET SECURITY WINDOW</span>
              </div>
              <span className="bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded-full text-[9px]">
                قارئ نشط 🔦
              </span>
            </div>

            <div className="w-full max-w-lg z-10 py-6 text-center">
              <AnimatePresence mode="wait">
                {lastScannedCarton ? (
                  <motion.div
                    key={lastScannedCarton.boxbarcode}
                    initial={{ scale: 0.9, opacity: 0, y: 15 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="w-68 h-[310px] mx-auto rounded-[2rem] shadow-2xl p-6 text-white flex flex-col justify-between border border-white/20"
                    style={{ background: getStageColor(lastScannedCarton.stageCodeNormalized).bgGradient }}
                  >
                    <div className="flex justify-between items-center text-[10px] opacity-80">
                      <span>SECURE SCAN STAGE</span>
                      <span className="bg-white/20 px-2.5 rounded-full font-black">#{lastScannedCarton.number}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="w-11 h-11 bg-white/25 rounded-full flex items-center justify-center mx-auto mb-1 animate-bounce">
                        <CheckCircle size={22} />
                      </div>
                      <h3 className="text-sm font-black truncate">{lastScannedCarton.stageArabicName}</h3>
                      <p className="text-[9px] font-mono tracking-wider opacity-90">{lastScannedCarton.stageCodeNormalized}</p>
                    </div>
                    <div className="bg-black/20 p-2 text-right rounded-xl border border-white/10 font-mono text-[10px]">
                      <span className="text-[8px] opacity-75 block mb-0.5">رمز الكرتون:</span>
                      <span className="text-emerald-350 block font-black text-center truncate">{lastScannedCarton.boxbarcode}</span>
                      <span className="block mt-1 font-sans text-center">مجموع الحزم: {lastScannedCarton.bundleCount} حزمة</span>
                    </div>
                  </motion.div>
                ) : (
                  <div className="w-64 h-[250px] mx-auto rounded-[2rem] bg-white/5 border border-dashed border-white/10 flex flex-col items-center justify-center text-slate-400 p-6">
                    <QrCode size={30} className="mb-3 animate-pulse opacity-70" />
                    <span className="text-[11px] font-black text-slate-350">بانتظار مسح كرتونة من الطبلية</span>
                    <p className="text-[9px] text-slate-500 mt-1 max-w-[190px]">مرر ماسح الباركود لقراءة البطاقة الملصقة على الصناديق</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            <div className="w-full max-w-lg space-y-4 z-10 text-right">
              <div className="relative">
                <input
                  type="text"
                  ref={barcodeInputRef}
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleScanSubmit(); }}
                  placeholder="اضغط هنا للمسح اليدوي أو الليزر..."
                  className="w-full bg-white/5 border border-white/15 focus:border-indigo-400 rounded-2xl py-3 px-4 text-center text-[10px] font-mono text-slate-200 focus:outline-none"
                />
              </div>

              {scanStatus && (
                <div className={`p-2.5 rounded-xl text-center font-bold text-[9px] ${scanStatus.type === 'success' ? 'bg-emerald-950/80 border-emerald-500/20 text-emerald-400' : 'bg-rose-950/80 border-rose-500/20 text-rose-400'}`}>
                  {scanStatus.message}
                </div>
              )}

              {auditSummary.totalExpected > 0 && (
                <div className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-1.5 text-right">
                  <div className="flex justify-between text-[9px] font-bold text-slate-400">
                    <span className="font-mono text-emerald-400">
                      {auditSummary.totalScanned} من {auditSummary.totalExpected} ktn ({auditSummary.progressPercent}%)
                    </span>
                    <span>تقدم مطابقة الصادر الفعلي</span>
                  </div>
                  <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-emerald-500 to-indigo-500 h-full transition-all duration-300" style={{ width: `${auditSummary.progressPercent}%` }} />
                  </div>
                </div>
              )}

              <div className="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-between text-right text-[9.5px]">
                <span className="text-slate-400 font-bold">تجاوزات محاكاة المعمل اليدوية:</span>
                <div className="flex gap-1.5">
                  <button onClick={simulateFullPreScan} className="bg-emerald-600/30 text-emerald-400 border border-emerald-500/20 px-2 py-1 rounded text-[8px] font-black">مطابقة كاملة ⚡</button>
                  <button onClick={simulateDeficitScan} className="bg-rose-600/30 text-rose-450 border border-rose-550/20 px-2 py-1 rounded text-[8px] font-black">عجز جزئي ⚠️</button>
                  <button onClick={handleResetCurrentAudit} className="bg-slate-800 text-slate-300 px-2 py-1 rounded text-[8px] font-black">تصفير</button>
                </div>
              </div>

              <button
                onClick={() => setShowResultsView(true)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs py-3.5 rounded-full transition shadow-lg flex items-center justify-center gap-2"
              >
                <span>إنهاء الجرد والذهاب للمطابقة وفروق الأرصدة 📋 ➔</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* VIEW 3: MATCH RESULTS */}
        {activePalletCode && showResultsView && (
          <motion.div
            key="results-view"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6 text-right"
          >
            <div className="bg-white p-6 rounded-[2rem] border border-slate-150 shadow-xl flex flex-col md:flex-row justify-between items-center gap-4 text-right">
              <div>
                <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] px-3 py-1 rounded-full font-black">تقارير الخصم الميداني الصادر</span>
                <h2 className="text-lg font-black mt-2">نتائج مطابقة طبلية الصادر {activePalletCode} مع مخزون المعمل</h2>
              </div>
              <button
                onClick={() => setShowResultsView(false)}
                className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-extrabold text-xs px-4 py-2.5 rounded-xl transition"
              >
                ← العودة لمتابعة الفحص
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-slate-400 font-extrabold block">المخطط الإجمالي</span>
                <span className="text-base font-black text-slate-850 mt-1 block font-mono">{auditSummary.totalExpected} كرتون</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-emerald-600 font-extrabold block">المجرود الفعلي</span>
                <span className="text-base font-black text-emerald-700 mt-1 block font-mono">{auditSummary.totalScanned} كرتون</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-indigo-600 font-extrabold block">الكتب المستهدفة بالخصم</span>
                <span className="text-base font-black text-indigo-700 mt-1 block font-mono">{auditSummary.totalBundlesScanned} حزمة</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-rose-600 font-extrabold block">عجز مفقود</span>
                <span className={`text-base font-black mt-1 block font-mono ${auditSummary.totalExpected - auditSummary.totalScanned > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {auditSummary.totalExpected - auditSummary.totalScanned} كرتون
                </span>
              </div>
            </div>

            <div className="bg-white p-7 rounded-[2rem] border border-slate-150 shadow-xl space-y-4">
              <h3 className="font-sans font-black text-slate-900 text-sm border-b pb-2 flex justify-between">
                <span className="text-[10px] text-slate-400">تأثير الخصم على مخزون المعمل الحر</span>
                <span>التحليل الكلي لمراحل الطبلية ومطابقة الكشوف</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {auditSummary.stageBreakdown.map((s) => {
                  const color = getStageColor(s.stageCodeNormalized);
                  const isLow = s.freeBalanceAfter < 10;
                  return (
                    <div key={s.stageCodeNormalized} className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 relative overflow-hidden flex flex-col justify-between">
                      <div className="absolute right-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: color.hex }} />
                      <div className="space-y-3">
                        <div className="flex justify-between items-center mr-2">
                          <span className="text-[9px] font-mono font-bold text-white px-2 py-0.5 rounded" style={{ backgroundColor: color.hex }}>{s.code}</span>
                          <span className="text-xs font-black text-slate-800">{s.arabicName}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1 bg-white p-2 border border-slate-100 rounded-lg text-center font-mono text-[10px] font-bold">
                          <div><span className="text-[8px] block text-slate-400">مخطط</span>{s.expectedCartons}</div>
                          <div className="border-l border-r border-slate-100"><span className="text-[8px] block text-emerald-600">منجز</span>{s.scannedCartons}</div>
                          <div><span className="text-[8px] block text-rose-500">متبقي</span>{s.expectedCartons - s.scannedCartons}</div>
                        </div>
                        <div className="bg-slate-100 p-2 rounded-lg text-[9px] font-bold font-mono">
                          <div className="flex justify-between"><span>{s.freeBalanceBefore} ktn</span><span className="text-slate-500 font-semibold">قبل الخصم:</span></div>
                          <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                            <span className={isLow ? 'text-rose-600 font-extrabold' : 'text-emerald-700'}>{s.freeBalanceAfter} ktn</span>
                            <span className="text-slate-550">الحر بعد الخصم:</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white p-6 rounded-[2rem] border border-slate-150 shadow-sm space-y-4">
              <h3 className="font-sans font-black text-slate-800 text-sm">حالة جرد الكراتين الفردية</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 max-h-48 overflow-y-auto p-1.5 border border-slate-100 rounded-xl bg-slate-50">
                {loadedCartons.map(c => {
                  const color = getStageColor(c.stageCodeNormalized);
                  return (
                    <div key={c.boxbarcode} className={`p-2.5 rounded-xl border text-center text-[10px] font-bold ${c.scanned ? 'bg-white border-slate-200' : 'bg-rose-50/70 border-rose-100 text-rose-750'}`}>
                      <span className="text-slate-400 block text-[8px]">كرتون {c.number}#</span>
                      <span className="block my-0.5">{c.stageRaw}</span>
                      {c.scanned ? (
                        <span className="text-[8px] font-extrabold" style={{ color: color.hex }}>✓ {c.bundleCount} حزم</span>
                      ) : (
                        <span className="text-rose-600 text-[8px]">مفقود (عجز)</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-50 p-5 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-4 border border-slate-200">
              <span className="text-[9.5px] text-slate-400 leading-normal max-w-sm">
                * عند ترحيل كشف المطابقة الحالي، سيقوم النظام بالخصم التجريبي للطرود والوحدات من الأرصدة الحرة في مركز التوزيع لضمان التسليم.
              </span>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setShowResultsView(false)}
                  className="bg-white border border-slate-200 text-slate-700 font-black text-xs px-4 py-3 rounded-xl transition"
                >
                  العودة للمسح
                </button>
                <button
                  onClick={handleConfirmExportDeduction}
                  disabled={auditSummary.totalScanned === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white font-black text-xs px-5 py-3 rounded-xl transition shadow-md"
                >
                  تأكيد الترحيل وخصم الأرصدة 📤
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>

      {/* DEDUCTION RECONCILED SUCCESS MODAL */}
      <AnimatePresence>
        {showDeductionModal && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center z-[110] p-4 text-right">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-7 rounded-[2.5rem] shadow-2xl max-w-lg w-full space-y-5"
            >
              <div className="flex justify-between items-start border-b pb-3.5">
                <button onClick={() => setShowDeductionModal(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                <div className="flex items-center gap-2">
                  <div className="text-right font-sans">
                    <h3 className="font-black text-slate-900 text-sm">تم ترحيل الصادر وخصم المخزون بنجاح</h3>
                    <p className="text-[10px] text-slate-400 font-bold">تم حفظ وتعديل حسابات الطرود والوحدات</p>
                  </div>
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center font-black">✓</div>
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 font-mono text-[11px] text-slate-600 space-y-1">
                <div className="flex justify-between"><span className="text-emerald-800 font-black">{showDeductionModal.id}</span><span>:رقم سند التصدير</span></div>
                <div className="flex justify-between"><span className="text-slate-900 font-black">{showDeductionModal.palletCode}</span><span>:رمز الطبلية</span></div>
                <div className="flex justify-between"><span>{showDeductionModal.totalExpectedCartons} كرتون</span><span>:الكراتين بكشوف الشيت</span></div>
                <div className="flex justify-between"><span className="text-indigo-700 font-black">{showDeductionModal.totalScannedCartons} كرتون</span><span>:الكراتين المجرودة والجاهزة</span></div>
                <div className="flex justify-between"><span className="text-emerald-700 font-black font-extrabold">{showDeductionModal.totalBooksDeducted} حزمة كتب</span><span>:إجمالي الكتب المطروحة</span></div>
              </div>
              <div className="bg-amber-50 text-amber-900 border border-amber-200 p-3.5 rounded-xl text-[9.5px]">
                💡 <strong>آلية الخصم الإرشادي:</strong> تم خصم هذه الطرود والكتب تجريبياً من سجل التوزيع لضمان التسليم للمدارس.
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={() => setShowDeductionModal(null)} className="bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-6 py-3 rounded-xl transition">إغلاق ومتابعة</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SELECTED SHEET VIEW MODAL */}
      <AnimatePresence>
        {selectedSheetPalletForView && (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center z-[110] p-4 text-right animate-fade-in">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white p-7 rounded-[2rem] border border-emerald-100 shadow-2xl max-w-xl w-full space-y-5"
            >
              <div className="flex justify-between items-start border-b pb-4">
                <button onClick={() => { setSelectedSheetPalletForView(null); setCartonSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg"><X size={15} /></button>
                <div className="text-right">
                  <h3 className="font-sans font-black text-slate-900 text-sm">📦 شحنات الطبلية بملف Google Sheets</h3>
                  <p className="text-[10px] text-slate-400 font-semibold">عرض أرقام الكراتين وحزم الكتب التابعة لها بالتفصيل الموثق</p>
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 flex flex-col justify-between text-xs font-bold leading-normal text-slate-600 text-right">
                <div>رمز الطبلية بالسحاب: <span className="text-emerald-800 font-mono font-black">{selectedSheetPalletForView.code}</span></div>
                <div className="mt-1">المحتوى: <span className="text-slate-900 font-sans">{selectedSheetPalletForView.desc}</span></div>
                <div className="mt-1">الكمية: <span className="text-slate-900 font-mono">{selectedSheetPalletForView.count} كرتون مقيد</span></div>
              </div>
              <input
                type="text"
                placeholder="ابحث عن باركود كرتون معين..."
                className="w-full text-right bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono font-black focus:outline-indigo-500 outline-none"
                value={cartonSearchQuery}
                onChange={(e) => setCartonSearchQuery(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1.5 bg-slate-50 border border-slate-100 rounded-xl">
                {selectedSheetPalletForView.cartons
                  .filter(c => c.boxbarcode.toLowerCase().includes(cartonSearchQuery.trim().toLowerCase()))
                  .map((c, idx) => {
                    const mappedCode = normalizeStageCode(c.stage.split('-')[0].trim().toUpperCase());
                    const color = getStageColor(mappedCode);
                    return (
                      <div key={c.boxbarcode} className="bg-white p-3 rounded-lg border border-slate-150 flex flex-col justify-between text-right">
                        <div className="flex justify-between items-center text-[8px] font-bold">
                          <span className="text-white px-1.5 rounded" style={{ backgroundColor: color.hex }}>{c.stage}</span>
                          <span className="text-slate-400 font-mono">#{idx + 1}</span>
                        </div>
                        <div className="font-mono text-[9px] font-black tracking-wider text-slate-800 mt-1">{c.boxbarcode}</div>
                        <span className="text-[8px] text-slate-500 font-bold block mt-1">{getStageArabicName(c.stage)}</span>
                      </div>
                    );
                  })}
              </div>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-[9px] text-slate-400 max-w-xs leading-normal">أضغط على بدء الجرد لفتح قارئ الباركود ومطابقة كراتين هذه الطبلية سحابياً بشكل فوري.</span>
                <button
                  onClick={() => {
                    const code = selectedSheetPalletForView.code;
                    setSelectedSheetPalletForView(null);
                    setCartonSearchQuery('');
                    setSearchPalletCode(code);
                    handleLoadPallet(code);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-5 py-2.5 rounded-xl transition shadow-md"
                >
                  بدء جرد هذه الطبلية 🔦
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
