
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { InventoryRecord, PalletType, UserRole, CenterCode, PressCode, Trip, PalletCondition, UserCredentials, PalletStatus } from '../types';
import { db } from '../firebase';
import { doc, updateDoc, collection, addDoc, deleteField, getDoc, writeBatch, query, where, orderBy, limit, startAfter, getDocs, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useInView } from 'react-intersection-observer';
import { useVirtualizer } from '@tanstack/react-virtual';

declare var html2pdf: any;

interface Props {
  records: InventoryRecord[];
  trips: Trip[];
  palletTypes: PalletType[];
  role: UserRole;
  userCode: string;
  userCenter: CenterCode | null;
  users: UserCredentials[]; // إضافة قائمة المستخدمين
  onNotify?: (title: string, msg: string) => void;
}

type LabelSize = '10x15' | '3x4';

export class LocalErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return <div className="p-10 text-red-500 font-bold bg-rose-50 border-rose-200" dir="ltr">
        <h1>History Crash:</h1>
        <pre className="whitespace-pre-wrap">{String(this.state.error?.stack || this.state.error)}</pre>
      </div>;
    }
    return this.props.children;
  }
}

export const History: React.FC<Props> = (props) => {
  return (
    <LocalErrorBoundary>
      <HistoryInner {...props} />
    </LocalErrorBoundary>
  );
};

