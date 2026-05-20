
import React, { useState, useMemo, useEffect } from 'react';
import { getStageColor } from '../stageColors';
import { ConfirmModal } from './ConfirmModal';
import { PalletType, InventoryRecord, Trip, UserRole, PressCode, CenterCode, UserCredentials, DistributionTrip } from '../types';
import { analyzeInventory } from '../services/geminiService';
import XLSX from 'xlsx-js-style';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, setDoc, updateDoc, writeBatch, deleteDoc, deleteField, getDoc, addDoc } from 'firebase/firestore';
import AdminReconciliationModal from './AdminReconciliationModal';
import ReconciliationComparison from './ReconciliationComparison';

const applyBarcodeStyleToSheet = (ws: any, headerName: string) => {
  if (!ws || !ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  let barcodeColIndex = -1;

  for (let C = range.s.c; C <= range.e.c; ++C) {
    const address = XLSX.utils.encode_col(C) + '1';
    if (ws[address]?.v === headerName) {
      barcodeColIndex = C;
      break;
    }
  }

  if (barcodeColIndex === -1) return;

  for (let R = range.s.r + 1; R <= range.e.r; ++R) {
    const address = XLSX.utils.encode_cell({ r: R, c: barcodeColIndex });
    if (ws[address]) {
      ws[address].s = {
        font: {
          name: 'Libre Barcode 39',
          sz: 28
        },
        alignment: {
          vertical: 'center',
          horizontal: 'center'
        }
      };
    }
  }
  
  // Set column width to be wider for barcode
  if (!ws['!cols']) ws['!cols'] = [];
  ws['!cols'][barcodeColIndex] = { wch: 30 };
};

interface Props {
  palletTypes: PalletType[];
  records: InventoryRecord[];
  trips: Trip[];
  distributionTrips: DistributionTrip[];
  currentTripId: string;
  role: UserRole;
  userCode: string;
  userCenter: CenterCode | null;
  users: UserCredentials[];
  onSelectCenter: (center: CenterCode) => void;
  onNewTrip: (press: PressCode, center: CenterCode, selections: { typeId: string, pallets: number, extraCartons: number, missingCartons: number }[], semester: string, year: string) => void;
  onNotify: (title: string, msg: string) => void;
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

const formatExcelDate = (val: any): string => {
  if (!val) return new Date().toISOString().split('T')[0];
  
  let date: Date;
  if (val instanceof Date) {
    date = val;
  } else if (typeof val === 'number') {
    // Excel serial conversion + 12 hours padding to avoid day shift
    date = new Date(Math.round((val - 25569) * 86400 * 1000) + 43200000);
  } else {
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    date = new Date(str);
    if (!isNaN(date.getTime()) && date.getHours() === 0) {
      date.setHours(12);
    }
  }

  if (!date || isNaN(date.getTime())) return String(val);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const StageCard: React.FC<{ type: PalletType, statsRecords: InventoryRecord[] }> = ({ type, statsRecords }) => {
  const typeRecords = statsRecords.filter(r => r.palletTypeId === type.id);
  const receivedRecords = typeRecords.filter(r => r.status === 'received');
  const receivedCount = receivedRecords.length;
  const inTransitCount = typeRecords.filter(r => r.status === 'in_transit').length;
  const pendingCount = typeRecords.filter(r => r.status === 'pending').length;
  
  let totalCartons = 0;
  let totalBundles = 0;

  receivedRecords.forEach(r => {
    let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
    let b = c * type.bundlesPerCarton;

    if (r.extraCartons) {
      c += r.extraCartons;
      b += r.extraCartons * type.bundlesPerCarton;
    }
    if (r.missingCartons) {
      c -= r.missingCartons;
      b -= r.missingCartons * type.bundlesPerCarton;
    }

    if (r.hasDiscrepancy) {
      const sign = r.discrepancyType === 'excess' ? 1 : -1;
      const diffC = r.discrepancyCartonsQty || 0;
      const diffB = r.discrepancyBundlesQty || 0;
      c += sign * diffC;
      b += sign * ((diffC * type.bundlesPerCarton) + diffB);
    }
    totalCartons += c;
    totalBundles += b;
  });

  const stageColorObj = getStageColor(type.stageCode);

  return (
    <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-4 relative overflow-hidden group hover:border-slate-350 transition-all">
      <div className="absolute top-0 left-0 w-2.5 h-full opacity-35 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: stageColorObj.hex }}></div>
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h4 className="text-sm font-black text-slate-800 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: stageColorObj.hex }} />
            {type.stageName}
          </h4>
          <p className="text-[10px] font-bold text-slate-400">كود: {type.stageCode}</p>
        </div>
        <div className="px-3 py-1 rounded-full text-[10px] font-black" style={{ backgroundColor: `${stageColorObj.hex}15`, color: stageColorObj.hex }}>
          {typeRecords.length} طبلية
        </div>
      </div>
      
      <div className={`grid ${type.stageCode.toUpperCase().startsWith('F') ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
        <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <span className="text-[8px] font-black text-slate-400 block mb-1 uppercase">الكراتين (المستلمة)</span>
          <span className="text-lg font-black text-indigo-900">{totalCartons.toLocaleString()}</span>
        </div>
        {!type.stageCode.toUpperCase().startsWith('F') && (
          <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
            <span className="text-[8px] font-black text-slate-400 block mb-1 uppercase">الحزم (المستلمة)</span>
            <span className="text-lg font-black text-emerald-700">{totalBundles.toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-3 border-t border-slate-50">
        <div className="flex-1 text-center">
          <span className="text-[7px] font-black text-slate-400 block uppercase">مستلم</span>
          <span className="text-[11px] font-black text-emerald-600">{receivedCount}</span>
        </div>
        <div className="flex-1 text-center border-x border-slate-100">
          <span className="text-[7px] font-black text-slate-400 block uppercase">في الطريق</span>
          <span className="text-[11px] font-black text-amber-600">{inTransitCount}</span>
        </div>
        <div className="flex-1 text-center">
          <span className="text-[7px] font-black text-slate-400 block uppercase">معلق</span>
          <span className="text-[11px] font-black text-slate-400">{pendingCount}</span>
        </div>
      </div>
    </div>
  );
};

export const Dashboard: React.FC<Props> = ({ palletTypes, records, trips, distributionTrips, currentTripId, role, userCode, userCenter, users, onSelectCenter, onNewTrip, onNotify }) => {
  const [showForm, setShowForm] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [pCode, setPCode] = useState<PressCode>(userCode);
  const [cCode, setCCode] = useState<CenterCode>('');
  const [semester, setSemester] = useState('1'); 
  const [year, setYear] = useState('2026'); 
  const [selections, setSelections] = useState<Record<string, { pallets: number, extraCartons: number, missingCartons: number }>>({});
  
  const [activeChoiceId, setActiveChoiceId] = useState<string | null>(null);
  const [isBatchPrinting, setIsBatchPrinting] = useState(false);
  const [selectedSize, setSelectedSize] = useState<LabelSize>('10x15');

  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [isUploadingActual, setIsUploadingActual] = useState(false);
  const [showExecutionManualForm, setShowExecutionManualForm] = useState(false);
  const [executionData, setExecutionData] = useState({
    tripId: '',
    date: new Date().toISOString().split('T')[0],
    quantities: {} as Record<string, { cartons: number, bundles: number }>
  });
  const [showDistForm, setShowDistForm] = useState(false);
  const [distTripData, setDistTripData] = useState({
    tripNumber: '',
    date: new Date().toISOString().split('T')[0],
    originCenter: '',
    destinationCity: '',
    quantities: {} as Record<string, { cartons: number, bundles: number }>
  });

  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [selectedTripForControl, setSelectedTripForControl] = useState<string>('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [tripIdToCancel, setTripIdToCancel] = useState<string | null>(null);
  const [showFixMisdirectedModal, setShowFixMisdirectedModal] = useState(false);
  const [misdirectedBarcodesStr, setMisdirectedBarcodesStr] = useState('');
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [showRestoreTripModal, setShowRestoreTripModal] = useState(false);
  const [tripIdToRestore, setTripIdToRestore] = useState<string | null>(null);
  const [showCancelledInControl, setShowCancelledInControl] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [tripIdToRevert, setTripIdToRevert] = useState<string | null>(null);
  const [showDeleteDistModal, setShowDeleteDistModal] = useState(false);
  const [tripIdToDeleteDist, setTripIdToDeleteDist] = useState<string | null>(null);
  const [showDispatchConfirmModal, setShowDispatchConfirmModal] = useState(false);
  const [tripToDispatch, setTripToDispatch] = useState<string | null>(null);
  const [showDispatchedTableModal, setShowDispatchedTableModal] = useState(false);
  const [showReconciliationModal, setShowReconciliationModal] = useState(false);
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [dispatchedTableSearch, setDispatchedTableSearch] = useState('');
  const [showEmptyCartonsModal, setShowEmptyCartonsModal] = useState(false);
  const [showBalanceDetailModal, setShowBalanceDetailModal] = useState(false);
  const [selectedCenterForBalance, setSelectedCenterForBalance] = useState<{
    name: string;
    code: string;
    details: { stageName: string; remainingCartons: number; remainingBundles: number; totalBundles: number }[];
  } | null>(null);

  const [showExportedDetailModal, setShowExportedDetailModal] = useState(false);
  const [selectedCenterForExported, setSelectedCenterForExported] = useState<{
    name: string;
    code: string;
    details: { stageName: string; exportedCartons: number; exportedBundles: number }[];
  } | null>(null);

  const [showReceivedDetailModal, setShowReceivedDetailModal] = useState(false);
  const [selectedCenterForReceived, setSelectedCenterForReceived] = useState<{
    name: string;
    code: string;
    details: { stageName: string; receivedCartons: number; receivedBundles: number; receivedPallets: number }[];
  } | null>(null);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [selectedCenterForEmpty, setSelectedCenterForEmpty] = useState<{
    name: string;
    items: { stageName: string; cartons: number }[];
  } | null>(null);

  const [dbStatus, setDbStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, 'config', 'health_check')).catch(() => {});
        setDbStatus('online');
      } catch (err) {
        setDbStatus('offline');
      }
    };
    
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  // Consolidated trips to handle duplicates in the database (favoring most advanced status and newest date)
  const consolidatedTrips = useMemo(() => {
    // Stage 1: Basic normalization and global grouping by trip number
    const grouped = new Map<string, DistributionTrip>();
    
    distributionTrips.forEach(t => {
      const cleanNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
      
      const key = cleanNum; // GLOBAL deduplication (ignoring originCenter if number matches)
      
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, t);
      } else {
        const statusPriority: Record<string, number> = { 'executed': 3, 'dispatched': 2, 'planned': 1 };
        const currentPrio = statusPriority[t.status] || 0;
        const existingPrio = statusPriority[existing.status] || 0;
        
        if (currentPrio > existingPrio) {
          grouped.set(key, t);
        } else if (currentPrio === existingPrio) {
          // If both have the same status, take the one with the newest date
          const dateCurrent = new Date(t.date || 0).getTime();
          const dateExisting = new Date(existing.date || 0).getTime();
          if (dateCurrent > dateExisting) {
            grouped.set(key, t);
          }
        }
      }
    });

    // Stage 2: Suffix handling (e.g., ZJED-T01 vs ZJED-T01-A)
    // If one trip number is a prefix of another and they share similar properties, merge them.
    const finalGrouped = new Map<string, DistributionTrip>();
    const sorted = Array.from(grouped.values()).sort((a, b) => {
      const na = (a.tripNumber || '').replace(/[^a-zA-Z0-9]/g, '').length;
      const nb = (b.tripNumber || '').replace(/[^a-zA-Z0-9]/g, '').length;
      return na - nb; // Shortest first (bases first)
    });

    sorted.forEach(t => {
      const clean = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '').toLowerCase();
      
      // Look if there's an existing base number that this number starts with (e.g., "zdmmt01" is base for "zdmmt01a")
      let baseKey = clean;
      for (const existingKey of finalGrouped.keys()) {
          if (clean.startsWith(existingKey) && clean.length <= existingKey.length + 2) {
              baseKey = existingKey;
              break;
          }
      }

      const existing = finalGrouped.get(baseKey);
      if (!existing) {
        finalGrouped.set(baseKey, t);
      } else {
        const statusPriority: Record<string, number> = { 'executed': 3, 'dispatched': 2, 'planned': 1 };
        const currentPrio = statusPriority[t.status] || 0;
        const existingPrio = statusPriority[existing.status] || 0;
        
        if (currentPrio > existingPrio) {
          finalGrouped.set(baseKey, t);
        } else if (currentPrio === existingPrio) {
          const dateCurrent = new Date(t.date || 0).getTime();
          const dateExisting = new Date(existing.date || 0).getTime();
          if (dateCurrent > dateExisting) {
            finalGrouped.set(baseKey, t);
          }
        }
      }
    });

    return Array.from(finalGrouped.values());
  }, [distributionTrips]);

  const centerOptions = useMemo(() => {
    const centers = users.filter(u => u.role === 'center');
    const uniqueCenters = new Map<string, UserCredentials & { displayName: string }>();
    
    // Sort to handle those with locationName first
    const sortedCenters = [...centers].sort((a, b) => {
      const aHasLocation = !!(a.locationName && a.locationName.trim());
      const bHasLocation = !!(b.locationName && b.locationName.trim());
      if (aHasLocation && !bHasLocation) return -1;
      if (!aHasLocation && bHasLocation) return 1;
      return 0;
    });

    sortedCenters.forEach(c => {
      const normalizedCode = (c.code || '').trim().toUpperCase();
      if (normalizedCode && !uniqueCenters.has(normalizedCode)) {
        let finalName = c.locationName || c.displayName || c.username;
        if (normalizedCode === 'DMM' && (!c.locationName || c.locationName.includes('-'))) finalName = 'مركز الدمام';
        if (normalizedCode === 'RYD' && (!c.locationName || c.locationName.includes('-'))) finalName = 'مركز الرياض';
        if (normalizedCode === 'JED' && (!c.locationName || c.locationName.includes('-'))) finalName = 'مركز جدة';
        
        uniqueCenters.set(normalizedCode, { ...c, code: normalizedCode, displayName: finalName });
      }
    });
    return Array.from(uniqueCenters.values());
  }, [users]);

  useEffect(() => {
    if (centerOptions.length > 0 && !cCode) setCCode(centerOptions[0].code);
  }, [centerOptions, cCode]);

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'رقم الرحلة': '5001',
        'تاريخ الرحلة': new Date().toISOString().split('T')[0],
        'نقطة الانطلاق': userCenter || 'RYD',
        'الوجهة': 'المدينة المستهدفة',
        ...palletTypes.reduce((acc, type) => {
          acc[type.stageCode] = 0; // عمود الكراتين
          acc[`${type.stageCode}L`] = 0; // عمود الحزم
          return acc;
        }, {} as Record<string, number>)
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Distribution_Plan_Template.xlsx");
  };

  const isAdmin = useMemo(() => userCode === 'ADMIN' || (role as string) === 'admin', [userCode, role]);
  const isMonitor = useMemo(() => (role as string) === 'monitor', [role]);
  const isCanViewAll = useMemo(() => isAdmin || isMonitor, [isAdmin, isMonitor]);

  const DAMMAM_MISDIRECTED_BARCODES = [
    'G01YOM1177316', 'G01YOM1177416', 'G01YOM1177516', 'G01YOM1177616', 'G01YOM1177716',
    'G02YOM1177816', 'G02YOM1177916', 'G02YOM1178016',
    'G03YOM1178116',
    'G05YOM1178216', 'G05YOM1178316', 'G05YOM1178416', 'G05YOM1178516', 'G05YOM1178616', 'G05YOM1178716', 'G05YOM1178816',
    'G06YOM1178916', 'G06YOM1179016', 'G06YOM1179116', 'G06YOM1179216',
    'G07YOM1179316', 'G07YOM1179416', 'G07YOM1179516'
  ];

  const statsRecords = useMemo(() => {
    const baseRecords = records.filter(r => r.status !== 'cancelled');
    return (isCanViewAll) ? baseRecords : baseRecords.filter(r => {
      if (role === 'factory') return r.palletBarcode.includes(userCode);
      if (role === 'center') {
        const userCodeComp = userCenter.trim().toUpperCase();
        // If received, it belongs to receivedByCenter. 
        // If received incorrectly and we don't know where, it doesn't belong to the destination anymore.
        let recordCodeComp = (r.receivedByCenter || (r.status === 'received' && r.isWrongDestination ? 'WRONG_DEST' : r.destination)).trim().toUpperCase();
        
        // Hard fix for the 23 pallets that Dammam center didn't receive
        const barcode = (r.palletBarcode || '').trim().toUpperCase();
        if ((recordCodeComp === 'DAMMAM' || recordCodeComp === 'DMM') && barcode && DAMMAM_MISDIRECTED_BARCODES.includes(barcode)) {
          recordCodeComp = 'WRONG_DEST';
        }
        
        return recordCodeComp === userCodeComp;
      }
      return false;
    });
  }, [records, role, userCode, userCenter, isCanViewAll, DAMMAM_MISDIRECTED_BARCODES]);

  const handleAiAnalysis = async () => {
    setIsAnalyzing(true);
    const result = await analyzeInventory(palletTypes, statsRecords);
    setAiAnalysis(result);
    setIsAnalyzing(false);
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingExcel(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result;
        const wb = XLSX.read(arrayBuffer, { cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        const processedNumbers = new Set<string>();

        data.forEach((row) => {
          const rawTripNumber = row['رقم الرحلة'] || row['tripNumber'];
          if (!rawTripNumber) return;
          
          const tripNumber = String(rawTripNumber).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
          if (processedNumbers.has(tripNumber.toLowerCase())) return;
          processedNumbers.add(tripNumber.toLowerCase());
          
          // البحث عن رحلة موجودة بنفس الرقم لمنع التكرار (بغض النظر عن الحالة)
          const existingTrip = distributionTrips.find(t => {
            const dbNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
            return dbNum.toLowerCase() === tripNumber.toLowerCase();
          });

          const quantities = palletTypes.map(type => {
            const cartons = Number(row[type.stageCode] || 0);
            const extraBundles = Number(row[`${type.stageCode}L`] || 0);
            const bPerC = type.bundlesPerCarton || 1;
            const totalBundles = (cartons * bPerC) + extraBundles;
            const finalCartonCount = Math.floor(totalBundles / bPerC);

            return {
              palletTypeId: type.id,
              cartonCount: finalCartonCount,
              bundleCount: totalBundles
            };
          }).filter(q => q.bundleCount > 0);

          const tripDate = formatExcelDate(row['تاريخ الرحلة'] || row['date']);

          if (existingTrip) {
            batch.update(doc(db, 'distributionTrips', existingTrip.id), {
              date: tripDate,
              originCenter: String(row['نقطة الانطلاق'] || row['originCenter'] || ''),
              destinationCity: String(row['الوجهة'] || row['destinationCity'] || ''),
              quantities
            });
          } else {
            const id = generateUUID();
            const trip: DistributionTrip = {
              id,
              tripNumber,
              date: tripDate,
              originCenter: String(row['نقطة الانطلاق'] || row['originCenter'] || ''),
              destinationCity: String(row['الوجهة'] || row['destinationCity'] || ''),
              status: 'planned',
              quantities
            };
            batch.set(doc(db, 'distributionTrips', id), trip);
          }
        });

        await batch.commit();
        onNotify('نجاح', 'تم رفع الرحلات المخططة بنجاح');
      } catch (err) {
        console.error('Excel upload error:', err);
        onNotify('خطأ', 'خطأ في معالجة ملف الاكسل. يرجى التأكد من أسماء الأعمدة.');
      } finally {
        setIsUploadingExcel(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadExecutionTemplate = () => {
    const plannedTrips = consolidatedTrips.filter(t => t.status === 'planned' || t.status === 'dispatched');
    if (plannedTrips.length === 0) {
      onNotify('تنبيه', 'لا توجد رحلات مخططة حالياً لتوليد قالب لها');
      return;
    }

    const exportData = plannedTrips.map(t => {
      const row: any = {
        'رقم الرحلة': t.tripNumber,
        'مركز الانطلاق': t.originCenter,
        'الوجهة': t.destinationCity,
        'تاريخ الرحلة': t.date,
        'تاريخ التنفيذ': t.date,
      };
      // إضافة أعمدة لكل مرحلة
      palletTypes.forEach(type => {
        const planned = t.quantities.find(q => q.palletTypeId === type.id);
        row[type.stageName] = planned?.cartonCount || 0;
        row[`${type.stageName} فرط`] = planned?.bundleCount ? (planned.bundleCount % (type.bundlesPerCarton || 1)) : 0;
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Execution_Template");
    XLSX.writeFile(wb, `Planned_Trips_Execution_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleActualExecutionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) {
      onNotify('خطأ', 'غير مصرح لك بتنفيذ هذه العملية');
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingActual(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result;
        const wb = XLSX.read(arrayBuffer, { cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        let matchCount = 0;

        const allSystemTrips = consolidatedTrips.map(t => t.tripNumber.trim().toLowerCase());
        console.log("Actual Upload Debug: Total rows in Excel:", data.length);
        console.log("Actual Upload Debug: System trip numbers (lowercase):", allSystemTrips);
        
        const tripDiscrepancies: any[] = [];
        const missingTrips: string[] = [];

        for (const row of data) {
          // Normalize keys by trimming and removing invisible chars
          const normalizedRow: any = {};
          Object.entries(row).forEach(([k, v]) => {
            const cleanKey = String(k).trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
            normalizedRow[cleanKey] = v;
          });

          // Robust column name lookup
          const primaryKeys = ['رقم الرحلة', 'الرحلة', 'رقم', 'tripNumber', 'trip_number', 'Trip', 'trip'];
          let tripNumberStr = '';
          for (const key of primaryKeys) {
            if (normalizedRow[key] !== undefined) {
              tripNumberStr = String(normalizedRow[key]).trim();
              break;
            }
          }
          
          if (!tripNumberStr) {
            console.log("Actual Upload Debug: Skipping row with no trip number column found", normalizedRow);
            continue;
          }
           
          // Clean trip number - KEEP FULL STRING for alphanumeric IDs like ZDMM-T01
          const cleanRowNumber = tripNumberStr.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
          
          console.log(`Actual Upload Debug: Attempting match for [${cleanRowNumber}]`);

          // Find if this trip already exists - robust string matching
          const existingTrip = consolidatedTrips.find(t => {
            const dbTripNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
            
            // Case-insensitive exact string match
            return dbTripNum.toLowerCase() === cleanRowNumber.toLowerCase();
          });
          
          if (existingTrip) {
            console.log(`Actual Upload Debug: MATCH SUCCESS for [${cleanRowNumber}] -> ID: ${existingTrip.id}`);
            matchCount++;
            const rawDate = normalizedRow['تاريخ التنفيذ'] || normalizedRow['التاريخ'] || normalizedRow['تاريخ الرحلة'] || normalizedRow['date'] || normalizedRow['Date'] || normalizedRow['date_executed'] || normalizedRow['تاريخ تنفيذ الرحلة'];
            const executedDate = formatExcelDate(rawDate);
            
            const executedQuantities = palletTypes.map(type => {
              // Try matching by stageCode or stageName
              const cartons = Number(normalizedRow[type.stageCode] || normalizedRow[type.stageName] || 0);
              const extraBundles = Number(normalizedRow[`${type.stageCode}L`] || normalizedRow[`${type.stageName} فرط`] || 0);
              const bPerC = type.bundlesPerCarton || 1;
              const totalBundles = (cartons * bPerC) + extraBundles;
              const finalCartonCount = Math.floor(totalBundles / bPerC);

              return {
                palletTypeId: type.id,
                cartonCount: finalCartonCount,
                bundleCount: totalBundles
              };
            }).filter(q => q.bundleCount > 0);

            // Calculate discrepancies
            const dailyDiscrepancies: any[] = [];
            palletTypes.forEach(type => {
              const plannedItem = existingTrip.quantities.find(q => q.palletTypeId === type.id);
              const executedItem = executedQuantities.find(q => q.palletTypeId === type.id);
              
              const plannedCount = plannedItem?.cartonCount || 0;
              const actualCount = executedItem?.cartonCount || 0;
              
              if (plannedCount !== actualCount) {
                dailyDiscrepancies.push({
                  stageName: type.stageName,
                  planned: plannedCount,
                  actual: actualCount,
                  diff: actualCount - plannedCount
                });
              }
            });

            if (dailyDiscrepancies.length > 0) {
              const centerUser = users.find(u => u.code === existingTrip.originCenter && u.role === 'center');
              tripDiscrepancies.push({
                tripNumber: existingTrip.tripNumber,
                originCenter: existingTrip.originCenter,
                date: executedDate,
                discrepancies: dailyDiscrepancies,
                recipientEmail: centerUser?.email
              });
            }

            batch.update(doc(db, 'distributionTrips', existingTrip.id), {
              status: 'executed',
              executedDate,
              executedQuantities
            });
          } else {
            console.log(`Debug Upload: FAILED to find match for #${cleanRowNumber}. system contents:`, allSystemTrips);
            missingTrips.push(cleanRowNumber);
          }
        }

        if (matchCount > 0) {
          await batch.commit();
          let successMsg = `تم مطابقة واعتماد ${matchCount} رحلات فعلية بنجاح.`;
          if (missingTrips.length > 0) {
            successMsg += `\n⚠️ تنبيه: لم يتم العثور على الرحلات التالية (${missingTrips.join(', ')})`;
          }
          onNotify('نجاح', successMsg);

          // Send emails for discrepancies
          for (const tripResult of tripDiscrepancies) {
            try {
              await fetch('/api/notify-shortage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tripResult)
              });
            } catch (err) {
              console.error(`Failed to send notification for trip ${tripResult.tripNumber}:`, err);
            }
          }
        } else {
          const detail = missingTrips.length > 0 ? `\nالرحلات التي لم تُوجد: ${missingTrips.join(', ')}` : '';
          onNotify('تنبيه', `لم يتم العثور على أي رحلات مطابقة في الخطة.${detail}`);
        }
      } catch (err) {
        console.error('Actual update error:', err);
        onNotify('خطأ', 'حدث خطأ أثناء معالجة ملف التنفيذ الفعلي');
      } finally {
        setIsUploadingActual(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const handleManualExecutionSubmit = async () => {
    if (!isAdmin) {
      onNotify('خطأ', 'غير مصرح لك بتنفيذ هذه العملية');
      return;
    }
    if (!executionData.tripId || !executionData.date) {
      onNotify('تنبيه', 'يرجى اختيار الرحلة وتحديد تاريخ التنفيذ');
      return;
    }

    const existingTrip = consolidatedTrips.find(t => t.id === executionData.tripId);
    if (!existingTrip) return;

    const executedQuantities = Object.entries(executionData.quantities)
      .filter(([_, qty]) => qty.cartons > 0 || qty.bundles > 0)
      .map(([typeId, qty]) => {
        const type = palletTypes.find(t => t.id === typeId);
        const bPerC = type?.bundlesPerCarton || 1;
        const totalBundles = (qty.cartons * bPerC) + qty.bundles;
        const finalCartonCount = Math.floor(totalBundles / bPerC);

        return {
          palletTypeId: typeId,
          cartonCount: finalCartonCount,
          bundleCount: totalBundles
        };
      }).filter(q => q.bundleCount > 0);

    if (executedQuantities.length === 0) {
      onNotify('تنبيه', 'يرجى إضافة كمية منفذة واحدة على الأقل');
      return;
    }

    try {
      // Calculate discrepancies
      const dailyDiscrepancies: any[] = [];
      palletTypes.forEach(type => {
        const plannedItem = existingTrip.quantities.find(q => q.palletTypeId === type.id);
        const executedItem = executedQuantities.find(q => q.palletTypeId === type.id);
        
        const plannedCount = plannedItem?.cartonCount || 0;
        const actualCount = executedItem?.cartonCount || 0;
        
        if (plannedCount !== actualCount) {
          dailyDiscrepancies.push({
            stageName: type.stageName,
            planned: plannedCount,
            actual: actualCount,
            diff: actualCount - plannedCount
          });
        }
      });

      if (dailyDiscrepancies.length > 0) {
        const centerUser = users.find(u => u.code === existingTrip.originCenter && u.role === 'center');
        try {
          await fetch('/api/notify-shortage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tripNumber: existingTrip.tripNumber,
              originCenter: existingTrip.originCenter,
              date: executionData.date,
              discrepancies: dailyDiscrepancies,
              recipientEmail: centerUser?.email
            })
          });
        } catch (err) {
          console.error(`Failed to send notification:`, err);
        }
      }

      await updateDoc(doc(db, 'distributionTrips', existingTrip.id), {
        status: 'executed',
        executedDate: executionData.date,
        executedQuantities
      });

      onNotify('نجاح', `تم اعتماد تنفيذ الرحلة #${existingTrip.tripNumber} يدوياً بنجاح`);
      setShowExecutionManualForm(false);
      setExecutionData({
        tripId: '',
        date: new Date().toISOString().split('T')[0],
        quantities: {}
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `distributionTrips/${existingTrip.id}`);
    }
  };

  const handleDispatchTrip = async (tripId: string) => {
    try {
      await updateDoc(doc(db, 'distributionTrips', tripId), { status: 'dispatched' });
      onNotify('نجاح', 'تم إطلاق الرحلة وتحديث المخزون');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `distributionTrips/${tripId}`);
    }
  };

  const handleDeleteDistTrip = (tripId: string) => {
    setTripIdToDeleteDist(tripId);
    setShowDeleteDistModal(true);
  };

  const confirmDeleteDistTrip = async () => {
    if (!tripIdToDeleteDist) return;
    try {
      await deleteDoc(doc(db, 'distributionTrips', tripIdToDeleteDist));
      onNotify('نجاح', 'تم حذف رحلة التوزيع بنجاح');
      setShowDeleteDistModal(false);
      setTripIdToDeleteDist(null);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.DELETE, `distributionTrips/${tripIdToDeleteDist}`);
    }
  };

  const handleRevertExecutionConfirm = async () => {
    if (!tripIdToRevert) return;
    try {
      await updateDoc(doc(db, 'distributionTrips', tripIdToRevert), {
        status: 'planned',
        executedDate: deleteField(),
        executedQuantities: deleteField()
      });
      onNotify('نجاح', 'تم التراجع عن العملية وتمت إعادة الرحلة إلى قائمة المخطط');
      setShowRevertModal(false);
      setTripIdToRevert(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `distributionTrips/${tripIdToRevert}`);
    }
  };

  const handleEditDistTrip = (trip: DistributionTrip) => {
    if (!isAdmin) return;
    const quantitiesMap: Record<string, { cartons: number, bundles: number }> = {};
    trip.quantities.forEach(q => {
      const type = palletTypes.find(t => t.id === q.palletTypeId);
      const bPerC = type?.bundlesPerCarton || 1;
      const fullCartons = Math.floor(q.bundleCount / bPerC);
      const remainingBundles = q.bundleCount % bPerC;
      quantitiesMap[q.palletTypeId] = {
        cartons: fullCartons,
        bundles: remainingBundles
      };
    });

    setDistTripData({
      tripNumber: trip.tripNumber,
      date: trip.date,
      originCenter: trip.originCenter,
      destinationCity: trip.destinationCity,
      quantities: quantitiesMap
    });
    setEditingTripId(trip.id);
    setShowDistForm(true);
  };

  const handleCreateManualDistTrip = async () => {
    console.log('Attempting to create/update manual dist trip...', distTripData);
    if (!distTripData.tripNumber || !distTripData.originCenter || !distTripData.destinationCity) {
      onNotify('تنبيه', 'يرجى إكمال جميع البيانات الأساسية');
      return;
    }

    const quantities = Object.entries(distTripData.quantities)
      .filter(([_, qty]) => qty.cartons > 0 || qty.bundles > 0)
      .map(([typeId, qty]) => {
        const type = palletTypes.find(t => t.id === typeId);
        const bPerC = type?.bundlesPerCarton || 0;
        
        if (bPerC <= 0) return null; // تجاهل المراحل ذات البيانات الخاطئة

        // المنطق الجديد: تحويل كل المدخلات إلى حزم أولاً
        const totalBundles = (qty.cartons * bPerC) + qty.bundles;
        
        // ثم إعادة توزيعها إلى كراتين كاملة وحزم متبقية
        const finalCartonCount = Math.floor(totalBundles / bPerC);
        
        return {
          palletTypeId: typeId,
          cartonCount: finalCartonCount,
          bundleCount: totalBundles
        };
      }).filter(q => q !== null) as { palletTypeId: string, cartonCount: number, bundleCount: number }[];

    if (quantities.length === 0) {
      onNotify('تنبيه', 'يرجى إضافة كمية واحدة على الأقل');
      return;
    }

    try {
      if (editingTripId) {
        await updateDoc(doc(db, 'distributionTrips', editingTripId), {
          tripNumber: distTripData.tripNumber.trim(),
          date: distTripData.date,
          originCenter: distTripData.originCenter,
          destinationCity: distTripData.destinationCity,
          quantities
        });
        onNotify('نجاح', 'تم تحديث الرحلة بنجاح');
      } else {
        const cleanNumber = distTripData.tripNumber.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
        
        // التحقق من تكرار رقم الرحلة (باستخدام القائمة المدمجة بدلاً من كل الرحلات)
        const isDuplicate = consolidatedTrips.some(t => {
           const dbNum = (t.tripNumber || '').replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '');
           return dbNum.toLowerCase() === cleanNumber.toLowerCase();
        });
        
        if (isDuplicate) {
          onNotify('خطأ', `رقم الرحلة (${distTripData.tripNumber}) موجود مسبقاً في النظام`);
          return;
        }

        const id = generateUUID();
        const newTrip: DistributionTrip = {
          id,
          tripNumber: cleanNumber,
          date: distTripData.date,
          originCenter: distTripData.originCenter,
          destinationCity: distTripData.destinationCity,
          status: 'planned',
          quantities
        };
        await setDoc(doc(db, 'distributionTrips', id), newTrip);
        onNotify('نجاح', 'تم إضافة الرحلة بنجاح');
      }
      
      setShowDistForm(false);
      setEditingTripId(null);
      setDistTripData({
        tripNumber: '',
        date: new Date().toISOString().split('T')[0],
        originCenter: '',
        destinationCity: '',
        quantities: {}
      });
    } catch (e) {
      handleFirestoreError(e, editingTripId ? OperationType.UPDATE : OperationType.CREATE, 'distributionTrips');
    }
  };

  const handleShiftPlannedTripDates = async () => {
    if (!isAdmin) return;
    try {
      const plannedTrips = distributionTrips.filter(t => t.status === 'planned');
      const batch = writeBatch(db);
      let count = 0;
      for (const trip of plannedTrips) {
        if (!trip.date) continue;
        const d = new Date(trip.date);
        if (isNaN(d.getTime())) continue;
        
        d.setUTCDate(d.getUTCDate() + 1);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        const newDate = `${y}-${m}-${day}`;
        
        batch.update(doc(db, 'distributionTrips', trip.id), { date: newDate });
        count++;
      }
      if (count > 0) {
        await batch.commit();
        onNotify('نجاح', `تم تحديث تواريخ ${count} رحلة مخططة (زيادة يوم واحد)`);
      } else {
        onNotify('معلومة', 'لا توجد رحلات مخططة تحتاج لتحديث');
      }
    } catch(err) {
      handleFirestoreError(err, OperationType.UPDATE, 'distributionTrips');
    }
  };

  const handleApplyMisdirectedFix = async () => {
    setIsApplyingFix(true);
    const barcodes = misdirectedBarcodesStr.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (barcodes.length === 0) {
      onNotify('تنبيه', 'يرجى إدخال باركود واحد على الأقل');
      setIsApplyingFix(false);
      return;
    }

    try {
      const batch = writeBatch(db);
      let count = 0;
      barcodes.forEach(bc => {
        const record = records.find(r => r.palletBarcode === bc);
        if (record) {
          batch.update(doc(db, 'records', record.id), {
            isWrongDestination: true,
            receivedByCenter: 'MISDIRECTED_CORRECTED',
            status: 'received', // Keep as received but at "WRONG_DEST" effectively
            notes: (record.notes || '') + ' [تم تصحيح التوجيه وتعديل الرصيد يدوياً بناءً على طلب الإدارة]'
          });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        onNotify('نجاح', `تمت معالجة ${count} طبلية وإزالتها من رصيد المركز الأصلي.`);
        setShowFixMisdirectedModal(false);
        setMisdirectedBarcodesStr('');
      } else {
        onNotify('تنبيه', 'لم يتم العثور على أي من الأكواد المدخلة في النظام.');
      }
    } catch (err) {
      console.error(err);
      onNotify('خطأ', 'فشل تطبيق التصحيح.');
    } finally {
      setIsApplyingFix(false);
    }
  };

  const handleExportCenterInventory = () => {
    const exportData: any[] = [];
    const isDateFiltered = exportStartDate || exportEndDate;

    centerOptions.forEach(center => {
      const centerRecords = statsRecords.filter(r => {
        const compareCode = center.code.trim().toUpperCase();
        let recordCenterCode = (r.receivedByCenter || (r.status === 'received' && r.isWrongDestination ? 'WRONG_DEST' : r.destination)).trim().toUpperCase();
        
        // Hard fix for the 23 pallets that Dammam center didn't receive
        if ((recordCenterCode === 'DAMMAM' || recordCenterCode === 'DMM') && DAMMAM_MISDIRECTED_BARCODES.includes(r.palletBarcode.trim().toUpperCase())) {
          recordCenterCode = 'WRONG_DEST';
        }

        return recordCenterCode === compareCode;
      });
      const receivedRecords = centerRecords.filter(r => r.status === 'received');

      if (isDateFiltered) {
        // Mode: Trips with deficit in date range
        const centerTrips = consolidatedTrips
          .filter(t => t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase())
          .sort((a, b) => a.date.localeCompare(b.date));

        // Initial stock calculation per pallet type for the center
        const currentStock = palletTypes.reduce((acc, type) => {
          const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
          let totalC = 0;
          typeInCenter.forEach(r => {
            let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
            if (r.extraCartons) c += r.extraCartons;
            if (r.missingCartons) c -= r.missingCartons;
            if (r.hasDiscrepancy) {
              const sign = r.discrepancyType === 'excess' ? 1 : -1;
              c += sign * (r.discrepancyCartonsQty || 0);
            }
            totalC += c;
          });

          // Subtract already executed or dispatched trips
          const centerExecutedTrips = centerTrips.filter(t => t.status !== 'planned');
          centerExecutedTrips.forEach(et => {
             const qt = (et.executedQuantities || et.quantities).find(q => q.palletTypeId === type.id);
             if (qt) totalC -= qt.cartonCount;
          });

          acc[type.id] = totalC;
          return acc;
        }, {} as Record<string, number>);

        // Process planned trips in chronological order to correctly calculate deficits
        centerTrips.filter(t => t.status === 'planned').forEach(trip => {
          let hasShortage = false;
          const tripDeficits: { typeId: string, q: number, deficit: number }[] = [];

          trip.quantities.forEach(q => {
            const available = currentStock[q.palletTypeId] || 0;
            if (available < q.cartonCount) {
              hasShortage = true;
              tripDeficits.push({
                typeId: q.palletTypeId,
                q: q.cartonCount,
                deficit: q.cartonCount - available
              });
            }
            currentStock[q.palletTypeId] = available - q.cartonCount;
          });

          if (hasShortage) {
            // Apply date filter to the trip
            const tripDate = trip.date;
            let inRange = true;
            if (exportStartDate && tripDate < exportStartDate) inRange = false;
            if (exportEndDate && tripDate > exportEndDate) inRange = false;

            if (inRange) {
              tripDeficits.forEach(d => {
                const type = palletTypes.find(t => t.id === d.typeId);
                exportData.push({
                  'المركز الأصل': center.displayName,
                  'رقم الرحلة': trip.tripNumber,
                  'تاريخ الرحلة': trip.date,
                  'الوجهة': trip.destinationCity,
                  'المرحلة': type?.stageName || 'غير معروف',
                  'الكمية المخططة (كرتون)': d.q,
                  'الحزم المخطط لها': d.q * (type?.bundlesPerCarton || 0),
                  'العجز (كرتون)': d.deficit,
                  'العجز (حزمة)': d.deficit * (type?.bundlesPerCarton || 0),
                  'العجز (طبلية)': type?.cartonsPerPallet ? (d.deficit / type.cartonsPerPallet).toFixed(2) : '0',
                  'الحر المتبقي حزم': currentStock[d.typeId] * (type?.bundlesPerCarton || 0)
                });
              });
            }
          }
        });
      } else {
        palletTypes.forEach(type => {
          const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
          const plannedQty = stats.plannedOutbound[center.code]?.[type.id] || 0;
          
          // حساب الكميات المصدرة لهذه المرحلة
          let typeExportedCartons = 0;
          let typeExportedBundles = 0;
          const centerExecutedTrips = consolidatedTrips.filter(t => 
            t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase() && 
            (t.status === 'executed' || t.status === 'dispatched')
          );
          centerExecutedTrips.forEach(et => {
            const q = (et.executedQuantities || et.quantities).find(qty => qty.palletTypeId === type.id);
            if (q) {
              typeExportedCartons += q.cartonCount;
              typeExportedBundles += (q.bundleCount || 0);
            }
          });

          const palletCount = typeInCenter.length;

          let totalCartons = 0;
          let totalBundles = 0;
          let diffCartons = 0;
          let diffBundles = 0;

          typeInCenter.forEach(r => {
            let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
            let b = c * type.bundlesPerCarton;

            if (r.extraCartons) {
              c += r.extraCartons;
              b += r.extraCartons * type.bundlesPerCarton;
              diffCartons += r.extraCartons;
              diffBundles += r.extraCartons * type.bundlesPerCarton;
            }
            if (r.missingCartons) {
              c -= r.missingCartons;
              b -= r.missingCartons * type.bundlesPerCarton;
              diffCartons -= r.missingCartons;
              diffBundles -= r.missingCartons * type.bundlesPerCarton;
            }

            if (r.hasDiscrepancy) {
              const sign = r.discrepancyType === 'excess' ? 1 : -1;
              const diffC = r.discrepancyCartonsQty || 0;
              const diffB = r.discrepancyBundlesQty || 0;
              diffCartons += sign * diffC;
              diffBundles += sign * diffB;
              
              c += sign * diffC;
              b += sign * ((diffC * type.bundlesPerCarton) + diffB);
            }
            totalCartons += c;
            totalBundles += b;
          });

          // الحساب الصحيح للرصيد المتبقي الحر: المستلم - (المنفذ + المشحون + المخطط)
          const remainingCartonsTotal = Math.max(0, totalCartons - typeExportedCartons - plannedQty);
          const remainingBundlesTotal = Math.max(0, totalBundles - typeExportedBundles - (plannedQty * type.bundlesPerCarton));
          
          const remainingPallets = type.cartonsPerPallet > 0 ? (remainingCartonsTotal / type.cartonsPerPallet).toFixed(2) : '0';

          if (palletCount > 0 || plannedQty > 0 || typeExportedCartons > 0) {
            exportData.push({
              'المركز': center.locationName || center.displayName,
              'المرحلة': type.stageName,
              'عدد الطبليات (المستلمة)': palletCount,
              'التباين (كرتون)': diffCartons,
              'التباين (حزمة)': diffBundles,
              'إجمالي الكراتين المستلمة': totalCartons,
              'إجمالي الحزم المستلمة': totalBundles,
              'تم تصديره (كرتون)': typeExportedCartons,
              'تم تصديره (حزمة)': typeExportedBundles, // الكمية التي تم شحنها أو تنفيذها فعلياً بالحزم
              'مخطط صرفه (كرتون)': plannedQty,
              'الرصيد الحر المتبقي (كرتون)': remainingCartonsTotal,
              'الرصيد الحر المتبقي (حزمة)': remainingBundlesTotal,
              'الطبليات المتبقية': remainingPallets
            });
          }
        });
      }
    });

    if (exportData.length === 0) {
      onNotify('تنبيه', 'لا يوجد بيانات لتصديرها');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isDateFiltered ? "Deficit Trips" : "Inventory Report");
    XLSX.writeFile(wb, `${isDateFiltered ? 'Deficit_Trips' : 'Inventory_Report'}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportAllTripsRaw = () => {
    try {
      const data = distributionTrips.map(t => {
        const row: any = {
          'رقم الرحلة': t.tripNumber,
          'مركز المنشأ': t.originCenter,
          'الوجهة / المقصد': t.destinationCity,
          'التاريخ': t.date,
          'الحالة': t.status === 'executed' ? 'تم التنفيذ' : t.status === 'dispatched' ? 'تم الشحن' : 'مخطط',
          'المعرف الفريد (ID)': t.id
        };

        // إضافة الكميات لكل مرحلة كأعمدة
        t.quantities.forEach(q => {
          const type = palletTypes.find(pt => pt.id === q.palletTypeId);
          if (type) {
            row[type.stageName] = q.cartonCount;
          }
        });

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "جميع الرحلات الخام");
      XLSX.writeFile(wb, `All_Trips_Raw_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('فشل تصدير التقرير الكامل');
    }
  };

  const handleExportDispatchedTable = (tripsToExport: any[]) => {
    try {
      const data = tripsToExport.map(t => {
        const row: any = {
          'رقم الرحلة': t.tripNumber,
          'الوجهة': t.destinationCity,
          'التاريخ': t.date,
          'المركز': t.originCenter,
          'الإجمالي (كرتون)': (t.executedQuantities || t.quantities).reduce((acc: number, q: any) => acc + q.cartonCount, 0)
        };
        palletTypes.forEach(pt => {
          const q = (t.executedQuantities || t.quantities).find((qty: any) => qty.palletTypeId === pt.id);
          row[pt.stageName] = q ? q.cartonCount : 0;
        });
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "الرحلات المنطلقة");
      XLSX.writeFile(wb, `Dispatched_Trips_Detailed_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('فشل تصدير التقرير');
    }
  };

  const handleExportAllPalletsRaw = () => {
    try {
      const data = records.map(r => {
        const pType = palletTypes.find(t => t.id === r.palletTypeId);
        const trip = trips.find(t => t.id === r.tripId);
        return {
          'باركود الطبلية': r.palletBarcode,
          'باركود الطبلية (Barcode)': `*${r.palletBarcode}*`,
          'رقم الرحلة': trip?.tripNumber || '---',
          'المرحلة': pType?.stageName || '---',
          'الوجهة': getDisplayName(r.destination),
          'الحالة': r.status === 'received' ? 'تم الاستلام' : r.status === 'in_transit' ? 'في الطريق' : r.status === 'cancelled' ? 'ملغاة' : 'في المطبعة',
          'المنشأ': getDisplayName(trip?.pressCode || '---'),
          'كراتين إضافية': r.extraCartons || 0,
          'كراتين ناقصة': r.missingCartons || 0,
          'تاريخ الإنشاء': r.timestamp ? new Date(r.timestamp).toLocaleString('ar-SA') : '---'
        };
      });

      const ws = XLSX.utils.json_to_sheet(data);
      applyBarcodeStyleToSheet(ws, 'باركود الطبلية (Barcode)');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "جميع الطبليات");
      XLSX.writeFile(wb, `All_Pallets_Data_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('فشل تصدير بيانات الطبليات');
    }
  };

  const handleExportDispatchedTripsDetailedReport = () => {
    try {
      // نستخدم consolidatedTrips لضمان عدم وجود نسخ مكررة من نفس الرحلة
      const dispatchedTrips = consolidatedTrips.filter(t => t.status === 'dispatched' || t.status === 'executed');
      
      const data = dispatchedTrips.map(t => {
        const row: any = {
          'رقم الرحلة': t.tripNumber,
          'مركز المنشأ': getDisplayName(t.originCenter),
          'الوجهة': t.destinationCity,
          'التاريخ': t.date,
          'الحالة': t.status === 'executed' ? 'تم التنفيذ' : 'منطلقة (في الطريق)',
        };

        // إضافة الكميات لكل مرحلة دراسية كأعمدة منفصلة
        const qList = t.executedQuantities || t.quantities;
        qList.forEach(q => {
          const type = palletTypes.find(pt => pt.id === q.palletTypeId);
          if (type) {
            row[type.stageName] = (row[type.stageName] || 0) + q.cartonCount;
          }
        });

        return row;
      });

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "الرحلات المنطلقة");
      XLSX.writeFile(wb, `Dispatched_Trips_Detailed_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('فشل تصدير تقرير الرحلات المنطلقة');
    }
  };

  const handleDownloadComparisonReport = () => {
    try {
      const USER_PLAN_DMM: Record<string, number> = {
        'الصف الأول الابتدائي': 3629,
        'الصف الثاني الابتدائي': 5120,
        'الصف الثالث الابتدائي': 5708,
        'الصف الرابع الابتدائي': 8323,
        'الصف الخامس الابتدائي': 8747,
        'الصف السادس الابتدائي': 8015,
        'الصف الأول المتوسط': 2716
      };

      const dmmTrips = consolidatedTrips.filter(t => t.originCenter === 'DMM' && (t.status === 'executed' || t.status === 'dispatched'));
      const systemStats = new Map<string, number>();

      dmmTrips.forEach(t => {
        const qtList = t.executedQuantities || t.quantities;
        qtList.forEach(q => {
          const type = palletTypes.find(pt => pt.id === q.palletTypeId);
          if (type) {
            systemStats.set(type.stageName, (systemStats.get(type.stageName) || 0) + q.cartonCount);
          }
        });
      });

      const reportData = Object.entries(USER_PLAN_DMM).map(([stage, planned]) => {
        const executed = systemStats.get(stage) || 0;
        return {
          'المرحلة': stage,
          'المخطط (حسب جدولك)': planned,
          'المنفذ (النظام حالياً)': executed,
          'الفارق (الزيادة)': executed - planned
        };
      });

      const totals = reportData.reduce((acc, row) => ({
        planned: acc.planned + row['المخطط (حسب جدولك)'],
        executed: acc.executed + row['المنفذ (النظام حالياً)'],
        diff: acc.diff + row['الفارق (الزيادة)']
      }), { planned: 0, executed: 0, diff: 0 });

      reportData.push({
        'المرحلة': 'الإجمالي',
        'المخطط (حسب جدولك)': totals.planned,
        'المنفذ (النظام حالياً)': totals.executed,
        'الفارق (الزيادة)': totals.diff
      });

      const ws = XLSX.utils.json_to_sheet(reportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "مقارنة التخطيط والمنفذ");
      XLSX.writeFile(wb, `DMM_Comparison_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error(err);
      alert('فشل تصدير التقرير');
    }
  };

  const handleCancelTrip = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    if (trip.status === 'cancelled') {
        onNotify('تنبيه', 'هذه الرحلة ملغاة بالفعل');
        return;
    }

    const tripRecords = records.filter(r => r.tripId === tripId);
    const isAnyReceived = tripRecords.some(r => r.status === 'received');

    if (isAnyReceived) {
      onNotify('خطأ', 'لا يمكن إلغاء رحلة تم استلام بعض طبلياتها بالفعل.');
      return;
    }

    setTripIdToCancel(tripId);
    setShowCancelModal(true);
  };

  const confirmCancelTrip = async () => {
    if (!tripIdToCancel) return;
    const trip = trips.find(t => t.id === tripIdToCancel);
    if (!trip) return;

    try {
      const tripRecords = records.filter(r => r.tripId === tripIdToCancel);
      const batch = writeBatch(db);
      batch.update(doc(db, 'trips', tripIdToCancel), { status: 'cancelled' });
      
      tripRecords.forEach(r => {
        batch.update(doc(db, 'records', r.id), { status: 'cancelled' });
      });
      
      await batch.commit();
      onNotify('نجاح', `تم إلغاء الرحلة #${trip.tripNumber} بنجاح.`);
      setShowCancelModal(false);
      setTripIdToCancel(null);
      setSelectedTripForControl('');
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, 'trips');
    }
  };

  const handleRestoreTrip = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;
    if (trip.status !== 'cancelled') {
        onNotify('تنبيه', 'هذه الرحلة ليست ملغاة');
        return;
    }
    setTripIdToRestore(tripId);
    setShowRestoreTripModal(true);
  };

  const confirmRestoreTrip = async () => {
    if (!tripIdToRestore) return;
    const trip = trips.find(t => t.id === tripIdToRestore);
    if (!trip) return;

    try {
      console.log(`Restoring trip: ${tripIdToRestore}`);
      // جلب بيانات الرحلة من الخادم للتأكد من حالتها
      const tripRef = doc(db, 'trips', tripIdToRestore);
      const tripSnap = await getDoc(tripRef);
      
      if (!tripSnap.exists()) {
        throw new Error('الرحلة غير موجودة في قاعدة البيانات');
      }

      const tripRecords = records.filter(r => r.tripId === tripIdToRestore);
      const batch = writeBatch(db);
      
      // إعادة الرحلة لحالة النشاط
      batch.update(tripRef, { 
        status: 'active',
        cancelledAt: deleteField()
      });
      
      // إعادة كل طبلية لحالتها السابقة قبل الإلغاء
      tripRecords.forEach(r => {
        const newStatus = r.centerTimestamp ? 'received' : (r.factoryTimestamp ? 'in_transit' : 'pending');
        batch.update(doc(db, 'records', r.id), { 
          status: newStatus,
          cancelledAt: deleteField()
        });
      });
      
      await batch.commit();

      // سـجل الـفعل
      await addDoc(collection(db, 'system_logs'), {
        timestamp: Date.now(),
        type: 'system_error',
        userId: userCode || 'ADMIN',
        message: 'استعادة رحلة ملغاة',
        details: `تمت استعادة الرحلة #${trip.tripNumber} وعدد ${tripRecords.length} طبلية مرتبطة بها.`
      });

      onNotify('✅ تم استعادة الرحلة', `تمت استعادة الرحلة #${trip.tripNumber} وكافة متعلقاتها بنجاح.`);
      setShowRestoreTripModal(false);
      setTripIdToRestore(null);
    } catch (e: any) {
      console.error('Failed to restore trip:', e);
      const errorMsg = e?.message || String(e);
      onNotify('❌ خطأ', `فشل في استعادة الرحلة: ${errorMsg}`);
    }
  };

  const handleExportTripPallets = (tripId: string) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;
    const tripRecords = records.filter(r => r.tripId === tripId);

    if (tripRecords.length === 0) {
      onNotify('تنبيه', 'لا يوجد طبليات لهذه الرحلة');
      return;
    }

    // Sort by stage then barcode
    const sortedRecords = [...tripRecords].sort((a, b) => {
      const typeA = palletTypes.find(t => t.id === a.palletTypeId);
      const typeB = palletTypes.find(t => t.id === b.palletTypeId);
      if (!typeA || !typeB) return 0;
      const stageCompare = (typeA.stageCode || '').localeCompare(typeB.stageCode || '');
      if (stageCompare !== 0) return stageCompare;
      return (a.palletBarcode || '').localeCompare(b.palletBarcode || '');
    });

    const exportData = sortedRecords.map(r => {
      const pType = palletTypes.find(t => t.id === r.palletTypeId);
      return {
        'رقم الرحلة': trip?.tripNumber || '---',
        'باركود الطبلية': r.palletBarcode,
        'باركود الطبلية (Barcode)': `*${r.palletBarcode}*`,
        'المرحلة': pType?.stageName || '---',
        'الوجهة': users.find(u => u.code === r.destination)?.displayName || r.destination,
        'الحالة': r.status === 'received' ? 'تم الاستلام' : r.status === 'in_transit' ? 'في الطريق' : r.status === 'cancelled' ? 'ملغاة' : 'في المطبعة',
        'كراتين إضافية': r.extraCartons || 0,
        'كراتين ناقصة': r.missingCartons || 0,
        'تاريخ الإنشاء': r.timestamp ? new Date(r.timestamp).toLocaleString('ar-SA') : '---'
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    applyBarcodeStyleToSheet(ws, 'باركود الطبلية (Barcode)');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trip Pallets");
    XLSX.writeFile(wb, `Trip_${trip?.tripNumber || 'Pallets'}_Details.xlsx`);
  };

  const currentTrip = useMemo(() => trips.find(t => t.id === currentTripId), [trips, currentTripId]);
  const currentTripRecords = useMemo(() => {
    const filtered = records.filter(r => r.tripId === currentTripId);
    return [...filtered].sort((a, b) => {
      const typeA = palletTypes.find(t => t.id === a.palletTypeId);
      const typeB = palletTypes.find(t => t.id === b.palletTypeId);
      if (!typeA || !typeB) return 0;
      
      const stageCompare = (typeA.stageCode || '').localeCompare(typeB.stageCode || '');
      if (stageCompare !== 0) return stageCompare;
      
      return (a.palletBarcode || '').localeCompare(b.palletBarcode || '');
    });
  }, [records, currentTripId, palletTypes]);

  const stats = useMemo(() => {
    const received = statsRecords.filter(r => r.status === 'received');
    
    // Filter trips for the current center if restricted
    const filteredTrips = isCanViewAll ? consolidatedTrips : consolidatedTrips.filter(t => 
      t.originCenter.trim().toUpperCase() === userCenter.trim().toUpperCase()
    );

    const stageSummary = palletTypes.map(type => {
      const typeReceived = received.filter(r => r.palletTypeId === type.id);
      const palletCount = typeReceived.length;

      let totalCartons = 0;
      let totalBundles = 0;
      typeReceived.forEach(r => {
        let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;
        let b = c * type.bundlesPerCarton;

        if (r.extraCartons) {
          c += r.extraCartons;
          b += r.extraCartons * type.bundlesPerCarton;
        }
        if (r.missingCartons) {
          c -= r.missingCartons;
          b -= r.missingCartons * type.bundlesPerCarton;
        }

        if (r.hasDiscrepancy) {
          const sign = r.discrepancyType === 'excess' ? 1 : -1;
          const diffC = r.discrepancyCartonsQty || 0;
          const diffB = r.discrepancyBundlesQty || 0;
          c += sign * diffC;
          b += sign * ((diffC * type.bundlesPerCarton) + diffB);
        }
        totalCartons += c;
        totalBundles += b;
      });
      
      return { ...type, palletCount, totalCartons, totalBundles };
    }).filter(s => s.palletCount > 0);

    const totalBundles = stageSummary.reduce((acc, s) => acc + s.totalBundles, 0);
    const totalCartons = stageSummary.reduce((acc, s) => acc + s.totalCartons, 0);
    const totalBooksCartons = stageSummary.filter(s => !s.stageCode.toUpperCase().startsWith('F')).reduce((acc, s) => acc + s.totalCartons, 0);
    const totalEmptyCartons = stageSummary.filter(s => s.stageCode.toUpperCase().startsWith('F')).reduce((acc, s) => acc + s.totalCartons, 0);

    // حساب إجمالي النقص/الزيادة
    let totalDiffCartons = 0;
    let totalDiffBundles = 0;
    received.forEach(r => {
      const type = palletTypes.find(t => t.id === r.palletTypeId);
      if (type) {
        if (r.extraCartons) {
          totalDiffCartons += r.extraCartons;
          totalDiffBundles += r.extraCartons * type.bundlesPerCarton;
        }
        if (r.missingCartons) {
          totalDiffCartons -= r.missingCartons;
          totalDiffBundles -= r.missingCartons * type.bundlesPerCarton;
        }
        if (r.hasDiscrepancy) {
          const sign = r.discrepancyType === 'excess' ? 1 : -1;
          totalDiffCartons += sign * (r.discrepancyCartonsQty || 0);
          totalDiffBundles += sign * (r.discrepancyBundlesQty || 0);
        }
      }
    });

    // حساب إجمالي عدد الكراتين المتضررة بدقة
    const totalExtDamagedCartons = received.reduce((acc, r) => acc + (r.externalDamageQty || 0), 0);
    const totalIntDamagedCartons = received.reduce((acc, r) => acc + (r.internalDamageQty || 0), 0);
    const totalDamagedCartons = totalExtDamagedCartons + totalIntDamagedCartons;

    // حساب المخزون المخطط صرفه (Planned Outbound)
    const totalPlannedBooksCartons = filteredTrips
      .filter(t => t.status === 'planned')
      .reduce((acc, t) => {
        const qTot = t.quantities.reduce((sum, q) => {
           const type = palletTypes.find(pt => pt.id === q.palletTypeId);
           if (type && !type.stageCode.toUpperCase().startsWith('F')) {
             return sum + q.cartonCount;
           }
           return sum;
        }, 0);
        return acc + qTot;
      }, 0);

    const plannedOutbound = filteredTrips
      .filter(t => t.status === 'planned')
      .reduce((acc, t) => {
        t.quantities.forEach(q => {
          acc[t.originCenter] = acc[t.originCenter] || {};
          acc[t.originCenter][q.palletTypeId] = (acc[t.originCenter][q.palletTypeId] || 0) + q.cartonCount;
        });
        return acc;
      }, {} as Record<string, Record<string, number>>);

    const shippedOutbound = filteredTrips
      .filter(t => t.status === 'dispatched' || t.status === 'executed')
      .reduce((acc, t) => {
        const qtList = t.executedQuantities || t.quantities;
        qtList.forEach(q => {
          const type = palletTypes.find(pt => pt.id === q.palletTypeId);
          if (type) {
            if (type.stageCode.toUpperCase().startsWith('F')) {
              acc.emptyCartons += q.cartonCount;
            } else {
              acc.bookCartons += q.cartonCount;
              acc.bookBundles += q.bundleCount || 0;
            }
          }
        });
        return acc;
      }, { bookCartons: 0, bookBundles: 0, emptyCartons: 0 });

    const totalFreeBooksCartons = totalBooksCartons - shippedOutbound.bookCartons - totalPlannedBooksCartons;

    return { 
      total: statsRecords.length, 
      received: received.length,
      inFactory: statsRecords.filter(r => r.status === 'pending').length,
      inTransit: statsRecords.filter(r => r.status === 'in_transit').length,
      totalCartons,
      totalBundles,
      totalBooksCartons,
      totalEmptyCartons,
      totalDiffCartons,
      totalDiffBundles,
      stageSummary,
      totalDamagedCartons,
      totalExtDamagedCartons,
      totalIntDamagedCartons,
      palletsWithDamage: received.filter(r => r.condition && r.condition !== 'intact').length,
      plannedOutbound,
      shippedOutbound,
      totalPlannedBooksCartons,
      totalFreeBooksCartons,
      wrongDestinationsCount: received.filter(r => r.isWrongDestination || (r.notes && r.notes.includes('توجيه خاطئ'))).length
    };
  }, [statsRecords, palletTypes, consolidatedTrips, isCanViewAll, userCenter]);

  const getDisplayName = (code: string) => {
    if (code === 'MISDIRECTED_CORRECTED' || code === 'WRONG_DEST') return 'مركز توجيه خاطئ';
    const u = users.find(u => u.code === code);
    if (!u) return code;
    
    let name = u.locationName || u.displayName;
    
    // Explicit fixes for main centers
    if (u.code === 'DMM' && (!u.locationName || u.locationName.includes('-'))) name = 'مركز الدمام';
    if (u.code === 'RYD' && (!u.locationName || u.locationName.includes('-'))) name = 'مركز الرياض';
    if (u.code === 'JED' && (!u.locationName || u.locationName.includes('-'))) name = 'مركز جدة';
    
    // Handle "User - Location" pattern
    if (name.includes(' - ')) {
      const parts = name.split(' - ');
      return parts[1].trim(); 
    }
    
    return name;
  };

  const generateLabelContent = (record: InventoryRecord, size: LabelSize) => {
    const pType = palletTypes.find(t => t.id === record?.palletTypeId);
    const trip = trips.find(t => t.id === record.tripId) || currentTrip;
    const barcodeImgUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${record?.palletBarcode}&scale=4&rotate=N&includetext=false`;
    const isLarge = size === '10x15';

    return `
      <div class="label-card" style="width: 100%; height: 100%; border: ${isLarge ? '8px' : '4px'} solid black; padding: ${isLarge ? '8mm' : '4mm'}; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; background: white; font-family: 'Tajawal', sans-serif; overflow: hidden; text-align: center; page-break-after: always;">
         <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: ${isLarge ? '4px' : '2px'} solid black; padding-bottom: ${isLarge ? '10px' : '5px'};">
            <div style="display: flex; gap: 10px; align-items: center;">
               <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${record?.palletBarcode}" style="width: ${isLarge ? '50px' : '30px'}; height: ${isLarge ? '50px' : '30px'};" />
               <div style="text-align: right;">
                  <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 800;">توصيل الكتب</div>
                  <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900; line-height: 1.1;">مشروع التعليم</div>
               </div>
            </div>
            <div style="background: white; color: black; border: ${isLarge ? '3px' : '2px'} solid black; padding: ${isLarge ? '8px 12px' : '4px 6px'}; border-radius: 6px; text-align: center;">
               <div style="font-size: ${isLarge ? '10px' : '7px'}; font-weight: 700;">الرحلة</div>
               <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900;">
                  #${trip?.tripNumber || '---'}
                  ${trip?.startDate ? `<span style="font-size: ${isLarge ? '14px' : '8px'}; font-weight: 700; display: block; border-top: 1px solid black; margin-top: 2px;">${new Date(trip.startDate).toLocaleDateString('en-GB')}</span>` : ''}
               </div>
            </div>
         </div>
         <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${isLarge ? '12px' : '6px'}; padding: 5px 0;">
            <div style="font-size: ${isLarge ? '13px' : '8px'}; font-weight: 900; color: #333;">PALLET BARCODE</div>
            <img src="${barcodeImgUrl}" style="width: 100%; max-height: ${isLarge ? '85px' : '45px'}; object-fit: contain;" />
            <div style="background: white; color: black; border: ${isLarge ? '3px' : '2px'} solid black; width: 100%; padding: ${isLarge ? '10px' : '5px'}; font-size: ${isLarge ? '26px' : '14px'}; font-weight: 900; font-family: monospace; border-radius: 8px;">
               ${record?.palletBarcode}
            </div>
         </div>
         <div style="padding: ${isLarge ? '8px 0' : '4px 0'}; border-top: ${isLarge ? '3px' : '1.5px'} solid black; border-bottom: ${isLarge ? '3px' : '1.5px'} solid black; margin-bottom: 5px;">
            <div style="font-size: ${isLarge ? '24px' : '12px'}; font-weight: 900; line-height: 1.1;">${pType?.stageName}</div>
            <div style="font-size: ${isLarge ? '12px' : '8px'}; font-weight: 700; color: #555;">
              ${record.isExtraOnly ? `(تحتوي على ${record.extraCartons} كرتون إضافي فقط بدون طبلية كاملة)` : `طبلية كاملة${record.extraCartons ? ` + (${record.extraCartons} كراتين إضافية)` : ''}`}
            </div>
            ${record.missingCartons ? `<div style="font-size: ${isLarge ? '13px' : '9px'}; font-weight: 900; color: #e11d48; margin-top: 2px;">(⚠️ طبلية ناقصة: مخصوم منها ${record.missingCartons} كراتين)</div>` : ''}
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
    const selectedEntries = Object.entries(selections);
    const selectedList = selectedEntries
      .filter(([_, sel]) => (sel.pallets || 0) > 0 || (sel.extraCartons || 0) > 0 || (sel.missingCartons || 0) > 0)
      .map(([typeId, sel]) => ({ typeId, pallets: sel.pallets || 0, extraCartons: sel.extraCartons || 0, missingCartons: sel.missingCartons || 0 }));
      
    if (selectedList.length === 0) { onNotify('تنبيه', 'يرجى اختيار كمية أو طبلية واحدة على الأقل'); return; }
    if (!cCode) { onNotify('تنبيه', 'يرجى اختيار وجهة الاستلام'); return; }
    
    // @ts-ignore
    onNewTrip(pCode, cCode, selectedList, semester, year);
    setShowForm(false); setSelections({});
    setTimeout(() => setShowLabels(true), 500);
  };

  const showStatsReport = isCanViewAll || role === 'center';

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <section className="bg-gradient-to-br from-indigo-900 to-indigo-800 p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden flex flex-col items-center text-center gap-4">
         <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
         <div className="relative p-2 bg-white/10 backdrop-blur-xl rounded-[2.5rem] shadow-inner border border-white/10">
            <SubulLogo size={80} color="white" />
         </div>
         <div className="space-y-1 relative z-10">
            <h2 className="text-2xl font-black text-white leading-tight">ادارة مخزون مشروع التعليم</h2>
            <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-[0.3em]">
               {role === 'center' ? `إدارة استلام ${getDisplayName(userCenter || '')}` : 'نظام تتبع الكتب المدرسية'}
            </p>
         </div>
         {isAdmin && (
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              <button onClick={handleAiAnalysis} disabled={isAnalyzing} className={`px-6 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95 ${isAnalyzing ? 'animate-pulse' : ''}`}>
                {isAnalyzing ? 'جاري التحليل...' : '✨ تحليل الذكاء الاصطناعي'}
              </button>
              <button onClick={() => setShowDistForm(true)} className="px-6 py-2.5 rounded-2xl bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/30 transition-all active:scale-95">
                ➕ إضافة رحلة يدوياً
              </button>
              <button 
                onClick={() => {
                  setMisdirectedBarcodesStr('G01YOM1177316\nG01YOM1177416\nG01YOM1177516\nG01YOM1177616\nG01YOM1177716\nG02YOM1177816\nG02YOM1177916\nG02YOM1178016\nG03YOM1178116\nG05YOM1178216\nG05YOM1178316\nG05YOM1178416\nG05YOM1178516\nG05YOM1178616\nG05YOM1178716\nG05YOM1178816\nG06YOM1178916\nG06YOM1179016\nG06YOM1179116\nG06YOM1179216\nG07YOM1179316\nG07YOM1179416\nG07YOM1179516');
                  setShowFixMisdirectedModal(true);
                }} 
                className="px-6 py-2.5 rounded-2xl bg-orange-500/20 backdrop-blur-md border border-orange-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-orange-500/30 transition-all active:scale-95"
              >
                🛠️ تصحيح الطبليات الموجهة خاطئاً
              </button>
              <div className="flex gap-1">
                {isAdmin && (
                  <>
                    <label className="px-6 py-2.5 rounded-2xl bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/30 transition-all active:scale-95 cursor-pointer">
                      {isUploadingActual ? 'جاري الرفع...' : '✅ رفع تقرير التنفيذ الفعلي'}
                      <input type="file" accept=".xlsx, .xls" onChange={handleActualExecutionUpload} className="hidden" disabled={isUploadingActual} />
                    </label>
                    <button onClick={() => setShowExecutionManualForm(true)} className="px-6 py-2.5 rounded-2xl bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/30 transition-all active:scale-95">
                      ✏️ إدخال التنفيذ يدوياً
                    </button>
                    <button onClick={handleDownloadExecutionTemplate} className="px-6 py-2.5 rounded-2xl bg-indigo-500/20 backdrop-blur-md border border-indigo-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/30 transition-all active:scale-95" title="تحميل قالب الرحلات المخططة">
                      📄 تحميل قالب التنفيذ المخطط
                    </button>
                    <button onClick={() => setShowReconciliationModal(true)} className="px-6 py-2.5 rounded-2xl bg-rose-500/20 backdrop-blur-md border border-rose-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-rose-500/30 transition-all active:scale-95 shadow-md">
                      ⚖️ أداة تسوية المخزون
                    </button>
                    <button onClick={() => setShowComparisonModal(true)} className="px-6 py-2.5 rounded-2xl bg-amber-500/20 backdrop-blur-md border border-amber-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-amber-500/30 transition-all active:scale-95 shadow-md">
                      📊 مقارنة نتائج التسوية والأرصدة
                    </button>
                  </>
                )}
                <label className="px-6 py-2.5 rounded-2xl bg-emerald-500/20 backdrop-blur-md border border-emerald-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-emerald-500/30 transition-all active:scale-95 cursor-pointer">
                  {isUploadingExcel ? 'جاري الرفع...' : '📊 رفع خطة التوزيع'}
                  <input type="file" accept=".xlsx, .xls" onChange={handleExcelUpload} className="hidden" disabled={isUploadingExcel} />
                </label>
                <button onClick={handleDownloadTemplate} className="px-4 py-2.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-black flex items-center gap-2 hover:bg-white/20 transition-all active:scale-95" title="تحميل القالب">
                  📥 القالب
                </button>
                <button onClick={handleShiftPlannedTripDates} className="px-4 py-2.5 rounded-2xl bg-amber-500/20 backdrop-blur-md border border-amber-500/30 text-white text-[10px] font-black flex items-center gap-2 hover:bg-amber-500/30 transition-all active:scale-95" title="تحديث التواريخ">
                  تحديث تواريخ الخطة (+1 يوم)
                </button>
                <button onClick={handleDownloadComparisonReport} className="px-4 py-2.5 rounded-2xl bg-indigo-500/40 backdrop-blur-md border border-indigo-500/50 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/60 transition-all active:scale-95">
                  📑 تقرير مقارنة الدمام (Excel)
                </button>
                <button onClick={handleExportAllTripsRaw} className="px-4 py-2.5 rounded-2xl bg-emerald-500/40 backdrop-blur-md border border-emerald-500/50 text-white text-[10px] font-black flex items-center gap-2 hover:bg-emerald-500/60 transition-all active:scale-95">
                  📥 تصدير كافة الرحلات الخام (Excel)
                </button>
                <button onClick={handleExportAllPalletsRaw} className="px-4 py-2.5 rounded-2xl bg-amber-500/40 backdrop-blur-md border border-amber-500/50 text-white text-[10px] font-black flex items-center gap-2 hover:bg-amber-500/60 transition-all active:scale-95">
                  📦 تصدير أرقام الطبليات (Excel)
                </button>
                <button onClick={() => setShowDispatchedTableModal(true)} className="px-4 py-2.5 rounded-2xl bg-indigo-500/40 backdrop-blur-md border border-indigo-500/50 text-white text-[10px] font-black flex items-center gap-2 hover:bg-indigo-500/60 transition-all active:scale-95">
                  📋 جدول الرحلات المنطلقة والكميات
                </button>
              </div>
            </div>
         )}
      </section>

      {showDistForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] relative my-auto">
            <div className="p-6 bg-indigo-900 text-white flex justify-between items-center shrink-0">
              <h3 className="font-black text-lg">{editingTripId ? 'تعديل رحلة توزيع' : 'إضافة رحلة توزيع يدوية'}</h3>
              <button onClick={() => {
                setShowDistForm(false);
                setEditingTripId(null);
                setDistTripData({
                  tripNumber: '',
                  date: new Date().toISOString().split('T')[0],
                  originCenter: '',
                  destinationCity: '',
                  quantities: {}
                });
              }} className="text-white/60 hover:text-white p-2">✕</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 mr-2">رقم الرحلة</label>
                  <input 
                    type="text" 
                    value={distTripData.tripNumber}
                    onChange={e => setDistTripData({...distTripData, tripNumber: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                    placeholder="مثلاً: 5001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 mr-2">التاريخ</label>
                  <input 
                    type="date" 
                    value={distTripData.date}
                    onChange={e => setDistTripData({...distTripData, date: e.target.value})}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">مركز الانطلاق</label>
                <select 
                  value={distTripData.originCenter}
                  onChange={e => setDistTripData({...distTripData, originCenter: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold text-black focus:border-indigo-500 outline-none transition-all"
                >
                  <option value="">اختر المركز</option>
                  {centerOptions.map(c => <option key={c.id} value={c.code}>{c.displayName}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">الوجهة (المدينة)</label>
                <input 
                  type="text" 
                  value={distTripData.destinationCity}
                  onChange={e => setDistTripData({...distTripData, destinationCity: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                  placeholder="مثلاً: مكة المكرمة"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="bg-indigo-50 p-3 rounded-2xl border border-indigo-100 mb-4">
                  <p className="text-[9px] font-bold text-indigo-700 leading-relaxed">
                    💡 <span className="font-black">منطق التوزيع:</span> يتم توزيع الكراتين بشكل كامل أولاً، ثم حساب الحزم المتبقية في كرتون جزئي أخير.
                  </p>
                </div>
                <label className="text-[10px] font-black text-slate-400 block mb-3">الكميات المطلوبة:</label>
                <div className="space-y-2">
                  {palletTypes.map(type => (
                    <div key={type.id} className="flex flex-col gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                      <span className="text-[10px] font-bold text-slate-700">{type.stageName}</span>
                      <div className="flex gap-2">
                        <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                          <span className="text-[9px] font-black text-slate-400">كرتون</span>
                          <input 
                            type="number"
                            min="0"
                            value={distTripData.quantities[type.id]?.cartons || ''}
                            onChange={e => setDistTripData({
                              ...distTripData, 
                              quantities: { 
                                ...distTripData.quantities, 
                                [type.id]: { 
                                  ...(distTripData.quantities[type.id] || { bundles: 0 }), 
                                  cartons: parseInt(e.target.value) || 0 
                                } 
                              }
                            })}
                            className="w-full text-center text-xs font-black outline-none"
                            placeholder="0"
                          />
                        </div>
                        <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                          <span className="text-[9px] font-black text-slate-400">حزمة</span>
                          <input 
                            type="number"
                            min="0"
                            value={distTripData.quantities[type.id]?.bundles || ''}
                            onChange={e => setDistTripData({
                              ...distTripData, 
                              quantities: { 
                                ...distTripData.quantities, 
                                [type.id]: { 
                                  ...(distTripData.quantities[type.id] || { cartons: 0 }), 
                                  bundles: parseInt(e.target.value) || 0 
                                } 
                              }
                            })}
                            className="w-full text-center text-xs font-black outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      {(() => {
                        const q = distTripData.quantities[type.id];
                        if (!q || (q.cartons === 0 && q.bundles === 0)) return null;
                        
                        const bPerC = type.bundlesPerCarton || 0;
                        if (bPerC <= 0) return (
                          <div className="mt-1 text-[8px] font-bold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100">
                            ⚠️ خطأ: سعة الكرتون لهذه المرحلة غير محددة بشكل صحيح (0). يرجى مراجعة الإعدادات.
                          </div>
                        );

                        const cartons = Number(q.cartons) || 0;
                        const bundles = Number(q.bundles) || 0;
                        const totalBundles = (cartons * bPerC) + bundles;
                        const finalCartons = Math.floor(totalBundles / bPerC);
                        const finalRemainingBundles = totalBundles % bPerC;
                        const totalCartonsNeeded = Math.ceil(totalBundles / bPerC);
                        
                        return (
                          <div className="mt-1 text-[8px] font-bold text-indigo-600 bg-indigo-50/50 p-2 rounded-xl border border-indigo-100/50 flex flex-col gap-1">
                            <div className="flex justify-between">
                              <span>📦 الإجمالي: {finalCartons} كرتون</span>
                              <span>🔢 + {finalRemainingBundles} حزمة</span>
                            </div>
                            <div className="text-[7px] text-slate-500 border-t border-indigo-100/30 pt-1">
                              سيتم خصم {totalCartonsNeeded} كرتون من المخزون (منها كرتون واحد جزئي يحتوي على {finalRemainingBundles} حزمة).
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 shrink-0">
              <button 
                onClick={handleCreateManualDistTrip}
                className="w-full bg-indigo-900 text-white p-4 rounded-[1.5rem] font-black text-sm shadow-xl active:scale-95 transition-all"
              >
                حفظ الرحلة
              </button>
            </div>
          </div>
        </div>
      )}

      {showFixMisdirectedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col relative my-auto">
            <div className="p-6 bg-orange-600 text-white flex justify-between items-center shrink-0">
              <h3 className="font-black text-lg">أداة تصحيح الطبليات الموجهة خاطئاً</h3>
              <button onClick={() => setShowFixMisdirectedModal(false)} className="text-white/60 hover:text-white p-2">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 mb-2">
                <p className="text-[10px] font-bold text-orange-800 leading-relaxed">
                  هذه الأداة تقوم بنقل الطبليات المختارة من رصيد المركز (الوجهة) إلى قسم "توجيه خاطئ" لإتاحة تصحيح الرصيد الحر.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2 uppercase">أرقام الطبليات (باركود بكل سطر)</label>
                <textarea 
                  value={misdirectedBarcodesStr}
                  onChange={e => setMisdirectedBarcodesStr(e.target.value)}
                  className="w-full h-64 bg-slate-50 border-2 border-slate-100 rounded-3xl p-4 text-xs font-mono font-bold focus:border-orange-500 outline-none transition-all resize-none"
                  placeholder="G01YOM..."
                />
              </div>
              <p className="text-[9px] font-black text-slate-400 text-center">أدخل أرقام الطبليات التي تم حصرها كـ "توجيه خاطئ" لحذفها من رصيد المركز الأصلي.</p>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setShowFixMisdirectedModal(false)}
                className="flex-1 bg-white border-2 border-slate-200 text-slate-600 p-4 rounded-2xl font-black text-sm active:scale-95 transition-all"
              >إلغاء</button>
              <button 
                onClick={handleApplyMisdirectedFix}
                disabled={isApplyingFix}
                className="flex-2 bg-orange-600 text-white p-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all disabled:opacity-50"
              >
                {isApplyingFix ? 'جاري المعالجة...' : 'تطبيق التصحيح الفوري'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExecutionManualForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] relative my-auto">
            <div className="p-6 bg-slate-800 text-white flex justify-between items-center shrink-0">
              <h3 className="font-black text-lg">تقرير تنفيذ رحلة مخططة</h3>
              <button onClick={() => {
                setShowExecutionManualForm(false);
                setExecutionData({
                  tripId: '',
                  date: new Date().toISOString().split('T')[0],
                  quantities: {}
                });
              }} className="text-white/60 hover:text-white p-2">✕</button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">اختر الرحلة المخططة</label>
                <select 
                  value={executionData.tripId}
                  onChange={e => {
                    const tripId = e.target.value;
                    const trip = distributionTrips.find(t => t.id === tripId);
                    const newQuants: any = {};
                    if (trip) {
                      trip.quantities.forEach(q => {
                        const type = palletTypes.find(t => t.id === q.palletTypeId);
                        const bPerC = type?.bundlesPerCarton || 1;
                        newQuants[q.palletTypeId] = {
                          cartons: q.cartonCount,
                          bundles: q.bundleCount % bPerC
                        };
                      });
                    }
                    setExecutionData({...executionData, tripId, quantities: newQuants});
                  }}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold text-black focus:border-indigo-500 outline-none transition-all"
                >
                  <option value="">اختر الرحلة...</option>
                  {distributionTrips
                    .filter(t => t.status === 'planned' || t.status === 'dispatched')
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        رحلة #{t.tripNumber} - {t.destinationCity} ({t.date})
                      </option>
                    ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 mr-2">تاريخ التنفيذ الفعلي</label>
                <input 
                  type="date" 
                  value={executionData.date}
                  onChange={e => setExecutionData({...executionData, date: e.target.value})}
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl p-3 text-xs font-bold focus:border-indigo-500 outline-none transition-all"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <label className="text-[10px] font-black text-slate-400 block mb-3">الكميات المنفذة فعلياً:</label>
                <div className="space-y-3">
                  {palletTypes.map(type => {
                    const isPlanned = executionData.tripId && distributionTrips.find(t => t.id === executionData.tripId)?.quantities.some(q => q.palletTypeId === type.id);
                    
                    return (
                      <div key={type.id} className={`flex flex-col gap-2 p-3 rounded-2xl border ${isPlanned ? 'bg-indigo-50/30 border-indigo-100' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-black text-slate-700">{type.stageName}</span>
                          {isPlanned && <span className="text-[8px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">مخططة</span>}
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                            <span className="text-[9px] font-black text-slate-400">كرتون</span>
                            <input 
                              type="number"
                              min="0"
                              value={executionData.quantities[type.id]?.cartons ?? ''}
                              onChange={e => setExecutionData({
                                ...executionData, 
                                quantities: { 
                                  ...executionData.quantities, 
                                  [type.id]: { 
                                    ...(executionData.quantities[type.id] || { bundles: 0 }), 
                                    cartons: parseInt(e.target.value) || 0 
                                  } 
                                }
                              })}
                              className="w-full text-center text-xs font-black outline-none"
                              placeholder="0"
                            />
                          </div>
                          <div className="flex-1 flex items-center gap-2 bg-white p-2 rounded-xl border border-slate-200">
                            <span className="text-[9px] font-black text-slate-400">حزمة</span>
                            <input 
                              type="number"
                              min="0"
                              value={executionData.quantities[type.id]?.bundles ?? ''}
                              onChange={e => setExecutionData({
                                ...executionData, 
                                quantities: { 
                                  ...executionData.quantities, 
                                  [type.id]: { 
                                    ...(executionData.quantities[type.id] || { cartons: 0 }), 
                                    bundles: parseInt(e.target.value) || 0 
                                  } 
                                }
                              })}
                              className="w-full text-center text-xs font-black outline-none"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 shrink-0">
              <button 
                onClick={handleManualExecutionSubmit}
                className="w-full bg-slate-800 text-white p-4 rounded-[1.5rem] font-black text-sm shadow-xl active:scale-95 transition-all"
              >
                اعتماد التنفيذ
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && aiAnalysis && (
        <section className="animate-slideDown">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border-t-4 border-indigo-500 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
               <h3 className="text-sm font-black text-indigo-900">✨ توصيات الذكاء الاصطناعي</h3>
               <button onClick={() => setAiAnalysis(null)} className="text-[10px] font-bold text-slate-400">إغلاق</button>
            </div>
            <div className="text-xs leading-relaxed text-slate-600 font-bold whitespace-pre-line">{aiAnalysis}</div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(isAdmin || isCanViewAll) && (
          <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-slate-100 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📑</span>
              <h3 className="text-sm font-black text-slate-800">تصدير تفاصيل الرحلات</h3>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={showCancelledInControl}
                    onChange={e => setShowCancelledInControl(e.target.checked)}
                    className="w-4 h-4 accent-indigo-600 rounded"
                  />
                  <span className="text-[10px] font-black text-slate-500 group-hover:text-indigo-600 transition-colors">عرض الرحلات الملغاة</span>
                </label>
              </div>
                <select 
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-xs font-black text-black focus:border-indigo-500 outline-none transition-all"
                value={selectedTripForControl}
                onChange={(e) => setSelectedTripForControl(e.target.value)}
              >
                <option value="">اختر رحلة للتحكم...</option>
                {trips.filter(t => showCancelledInControl || t.status !== 'cancelled').map(trip => (
                  <option key={trip.id} value={trip.id}>
                    رحلة #{trip.tripNumber} ({getDisplayName(trip.pressCode)}) - {getDisplayName(trip.centerCode)} {trip.status === 'cancelled' ? '(ملغاة)' : ''}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                 <button 
                   disabled={!selectedTripForControl}
                   onClick={() => handleExportTripPallets(selectedTripForControl)}
                   className={`flex-1 py-3 rounded-xl text-[10px] font-black shadow-sm transition-all flex items-center justify-center gap-2 ${selectedTripForControl ? 'bg-emerald-600 text-white active:scale-95' : 'bg-slate-200 text-slate-400'}`}
                 >📊 تصدير Excel</button>
                  {isAdmin && (
                    <>
                      {trips.find(t => t.id === selectedTripForControl)?.status === 'cancelled' ? (
                        <button 
                          disabled={!selectedTripForControl}
                          onClick={() => handleRestoreTrip(selectedTripForControl)}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black shadow-sm transition-all flex items-center justify-center gap-2 ${selectedTripForControl ? 'bg-indigo-600 text-white active:scale-95' : 'bg-slate-200 text-slate-400'}`}
                        >🔄 استعادة الرحلة</button>
                      ) : (
                        <button 
                          disabled={!selectedTripForControl}
                          onClick={() => {
                            handleCancelTrip(selectedTripForControl);
                          }}
                          className={`flex-1 py-3 rounded-xl text-[10px] font-black shadow-sm transition-all flex items-center justify-center gap-2 ${selectedTripForControl ? 'bg-rose-600 text-white active:scale-95' : 'bg-slate-200 text-slate-400'}`}
                        >🚫 إلغاء الرحلة</button>
                      )}
                    </>
                  )}
              </div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-1">
          <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col items-center text-center">
            <span className="text-3xl mb-2">📦</span>
            <span className="text-3xl font-black text-slate-800">{stats.total}</span>
            <span className="text-[10px] font-bold text-slate-400">إجمالي الطبليات</span>
          </div>
          <div className="bg-emerald-50 p-6 rounded-[2.5rem] shadow-sm border border-emerald-100 flex flex-col items-center text-center">
            <span className="text-3xl mb-2">✅</span>
            <span className="text-3xl font-black text-emerald-700">{stats.received}</span>
            <span className="text-[10px] font-bold text-emerald-500">
              {role === 'center' ? 'تم استلامها (في المركز)' : 'تم استلامها (في المراكز)'}
            </span>
          </div>
          <div className="bg-indigo-50 p-6 rounded-[2.5rem] shadow-sm border border-indigo-100 flex flex-col items-center text-center">
            <span className="text-3xl mb-2">🏭</span>
            <span className="text-3xl font-black text-indigo-700">{stats.inFactory}</span>
            <span className="text-[10px] font-bold text-indigo-500">في المطبعة</span>
          </div>
          <div className="bg-amber-50 p-6 rounded-[2.5rem] shadow-sm border border-amber-100 flex flex-col items-center text-center">
            <span className="text-3xl mb-2">🚚</span>
            <span className="text-3xl font-black text-amber-700">{stats.inTransit}</span>
            <span className="text-[10px] font-bold text-amber-500">في الطريق</span>
          </div>
        </div>
      </section>

      {showStatsReport && (
        <section className="space-y-4 animate-slideDown">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-6">
             <div className="flex justify-between items-center border-b pb-4">
               <h2 className="text-lg font-black text-indigo-900">📊 تقرير التلفيات والمخزون {isCanViewAll ? '(نطاق شامل)' : `(${getDisplayName(userCenter)})`}</h2>
               {dbStatus === 'offline' && <span className="text-[10px] bg-rose-100 text-rose-600 px-3 py-1 rounded-full font-black animate-pulse">⚠️ وضع غير متصل - جاري المحاولة...</span>}
               {dbStatus === 'online' && <span className="text-[10px] bg-emerald-100 text-emerald-600 px-3 py-1 rounded-full font-black">🟢 متصل بقاعدة البيانات</span>}
             </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl text-right border border-emerald-100 flex justify-between items-center">
                <div>
                   <span className="text-[9px] font-black text-emerald-400 block mb-1 uppercase">إجمالي الكتب (كراتين) المستلمة</span>
                   <span className="text-2xl font-black text-emerald-900">{stats.totalBooksCartons.toLocaleString()} كرتون</span>
                </div>
                {stats.totalEmptyCartons > 0 && (
                   <div className="text-left">
                      <span className="text-[8px] font-bold text-emerald-500/80 block mb-1">فوارغ إضافية</span>
                      <span className="text-lg font-black text-emerald-700">+{stats.totalEmptyCartons.toLocaleString()}</span>
                   </div>
                )}
              </div>
              <div className="bg-indigo-50 p-5 rounded-3xl text-right border border-indigo-100 flex justify-between items-center">
                <div>
                   <span className="text-[9px] font-black text-indigo-400 block mb-1 uppercase">إجمالي المنطلق والمصدر (خروج)</span>
                   <span className="text-2xl font-black text-indigo-900">{(stats.shippedOutbound.bookCartons + stats.shippedOutbound.emptyCartons).toLocaleString()} كرتون</span>
                </div>
                <div className="text-left flex flex-col items-end">
                   <span className="text-[7px] font-black text-indigo-500 bg-white/50 px-2 rounded-full mb-1">كتب: {stats.shippedOutbound.bookCartons.toLocaleString()}</span>
                   <span className="text-[7px] font-black text-amber-600 bg-white/50 px-2 rounded-full">فوارغ: {stats.shippedOutbound.emptyCartons.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-emerald-50 p-5 rounded-3xl text-right border border-emerald-100">
                <span className="text-[9px] font-black text-emerald-400 block mb-1 uppercase">إجمالي الحزم المستلمة</span>
                <span className="text-2xl font-black text-emerald-700">{stats.totalBundles.toLocaleString()} حزمة</span>
              </div>
              <div className="bg-indigo-50 p-5 rounded-3xl text-right border border-indigo-100">
                <span className="text-[9px] font-black text-indigo-400 block mb-1 uppercase">الرصيد المتبقي المتاح (حر)</span>
                <span className="text-2xl font-black text-indigo-900">{stats.totalFreeBooksCartons.toLocaleString()} كرتون</span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-slate-50">
               <div className="bg-rose-50 p-4 rounded-3xl text-center border border-rose-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">⚠️</span>
                  <span className="text-xl font-black text-rose-700 leading-none">{stats.totalDamagedCartons}</span>
                  <span className="text-[7px] font-black text-rose-400 block uppercase mt-1">إجمالي الكراتين التالفة</span>
               </div>
               <div className="bg-amber-50 p-4 rounded-3xl text-center border border-amber-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📦</span>
                  <span className="text-xl font-black text-amber-700 leading-none">{stats.totalExtDamagedCartons}</span>
                  <span className="text-[7px] font-black text-amber-400 block uppercase mt-1">تلف كراتين خارجي</span>
               </div>
               <div className="bg-orange-50 p-4 rounded-3xl text-center border border-orange-100 flex flex-col items-center">
                  <span className="text-xl block mb-1">📖</span>
                  <span className="text-xl font-black text-orange-700 leading-none">{stats.totalIntDamagedCartons}</span>
                  <span className="text-[7px] font-black text-orange-400 block uppercase mt-1">تلف كراتين داخلي</span>
               </div>
               <div className="bg-orange-100/50 p-4 rounded-3xl text-center border border-orange-200 flex flex-col items-center">
                  <span className="text-xl block mb-1">🚩</span>
                  <span className="text-xl font-black text-orange-800 leading-none">{stats.wrongDestinationsCount}</span>
                  <span className="text-[7px] font-black text-orange-600 block uppercase mt-1">طبليات بتوجيه خاطئ</span>
               </div>
            </div>

            {(isAdmin || isMonitor) && (stats.totalDiffCartons !== 0 || stats.totalDiffBundles !== 0) && (
              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                 <div className="bg-indigo-50 p-4 rounded-3xl text-center border border-indigo-100 flex flex-col items-center">
                    <span className="text-xl block mb-1">⚖️</span>
                    <span className={`text-xl font-black leading-none ${stats.totalDiffCartons > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {stats.totalDiffCartons > 0 ? '+' : ''}{stats.totalDiffCartons}
                    </span>
                    <span className="text-[7px] font-black text-indigo-400 block uppercase mt-1">تباين المخزون (كرتون)</span>
                 </div>
                 <div className="bg-indigo-50 p-4 rounded-3xl text-center border border-indigo-100 flex flex-col items-center">
                    <span className="text-xl block mb-1">⚖️</span>
                    <span className={`text-xl font-black leading-none ${stats.totalDiffBundles > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {stats.totalDiffBundles > 0 ? '+' : ''}{stats.totalDiffBundles}
                    </span>
                    <span className="text-[7px] font-black text-indigo-400 block uppercase mt-1">تباين المخزون (حزم)</span>
                 </div>
              </div>
            )}
          </div>
        </section>
      )}

      {(role === 'center' || isMonitor || isAdmin) && (
        <section className="space-y-6 animate-slideDown">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
             <h3 className="text-lg font-black text-indigo-900 px-2">🏢 مراكز الخدمات اللوجستية</h3>
             {isCanViewAll && (
               <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl shadow-sm border border-slate-100">
                 <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400">من:</span>
                    <input 
                      type="date" 
                      value={exportStartDate}
                      onChange={e => setExportStartDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none focus:border-indigo-500"
                    />
                 </div>
                 <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400">إلى:</span>
                    <input 
                      type="date" 
                      value={exportEndDate}
                      onChange={e => setExportEndDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg p-1 text-[10px] font-bold outline-none focus:border-indigo-500"
                    />
                 </div>
                 <button 
                   onClick={handleExportCenterInventory}
                   className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 hover:bg-emerald-700 transition-all shadow-sm"
                 >
                   📊 تصدير البيانات (Excel)
                 </button>
               </div>
             )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {centerOptions
              .filter(center => {
                if (isAdmin || isMonitor) return true;
                return center.code === userCenter;
              })
              .map(center => {
              const centerRecords = statsRecords.filter(r => {
                const compareCode = center.code.trim().toUpperCase();
                let recordCenterCode = (r.receivedByCenter || (r.status === 'received' && r.isWrongDestination ? 'WRONG_DEST' : r.destination)).trim().toUpperCase();
                
                // Hard fix for the 23 pallets that Dammam center didn't receive
                if ((recordCenterCode === 'DAMMAM' || recordCenterCode === 'DMM') && DAMMAM_MISDIRECTED_BARCODES.includes(r.palletBarcode.trim().toUpperCase())) {
                  recordCenterCode = 'WRONG_DEST';
                }

                return recordCenterCode === compareCode;
              });
              const receivedRecords = centerRecords.filter(r => r.status === 'received');
              
              const centerExecutedTripsForCalc = consolidatedTrips.filter(t => 
                t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase() && 
                (t.status === 'executed' || t.status === 'dispatched')
              );

              let centerCartons = 0;
              let centerBundles = 0;
              let centerEmptyCartons = 0;
              let exportedBookCartons = 0;
              let exportedExtraBundles = 0;
              let exportedBookBundles = 0;
              let exportedEmptyCartons = 0;
              const emptyBreakdownMap: Record<string, number> = {};

              receivedRecords.forEach(r => {
                const type = palletTypes.find(t => t.id === r.palletTypeId);
                if (type) {
                  let c = (r.isExtraOnly ? 0 : type.cartonsPerPallet);
                  if (r.extraCartons) c += r.extraCartons;
                  if (r.missingCartons) c -= r.missingCartons;

                  let b = c * type.bundlesPerCarton;

                  if (r.hasDiscrepancy) {
                    const sign = r.discrepancyType === 'excess' ? 1 : -1;
                    const diffC = r.discrepancyCartonsQty || 0;
                    const diffB = r.discrepancyBundlesQty || 0;
                    c += sign * diffC;
                    b += sign * ((diffC * type.bundlesPerCarton) + diffB);
                  }
                  
                  if (type.stageCode.toUpperCase().startsWith('F')) {
                    centerEmptyCartons += c;
                    emptyBreakdownMap[type.stageName] = (emptyBreakdownMap[type.stageName] || 0) + c;
                  } else {
                    centerCartons += c;
                    centerBundles += b;
                  }
                }
              });

              centerExecutedTripsForCalc.forEach(et => {
                const qtList = et.executedQuantities || et.quantities;
                qtList.forEach(q => {
                  const type = palletTypes.find(t => t.id === q.palletTypeId);
                  if (type) {
                    const b = q.bundleCount || 0;
                    if (type.stageCode.toUpperCase().startsWith('F')) {
                      exportedEmptyCartons += q.cartonCount;
                      emptyBreakdownMap[type.stageName] = (emptyBreakdownMap[type.stageName] || 0) - q.cartonCount;
                    } else {
                      exportedBookCartons += q.cartonCount;
                      exportedBookBundles += b;
                      exportedExtraBundles += (b % type.bundlesPerCarton);
                    }
                  }
                });
              });
              
              const centerPlannedTrips = consolidatedTrips
                .filter(t => 
                  t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase() && 
                  t.status === 'planned'
                )
                .sort((a, b) => a.date.localeCompare(b.date)); // الأقدم أولاً للمخطط

              // حساب دقيق للرصيد المتبقي الحر الإجمالي من خلال جمع الأرصدة المتبقية لكل مرحلة
              let totalRemainingCartonsSum = 0;
              let totalRemainingBundlesSum = 0;
              let totalRemainingBundlesRaw = 0;

              palletTypes.filter(t => !t.stageCode.toUpperCase().startsWith('F')).forEach(type => {
                let stageReceivedB = 0;
                receivedRecords.filter(r => r.palletTypeId === type.id).forEach(r => {
                  let b = (r.isExtraOnly ? 0 : type.cartonsPerPallet) * type.bundlesPerCarton;
                  if (r.extraCartons) b += r.extraCartons * type.bundlesPerCarton;
                  if (r.missingCartons) b -= r.missingCartons * type.bundlesPerCarton;
                  if (r.hasDiscrepancy) {
                    const sign = r.discrepancyType === 'excess' ? 1 : -1;
                    b += sign * ((r.discrepancyCartonsQty || 0) * type.bundlesPerCarton + (r.discrepancyBundlesQty || 0));
                  }
                  stageReceivedB += b;
                });

                let stageShippedB = 0;
                centerExecutedTripsForCalc.forEach(et => {
                  const q = (et.executedQuantities || et.quantities).find(qty => qty.palletTypeId === type.id);
                  if (q) {
                    stageShippedB += q.bundleCount || 0;
                  }
                });

                let stagePlannedB = 0;
                centerPlannedTrips.forEach(pt => {
                  const q = pt.quantities.find(qty => qty.palletTypeId === type.id);
                  if (q) {
                    stagePlannedB += q.bundleCount || 0;
                  }
                });

                const stageRemainingB = Math.max(0, stageReceivedB - stageShippedB - stagePlannedB);
                totalRemainingCartonsSum += Math.floor(stageRemainingB / type.bundlesPerCarton);
                totalRemainingBundlesSum += (stageRemainingB % type.bundlesPerCarton);
                totalRemainingBundlesRaw += stageRemainingB;
              });
              
              const remainingBookBalance = totalRemainingCartonsSum;
              const remainingExtraBundles = totalRemainingBundlesSum;
              const remainingEmptyBalance = Math.max(0, centerEmptyCartons - exportedEmptyCartons);

              return (
                <div key={center.id} className="bg-white p-5 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-4 relative overflow-hidden group hover:border-emerald-200 transition-all">
                  <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500 opacity-20 group-hover:opacity-100 transition-opacity"></div>
                  <div className="flex justify-between items-start">
                    <h4 className="text-xs font-black text-slate-800">{center.displayName}</h4>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        كود: {center.code}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1">
                    <div className="bg-slate-50 p-2 rounded-xl text-center border border-slate-100">
                      <span className="text-lg block">📦</span>
                      <span className="text-xs font-black text-slate-800 block">{centerRecords.length}</span>
                      <span className="text-[7px] font-bold text-slate-400 uppercase">إجمالي</span>
                    </div>
                    <div className="bg-emerald-50 p-2 rounded-xl text-center border border-emerald-100">
                      <span className="text-lg block">✅</span>
                      <span className="text-xs font-black text-emerald-700 block">{receivedRecords.length}</span>
                      <span className="text-[7px] font-bold text-emerald-500 uppercase">مستلم</span>
                    </div>
                    <div className="bg-indigo-50 p-2 rounded-xl text-center border border-indigo-100">
                      <span className="text-lg block">🏭</span>
                      <span className="text-xs font-black text-indigo-700 block">{
centerRecords.filter(r => r.status === 'pending').length}</span>
                      <span className="text-[7px] font-bold text-indigo-500 uppercase">بالمطبعة</span>
                    </div>
                    <div className="bg-amber-50 p-2 rounded-xl text-center border border-amber-100">
                      <span className="text-lg block">🚚</span>
                      <span className="text-xs font-black text-amber-700 block">{centerRecords.filter(r => r.status === 'in_transit').length}</span>
                      <span className="text-[7px] font-bold text-amber-500 uppercase">بالطريق</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div 
                      onClick={() => {
                        const details: { stageName: string; exportedCartons: number; exportedBundles: number }[] = [];
                        
                        palletTypes.forEach(type => {
                          let stageShippedCartons = 0;
                          let stageShippedBundles = 0;
                          
                          centerExecutedTripsForCalc.forEach(et => {
                            const q = (et.executedQuantities || et.quantities).find(qty => qty.palletTypeId === type.id);
                            if (q) {
                              stageShippedCartons += q.cartonCount;
                              const bPerC = type.bundlesPerCarton || 1;
                              stageShippedBundles += (q.bundleCount || 0) % bPerC;
                            }
                          });

                          if (stageShippedCartons > 0 || stageShippedBundles > 0) {
                            details.push({
                              stageName: type.stageName,
                              exportedCartons: stageShippedCartons,
                              exportedBundles: stageShippedBundles
                            });
                          }
                        });

                        details.sort((a, b) => a.stageName.localeCompare(b.stageName));

                        setSelectedCenterForExported({
                          name: center.displayName,
                          code: center.code,
                          details
                        });
                        setShowExportedDetailModal(true);
                      }}
                      className="bg-indigo-50 border border-indigo-100 p-2 rounded-2xl text-center flex flex-col justify-center cursor-pointer hover:bg-indigo-100 transition-all active:scale-95 shadow-sm"
                    >
                      <span className="text-[8px] font-black text-indigo-400 uppercase block">تم التصدير (خروج)</span>
                      <div className="flex flex-col items-center">
                        <span className="text-sm font-black text-indigo-900">{(exportedBookCartons + exportedEmptyCartons).toLocaleString()} كرتون</span>
                        <div className="flex gap-1 items-center">
                           <span className="text-[8px] font-bold text-indigo-600 bg-indigo-100 px-1 rounded">{exportedBookCartons.toLocaleString()} كتب</span>
                           {exportedEmptyCartons > 0 && <span className="text-[8px] font-bold text-amber-600 bg-amber-100 px-1 rounded">{exportedEmptyCartons.toLocaleString()} فوارغ</span>}
                        </div>
                      </div>
                    </div>
                    <div 
                      onClick={() => {
                        const details: { stageName: string; remainingCartons: number; remainingBundles: number; totalBundles: number }[] = [];
                        
                        palletTypes.filter(t => !t.stageCode.toUpperCase().startsWith('F')).forEach(type => {
                          let stageReceivedBundles = 0;
                          receivedRecords.filter(r => r.palletTypeId === type.id).forEach(r => {
                            let b = (r.isExtraOnly ? 0 : type.cartonsPerPallet) * type.bundlesPerCarton;
                            if (r.extraCartons) b += r.extraCartons * type.bundlesPerCarton;
                            if (r.missingCartons) b -= r.missingCartons * type.bundlesPerCarton;
                            if (r.hasDiscrepancy) {
                              const sign = r.discrepancyType === 'excess' ? 1 : -1;
                              b += sign * ((r.discrepancyCartonsQty || 0) * type.bundlesPerCarton + (r.discrepancyBundlesQty || 0));
                            }
                            stageReceivedBundles += b;
                          });

                          let stageShippedBundles = 0;
                          centerExecutedTripsForCalc.forEach(et => {
                            const q = (et.executedQuantities || et.quantities).find(qty => qty.palletTypeId === type.id);
                            if (q) {
                              stageShippedBundles += q.bundleCount || 0;
                            }
                          });

                          let stagePlannedBundles = 0;
                          centerPlannedTrips.forEach(pt => {
                            const q = pt.quantities.find(qty => qty.palletTypeId === type.id);
                            if (q) {
                              stagePlannedBundles += q.bundleCount || 0;
                            }
                          });

                          const remainingBundlesTotal = Math.max(0, stageReceivedBundles - stageShippedBundles - stagePlannedBundles);
                          
                          // ندرج كافة المراحل لسهولة التتبع
                          details.push({
                            stageName: type.stageName,
                            remainingCartons: Math.floor(remainingBundlesTotal / type.bundlesPerCarton),
                            remainingBundles: remainingBundlesTotal % type.bundlesPerCarton,
                            totalBundles: remainingBundlesTotal
                          });
                        });

                        // ترتيب التفاصيل حسب الاسم لسهولة القراءة
                        details.sort((a, b) => a.stageName.localeCompare(b.stageName));

                        setSelectedCenterForBalance({
                          name: center.displayName,
                          code: center.code,
                          details
                        });
                        setShowBalanceDetailModal(true);
                      }}
                      className={`${totalRemainingBundlesRaw <= 0 ? 'bg-slate-50 border-slate-200' : 'bg-emerald-600 border-emerald-700 shadow-lg shadow-emerald-100 cursor-pointer active:scale-95'} p-2 rounded-2xl text-center flex flex-col justify-center transition-all`}
                    >
                      <span className={`text-[8px] font-black uppercase block ${totalRemainingBundlesRaw <= 0 ? 'text-slate-400' : 'text-emerald-100'}`}>الرصيد المتبقي الحر</span>
                      <div className="flex flex-col items-center">
                        <span className={`text-sm font-black ${totalRemainingBundlesRaw <= 0 ? 'text-slate-400' : 'text-white'}`}>{remainingBookBalance.toLocaleString()} كرتون</span>
                        <span className={`text-[10px] font-black ${totalRemainingBundlesRaw <= 0 ? 'text-slate-400/60' : 'text-emerald-100/80'}`}>{remainingExtraBundles.toLocaleString()} حزمة زائدة</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div 
                      onClick={() => {
                        const details: { stageName: string; receivedCartons: number; receivedBundles: number; receivedPallets: number }[] = [];
                        
                        palletTypes.filter(t => !t.stageCode.toUpperCase().startsWith('F')).forEach(type => {
                          let stageReceivedB = 0;
                          const stageRecords = receivedRecords.filter(r => r.palletTypeId === type.id);
                          
                          stageRecords.forEach(r => {
                            let b = (r.isExtraOnly ? 0 : type.cartonsPerPallet) * type.bundlesPerCarton;
                            if (r.extraCartons) b += r.extraCartons * type.bundlesPerCarton;
                            if (r.missingCartons) b -= r.missingCartons * type.bundlesPerCarton;
                            if (r.hasDiscrepancy) {
                              const sign = r.discrepancyType === 'excess' ? 1 : -1;
                              b += sign * ((r.discrepancyCartonsQty || 0) * type.bundlesPerCarton + (r.discrepancyBundlesQty || 0));
                            }
                            stageReceivedB += b;
                          });

                          if (stageReceivedB > 0 || stageRecords.length > 0) {
                            details.push({
                              stageName: type.stageName,
                              receivedCartons: Math.floor(stageReceivedB / type.bundlesPerCarton),
                              receivedBundles: stageReceivedB % type.bundlesPerCarton,
                              receivedPallets: stageRecords.length
                            });
                          }
                        });

                        details.sort((a, b) => a.stageName.localeCompare(b.stageName));

                        setSelectedCenterForReceived({
                          name: center.displayName,
                          code: center.code,
                          details
                        });
                        setShowReceivedDetailModal(true);
                      }}
                      className="bg-indigo-50 border border-indigo-100 p-2 rounded-2xl text-center flex flex-col justify-center cursor-pointer hover:bg-indigo-100 transition-all active:scale-95 shadow-sm"
                    >
                      <span className="text-[8px] font-black text-indigo-500 uppercase block">إجمالي المستلم</span>
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-black text-indigo-700">{centerCartons.toLocaleString()} كرتون</span>
                        <span className="text-[10px] font-black text-indigo-500/80">{receivedRecords.filter(r => {
                          const t = palletTypes.find(pt => pt.id === r.palletTypeId);
                          return t && !t.stageCode.toUpperCase().startsWith('F');
                        }).length} طبلية</span>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded-xl text-center flex flex-col justify-center">
                      <span className="text-[8px] font-black text-slate-400 uppercase block">إجمالي الحزم</span>
                      <span className="text-xs font-bold text-slate-600">{centerBundles.toLocaleString()} ح</span>
                    </div>
                  </div>

                  {remainingEmptyBalance > 0 && (
                    <div 
                      onClick={() => {
                        setSelectedCenterForEmpty({
                          name: center.displayName,
                          items: Object.entries(emptyBreakdownMap).map(([stageName, cartons]) => ({ stageName, cartons }))
                        });
                        setShowEmptyCartonsModal(true);
                      }}
                      className="cursor-pointer hover:bg-emerald-100 transition-colors bg-emerald-50 p-2 rounded-xl text-center flex flex-col justify-center border border-emerald-100 mt-2 shadow-sm"
                    >
                      <span className="text-[8px] font-black text-emerald-500 uppercase block">كراتين فارغة إضافية (اضغط للتفاصيل)</span>
                      <span className="text-sm font-black text-emerald-700">+{remainingEmptyBalance.toLocaleString()} كرتون</span>
                    </div>
                  )}

                  <div className="space-y-2 pt-2 border-t border-slate-50">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[9px] font-black text-indigo-600 uppercase block mr-1">🚚 رحلات التوزيع المخططة:</span>
                    </div>
                    {centerPlannedTrips.length === 0 ? (
                      <div className="p-3 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center">
                        <p className="text-[8px] font-bold text-slate-400">لا توجد رحلات مجدولة حالياً</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(() => {
                          const currentStock = palletTypes.reduce((acc, type) => {
                            const typeInCenter = receivedRecords.filter(r => r.palletTypeId === type.id);
                            let tC = 0;
                            typeInCenter.forEach(r => {
                              let c = r.isExtraOnly ? 0 : type.cartonsPerPallet;

                              if (r.extraCartons) {
                                c += r.extraCartons;
                              }
                              if (r.missingCartons) {
                                c -= r.missingCartons;
                              }

                              if (r.hasDiscrepancy) {
                                const sign = r.discrepancyType === 'excess' ? 1 : -1;
                                c += sign * (r.discrepancyCartonsQty || 0);
                              }
                              tC += c;
                            });
                            
                            // خصم الرحلات المنفذة أو المرسلة فعلياً لكي يظهر الرصيد المتبقي بشكل دقيق
                            const centerExecutedTrips = consolidatedTrips.filter(t => 
                              t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase() && 
                              t.status !== 'planned'
                            );
                            centerExecutedTrips.forEach(et => {
                              const qt = (et.executedQuantities || et.quantities).find(q => q.palletTypeId === type.id);
                              if (qt) {
                                tC -= qt.cartonCount;
                              }
                            });

                            acc[type.id] = tC;
                            return acc;
                          }, {} as Record<string, number>);

                          return centerPlannedTrips.map(trip => {
                            let hasShortage = false;
                            let hasNonEmptyCartonShortage = false;
                            const tripDeficits: { stageName: string, deficit: number }[] = [];

                            trip.quantities.forEach(q => {
                              const available = currentStock[q.palletTypeId] || 0;
                              if (available < q.cartonCount) {
                                hasShortage = true;
                                const stageName = palletTypes.find(t => t.id === q.palletTypeId)?.stageName || 'غير معروف';
                                if (!stageName.includes('كراتين فارغة')) {
                                  hasNonEmptyCartonShortage = true;
                                  tripDeficits.push({
                                    stageName,
                                    deficit: q.cartonCount - available
                                  });
                                }
                              }
                              currentStock[q.palletTypeId] = available - q.cartonCount;
                            });

                            const isFullyDisabled = hasNonEmptyCartonShortage;
                            const needsConfirmation = hasShortage && !hasNonEmptyCartonShortage;

                            const todayStr = new Date().toISOString().split('T')[0];
                            const isOverdue = trip.date < todayStr;

                            return (
                              <div key={trip.id} className={`p-3 rounded-2xl border transition-all ${isOverdue ? 'bg-rose-50 border-rose-200' : hasNonEmptyCartonShortage ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'} flex flex-col gap-2 relative overflow-hidden shadow-sm`}>
                                {isOverdue && <div className="absolute top-0 right-0 px-2 py-0.5 bg-rose-600 text-white text-[6px] font-black uppercase rounded-bl-lg animate-pulse">متأخرة</div>}
                                <div className="flex justify-between items-center">
                                  <div className="text-right">
                                    <div className={`text-[10px] font-black ${isOverdue ? 'text-rose-900' : hasNonEmptyCartonShortage ? 'text-amber-900' : 'text-emerald-900'}`}>رحلة #{trip.tripNumber}</div>
                                    <div className={`text-[8px] font-bold ${isOverdue ? 'text-rose-500' : 'text-slate-500'}`}>{trip.destinationCity} - {trip.date}</div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isAdmin && (
                                      <div className="flex items-center gap-1 ml-2">
                                        <button onClick={(e) => { e.stopPropagation(); handleEditDistTrip(trip); }} className="p-2 bg-white/50 text-slate-600 rounded-lg hover:bg-indigo-100 hover:text-indigo-600 transition-all border border-slate-100 active:scale-90" title="تعديل">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteDistTrip(trip.id); }} className="p-2 bg-white/50 text-slate-600 rounded-lg hover:bg-rose-100 hover:text-rose-600 transition-all border border-slate-100 active:scale-90" title="حذف">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                      </div>
                                    )}
                                    {hasNonEmptyCartonShortage ? (
                                      <span className="bg-rose-600 text-white px-2 py-0.5 rounded-full text-[7px] font-black uppercase shadow-sm">عجز</span>
                                    ) : (
                                      <span className="bg-emerald-600 text-white px-2 py-0.5 rounded-full text-[7px] font-black uppercase shadow-sm">متاح</span>
                                    )}
                                    {(isAdmin || (role === 'center' && userCenter === center.code)) && (
                                      <button 
                                        onClick={() => {
                                          if (needsConfirmation) {
                                            setTripToDispatch(trip.id);
                                            setShowDispatchConfirmModal(true);
                                          } else {
                                            handleDispatchTrip(trip.id);
                                          }
                                        }}
                                        className={`${isFullyDisabled ? 'bg-slate-300 cursor-not-allowed text-slate-500' : isOverdue ? 'bg-rose-600 hover:bg-rose-700' : (needsConfirmation ? 'bg-amber-500 hover:bg-amber-600' : 'bg-indigo-600 hover:bg-indigo-700')} text-white px-3 py-1.5 rounded-xl text-[8px] font-black transition-all shadow-sm`}
                                        disabled={isFullyDisabled}
                                      >
                                        إطلاق
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {hasNonEmptyCartonShortage && (
                                  <div className="bg-white/50 p-2 rounded-xl border border-rose-100">
                                    <div className="flex flex-wrap gap-1">
                                      {tripDeficits.map((d, i) => (
                                        <span key={i} className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-md text-[7px] font-bold">
                                          {d.stageName}: {d.deficit} ك
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 pt-4 border-t border-slate-100">
                    <span className="text-[9px] font-black text-slate-500 uppercase block mr-1">✅ تم تنفيذه وشحنه:</span>
                    {(() => {
                      const centerExecutedTrips = consolidatedTrips
                        .filter(t => 
                          t.originCenter?.trim().toUpperCase() === center.code?.trim().toUpperCase() && 
                          (t.status === 'executed' || t.status === 'dispatched')
                        )
                        .sort((a, b) => {
                          const dateA = a.executedDate || a.date;
                          const dateB = b.executedDate || b.date;
                          return dateB.localeCompare(dateA); // الأحدث أولاً
                        });
                      
                      if (centerExecutedTrips.length === 0) return (
                        <div className="p-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-100 text-center">
                           <p className="text-[8px] font-bold text-slate-300">لا توجد رحلات منفذة بعد</p>
                        </div>
                      );

                      return (
                        <div className="space-y-2">
                           {centerExecutedTrips.map(trip => (
                              <div key={trip.id} className="p-3 rounded-2xl border bg-slate-50 border-slate-200 flex flex-col gap-2">
                                 <div className="flex justify-between items-center">
                                     <div className="text-right">
                                       <div className="text-[10px] font-black text-slate-700">رحلة #{trip.tripNumber}</div>
                                       <div className="text-[8px] font-bold text-slate-500">{trip.destinationCity} • {trip.executedDate || trip.date}</div>
                                     </div>
                                     <div className="flex items-center gap-2">
                                       <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase ${trip.status === 'executed' ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                         {trip.status === 'executed' ? 'منفذ' : 'جاري الشحن'}
                                       </span>
                                       {isAdmin && (trip.status === 'executed' || trip.status === 'dispatched') && (
                                         <button 
                                           onClick={() => { setTripIdToRevert(trip.id); setShowRevertModal(true); }} 
                                           className="p-1 bg-white text-rose-600 rounded-md border border-rose-100 hover:bg-rose-50 transition-all shadow-sm" 
                                           title="التراجع عن التنفيذ/الإطلاق"
                                         >
                                           <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                                         </button>
                                       )}
                                     </div>
                                 </div>
                                 
                                 {/* تفاصيل الاختلاف بين المخطط والمنفذ */}
                                 {trip.executedQuantities && trip.executedQuantities.length > 0 && (
                                   <div className="pt-2 border-t border-slate-100 mt-1">
                                      <div className="flex flex-wrap gap-1">
                                         {palletTypes.map(type => {
                                           const plannedObj = trip.quantities.find(q => q.palletTypeId === type.id);
                                           const executedObj = trip.executedQuantities?.find(q => q.palletTypeId === type.id);
                                           const planned = plannedObj?.cartonCount || 0;
                                           const executed = executedObj?.cartonCount || 0;
                                           const diff = executed - planned;
                                           if (planned === 0 && executed === 0) return null;
                                           return (
                                             <div key={type.id} className="flex flex-col bg-white/40 p-1.5 rounded-xl border border-slate-100 min-w-[70px]">
                                               <span className="text-[7px] font-black text-slate-400 uppercase truncate text-right">{type.stageName}</span>
                                               <div className="flex items-center justify-between gap-1">
                                                 <span className="text-[9px] font-black text-slate-700">{executed} ك</span>
                                                 {diff !== 0 && (
                                                   <span className={`text-[8px] font-bold px-1 rounded ${diff > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                                     {diff > 0 ? '▲' : '▼'}{Math.abs(diff)}
                                                   </span>
                                                 )}
                                               </div>
                                             </div>
                                           );
                                         })}
                                      </div>
                                   </div>
                                 )}
                              </div>
                           ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-8 border-t border-slate-100">
            <h3 className="text-lg font-black text-indigo-900 mb-6 px-2">📚 تفاصيل المخزون التفصيلية</h3>
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between px-4 border-r-4 border-indigo-600">
                  <h3 className="text-md font-black text-indigo-900">التعليم العام (G)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {palletTypes.filter(t => t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).map(type => (
                    <StageCard key={type.id} type={type} statsRecords={statsRecords} />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-4 border-r-4 border-emerald-600">
                  <h3 className="text-md font-black text-emerald-900">المدارس العالمية (IG)</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {palletTypes.filter(t => t.stageCode.startsWith('IG')).map(type => (
                    <StageCard key={type.id} type={type} statsRecords={statsRecords} />
                  ))}
                </div>
              </div>

              {/* أي مراحل أخرى غير مصنفة */}
              {palletTypes.filter(t => !t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-4 border-r-4 border-slate-400">
                    <h3 className="text-md font-black text-slate-700">📦 مراحل أخرى</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {palletTypes.filter(t => !t.stageCode.startsWith('G') && !t.stageCode.startsWith('IG')).map(type => (
                      <StageCard key={type.id} type={type} statsRecords={statsRecords} />
                    ))}
                  </div>
                </div>
              )}
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
            <button onClick={() => setShowForm(!showForm)} className="w-full bg-white border-2 border-indigo-600 text-indigo-600 p-6 rounded-[2.5rem] font-black text-sm flex items-center justify-center gap-3 shadow-xl hover:bg-indigo-50 transition-all">{showForm ? 'إلغاء' : '➕ إنشاء رحلة جديدة'}</button>
        </div>
      )}

      {showForm && (
        <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border border-slate-100 space-y-6 animate-slideDown">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">الوجهة</label>
              <select value={cCode} onChange={e => setCCode(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-black text-black outline-none ring-1 ring-slate-100">
                {centerOptions.map(center => <option key={center.id} value={center.code} className="text-black">{center.displayName}</option>)}
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
              <select value={semester} onChange={e => setSemester(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-black text-black outline-none ring-1 ring-slate-100">
                <option value="1">الفصل الأول</option>
                <option value="2">الفصل الثاني</option>
                <option value="3">الفصل الثالث</option>
              </select>
            </div>
            <div className="space-y-1 text-right">
              <label className="text-[10px] font-black text-slate-400 mr-2">العام الدراسي</label>
              <select value={year} onChange={e => setYear(e.target.value)} className="w-full bg-slate-50 p-4 rounded-2xl text-xs font-black text-black outline-none ring-1 ring-slate-100">
                <option value="2026">2026 م</option>
                <option value="2027">2027 م</option>
                <option value="2028">2028 م</option>
                <option value="2029">2029 م</option>
                <option value="2030">2030 م</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 mr-2">تحديد المراحل والكميات</label>
            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto p-2 bg-slate-50 rounded-2xl border border-slate-100 custom-scrollbar">
              {palletTypes.map(type => (
                <div key={type.id} className="flex flex-col gap-2 p-3 bg-white rounded-xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-50">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-black text-slate-700">{type.stageName}</span>
                      <span className="text-[8px] font-bold text-slate-400">الطبلية: {type.cartonsPerPallet} كرتون</span>
                    </div>
                  </div>
                  <div className="flex justify-between gap-4">
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-indigo-900 border-b border-indigo-100 pb-1 w-full text-center">عدد الطبليات</span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: Math.max(0, ((prev[type.id]?.pallets) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.pallets || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], pallets: ((prev[type.id]?.pallets) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-indigo-100 rounded-lg text-indigo-600 font-black"
                        >+</button>
                      </div>
                    </div>
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-emerald-700 border-b border-emerald-100 pb-1 w-full text-center flex items-center justify-center gap-1">كراتين إضافية <span className="text-[7px] text-emerald-500">(بجانب الطبلية)</span></span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: Math.max(0, ((prev[type.id]?.extraCartons) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.extraCartons || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5 text-emerald-700"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], extraCartons: ((prev[type.id]?.extraCartons) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-emerald-100 rounded-lg text-emerald-700 font-black"
                        >+</button>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-center flex-1 gap-1">
                      <span className="text-[9px] font-black text-rose-700 border-b border-rose-100 pb-1 w-full text-center flex items-center justify-center gap-1">كراتين ناقصة <span className="text-[7px] text-rose-500">(من الطبلية)</span></span>
                      <div className="flex items-center gap-2">
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: Math.max(0, ((prev[type.id]?.missingCartons) || 0) - 1) } }))}
                          className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-lg text-slate-600 font-black"
                        >-</button>
                        <input 
                          type="number" 
                          min="0"
                          value={selections[type.id]?.missingCartons || 0}
                          onChange={e => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: parseInt(e.target.value) || 0 } }))}
                          className="w-10 text-center bg-slate-50 border border-slate-100 rounded-lg font-black text-xs outline-none py-1.5 text-rose-700"
                        />
                        <button 
                          type="button"
                          onClick={() => setSelections(prev => ({ ...prev, [type.id]: { ...prev[type.id], missingCartons: ((prev[type.id]?.missingCartons) || 0) + 1 } }))}
                          className="w-6 h-6 flex items-center justify-center bg-rose-100 rounded-lg text-rose-700 font-black"
                        >+</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={handleNewTripSubmit} className="w-full bg-indigo-900 text-white p-6 rounded-[2rem] font-black text-sm shadow-xl active:scale-95 transition-all">إرسال وتجهيز ملصقات المشروع</button>
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
                <button onClick={() => handleExportTripPallets(currentTrip?.id || '')} className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-black text-[10px] flex items-center gap-1 shadow-sm hover:bg-emerald-700 transition-all">📊 تصدير Excel</button>
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

      <ConfirmModal
        isOpen={showCancelModal}
        title="تأكيد إلغاء الرحلة"
        message={`⚠️ تحذير: هل أنت متأكد من إلغاء الرحلة رقم #${trips.find(t => t.id === tripIdToCancel)?.tripNumber}؟\nستبقى الرحلة في السجلات كـ "ملغاة" ولن تدخل في الإحصائيات.`}
        type="danger"
        onConfirm={confirmCancelTrip}
        onCancel={() => {
          setShowCancelModal(false);
          setTripIdToCancel(null);
        }}
        confirmText="نعم، إلغاء الرحلة"
        cancelText="تراجع"
      />
      <ConfirmModal
        isOpen={showRestoreTripModal}
        title="استعادة الرحلة الملغاة"
        message={`⚠️ هل أنت متأكد من استعادة الرحلة رقم #${trips.find(t => t.id === tripIdToRestore)?.tripNumber}؟\nسيتم إعادة الرحلة وجميع طبلياتها المرتبطة إلى النظام بحالتها السابقة.`}
        type="info"
        onConfirm={confirmRestoreTrip}
        onCancel={() => {
          setShowRestoreTripModal(false);
          setTripIdToRestore(null);
        }}
        confirmText="نعم، استعادة الرحلة"
        cancelText="إلغاء"
      />
      <ConfirmModal
        isOpen={showRevertModal}
        title="تأكيد التراجع عن العملية"
        message="هل أنت متأكد من التراجع عن هذه الرحلة (تنفيذ أو إطلاق)؟ سيتم إعادتها إلى قائمة الرحلات المخططة وتصحيح رصيد المخزون فوراً."
        type="danger"
        onConfirm={handleRevertExecutionConfirm}
        onCancel={() => { setShowRevertModal(false); setTripIdToRevert(null); }}
        confirmText="تأكيد التراجع"
        cancelText="إلغاء"
      />

      <ConfirmModal
        isOpen={showDeleteDistModal}
        title="حذف رحلة مخططة"
        message={`⚠️ هل أنت متأكد من حذف الرحلة المخططة رقم #${distributionTrips.find(t => t.id === tripIdToDeleteDist)?.tripNumber}؟\nسيتم حذفها نهائياً من النظام.`}
        type="danger"
        onConfirm={confirmDeleteDistTrip}
        onCancel={() => {
          setShowDeleteDistModal(false);
          setTripIdToDeleteDist(null);
        }}
        confirmText="حذف نهائي"
        cancelText="إلغاء"
      />

      <ConfirmModal
        isOpen={showDispatchConfirmModal}
        title="تأكيد العجز وإطلاق الرحلة"
        message="يوجد عجز في الكراتين الفارغة فقط. هل تريد بالتأكيد إطلاق الرحلة؟"
        type="info"
        onConfirm={() => {
          if (tripToDispatch) {
            handleDispatchTrip(tripToDispatch);
          }
          setShowDispatchConfirmModal(false);
          setTripToDispatch(null);
        }}
        onCancel={() => {
          setShowDispatchConfirmModal(false);
          setTripToDispatch(null);
        }}
        confirmText="نعم، إطلاق الرحلة"
        cancelText="تراجع"
      />

      {showDispatchedTableModal && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-7xl h-[90vh] rounded-[3rem] shadow-2xl border-4 border-indigo-600 flex flex-col overflow-hidden">
            <div className="bg-indigo-600 p-6 flex justify-between items-center shrink-0">
              <div className="text-right">
                <h3 className="text-2xl font-black text-white">جدول الرحلات المنطلقة والكميات التفصيلي</h3>
                <p className="text-indigo-100 text-sm font-bold">عرض كافة الرحلات التي تم إطلاقها وكميات كل مرحلة</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="بحث برقم الرحلة أو الوجهة..."
                    value={dispatchedTableSearch}
                    onChange={(e) => setDispatchedTableSearch(e.target.value)}
                    className="bg-white/10 border border-white/20 text-white placeholder:text-white/50 px-4 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-white/50 w-64 text-right"
                  />
                </div>
                <button 
                  onClick={() => {
                    const filtered = consolidatedTrips.filter(t => 
                      (t.status === 'dispatched' || t.status === 'executed') && 
                      (t.tripNumber.toLowerCase().includes(dispatchedTableSearch.toLowerCase()) || 
                       t.destinationCity.toLowerCase().includes(dispatchedTableSearch.toLowerCase()))
                    );
                    handleExportDispatchedTable(filtered);
                  }}
                  className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-black text-xs transition-all flex items-center gap-2 shadow-lg"
                >
                  📥 تصدير Excel
                </button>
                <button onClick={() => setShowDispatchedTableModal(false)} className="text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="inline-block min-w-full align-middle">
                <div className="overflow-hidden border border-slate-200 rounded-3xl shadow-sm">
                  <table className="min-w-full divide-y divide-slate-200 text-right">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-xs font-black text-slate-500 sticky right-0 bg-slate-50 z-10 border-l">رقم الرحلة</th>
                        <th className="px-4 py-3 text-xs font-black text-slate-500">الوجهة</th>
                        <th className="px-4 py-3 text-xs font-black text-slate-500">التاريخ</th>
                        <th className="px-4 py-3 text-xs font-black text-slate-500">المركز</th>
                        {palletTypes.map(pt => (
                          <th key={pt.id} className="px-4 py-3 text-[10px] font-black text-indigo-600 bg-indigo-50/30 whitespace-nowrap">
                            {pt.stageName}
                          </th>
                        ))}
                        <th className="px-4 py-3 text-xs font-black text-emerald-600 bg-emerald-50">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {consolidatedTrips
                        .filter(t => 
                          (t.status === 'dispatched' || t.status === 'executed') && 
                          (t.tripNumber.toLowerCase().includes(dispatchedTableSearch.toLowerCase()) || 
                           t.destinationCity.toLowerCase().includes(dispatchedTableSearch.toLowerCase()))
                        )
                        .map(trip => {
                          const tripQtys = trip.executedQuantities || trip.quantities;
                          const grandTotal = tripQtys.reduce((acc: number, cur: any) => acc + cur.cartonCount, 0);
                          return (
                            <tr key={trip.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3 text-xs font-black text-slate-900 sticky right-0 bg-white border-l hover:bg-slate-50">{trip.tripNumber}</td>
                              <td className="px-4 py-3 text-[11px] font-bold text-slate-600">{trip.destinationCity}</td>
                              <td className="px-4 py-3 text-[11px] font-bold text-slate-500">{trip.date}</td>
                              <td className="px-4 py-3 text-[11px] font-black text-indigo-500">{trip.originCenter}</td>
                              {palletTypes.map(pt => {
                                const q = tripQtys.find((qty: any) => qty.palletTypeId === pt.id);
                                return (
                                  <td key={pt.id} className={`px-4 py-3 text-[11px] font-black text-center ${q ? 'text-slate-900 bg-indigo-50/10' : 'text-slate-300'}`}>
                                    {q ? q.cartonCount : '-'}
                                  </td>
                                );
                              })}
                              <td className="px-4 py-3 text-xs font-black text-emerald-700 bg-emerald-50/30">{grandTotal}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                    <tfoot className="bg-slate-100 border-t-2 border-slate-200">
                       <tr className="font-black text-slate-900">
                          <td colSpan={4} className="px-4 py-3 text-sm text-center sticky right-0 bg-slate-100 z-10 border-l">الإجمالي العام</td>
                          {palletTypes.map(pt => {
                             const totalForStage = consolidatedTrips
                               .filter(t => 
                                 (t.status === 'dispatched' || t.status === 'executed') && 
                                 (t.tripNumber.toLowerCase().includes(dispatchedTableSearch.toLowerCase()) || 
                                  t.destinationCity.toLowerCase().includes(dispatchedTableSearch.toLowerCase()))
                               )
                               .reduce((acc, t) => {
                                 const q = (t.executedQuantities || t.quantities).find(qty => qty.palletTypeId === pt.id);
                                 return acc + (q?.cartonCount || 0);
                               }, 0);
                             return (
                               <td key={`footer-${pt.id}`} className="px-4 py-3 text-[11px] text-center text-indigo-700 bg-indigo-50/30">
                                 {totalForStage.toLocaleString()}
                               </td>
                             );
                          })}
                          <td className="px-4 py-3 text-xs text-emerald-700 bg-emerald-100">
                             {consolidatedTrips
                               .filter(t => 
                                 (t.status === 'dispatched' || t.status === 'executed') && 
                                 (t.tripNumber.toLowerCase().includes(dispatchedTableSearch.toLowerCase()) || 
                                  t.destinationCity.toLowerCase().includes(dispatchedTableSearch.toLowerCase()))
                               )
                               .reduce((acc, t) => {
                                  const tripQtys = t.executedQuantities || t.quantities;
                                  return acc + tripQtys.reduce((sum: number, q: any) => sum + q.cartonCount, 0);
                               }, 0).toLocaleString()
                             }
                          </td>
                       </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExportedDetailModal && selectedCenterForExported && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border-4 border-indigo-600 overflow-hidden">
            <div className="bg-indigo-600 p-6 text-center">
               <h3 className="text-xl font-black text-white">تفاصيل الإنتاج المصدر (خروج)</h3>
               <p className="text-indigo-100 text-xs font-bold mt-1">{selectedCenterForExported.name}</p>
            </div>
            <div className="p-4 bg-indigo-50 border-b border-indigo-100">
               <p className="text-[10px] font-black text-indigo-800 text-center leading-relaxed">
                 📊 يوضح هذا الجدول تفاصيل الكراتين والحزم المرسلة من المركز لكل مرحلة دراسية بشكل منفصل.
               </p>
            </div>
            <div className="p-6 max-h-[50vh] overflow-y-auto custom-scrollbar text-right">
               <div className="space-y-2">
                  {selectedCenterForExported.details.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 font-bold">لا توجد بيانات تصدير مسجلة</div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-100">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-3 py-2 font-black text-slate-500">المرحلة</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">كرتون</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">حزمة زائدة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {selectedCenterForExported.details.map((item, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2 font-black text-slate-700">{item.stageName}</td>
                              <td className="px-3 py-2 text-center text-indigo-700 font-black">{item.exportedCartons.toLocaleString()}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-lg font-black ${item.exportedBundles > 0 ? 'bg-amber-50 text-amber-600' : 'text-slate-300'}`}>
                                  {item.exportedBundles.toLocaleString()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
               </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
               <button 
                 onClick={() => { setShowExportedDetailModal(false); setSelectedCenterForExported(null); }}
                 className="w-full bg-indigo-900 text-white p-4 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-lg"
               >
                 إغلاق
               </button>
            </div>
          </div>
        </div>
      )}

      {showReceivedDetailModal && selectedCenterForReceived && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border-4 border-emerald-600 overflow-hidden">
            <div className="bg-emerald-600 p-6 text-center">
               <h3 className="text-xl font-black text-white">تفاصيل إجمالي المستلم</h3>
               <p className="text-emerald-100 text-xs font-bold mt-1">{selectedCenterForReceived.name}</p>
            </div>
            <div className="p-4 bg-emerald-50 border-b border-emerald-100">
               <p className="text-[10px] font-black text-emerald-800 text-center leading-relaxed">
                 📥 يوضح هذا الجدول تفاصيل الكراتين والحزم التي تم استلامها وإدخالها للمستودع لكل مرحلة.
               </p>
            </div>
            <div className="p-6 max-h-[50vh] overflow-y-auto custom-scrollbar text-right">
               <div className="space-y-2">
                  {selectedCenterForReceived.details.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 font-bold">لا توجد بيانات استلام مسجلة</div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-100">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-3 py-2 font-black text-slate-500">المرحلة</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">طبلية</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">كرتون</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">حزمة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {selectedCenterForReceived.details.map((item, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2 font-black text-slate-700">{item.stageName}</td>
                              <td className="px-3 py-2 text-center">
                                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg font-black">{item.receivedPallets.toLocaleString()}</span>
                              </td>
                              <td className="px-3 py-2 text-center text-emerald-700 font-black">{item.receivedCartons.toLocaleString()}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-lg font-black ${item.receivedBundles > 0 ? 'bg-amber-50 text-amber-600' : 'text-slate-300'}`}>
                                  {item.receivedBundles.toLocaleString()}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
               </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
               <button 
                 onClick={() => { setShowReceivedDetailModal(false); setSelectedCenterForReceived(null); }}
                 className="w-full bg-emerald-900 text-white p-4 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-lg"
               >
                 إغلاق
               </button>
            </div>
          </div>
        </div>
      )}

      {showBalanceDetailModal && selectedCenterForBalance && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border-4 border-indigo-900 overflow-hidden">
            <div className="bg-indigo-900 p-6 text-center">
               <h3 className="text-xl font-black text-white">تفاصيل الرصيد المتبقي الحر</h3>
               <p className="text-indigo-100 text-xs font-bold mt-1">{selectedCenterForBalance.name}</p>
            </div>
            <div className="p-4 bg-emerald-50 border-b border-emerald-100">
               <p className="text-[10px] font-black text-emerald-800 text-center leading-relaxed">
                 💡 يتم تحويل إجمالي الحزم المتبقية لكل مرحلة إلى كراتين كاملة وما تبقى يظهر كحزم لضمان دقة الرصيد.
               </p>
            </div>
            <div className="p-6 max-h-[50vh] overflow-y-auto custom-scrollbar">
               <div className="space-y-2">
                  {selectedCenterForBalance.details.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 font-bold">لا يوجد رصيد متبقي</div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-100">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-slate-50 border-b border-slate-100">
                          <tr>
                            <th className="px-3 py-2 font-black text-slate-500">المرحلة</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">كرتون</th>
                            <th className="px-3 py-2 font-black text-slate-500 text-center">حزمة</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {selectedCenterForBalance.details.map((item, idx) => {
                            const isNegative = item.totalBundles < 0;
                            return (
                              <tr key={idx} className={isNegative ? "bg-rose-50/30" : ""}>
                                <td className={`px-3 py-2 font-black ${isNegative ? 'text-rose-700' : 'text-slate-700'}`}>
                                  {item.stageName} {isNegative && <span className="text-[8px]">(عجز)</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`${isNegative ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'} px-2 py-0.5 rounded-lg font-black`}>
                                    {item.remainingCartons.toLocaleString()}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded-lg font-black ${isNegative ? 'bg-rose-100 text-rose-600' : item.remainingBundles > 0 ? 'bg-amber-50 text-amber-600' : 'text-slate-300'}`}>
                                    {item.remainingBundles.toLocaleString()}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
               </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
               <button 
                 onClick={() => { setShowBalanceDetailModal(false); setSelectedCenterForBalance(null); }}
                 className="w-full bg-slate-900 text-white p-4 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-lg"
               >
                 إغلاق
               </button>
            </div>
          </div>
        </div>
      )}

      {showReconciliationModal && (
        <AdminReconciliationModal
          onClose={() => setShowReconciliationModal(false)}
          onNotify={onNotify}
          palletTypes={palletTypes}
          trips={consolidatedTrips}
          records={statsRecords}
          centerOps={centerOptions}
        />
      )}

      {showComparisonModal && (
        <ReconciliationComparison
          palletTypes={palletTypes}
          records={records}
          distributionTrips={distributionTrips}
          users={users}
          onClose={() => setShowComparisonModal(false)}
        />
      )}

      {showEmptyCartonsModal && selectedCenterForEmpty && (
        <div className="fixed inset-0 z-[6000] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border-4 border-emerald-600 overflow-hidden">
            <div className="bg-emerald-600 p-6 text-center">
               <h3 className="text-xl font-black text-white">تفاصيل الكراتين الفارغة</h3>
               <p className="text-emerald-100 text-xs font-bold mt-1">{selectedCenterForEmpty.name}</p>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
               <div className="space-y-3">
                  {selectedCenterForEmpty.items.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 font-bold">لا توجد بيانات متوفرة</div>
                  ) : (
                    selectedCenterForEmpty.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <span className="font-black text-slate-700 text-sm ArabicText">{item.stageName}</span>
                        <span className="font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-xs">{item.cartons.toLocaleString()} كرتون</span>
                      </div>
                    ))
                  )}
               </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100">
               <button 
                 onClick={() => { setShowEmptyCartonsModal(false); setSelectedCenterForEmpty(null); }}
                 className="w-full bg-slate-800 text-white p-4 rounded-2xl font-black text-sm active:scale-95 transition-all shadow-lg"
               >
                 إغلاق
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

