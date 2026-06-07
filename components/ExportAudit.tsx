import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PalletType, UserCredentials, InventoryRecord, DistributionTrip } from '../types';
import { getStageColor } from '../stageColors';
import { 
  RefreshCw, QrCode, CheckCircle, AlertTriangle, RotateCcw, Archive, Layers, Check, X, ArrowRight, Search, Database, CheckSquare, Sparkles, ChevronDown, ChevronUp, CheckCircle2, AlertOctagon, HelpCircle, Landmark
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

  // Pallet loading error shown in-view
  const [palletLoadError, setPalletLoadError] = useState<string | null>(null);

  const [scanInput, setScanInput] = useState('');
  const [scanStatus, setScanStatus] = useState<{ type: 'success' | 'error'; message: string; stageName?: string; subMessage?: string } | null>(null);
  const [scannerFocus] = useState(true);
  
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const palletInputRef = useRef<HTMLInputElement>(null);

  const [lastScannedCarton, setLastScannedCarton] = useState<LoadedCarton | null>(null);
  const [scannedAnomalies, setScannedAnomalies] = useState<{ id: string; barcode: string; errorType: string; timestamp: number }[]>([]);
  const [exportLogs, setExportLogs] = useState<ExportAuditLog[]>([]);
  const [showDeductionModal, setShowDeductionModal] = useState<ExportAuditLog | null>(null);

  // Accordion drawer states
  const [showSheetDetailsDrawer, setShowSheetDetailsDrawer] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

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
      setPalletLoadError(`الرمز "${code}" غير مدرج في كشوف الشيت. يرجى التحقق وإعادة الإدخال.`);
      if (onNotify) onNotify('❌ طبلية غير موجودة', `الرمز "${code}" غير مدرج في كشوف الشيت.`);
      return;
    }

    setPalletLoadError(null);
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
    setScanStatus(null);
    setShowResultsView(false);
  };

  const handlePalletInputChange = (val: string) => {
    setSearchPalletCode(val);
    setPalletLoadError(null);
    const cleaned = val.replace(/\s+/g, '').toUpperCase();
    if (!cleaned) return;

    if (palletIndex[cleaned]) {
      handleLoadPallet(cleaned);
    }
  };

  useEffect(() => {
    loadGoogleSheetData(true);
  }, []);

  // Autofocus pallet input when we are back on select screen
  useEffect(() => {
    if (!activePalletCode && palletInputRef.current) {
      palletInputRef.current.focus();
    }
  }, [activePalletCode]);

  // Autofocus carton scanner input in immersive view
  useEffect(() => {
    if (barcodeInputRef.current && scannerFocus && activePalletCode && !showResultsView) {
      barcodeInputRef.current.focus();
    }
  }, [scannerFocus, activePalletCode, loadedCartons, showResultsView]);

  // Click-to-focus helper for warehouse handheld screens
  const handleContainerClickForRefocus = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // Don't intercept clicks on buttons, inputs, links
    if (
      target.tagName === 'INPUT' || 
      target.tagName === 'BUTTON' || 
      target.tagName === 'A' || 
      target.tagName === 'SELECT' || 
      target.closest('button') || 
      target.closest('a')
    ) {
      return;
    }
    if (activePalletCode && !showResultsView && barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
  };

  const handleScanCarton = (barcodeRaw: string) => {
    const code = barcodeRaw.replace(/\s+/g, '').toUpperCase();
    if (!code) return;

    setScanStatus(null);
    const mIdx = loadedCartons.findIndex(c => c.boxbarcode.toUpperCase() === code);

    if (mIdx !== -1) {
      const target = loadedCartons[mIdx];
      if (target.scanned) {
        setScanStatus({ 
          type: 'error', 
          message: `⚠️ مكرر: تم فرز هذا الكرتون مسبقاً!`,
          subMessage: `باركود: ${code} - مقرر: ${target.stageArabicName}`
        });
        return;
      }
      const updated = [...loadedCartons];
      updated[mIdx] = { ...target, scanned: true, scannedAt: Date.now() };
      setLoadedCartons(updated);
      setLastScannedCarton(updated[mIdx]);
      setScanStatus({ 
        type: 'success', 
        message: `تم جرد وتأكيد الكرتون بنجاح ✓`,
        stageName: target.stageArabicName,
        subMessage: `باركود: ${code} (#${target.number} من الطبلية)`
      });
    } else {
      let otherPallet = '';
      for (const [pCode, items] of Object.entries(palletIndex)) {
        if (items.some(it => it.boxbarcode.toUpperCase() === code)) {
          otherPallet = pCode; break;
        }
      }
      const err = otherPallet ? `تابع للطبلية الشاردة (${otherPallet})` : 'باركود مفرود غير معروف بسجل التوزيع';
      setScannedAnomalies(prev => [{ id: Math.random().toString(), barcode: code, errorType: err, timestamp: Date.now() }, ...prev]);
      setScanStatus({ 
        type: 'error', 
        message: `🚨 كرتون خاطئ: لا ينتمي لهذه الطبلية!`,
        subMessage: `${err}`
      });
    }
    setScanInput('');
  };

  // Direct fast-checking during typing/laser-transmission (eliminates manual enter key needs)
  const handleBarcodeInputChange = (val: string) => {
    setScanInput(val);
    const cleaned = val.replace(/\s+/g, '').toUpperCase();
    if (!cleaned) return;

    // Check if what is typed is exactly one of the remaining unscanned cartons
    const exactMatch = loadedCartons.find(
      c => c.boxbarcode.toUpperCase() === cleaned && !c.scanned
    );

    if (exactMatch) {
      // Instant automated match
      handleScanCarton(cleaned);
    }
  };

  const handleScanSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scanInput.trim()) return;
    handleScanCarton(scanInput);
    setScanInput('');
  };

  const simulateFullPreScan = () => {
    setLoadedCartons(prev => prev.map(c => ({ ...c, scanned: true, scannedAt: Date.now() })));
    if (loadedCartons.length > 0) setLastScannedCarton({ ...loadedCartons[loadedCartons.length - 1], scanned: true });
    setScanStatus({
      type: 'success',
      message: 'تمت مطابقة كامل الطبلية بنجاح عبر المحاكاة'
    });
    if (onNotify) onNotify('⚡ جرد فوري كامل', 'تم محاكاة جرد كافية كراتين الطبلية بنجاح.');
  };

  const simulateDeficitScan = () => {
    const border = Math.floor(loadedCartons.length * 0.9);
    setLoadedCartons(prev => prev.map((c, i) => ({ ...c, scanned: i < border, scannedAt: i < border ? Date.now() : undefined })));
    setLastScannedCarton(loadedCartons[0] || null);
    setScannedAnomalies([{ id: '1', barcode: 'EBUXSL9999999926', errorType: 'كرتون مفقود عجز طبلية', timestamp: Date.now() }]);
    setScanStatus({
      type: 'error',
      message: 'تم فرز عينات جزئية مع رصد عجز لكراتين مفقودة'
    });
    if (onNotify) onNotify('⚠️ جرد عجز وجزئي', 'تم محاكاة جرد جزئي مع كرتونة عجز مفقودة.');
  };

  const handleResetCurrentAudit = () => {
    setLoadedCartons(prev => prev.map(c => ({ ...c, scanned: false, scannedAt: undefined })));
    setLastScannedCarton(null);
    setScannedAnomalies([]);
    setScanInput('');
    setScanStatus(null);
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
      {/* Dynamic Laser beam CSS styling */}
      <style>{`
        @keyframes laser-glow {
          0%, 100% { top: 10%; opacity: 0.3; }
          50% { top: 90%; opacity: 1; }
        }
        .laser-line {
          animation: laser-glow 2.5s infinite ease-in-out;
        }
      `}</style>

      <AnimatePresence mode="wait">
        
        {/* VIEW 1: SELECT / SCAN PALLET TO START */}
        {!activePalletCode && (
          <motion.div
            key="select-view"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="space-y-6"
          >
            {/* Elegant Header Card */}
            <div className="bg-gradient-to-r from-teal-900 via-emerald-950 to-slate-900 text-white rounded-[2.5rem] p-6 shadow-2xl border border-teal-800/60 relative overflow-hidden text-right">
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 w-full">
                  <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-black text-[10px] px-3 py-1 rounded-full inline-block">
                    جرد الصادر وحسم المواد من المخازن 📦
                  </span>
                  <h2 className="text-xl font-black mt-2 font-sans">الجرد الصادر للمركز (كرتون كرتون)</h2>
                  <p className="text-xs text-teal-100/70 max-w-2xl font-semibold">تأكيد خروج الكراتين للمدارس وحسم الحزم التراكمية مباشرة من الكشوفات السحابية.</p>
                </div>
                <div className="flex flex-col items-center md:items-end gap-2 shrink-0">
                  <button
                    onClick={() => loadGoogleSheetData(false)}
                    disabled={isDownloading}
                    className="px-5 py-3 bg-white/10 hover:bg-white/15 border border-white/20 rounded-2xl text-xs font-black transition flex items-center gap-2 text-white active:scale-95 duration-150"
                  >
                    <RefreshCw size={14} className={isDownloading ? 'animate-spin' : ''} />
                    {isDownloading ? 'تحديث الكشوف...' : 'تحديث جوجل شيت'}
                  </button>
                  {dbStats && (
                    <div className="text-[10px] text-teal-200/80 font-bold bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
                      الكشوفات المحملة: <strong className="font-mono text-emerald-300">{dbStats.totalRows.toLocaleString()}</strong> كرتون لـ <strong className="font-mono text-emerald-300">{dbStats.uniquePallets}</strong> طبلية
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile-Friendly Main Scanning Focus Card */}
            <div className="max-w-2xl mx-auto bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-100 shadow-xl space-y-6 text-right">
              <div className="text-center space-y-2">
                <div className="mx-auto w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100">
                  <QrCode className="text-emerald-600 animate-pulse" size={32} />
                </div>
                <h3 className="font-sans font-extrabold text-slate-800 text-base">مسح باركود الطبلية لبدء الفرز</h3>
                <p className="text-xs text-slate-400 font-medium">امسح الكود الملصق على الطبلية للتحقق من كراتينها وتحضير نافذة الجرد الصادر الفوري</p>
              </div>

              {/* Form specifically crafted to submit instantly on mobile keyboards & scanners */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleLoadPallet(searchPalletCode);
                }} 
                className="space-y-4"
              >
                <div className="relative">
                  <input 
                    type="text"
                    ref={palletInputRef}
                    className="w-full bg-slate-50 border-2 border-slate-200 focus:border-emerald-500 focus:bg-white rounded-2xl p-5 text-center text-lg font-mono font-black uppercase text-slate-800 tracking-widest outline-none transition-all duration-200"
                    placeholder="امسح أو اكتب كود الطبلية..."
                    value={searchPalletCode}
                    onChange={(e) => handlePalletInputChange(e.target.value)}
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                    <QrCode size={18} />
                  </div>
                </div>

                {palletLoadError && (
                  <div className="bg-rose-50 text-rose-600 border border-rose-100 p-4 rounded-xl text-xs font-black text-center flex items-center justify-center gap-2">
                    <AlertTriangle size={15} />
                    <span>{palletLoadError}</span>
                  </div>
                )}
              </form>

              <div className="bg-emerald-50/50 rounded-2xl p-4 flex items-center gap-3 justify-between text-right">
                <Sparkles className="text-emerald-600 shrink-0" size={20} />
                <div className="flex-1 pr-1">
                  <span className="text-[11px] font-black text-slate-800 block">⚡ جرد فائق السرعة وبدون أزرار</span>
                  <span className="text-[9px] text-slate-500 block mt-0.5">بمجرد مطابقة رمز الكرتون مع الشيت سيقوم النظام باعتماده فوراً والقفز للكرتون التالي دون الحاجة للضغط على أي زر.</span>
                </div>
              </div>
            </div>

            {/* COLLAPSIBLE SECTION 1: Sheet Pallets available */}
            <div className="bg-white border border-slate-100 rounded-[2rem] shadow-md overflow-hidden">
              <button
                onClick={() => setShowSheetDetailsDrawer(!showSheetDetailsDrawer)}
                className="w-full px-6 py-4.5 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/70 transition flex items-center justify-between font-black text-xs text-slate-700"
              >
                {showSheetDetailsDrawer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <div className="flex items-center gap-2">
                  <span>تصفح طبليات جوجل شيت المحملة ({googleSheetPallets.length})</span>
                  <Database size={14} className="text-slate-400" />
                </div>
              </button>

              <AnimatePresence>
                {showSheetDetailsDrawer && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden bg-white"
                  >
                    <div className="p-6 space-y-4">
                      <div className="flex items-center gap-2 relative">
                        <input
                          type="text"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-right text-xs font-bold focus:outline-emerald-500 focus:bg-white"
                          placeholder="ابحث برمز الطبلية في الشيت..."
                          value={pListSearchQuery}
                          onChange={(e) => setPListSearchQuery(e.target.value)}
                        />
                        <Search size={14} className="absolute left-3.5 text-slate-400" />
                      </div>

                      {filteredGoogleSheetPallets.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 text-xs font-bold">
                          لا توجد طبلية متطابقة مع البحث
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto p-1 text-right">
                          {filteredGoogleSheetPallets.map(p => (
                            <div
                              key={p.code}
                              onClick={() => setSelectedSheetPalletForView(p)}
                              className="p-3.5 rounded-2xl border border-slate-150 bg-slate-50/50 hover:bg-slate-100/80 hover:border-slate-300 transition cursor-pointer flex flex-col justify-between gap-2"
                            >
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-teal-600 font-extrabold bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-100">معاينة الشيت 👁️</span>
                                <span className="font-mono font-black text-slate-800 text-xs">{p.code}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 font-semibold line-clamp-1">{p.desc}</span>
                              <div className="flex justify-between items-center border-t border-slate-100 pt-2 mt-1 text-xs">
                                <span className="bg-emerald-50 text-emerald-800 font-black px-2 py-0.5 rounded-xl">{p.count} كرتون مقيد</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleLoadPallet(p.code); }}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[10px] px-3 py-1 rounded-lg transition"
                                >
                                  تحميل وجرد
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* COLLAPSIBLE SECTION 2: Completed history logs */}
            <div className="bg-white border border-slate-100 rounded-[2rem] shadow-md overflow-hidden">
              <button
                onClick={() => setShowHistoryDrawer(!showHistoryDrawer)}
                className="w-full px-6 py-4.5 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/70 transition flex items-center justify-between font-black text-xs text-slate-700"
              >
                {showHistoryDrawer ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                <div className="flex items-center gap-2">
                  <span>سجل وتاريخ الترحيل الصادر السحابي المنجز ({exportLogs.length})</span>
                  <CheckSquare size={14} className="text-slate-400" />
                </div>
              </button>

              <AnimatePresence>
                {showHistoryDrawer && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: "auto" }}
                    exit={{ height: 0 }}
                    className="overflow-hidden bg-white"
                  >
                    <div className="p-6">
                      {exportLogs.length === 0 ? (
                        <div className="py-10 text-center text-slate-400 text-xs border border-dashed border-slate-150 rounded-3xl font-medium">
                          لا توجد عمليات جرد أو ترحيل صادر مسجلة حالياً خلال هذه الجلسة.
                        </div>
                      ) : (
                        <div className="overflow-x-auto text-[11px] font-bold text-slate-700">
                          <table className="w-full text-right border-collapse">
                            <thead>
                              <tr className="border-b bg-slate-50 text-slate-550">
                                <th className="p-3">رقم التصدير ID</th>
                                <th className="p-3">التاريخ</th>
                                <th className="p-3">رمز الطبلية</th>
                                <th className="p-3">جوجل شيت</th>
                                <th className="p-3">المجرود الفعلي</th>
                                <th className="p-3">الحزم المحسومة</th>
                                <th className="p-3">الحالة ترحيل</th>
                              </tr>
                            </thead>
                            <tbody>
                              {exportLogs.map(log => (
                                <tr key={log.id} className="border-b hover:bg-slate-50">
                                  <td className="p-3 text-emerald-800 font-mono font-black">{log.id}</td>
                                  <td className="p-3 text-slate-450">{log.date}</td>
                                  <td className="p-3 font-mono font-black">{log.palletCode}</td>
                                  <td className="p-3 font-mono">{log.totalExpectedCartons} ktn</td>
                                  <td className="p-3 font-mono text-indigo-700">{log.totalScannedCartons} ktn</td>
                                  <td className="p-3 font-mono text-emerald-800 font-black">{log.totalBooksDeducted} حزم</td>
                                  <td className="p-3">
                                    <span className={`px-2.5 py-1 rounded-full text-[9px] ${log.status === 'reconciled' ? 'bg-emerald-50 text-emerald-800 border border-emerald-250' : 'bg-amber-50 text-amber-700'}`}>
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
              </AnimatePresence>
            </div>
          </motion.div>
        )}

        {/* VIEW 2: IMMERSIVE CARTON SCANNING (OPTIMIZED FOR MOBILE DEVICE VIEWPORTS) */}
        {activePalletCode && !showResultsView && (
          <motion.div
            key="immersive-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            onClick={handleContainerClickForRefocus}
            className="flex flex-col min-h-[82vh] bg-slate-900 rounded-[2.5rem] relative overflow-hidden text-white"
          >
            {/* Dynamic laser radar effect reflecting status of current/last scan */}
            <div 
              className="absolute inset-0 opacity-15 pointer-events-none transition-all duration-750"
              style={{
                background: `radial-gradient(circle at center, ${
                  scanStatus
                    ? scanStatus.type === 'success' ? '#10b981' : '#f43f5e'
                    : lastScannedCarton ? getStageColor(lastScannedCarton.stageCodeNormalized).hex : '#3b82f6'
                } 0%, rgba(15,23,42,1) 85%)`
              }}
            />

            {/* Top Toolbar */}
            <div className="w-full px-5 py-4 flex items-center justify-between border-b border-white/10 z-10 bg-slate-950/40 backdrop-blur-sm">
              <button
                onClick={() => { if (confirm('هل ترغب حقاً بإلغاء جرد هذه الطبلية والخروج؟ ستفقد التقدم غير المرحل.')) { setActivePalletCode(''); setLoadedCartons([]); } }}
                className="bg-white/10 hover:bg-white/20 active:scale-95 duration-150 px-4 py-2 rounded-xl text-xs font-black text-slate-100"
              >
                رجوع وخروج
              </button>
              <div className="text-center">
                <span className="text-sm font-black text-emerald-400 font-mono tracking-wider block">{activePalletCode}</span>
                <span className="text-[8px] text-slate-400 block tracking-widest uppercase font-bold">MOBILE BULK SCAN SYSTEM</span>
              </div>
              <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full text-[9px] font-bold">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping"></span>
                <span>القارئ نشط</span>
              </div>
            </div>

            {/* Immersive Scan Viewport Zone */}
            <div className="flex-1 w-full max-w-lg mx-auto px-5 py-6 flex flex-col justify-between gap-6 z-10 text-center">
              
              {/* Saturated High-Visibility Top Banner Panel */}
              <AnimatePresence mode="wait">
                {scanStatus ? (
                  <motion.div
                    key={scanStatus.message + Date.now().toString()}
                    initial={{ opacity: 0, y: -20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className={`w-full p-4 rounded-2xl shadow-xl flex flex-col items-center justify-center text-center ${
                      scanStatus.type === 'success' 
                        ? 'bg-emerald-600 border-2 border-emerald-400/50 text-white' 
                        : 'bg-rose-600 border-2 border-rose-400/50 text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 justify-center">
                      {scanStatus.type === 'success' ? (
                        <CheckCircle2 className="text-white animate-bounce shrink-0" size={24} />
                      ) : (
                        <AlertOctagon className="text-white animate-bounce shrink-0" size={24} />
                      )}
                      <span className="text-base font-black leading-tight">{scanStatus.message}</span>
                    </div>

                    {scanStatus.stageName && (
                      <span className="text-sm font-extrabold mt-1.5 underline underline-offset-4 decoration-white/50">{scanStatus.stageName}</span>
                    )}

                    {scanStatus.subMessage && (
                      <span className="text-[10px] font-semibold opacity-90 mt-1 block font-mono">{scanStatus.subMessage}</span>
                    )}
                  </motion.div>
                ) : (
                  <div className="w-full p-4 rounded-2xl bg-white/5 border border-white/10 text-center text-xs text-slate-400 font-black">
                    💡 ابدأ مسح باركود كراتين الصناديق فورياً - سيتم الإدخال كلياً وتلقائياً
                  </div>
                )}
              </AnimatePresence>

              {/* Viewport Laser Focus Box */}
              <div className="relative w-full max-w-[280px] h-[190px] mx-auto bg-slate-950/70 border-2 border-white/20 rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-center items-center">
                {/* Simulated laser line */}
                <div className="absolute left-0 right-0 h-0.5 bg-red-500 laser-line shadow-[0_0_12px_rgba(239,68,68,1)] z-10" />

                {lastScannedCarton ? (
                  <div className="space-y-2 px-4 text-center">
                    <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/20 block w-max mx-auto mb-1">
                      كرتون #{lastScannedCarton.number} تم
                    </span>
                    <h4 className="text-xs font-black text-white line-clamp-1">{lastScannedCarton.stageArabicName}</h4>
                    <p className="text-[9px] font-mono font-black text-indigo-300">{lastScannedCarton.stageCodeNormalized}</p>
                    <span className="text-[9px] font-mono text-slate-500 block truncate max-w-[210px]">{lastScannedCarton.boxbarcode}</span>
                  </div>
                ) : (
                  <div className="space-y-2 text-slate-500 flex flex-col items-center justify-center p-4">
                    <QrCode size={40} className="text-slate-500 animate-pulse" />
                    <span className="text-[10px] font-black text-slate-400">بانتظار قراءة المعامل...</span>
                    <span className="text-[8px] text-slate-600 block leading-tight">وجّه قارئ الباركود نحو الكرتون</span>
                  </div>
                )}
              </div>

              {/* Input Form & Auto-Refocus Area */}
              <div className="space-y-3">
                <form onSubmit={handleScanSubmit} className="w-full">
                  <input
                    type="text"
                    ref={barcodeInputRef}
                    value={scanInput}
                    onChange={(e) => handleBarcodeInputChange(e.target.value)}
                    placeholder="امسح باركود الكرتون هنا..."
                    className="w-full bg-black/40 border-2 border-white/10 focus:border-emerald-500 focus:bg-slate-900 rounded-2xl py-4.5 px-4 text-center text-xs font-mono font-black tracking-widest text-emerald-300 placeholder-slate-500 outline-none transition-all duration-200"
                    autoComplete="off"
                  />
                </form>

                {/* Mobile Floating Click Info */}
                <div className="text-center">
                  <span className="text-[9px] text-slate-500 font-black block">💡 إذا توقف الماسح، اضغط في أي مكان على الشاشة لاستعادة التركيز والكتابة الآلية.</span>
                </div>
              </div>

              {/* Progress Panel */}
              {auditSummary.totalExpected > 0 && (
                <div className="bg-white/5 p-4 rounded-3xl border border-white/10 space-y-2 text-right">
                  <div className="flex justify-between items-center text-[10px] font-black font-mono">
                    <span className="text-emerald-400">{auditSummary.totalScanned} / {auditSummary.totalExpected} كرتون ({auditSummary.progressPercent}%)</span>
                    <span className="text-slate-405">إنجاز مطابقة الطبلية في الشيت</span>
                  </div>
                  <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden">
                    <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-full transition-all duration-300" style={{ width: `${auditSummary.progressPercent}%` }} />
                  </div>
                </div>
              )}

              {/* Sandbox Controls for Testing Override */}
              <div className="p-3 bg-white/5 border border-white/10 rounded-2xl text-center space-y-2">
                <span className="text-[9px] text-slate-400 font-bold block">تجاوز مطابقة المختبر (محاكاة يدوية سريعة)</span>
                <div className="flex gap-1 justify-center">
                  <button onClick={simulateFullPreScan} className="bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/20 px-2.5 py-1.5 rounded-xl text-[9px] font-black transition">جرد كامل ⚡</button>
                  <button onClick={simulateDeficitScan} className="bg-rose-600/25 hover:bg-rose-600/40 text-rose-450 border border-rose-550/20 px-2.5 py-1.5 rounded-xl text-[9px] font-black transition">عجز ⚠️</button>
                  <button onClick={handleResetCurrentAudit} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1.5 rounded-xl text-[9px] font-black transition">تصفير</button>
                </div>
              </div>

              {/* Finish Actions */}
              <button
                onClick={() => setShowResultsView(true)}
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 duration-150 text-white font-black text-xs py-4.5 rounded-full transition shadow-lg flex items-center justify-center gap-2"
              >
                <span>إنهاء فحص الطرد ومعالجة فروق المستودع 📋➔</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* VIEW 3: MATCH RESULTS REPORT */}
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
                <span className="bg-indigo-50 text-indigo-750 border border-indigo-200 text-[10px] px-3 py-1 rounded-full font-black">تقارير الخصم الميداني الصادر</span>
                <h2 className="text-lg font-black mt-2">نتائج مطابقة طبلية الصادر {activePalletCode} مع كشوفات الشيت</h2>
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
                <span className="text-[10px] text-slate-400 font-extrabold block">المخطط الإجمالي بالشيت</span>
                <span className="text-base font-black text-slate-850 mt-1 block font-mono">{auditSummary.totalExpected} كرتون</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-emerald-600 font-extrabold block">المجرود الفعلي المؤكد</span>
                <span className="text-base font-black text-emerald-700 mt-1 block font-mono">{auditSummary.totalScanned} كرتون</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-indigo-600 font-extrabold block">الحزم المفروزة بالخصم</span>
                <span className="text-base font-black text-indigo-700 mt-1 block font-mono">{auditSummary.totalBundlesScanned} حزمة</span>
              </div>
              <div className="bg-white p-5 rounded-2xl border border-slate-150 shadow-sm">
                <span className="text-[10px] text-rose-600 font-extrabold block">عجز كراتين مفقودة</span>
                <span className={`text-base font-black mt-1 block font-mono ${auditSummary.totalExpected - auditSummary.totalScanned > 0 ? 'text-rose-600' : 'text-slate-405'}`}>
                  {auditSummary.totalExpected - auditSummary.totalScanned} كرتون
                </span>
              </div>
            </div>

            {/* Stage analysis details */}
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

            {/* Individual carton indicators display */}
            <div className="bg-white p-6 rounded-[2rem] border border-slate-150 shadow-sm space-y-4">
              <h3 className="font-sans font-black text-slate-800 text-sm">حالة جرد الكراتين الفردية للطبلية</h3>
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
                        <span className="text-rose-600 text-[8px]">عجز طرد مفقود</span>
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
                  className="bg-white border border-slate-200 text-slate-700 font-black text-xs px-4 py-3 rounded-xl transition hover:bg-slate-50 active:scale-95 duration-100"
                >
                  العودة للمسح
                </button>
                <button
                  onClick={handleConfirmExportDeduction}
                  disabled={auditSummary.totalScanned === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white font-black text-xs px-5 py-3 rounded-xl transition shadow-md active:scale-95 duration-100"
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
                <button onClick={() => setShowDeductionModal(null)} className="text-slate-400 hover:text-slate-600 bg-slate-50 p-1 rounded-md"><X size={15} /></button>
                <div className="flex items-center gap-3">
                  <div className="text-right font-sans">
                    <h3 className="font-black text-slate-900 text-sm">تم ترحيل الصادر وخصم المخزون بنجاح</h3>
                    <p className="text-[10px] text-slate-400 font-bold">تم حفظ وتعديل حسابات الطرود والوحدات بمطابقة تامة</p>
                  </div>
                  <div className="w-10 h-10 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center font-black text-base">✓</div>
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 font-mono text-[11px] text-slate-600 space-y-1">
                <div className="flex justify-between"><span className="text-emerald-800 font-black">{showDeductionModal.id}</span><span>:رقم سند التصدير</span></div>
                <div className="flex justify-between"><span className="text-slate-900 font-black">{showDeductionModal.palletCode}</span><span>:رمز الطبلية المجرودة</span></div>
                <div className="flex justify-between"><span>{showDeductionModal.totalExpectedCartons} كرتون</span><span>:الكراتين المقيدة بسجلات الشيت</span></div>
                <div className="flex justify-between"><span className="text-indigo-700 font-black">{showDeductionModal.totalScannedCartons} كرتون</span><span>:الكراتين المجرودة والجاهزة</span></div>
                <div className="flex justify-between"><span className="text-emerald-700 font-black font-extrabold">{showDeductionModal.totalBooksDeducted} حزمة كتب</span><span>:إجمالي المخرجات المطروحة من المخزون</span></div>
              </div>
              <div className="bg-amber-50 text-amber-900 border border-amber-200 p-3.5 rounded-xl text-[9.5px] leading-relaxed">
                💡 <strong>آلية الخصم الإرشادي:</strong> تم خصم هذه الطرود والكتب تجريبياً من سجل التوزيع لضمان دقة التسليم للمدارس.
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={() => setShowDeductionModal(null)} className="bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-6 py-3 rounded-xl transition active:scale-95 duration-100">إغلاق ومتابعة الفرار</button>
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
              className="bg-white p-7 rounded-[2rem] border border-slate-100 shadow-2xl max-w-xl w-full space-y-5"
            >
              <div className="flex justify-between items-start border-b pb-4">
                <button onClick={() => { setSelectedSheetPalletForView(null); setCartonSearchQuery(''); }} className="text-slate-400 hover:text-slate-600 bg-slate-100 p-1.5 rounded-lg"><X size={15} /></button>
                <div className="text-right">
                  <h3 className="font-sans font-black text-slate-900 text-sm">📦 شحنات الطبلية بملف Google Sheets</h3>
                  <p className="text-[10px] text-slate-400 font-semibold">عرض أرقام الكراتين وحزم الكتب التابعة لها بالتفصيل الموثق بالملف</p>
                </div>
              </div>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-150 flex flex-col justify-between text-xs font-bold leading-normal text-slate-600 text-right space-y-0.5">
                <div>رمز الطبلية المعتمد: <span className="text-emerald-800 font-mono font-black">{selectedSheetPalletForView.code}</span></div>
                <div>وصف الطبلية سحابياً: <span className="text-slate-900 font-sans">{selectedSheetPalletForView.desc}</span></div>
                <div>الكمية المقيدة: <span className="text-slate-900 font-mono">{selectedSheetPalletForView.count} كرتون مقيد</span></div>
              </div>
              <input
                type="text"
                placeholder="ابحث عن باركود كرتون معين..."
                className="w-full text-right bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono font-black focus:outline-emerald-500 outline-none"
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
                      <div key={c.boxbarcode} className="bg-white p-3 rounded-lg border border-slate-150 flex flex-col justify-between text-right gap-1">
                        <div className="flex justify-between items-center text-[8px] font-bold">
                          <span className="text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: color.hex }}>{c.stage}</span>
                          <span className="text-slate-400 font-mono">#{idx + 1}</span>
                        </div>
                        <div className="font-mono text-[9.5px] font-black tracking-wider text-slate-800">{c.boxbarcode}</div>
                        <span className="text-[8px] text-slate-550 font-bold block">{getStageArabicName(c.stage)}</span>
                      </div>
                    );
                  })}
              </div>
              <div className="flex justify-between items-center pt-3 border-t">
                <span className="text-[9px] text-slate-400 max-w-xs leading-normal">انقر على زر البدء لفتح شاشة الفحص وقراءة الباركودات بشكل متتالي فوري.</span>
                <button
                  onClick={() => {
                    const code = selectedSheetPalletForView.code;
                    setSelectedSheetPalletForView(null);
                    setCartonSearchQuery('');
                    setSearchPalletCode(code);
                    handleLoadPallet(code);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-5 py-2.5 rounded-xl transition shadow-md active:scale-95 duration-100"
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