const HistoryInner: React.FC<Props> = ({ records, trips, palletTypes, role, userCode, userCenter, users, onNotify }) => {
  const [destinationFilter, setDestinationFilter] = useState<CenterCode | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'received' | 'in_transit' | 'pending' | 'cancelled'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [palletTypeFilter, setPalletTypeFilter] = useState<string | 'ALL'>('ALL');
  const [pressFilter, setPressFilter] = useState<PressCode | 'ALL'>('ALL');
  const [showDamagedOnly, setShowDamagedOnly] = useState(false);
  const [showWrongDestinationsOnly, setShowWrongDestinationsOnly] = useState(false);
  const [activeChoiceId, setActiveChoiceId] = useState<string | null>(null);
  const [batchPrintTripId, setBatchPrintTripId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<LabelSize>('10x15');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkCancelling, setIsBulkCancelling] = useState(false);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);

  const isAdmin = useMemo(() => userCode === 'ADMIN' || (role as string) === 'admin', [userCode, role]);

  const parentRef = useRef<HTMLDivElement>(null);

  const [displayCount, setDisplayCount] = useState(50);

  const handleRestoreRecord = async (record: InventoryRecord) => {
    setIsRestoring(record.id);
    try {
      console.log(`Restoring record: ${record.id}`);
      
      const docRef = doc(db, 'records', record.id);
      const docSnap = await getDoc(docRef);
      
      let targetRecord = record;
      if (docSnap.exists()) {
        targetRecord = { ...docSnap.data(), id: docSnap.id } as InventoryRecord;
      }

      let restoredStatus: PalletStatus = 'pending';
      if (targetRecord.centerTimestamp) restoredStatus = 'received';
      else if (targetRecord.factoryTimestamp) restoredStatus = 'in_transit';

      const batch = writeBatch(db);
      batch.update(docRef, {
        status: restoredStatus,
        cancelledAt: deleteField()
      });

      await batch.commit();

      await addDoc(collection(db, 'system_logs'), {
        timestamp: Date.now(),
        type: 'system_error',
        userId: userCode || 'مجهول',
        message: 'إعادة تفعيل لصيقة',
        details: `تمت استعادة اللصيقة رقم (${record.palletBarcode}) وإعادتها لحالة: ${restoredStatus}.`
      });

      const statusAr = restoredStatus === 'received' ? 'تم الاستلام' : restoredStatus === 'in_transit' ? 'في الطريق' : 'بانتظار التحميل';
      
      if (onNotify) {
        onNotify('✅ تمت الاستعادة', `تمت إعادة تفعيل اللصيقة (${record.palletBarcode}) بنجاح. الحالة الحالية: ${statusAr}.`);
      }
    } catch (err: any) {
      console.error('Failed to restore record:', err);
      const errorMsg = err?.message || String(err);
      if (onNotify) {
        onNotify('❌ خطأ في الاستعادة', `فشل في استعادة اللصيقة: ${errorMsg}`);
      }
    } finally {
      setIsRestoring(null);
    }
  };

  const toggleSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleBulkCancel = async () => {
    if (selectedIds.size === 0) return;
    
    setIsBulkCancelling(true);
    try {
      const ids = Array.from(selectedIds);
      const batchSize = 10;
        
        for (let i = 0; i < ids.length; i++) {
           const id = ids[i];
           const record = records.find(r => r.id === id);
           if (!record || record.status === 'cancelled') continue;

           await updateDoc(doc(db, 'records', id), {
             status: 'cancelled',
             cancelledAt: Date.now()
           });

           await addDoc(collection(db, 'system_logs'), {
             timestamp: Date.now(),
             type: 'system_error',
             userId: userCode || 'مجهول',
             message: 'إلغاء لصيقة (جماعي)',
             details: `تم إلغاء اللصيقة رقم (${record.palletBarcode}) ضمن عملية إلغاء جماعي.`
           });
        }

        if (onNotify) {
          onNotify('نجاح الإلغاء', `تم إلغاء ${selectedIds.size} لصيقة بنجاح.`);
        }
        setSelectedIds(new Set());
      } catch (err) {
        console.error('Bulk cancel failed', err);
        if (onNotify) onNotify('خطأ', 'فشل الإلغاء الجماعي لبعض السجلات.');
      } finally {
        setIsBulkCancelling(false);
      }
  };

  // جلب اسم المنشأة ديناميكياً
  const getEntityName = (code: any) => {
     if (!code) return 'غير معروف';
     const normCode = String(code).trim().toUpperCase();
     if (normCode === 'MISDIRECTED_CORRECTED' || normCode === 'WRONG_DEST') return 'توجيه خاطئ';
     const u = users.find(u => String(u.code || '').trim().toUpperCase() === normCode);
     if (!u) return String(code);
     let name = u.locationName || u.displayName || code;

     // Explicit fixes for main centers
     if (u.code === 'DMM' && (!u.locationName || String(u.locationName).includes('-'))) name = 'مركز الدمام';
     if (u.code === 'RYD' && (!u.locationName || String(u.locationName).includes('-'))) name = 'مركز الرياض';
     if (u.code === 'JED' && (!u.locationName || String(u.locationName).includes('-'))) name = 'مركز جدة';

     if (String(name).includes(' - ')) {
       const parts = String(name).split(' - ');
       return parts[1] ? String(parts[1]).trim() : String(name);
     }
     return String(name);
  };

  const formatDateTime = (ts: number | undefined) => {
    if (!ts) return '---';
    const date = new Date(ts);
    return date.toLocaleString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (ms: number) => {
    if (ms <= 0) return '---';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} يوم و ${hours % 24} ساعة`;
    if (hours > 0) return `${hours} ساعة و ${minutes % 60} دقيقة`;
    if (minutes > 0) return `${minutes} دقيقة`;
    return `${seconds} ثانية`;
  };

  const centerOptions = useMemo(() => {
    const centers = users.filter(u => u.role === 'center');
    const unique = new Map<string, UserCredentials & { displayName: string }>();
    const sortedCenters = [...centers].sort((a, b) => {
      const aHasLocation = !!(a.locationName && String(a.locationName).trim());
      const bHasLocation = !!(b.locationName && String(b.locationName).trim());
      if (aHasLocation && !bHasLocation) return -1;
      if (!aHasLocation && bHasLocation) return 1;
      return 0;
    });

    sortedCenters.forEach(c => {
      const normalizedCode = String(c.code || '').trim().toUpperCase();
      if (normalizedCode && !unique.has(normalizedCode)) {
        let finalName = c.locationName || c.displayName || c.username;
        if (normalizedCode === 'DMM' && (!c.locationName || String(c.locationName).includes('-'))) finalName = 'مركز الدمام';
        if (normalizedCode === 'RYD' && (!c.locationName || String(c.locationName).includes('-'))) finalName = 'مركز الرياض';
        if (normalizedCode === 'JED' && (!c.locationName || String(c.locationName).includes('-'))) finalName = 'مركز جدة';
        unique.set(normalizedCode, { ...c, code: normalizedCode, displayName: finalName });
      }
    });
    return Array.from(unique.values());
  }, [users]);

  const pressOptions = useMemo(() => {
    const factories = users.filter(u => u.role === 'factory');
    const unique = new Map<string, UserCredentials & { displayName: string }>();
    factories.forEach(f => {
      const normalizedCode = String(f.code || '').trim().toUpperCase();
      if (normalizedCode && !unique.has(normalizedCode)) {
        let finalName = f.displayName || f.username;
        if (normalizedCode === 'OPK') finalName = 'مطبعة العبيكان';
        if (normalizedCode === 'UNI') finalName = 'المطبعة المتحدة';
        unique.set(normalizedCode, { ...f, code: normalizedCode as PressCode, displayName: finalName });
      }
    });
    return Array.from(unique.values());
  }, [users]);

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
      // الملصقات الملغاة تظهر فقط لمسئول النظام
      if (record.status === 'cancelled' && !isAdmin) return false;

      const barcode = (record.palletBarcode || '').trim().toUpperCase();
      const isAdjustment = (record.notes && (String(record.notes).includes('تسوية') || String(record.notes).includes('زيادة'))) || record.isExtraOnly || barcode.startsWith('ADJ-');

      // التسويات والزيادات والنقص (زيادة، تسوية، ADJ-، isExtraOnly) لا تظهر إلا لمسؤول النظام
      if (isAdjustment && !isAdmin) {
        return false;
      }

      let isVisible = false;
      if (isAdmin || role === 'monitor') isVisible = true;
      else if (role === 'factory') isVisible = (record.palletBarcode || '').includes(userCode);
      else if (role === 'center' && userCenter) {
        const targetCenter = String(record.receivedByCenter || (record.status === 'received' && record.isWrongDestination ? 'WRONG_DEST' : (record.destination || ''))).trim().toUpperCase();
        const DAMMAM_MISDIRECTED_BARCODES = [
          'G01YOM1177316', 'G01YOM1177416', 'G01YOM1177516', 'G01YOM1177616', 'G01YOM1177716',
          'G02YOM1177816', 'G02YOM1177916', 'G02YOM1178016',
          'G03YOM1178116',
          'G05YOM1178216', 'G05YOM1178316', 'G05YOM1178416', 'G05YOM1178516', 'G05YOM1178616', 'G05YOM1178716', 'G05YOM1178816',
          'G06YOM1178916', 'G06YOM1179016', 'G06YOM1179116', 'G06YOM1179216',
          'G07YOM1179316', 'G07YOM1179416', 'G07YOM1179516'
        ];
        let finalTarget = targetCenter;
        if ((finalTarget === 'DAMMAM' || finalTarget === 'DMM') && barcode && DAMMAM_MISDIRECTED_BARCODES.includes(barcode)) {
          finalTarget = 'WRONG_DEST';
        }
        isVisible = finalTarget === String(userCenter).trim().toUpperCase();
      }
      
      const trip = trips.find(t => t.id === record.tripId);
      
      if (isVisible && role !== 'center' && destinationFilter !== 'ALL') {
        const targetCenter = String(record.receivedByCenter || (record.status === 'received' && record.isWrongDestination ? 'WRONG_DEST' : (record.destination || ''))).trim().toUpperCase();
        isVisible = targetCenter === destinationFilter.trim().toUpperCase();
      }
      if (isVisible && statusFilter !== 'ALL') isVisible = record.status === statusFilter;
      if (isVisible && showDamagedOnly) isVisible = (record.condition && record.condition !== 'intact') || record.hasDiscrepancy;
      
      const isActuallyWrongDest = record.isWrongDestination || (record.notes && String(record.notes).includes('توجيه خاطئ'));
      if (isVisible && showWrongDestinationsOnly) isVisible = !!isActuallyWrongDest;

      // Search Filter
      if (isVisible && searchQuery) {
        const query = String(searchQuery).toLowerCase().trim();
        const barcodeMatch = String(record.palletBarcode || '').toLowerCase().includes(query);
        const tripNumMatch = String(trip?.tripNumber || '').toLowerCase().includes(query);
        isVisible = barcodeMatch || tripNumMatch;
      }
      
      // Date Filter
      if (isVisible && dateFilter) {
        let recordDate = '';
        if (record.timestamp) {
           const d = new Date(record.timestamp);
           if (!isNaN(d.getTime())) {
             recordDate = d.toISOString().split('T')[0];
           }
        }
        isVisible = recordDate === dateFilter;
      }

      // Pallet Type Filter
      if (isVisible && palletTypeFilter !== 'ALL') {
        isVisible = record.palletTypeId === palletTypeFilter;
      }

      // Filter by Press / Factory
      if (isVisible && pressFilter !== 'ALL') {
        const recordPressCode = trip ? (trip.pressCode || '').trim().toUpperCase() : ((record.palletBarcode || '').includes('OPK') ? 'OPK' : 'UNI');
        isVisible = recordPressCode === pressFilter.trim().toUpperCase();
      }
      
      return isVisible;
    }).sort((a, b) => {
      const timeA = a.timestamp || 0;
      const timeB = b.timestamp || 0;
      if (timeB !== timeA) return timeB - timeA;
      return (b.id || '').localeCompare(a.id || ''); // التحقق من المعرف للثبات في حال تطابق الوقت
    });
  }, [records, role, userCode, userCenter, destinationFilter, statusFilter, showDamagedOnly, searchQuery, dateFilter, palletTypeFilter, pressFilter, trips]);

  const visibleRecords = useMemo(() => {
    return filteredRecords.slice(0, displayCount);
  }, [filteredRecords, displayCount]);

  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '200px',
  });

  useEffect(() => {
    if (inView && displayCount < filteredRecords.length) {
      setDisplayCount(prev => Math.min(prev + 50, filteredRecords.length));
    }
  }, [inView, filteredRecords.length, displayCount]);

  // Reset displayCount when any filter changes
  useEffect(() => {
    setDisplayCount(50);
  }, [destinationFilter, statusFilter, searchQuery, dateFilter, palletTypeFilter, pressFilter, showDamagedOnly, showWrongDestinationsOnly]);

  const generateLabelHTML = (record: InventoryRecord, size: LabelSize) => {
    const pType = palletTypes.find(t => t.id === record.palletTypeId);
    const trip = trips.find(t => t.id === record.tripId);
    const tripNumber = trip ? trip.tripNumber : '---';
    const pressCode = trip ? trip.pressCode : ((record.palletBarcode || '').includes('OPK') ? 'OPK' : 'UNI');
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
               <div style="font-size: ${isLarge ? '32px' : '18px'}; font-weight: 900;">
                  #${tripNumber}
                  ${trip?.startDate ? `<span style="font-size: ${isLarge ? '14px' : '8px'}; font-weight: 700; display: block; border-top: 1px solid white; margin-top: 2px;">${new Date(trip.startDate).toLocaleDateString('en-GB')}</span>` : ''}
               </div>
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

    // Sort by stage then barcode
    const sortedTripRecords = [...tripRecords].sort((a, b) => {
      const typeA = palletTypes.find(t => t.id === a.palletTypeId);
      const typeB = palletTypes.find(t => t.id === b.palletTypeId);
      if (!typeA || !typeB) return 0;
      const stageCompare = (typeA.stageCode || '').localeCompare(typeB.stageCode || '');
      if (stageCompare !== 0) return stageCompare;
      return (a.palletBarcode || '').localeCompare(b.palletBarcode || '');
    });

    const isLarge = selectedSize === '10x15';
    const w = isLarge ? 100 : 76;
    const h = isLarge ? 150 : 101;
    const html = sortedTripRecords.map(r => generateLabelHTML(r, selectedSize)).join('');

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

      if (onNotify) {
        onNotify('✅ نجاح', 'تم تعديل الحالة بنجاح.');
      }
    } catch (err: any) {
      console.error('Failed to force update', err);
      if (onNotify) onNotify('❌ خطأ', 'حدث خطأ أثناء محاولة تعديل الحالة.');
    }
  };

  const handleCancelRecord = async (record: InventoryRecord) => {
    setIsCancelling(record.id);
    try {
      console.log(`Cancelling record: ${record.id}`);
      await updateDoc(doc(db, 'records', record.id), {
        status: 'cancelled',
        cancelledAt: Date.now()
      });

      await addDoc(collection(db, 'system_logs'), {
        timestamp: Date.now(),
        type: 'system_error',
        userId: userCode || 'مجهول',
        message: 'إلغاء لصيقة سجل',
        details: `تم إلغاء اللصيقة رقم (${record.palletBarcode}) بواسطة مسؤول النظام (الحالة السابقة: ${record.status}).`
      });

      if (onNotify) {
        onNotify('⚠️ تم الإلغاء', 'تم إلغاء اللصيقة بنجاح من النظام والمخزون.');
      }
    } catch (err: any) {
      console.error('Failed to cancel record:', err);
      if (onNotify) {
        onNotify('❌ خطأ', 'فشل إلغاء اللصيقة. يرجى التحقق من الاتصال.');
      }
    } finally {
      setIsCancelling(null);
    }
  };

  const rowVirtualizer = useVirtualizer({
    count: visibleRecords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 5,
  });

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
          <div className="flex items-center gap-2">
            {isAdmin && selectedIds.size > 0 && (
              <button 
                onClick={handleBulkCancel}
                disabled={isBulkCancelling}
                className="bg-rose-600 text-white px-3 py-1.5 rounded-xl text-[10px] font-black shadow-lg animate-bounce animate-once"
              >
                {isBulkCancelling ? 'جاري الإلغاء...' : `إلغاء (${selectedIds.size}) لصائق`}
              </button>
            )}
            <span className="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-[10px] font-black">{filteredRecords.length} سجل</span>
          </div>
        </div>
        
        <div className="flex flex-col gap-3 pb-2">
          {/* Search Bar */}
          <div className="relative">
            <input
              type="text"
              placeholder="البحث برقم الباركود أو رقم الرحلة..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-10 text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 transition-all text-right"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
              >✕</button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            {/* Date Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 min-w-fit">
              <span className="text-[9px] font-black text-slate-400">التاريخ:</span>
              <input 
                type="date" 
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="bg-transparent text-[10px] font-black text-slate-700 focus:outline-none"
              />
              {dateFilter && (
                <button onClick={() => setDateFilter('')} className="text-slate-400 text-xs hover:text-rose-500">✕</button>
              )}
            </div>

            {/* Pallet Type Filter */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 flex-1 min-w-fit overflow-hidden">
               <span className="text-[9px] font-black text-slate-400 whitespace-nowrap">النوع:</span>
               <select 
                 value={palletTypeFilter}
                 onChange={(e) => setPalletTypeFilter(e.target.value)}
                 className="bg-transparent text-[10px] font-black text-slate-700 focus:outline-none w-full"
               >
                 <option value="ALL">الكل</option>
                 {palletTypes.map(t => (
                   <option key={t.id} value={t.id}>{t.stageName}</option>
                 ))}
               </select>
            </div>

            {/* Press Filter */}
            {role !== 'factory' && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 flex-1 min-w-fit overflow-hidden">
                 <span className="text-[9px] font-black text-slate-400 whitespace-nowrap">المطبعة:</span>
                 <select 
                   value={pressFilter}
                   onChange={(e) => setPressFilter(e.target.value as PressCode | 'ALL')}
                   className="bg-transparent text-[10px] font-black text-slate-700 focus:outline-none w-full"
                 >
                   <option value="ALL">الكل</option>
                   {pressOptions.map(press => (
                     <option key={press.id} value={press.code}>{press.displayName}</option>
                   ))}
                 </select>
              </div>
            )}
          </div>

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
            {isAdmin && (
              <button onClick={() => setStatusFilter('cancelled')} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${statusFilter === 'cancelled' ? 'bg-rose-600 text-white' : 'bg-rose-50 text-rose-600'}`}>الملغاة ⚠️</button>
            )}
            
            <div className="w-px h-6 bg-slate-200 mx-1 flex-shrink-0"></div>
            
            <button onClick={() => setShowDamagedOnly(!showDamagedOnly)} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${showDamagedOnly ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 border border-rose-100 text-rose-600'}`}>⚠️ المتضرر</button>
            <button onClick={() => setShowWrongDestinationsOnly(!showWrongDestinationsOnly)} className={`px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all ${showWrongDestinationsOnly ? 'bg-orange-600 text-white border-orange-600' : 'bg-orange-50 border border-orange-100 text-orange-600'}`}>⚠️ توجيه خاطئ</button>

            <button 
              onClick={() => {
                setSearchQuery('');
                setDateFilter('');
                setPalletTypeFilter('ALL');
                setPressFilter('ALL');
                setStatusFilter('ALL');
                setDestinationFilter('ALL');
                setShowDamagedOnly(false);
                setShowWrongDestinationsOnly(false);
              }}
              className="px-4 py-2 rounded-xl text-[10px] font-black whitespace-nowrap transition-all bg-slate-100 text-slate-500 hover:bg-slate-200"
            >
              🔄 إعادة ضبط
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4">
        {filteredRecords.length === 0 && (
          <div className="py-20 text-center space-y-3 bg-white rounded-[3rem] border border-dashed border-slate-200">
             <div className="text-4xl opacity-20">📂</div>
             <p className="text-slate-400 font-bold text-xs">لا توجد سجلات متاحة حالياً</p>
          </div>
        )}

        {filteredRecords.length > 0 && (
          <>
            {isAdmin && filteredRecords.some(r => r.status !== 'cancelled') && (
              <div className="bg-white p-4 rounded-3xl border border-slate-100/80 flex flex-wrap justify-between items-center gap-3 shadow-sm animate-fadeIn">
                <div className="flex items-center gap-2">
                  <span className="text-xs">☑️</span>
                  <span className="text-[11px] font-black text-slate-700">التحديد الجماعي للنتائج المفلترة:</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const eligibleIds = filteredRecords.filter(r => r.status !== 'cancelled').map(r => r.id);
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        eligibleIds.forEach(id => next.add(id));
                        return next;
                      });
                    }}
                    className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-150 px-3 py-2 rounded-xl text-[10px] font-black active:scale-95 transition-all cursor-pointer"
                  >
                    تحديد الكل ({filteredRecords.filter(r => r.status !== 'cancelled').length})
                  </button>
                  {selectedIds.size > 0 && (
                    <button
                      onClick={() => {
                        const eligibleIds = filteredRecords.filter(r => r.status !== 'cancelled').map(r => r.id);
                        setSelectedIds(prev => {
                          const next = new Set(prev);
                          eligibleIds.forEach(id => next.delete(id));
                          return next;
                        });
                      }}
                      className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-150 px-3 py-2 rounded-xl text-[10px] font-black active:scale-95 transition-all cursor-pointer"
                    >
                      إلغاء تحديد المفلتر ({filteredRecords.filter(r => r.status !== 'cancelled' && selectedIds.has(r.id)).length})
                    </button>
                  )}
                </div>
              </div>
            )}
            <div ref={parentRef} className="max-h-[75vh] overflow-y-auto custom-scrollbar no-scrollbar" style={{ overscrollBehavior: 'contain' }}>
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const record = visibleRecords[virtualRow.index];
                  if (!record) return null;
                  const isExpanded = expandedId === record.id;
                  const cond = getConditionLabel(record);
                  const pType = palletTypes.find(t => t.id === record.palletTypeId);
                  const trip = trips.find(t => t.id === record.tripId);
                  
                  return (
                    <div 
                      key={record.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                      className="pb-4"
                    >
                      <div className={`bg-white rounded-[2.5rem] shadow-sm border transition-all duration-300 overflow-hidden ${isExpanded ? 'ring-2 ring-indigo-500 border-transparent' : 'border-slate-100'} ${selectedIds.has(record.id) ? 'bg-indigo-50/50' : ''}`}>
                        <div onClick={() => setExpandedId(isExpanded ? null : record.id)} className={`p-6 flex justify-between items-center cursor-pointer active:bg-slate-50 ${isExpanded ? 'bg-indigo-50/30' : 'bg-white'}`}>
                  <div className="flex items-center gap-4">
                    {isAdmin && record.status !== 'cancelled' && (
                      <div 
                        onClick={(e) => toggleSelection(record.id, e)}
                        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${selectedIds.has(record.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200'}`}
                      >
                        {selectedIds.has(record.id) && <span className="text-[10px]">✓</span>}
                      </div>
                    )}
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
                       {(record.isWrongDestination || (record.notes && String(record.notes).includes('توجيه خاطئ'))) && (
                         <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">🚩 توجيه خاطئ</span>
                       )}
                       <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${
                         record.status === 'received' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 
                         record.status === 'in_transit' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 
                         record.status === 'cancelled' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                         'bg-slate-50 text-slate-400 border border-slate-100'
                       }`}>
                         {record.status === 'received' ? 'تم الاستلام ✓' : 
                          record.status === 'in_transit' ? 'في الطريق 🚚' : 
                          record.status === 'cancelled' ? '⚠️ ملغاة' :
                          'بانتظار التحميل'}
                       </span>
                    </div>
                    
                    {(() => {
                      const isWrong = record.isWrongDestination || 
                                     (record.receivedByCenter && record.destination && String(record.receivedByCenter).trim().toUpperCase() !== String(record.destination).trim().toUpperCase()) ||
                                     (record.notes && String(record.notes).includes('توجيه خاطئ'));

                      if (isWrong) {
                        return (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 p-1.5 bg-orange-50/50 rounded-lg border border-dashed border-orange-200">
                            <span className="text-[8px] font-black text-slate-400">الوجهة: <span className="text-indigo-600">{getEntityName(record.destination)}</span></span>
                            <span className="text-[8px] font-bold text-slate-300">←</span>
                            <span className="text-[8px] font-black text-slate-400">استلمت في: <span className="text-orange-600">{record.receivedByCenter ? getEntityName(record.receivedByCenter) : 'مركز آخر'}</span></span>
                            {record.receivedByUsername && (
                              <>
                                <span className="text-[8px] font-bold text-slate-300 mx-1">|</span>
                                <span className="text-[8px] font-black text-slate-400">بواسطة: <span className="text-emerald-600">{record.receivedByUsername}</span></span>
                              </>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}
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
                     {record.status === 'cancelled' ? (
                        <div className="bg-rose-50 p-3 rounded-2xl text-right border border-rose-100">
                           <span className="text-[9px] font-black text-rose-400 block uppercase mb-1">الحالة</span>
                           <span className="text-[10px] font-bold block text-rose-700">
                             ملغاة ⚠️
                           </span>
                           {record.cancelledAt && (
                             <span className="text-[8px] font-bold text-rose-500 mt-1 block">
                               تم الإلغاء في: {formatDateTime(record.cancelledAt)}
                             </span>
                           )}
                        </div>
                       ) : (
                        <div className="bg-slate-50 p-3 rounded-2xl text-right">
                           <span className="text-[9px] font-black text-slate-400 block uppercase mb-1">الحالة</span>
                           <span className={`text-[10px] font-bold block ${
                             record.status === 'received' ? 'text-emerald-600' : 
                             record.status === 'in_transit' ? 'text-amber-600' : 
                             'text-slate-400'
                           }`}>
                             {record.status === 'received' ? 'تم الاستلام ✓' : 
                              record.status === 'in_transit' ? 'في الطريق 🚚' : 
                              'بانتظار التحميل'}
                           </span>
                        </div>
                       )}
                      <div className="bg-slate-50 p-3 rounded-2xl">
                         <span className="text-[9px] font-black text-slate-400 block uppercase mb-1 text-right">الوجهة</span>
                         <span className="text-[10px] font-bold text-slate-800 block text-right">{getEntityName(record.destination)}</span>
                      </div>
                    </div>

                    {(() => {
                      const isWrong = record.isWrongDestination || 
                                     (record.receivedByCenter && record.destination && String(record.receivedByCenter).trim().toUpperCase() !== String(record.destination).trim().toUpperCase()) ||
                                     (record.notes && String(record.notes).includes('توجيه خاطئ'));

                      if (isWrong) {
                        return (
                          <div className="bg-orange-50 border border-orange-100 p-4 rounded-[1.5rem] space-y-2">
                            <div className="flex items-center gap-2 text-orange-700 font-black text-[11px]">
                              <span>🚩 تفاصيل التوجيه الخاطئ</span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-1">
                              <div className="bg-white p-2 rounded-xl text-right border border-orange-200">
                                 <span className="text-[8px] font-black text-slate-400 block mb-0.5">الوجهة المقررة</span>
                                 <span className="text-xs font-black text-indigo-700">{getEntityName(record.destination)}</span>
                              </div>
                              <div className="bg-white p-2 rounded-xl text-right border border-orange-200">
                                 <span className="text-[8px] font-black text-slate-400 block mb-0.5">مكان الاستلام الفعلي</span>
                                 <span className="text-xs font-black text-orange-700">{record.receivedByCenter ? getEntityName(record.receivedByCenter) : 'غير مسجل'}</span>
                              </div>
                              {record.receivedByUsername && (
                                <div className="bg-white p-2 rounded-xl text-right border border-orange-200 col-span-2">
                                   <span className="text-[8px] font-black text-slate-400 block mb-0.5">المستلم بواسطة (اسم المستخدم)</span>
                                   <span className="text-xs font-black text-emerald-700">{record.receivedByUsername}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/*Timeline Movement Log*/}
                    <div className="bg-slate-50 p-5 rounded-[2.5rem] border border-slate-100 space-y-4">
                       <h4 className="text-[11px] font-black text-slate-700 border-b border-indigo-100 pb-2 mb-2 flex items-center gap-2">
                         <span className="bg-indigo-100 p-1.5 rounded-lg">📦</span>
                         التسلسل الزمني للتحركات
                       </h4>
                       <div className="relative space-y-6 mr-1 pr-1">
                          {/* Stage 1: Creation */}
                          <div className="relative flex items-start gap-4">
                            <div className="absolute right-[9px] top-[18px] bottom-[-30px] w-0.5 bg-slate-200"></div>
                            <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm">
                              <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                            </div>
                            <div className="flex-1 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] font-black text-slate-800">التجهيز في المطبعة</span>
                                <span className="text-[8px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md font-mono" dir="ltr">
                                  {formatDateTime(trip?.startDate || record.timestamp)}
                                </span>
                              </div>
                              <p className="text-[8px] text-slate-400 leading-relaxed">تم إصدار الباركود وربطه بالرحلة رقم #{trip?.tripNumber || '---'}</p>
                            </div>
                          </div>

                          {/* Stage 2: Departure */}
                          <div className="relative flex items-start gap-4">
                            <div className="absolute right-[9px] top-[18px] bottom-[-30px] w-0.5 bg-slate-200"></div>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm ${record.factoryTimestamp ? 'bg-amber-500' : 'bg-slate-200'}`}>
                               <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                            </div>
                            <div className={`flex-1 p-3 rounded-2xl border shadow-sm transition-all ${record.factoryTimestamp ? 'bg-white border-slate-100' : 'bg-slate-50/50 border-dashed border-slate-200 opacity-60'}`}>
                               <div className="flex justify-between items-center mb-1">
                                 <span className={`text-[10px] font-black ${record.factoryTimestamp ? 'text-slate-800' : 'text-slate-400'}`}>مغادرة المطبعة (خروج)</span>
                                 {record.factoryTimestamp && (
                                   <span className="text-[8px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md font-mono" dir="ltr">
                                     {formatDateTime(record.factoryTimestamp)}
                                   </span>
                                 )}
                               </div>
                            </div>
                          </div>

                          {/* Stage 3: Arrival */}
                          <div className="relative flex items-start gap-4">
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 border-2 border-white shadow-sm ${record.centerTimestamp ? 'bg-emerald-600' : 'bg-slate-200'}`}>
                               <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
                            </div>
                            <div className={`flex-1 p-3 rounded-2xl border shadow-sm transition-all ${record.centerTimestamp ? 'bg-white border-slate-100' : 'bg-slate-50/50 border-dashed border-slate-200 opacity-60'}`}>
                               <div className="flex justify-between items-center mb-1">
                                 <span className={`text-[10px] font-black ${record.centerTimestamp ? 'text-slate-800' : 'text-slate-400'}`}>الاستلام في المركز (وصول)</span>
                                 {record.centerTimestamp && (
                                   <span className="text-[8px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-mono" dir="ltr">
                                     {formatDateTime(record.centerTimestamp)}
                                   </span>
                                 )}
                               </div>
                               {record.centerTimestamp && record.factoryTimestamp && (
                                 <div className="mt-2 flex items-center gap-1 text-[8px] font-bold text-emerald-600 bg-emerald-50 w-fit px-2 py-1 rounded-lg">
                                    <span>🚚 مدة النقل:</span>
                                    <span className="font-black underline decoration-emerald-200 decoration-2 underline-offset-2">
                                      {formatDuration(record.centerTimestamp - record.factoryTimestamp)}
                                    </span>
                                 </div>
                               )}
                            </div>
                          </div>
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

                    {isAdmin && record.status === 'cancelled' && (
                       <button 
                         disabled={isRestoring === record.id}
                         onClick={(e) => {
                           e.stopPropagation();
                           handleRestoreRecord(record);
                         }}
                         className={`w-full py-3 rounded-2xl text-[10px] font-black flex items-center justify-center gap-2 active:scale-95 transition-all mt-2 ${
                           isRestoring === record.id 
                           ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                           : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                         }`}
                       >
                         {isRestoring === record.id ? (
                           <>
                             <div className="w-3 h-3 border-2 border-indigo-700 border-t-transparent rounded-full animate-spin"></div>
                             <span>جاري الاستعادة...</span>
                           </>
                         ) : (
                           <>
                             <span>🔄 إعادة تفعيل هذه اللصيقة (إلغاء الإلغاء)</span>
                           </>
                         )}
                       </button>
                    )}

                    {isAdmin && record.status !== 'cancelled' && (
                       <button 
                         disabled={isCancelling === record.id}
                         onClick={(e) => {
                           e.stopPropagation();
                           handleCancelRecord(record);
                         }}
                         className={`w-full py-3 rounded-2xl text-[10px] font-black flex items-center justify-center gap-2 active:scale-95 transition-all mt-2 ${
                           isCancelling === record.id 
                           ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                           : 'bg-rose-50 text-rose-700 border border-rose-100'
                         }`}
                       >
                         {isCancelling === record.id ? (
                           <>
                             <div className="w-3 h-3 border-2 border-rose-700 border-t-transparent rounded-full animate-spin"></div>
                             <span>جاري الإلغاء...</span>
                           </>
                         ) : (
                           <>
                             <span>🚫 إلغاء هذه اللصيقة (مسؤول النظام فقط)</span>
                           </>
                         )}
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

                    {isAdmin && record.hasDiscrepancy && (
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
            </div>
            );
          })}
          </div>
          {displayCount < filteredRecords.length && (
            <div ref={loadMoreRef} className="py-6 text-center text-xs text-slate-400 font-bold flex items-center justify-center gap-2" dir="rtl">
              <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              <span>جاري تحميل المزيد من السجلات...</span>
            </div>
          )}
          </div>
          </>
        )}
      </div>
    </div>
  );
};
