import React, { useState, useMemo } from 'react';
import { InventoryRecord, PalletType, UserCredentials, CenterCode, PressCode, Trip, PalletCondition, PalletStatus, DistributionTrip } from '../types';
import { db } from '../firebase';
import { doc, setDoc, deleteDoc, writeBatch, collection } from 'firebase/firestore';
import { 
  Play, 
  CheckCircle, 
  Truck, 
  CornerDownLeft, 
  Activity, 
  Layers, 
  RotateCcw, 
  AlertTriangle, 
  FileText, 
  HelpCircle, 
  Check, 
  Barcode, 
  X, 
  CornerUpLeft, 
  ArrowRight,
  ShieldAlert,
  Archive,
  Zap,
  Layers3
} from 'lucide-react';

interface Props {
  records: InventoryRecord[];
  trips: Trip[];
  palletTypes: PalletType[];
  users: UserCredentials[];
  currentUser: UserCredentials;
  distributionTrips?: DistributionTrip[];
  onNotify?: (title: string, msg: string) => void;
}

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const Lab: React.FC<Props> = ({ records, trips, palletTypes, users, currentUser, distributionTrips = [], onNotify }) => {
  // تصفية السجلات والرحلات الخاصة بالمختبر فقط
  // نعتبر أي رحلة تبدأ بـ "TEST_" أو كود باركود يحتوي على رمز الاختبار هي بيانات مختبر
  const testTrips = useMemo(() => trips.filter(t => (t.id && t.id.startsWith('TEST_')) || (t.tripNumber && t.tripNumber.startsWith('LAB'))), [trips]);
  const testRecords = useMemo(() => records.filter(r => (r.id && r.id.startsWith('TEST_')) || (r.tripId && r.tripId.startsWith('TEST_'))), [records]);
  const testDistTrips = useMemo(() => distributionTrips.filter(t => (t.id && t.id.startsWith('TEST_')) || (t.tripNumber && t.tripNumber.startsWith('LABD'))), [distributionTrips]);

  // محرك احتساب الإحصائيات الدقيقة للمختبر (محاكي الواقع)
  const stats = useMemo(() => {
    let totalPallets = testRecords.length;
    let pendingPallets = testRecords.filter(r => r.status === 'pending').length;
    let transitPallets = testRecords.filter(r => r.status === 'in_transit').length;
    let receivedPallets = testRecords.filter(r => r.status === 'received').length;

    let totalShippedCartons = 0;
    let totalShippedBundles = 0;

    let totalReceivedCartons = 0;
    let totalReceivedBundles = 0;

    let totalShortageCartons = 0;
    let totalShortageBundles = 0;

    let totalExcessCartons = 0;
    let totalExcessBundles = 0;

    let totalExternalDamage = 0;
    let totalInternalDamage = 0;
    
    let wrongDestinationCount = testRecords.filter(r => r.isWrongDestination).length;

    testRecords.forEach(r => {
      const type = palletTypes.find(t => t.id === r.palletTypeId);
      if (!type) return;

      const baseCartons = r.isExtraOnly ? 0 : type.cartonsPerPallet;
      const extraC = r.extraCartons || 0;
      const shippedC = baseCartons + extraC;
      const shippedB = shippedC * type.bundlesPerCarton;

      totalShippedCartons += shippedC;
      totalShippedBundles += shippedB;

      if (r.status === 'received') {
        let rc = shippedC;
        let rb = shippedB;

        if (r.hasDiscrepancy) {
          if (r.discrepancyType === 'shortage') {
            const sc = r.discrepancyCartonsQty || 0;
            const sb = r.discrepancyBundlesQty || 0;
            totalShortageCartons += sc;
            totalShortageBundles += sb;
            rc = Math.max(0, rc - sc);
            rb = Math.max(0, rb - sb);
          } else if (r.discrepancyType === 'excess') {
            const ec = r.discrepancyCartonsQty || 0;
            const eb = r.discrepancyBundlesQty || 0;
            totalExcessCartons += ec;
            totalExcessBundles += eb;
            rc += ec;
            rb += eb;
          }
        }

        totalReceivedCartons += rc;
        totalReceivedBundles += rb;

        totalExternalDamage += r.externalDamageQty || 0;
        totalInternalDamage += r.internalDamageQty || 0;
      }
    });

    // إحصائيات رحلات التوزيع التجريبية بالمدارس
    const totalDistTripsCount = testDistTrips.length;
    const plannedDistTripsCount = testDistTrips.filter(t => t.status === 'planned').length;
    const dispatchedDistTripsCount = testDistTrips.filter(t => t.status === 'dispatched').length;
    const executedDistTripsCount = testDistTrips.filter(t => t.status === 'executed').length;

    let totalDistShortageCartons = 0;
    testDistTrips.forEach(t => {
      if (t.status === 'executed' && t.executedQuantities) {
        t.quantities.forEach(planned => {
          const actual = t.executedQuantities?.find(ex => ex.palletTypeId === planned.palletTypeId);
          if (actual && actual.cartonCount < planned.cartonCount) {
            totalDistShortageCartons += (planned.cartonCount - actual.cartonCount);
          }
        });
      }
    });

    return {
      totalPallets,
      pendingPallets,
      transitPallets,
      receivedPallets,
      totalShippedCartons,
      totalShippedBundles,
      totalReceivedCartons,
      totalReceivedBundles,
      totalShortageCartons,
      totalShortageBundles,
      totalExcessCartons,
      totalExcessBundles,
      totalExternalDamage,
      totalInternalDamage,
      wrongDestinationCount,
      // رحلات التوزيع
      totalDistTripsCount,
      plannedDistTripsCount,
      dispatchedDistTripsCount,
      executedDistTripsCount,
      totalDistShortageCartons
    };
  }, [testRecords, testDistTrips, palletTypes]);

  // مدخلات تصميم الطبلية والرحلة
  const [selectedPress, setSelectedPress] = useState<PressCode>('OPK');
  const [selectedCenter, setSelectedCenter] = useState<CenterCode>('DMM');
  const [selectedType, setSelectedType] = useState<string>('g01'); // الصف الأول الابتدائي ديفولت
  const [palletQty, setPalletQty] = useState<number>(3);
  const [extraCartons, setExtraCartons] = useState<number>(0);
  const [semester, setSemester] = useState<string>('1');
  const [year, setYear] = useState<string>('2026');

  // المعاملات النشطة في المختبر التجريبي
  const [activeTestTripId, setActiveTestTripId] = useState<string>('');
  const [scanningBarcode, setScanningBarcode] = useState<string>('');
  
  // شروط وتفاصيل الاستلام التجريبي
  const [receivingCondition, setReceivingCondition] = useState<PalletCondition>('intact');
  const [externalDamage, setExternalDamage] = useState<number>(0);
  const [internalDamage, setInternalDamage] = useState<number>(0);
  const [hasDiscrepancy, setHasDiscrepancy] = useState<boolean>(false);
  const [discrepancyType, setDiscrepancyType] = useState<'shortage' | 'excess'>('shortage');
  const [discrepancyCartons, setDiscrepancyCartons] = useState<number>(0);
  const [discrepancyBundles, setDiscrepancyBundles] = useState<number>(0);
  const [receivingCenter, setReceivingCenter] = useState<CenterCode>('DMM'); 
  const [notes, setNotes] = useState<string>('استلام تجريبي داخل المختبر');

  // استعراض تفاصيل اللصيقة الممسوحة أو المختارة
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<InventoryRecord | null>(null);

  // -----------------------------------------------------
  // محاكاة رحلات التوزيع الفرعية (المركز ➔ المدارس والجهات الفرعية)
  // -----------------------------------------------------
  const [labSubTab, setLabSubTab] = useState<'pallets' | 'distribution'>('pallets');
  const [distOriginCenter, setDistOriginCenter] = useState<CenterCode>('DMM');
  const [distDestinationCity, setDistDestinationCity] = useState<string>('مدرسة الملك فهد - الدمام');
  const [distQuantities, setDistQuantities] = useState<Record<string, { cartons: number; bundles: number }>>({});
  const [selectedDistTripForDetail, setSelectedDistTripForDetail] = useState<DistributionTrip | null>(null);
  const [executedQuantities, setExecutedQuantities] = useState<Record<string, { cartons: number; bundles: number }>>({});

  const handleCreateDistTrip = async () => {
    const testId = `TEST_${generateUUID().substring(0, 8)}`;
    const tripNum = `LABD${Math.floor(10000 + Math.random() * 90000)}`;

    const quantities = palletTypes.map(t => {
      const q = distQuantities[t.id] || { cartons: 0, bundles: 0 };
      return {
        palletTypeId: t.id,
        cartonCount: q.cartons || 0,
        bundleCount: q.bundles || 0,
      };
    }).filter(q => q.cartonCount > 0 || q.bundleCount > 0);

    // إذا لم يحددوا كميات، فلنضع كمية افتراضية للمرحلة المفتوحة الأولى لتسهيل التجربة
    let finalQuantities = quantities;
    if (finalQuantities.length === 0 && palletTypes.length > 0) {
      finalQuantities = [{
        palletTypeId: palletTypes[0].id,
        cartonCount: 20,
        bundleCount: 20 * palletTypes[0].bundlesPerCarton
      }];
    }

    const newTrip: DistributionTrip = {
      id: testId,
      tripNumber: tripNum,
      date: new Date().toISOString().split('T')[0],
      originCenter: distOriginCenter,
      destinationCity: distDestinationCity,
      quantities: finalQuantities,
      status: 'planned'
    };

    try {
      await setDoc(doc(db, 'distributionTrips', testId), newTrip);
      setSelectedDistTripForDetail(newTrip);
      
      const initExecuted: Record<string, { cartons: number; bundles: number }> = {};
      finalQuantities.forEach(q => {
        initExecuted[q.palletTypeId] = {
          cartons: q.cartonCount,
          bundles: q.bundleCount
        };
      });
      setExecutedQuantities(initExecuted);

      if (onNotify) {
        onNotify('🚚 تم بناء رحلة توزيع فرعية', `تم إنشاء رحلة التوزيع رقم ${tripNum} بنجاح كمسودة.`);
      }
    } catch (error: any) {
      console.error('Failed to create dist trip:', error);
      if (onNotify) onNotify('❌ خطأ', `فشل في إنشاء رحلة التوزيع: ${error.message}`);
    }
  };

  const handleDispatchDistTrip = async (trip: DistributionTrip) => {
    try {
      await setDoc(doc(db, 'distributionTrips', trip.id), { status: 'dispatched' }, { merge: true });
      setSelectedDistTripForDetail({ ...trip, status: 'dispatched' });
      if (onNotify) {
        onNotify('🚚 تم التصدير والشحن الفرعي', `الرحلة الفرعية ${trip.tripNumber} غادرت المركز ومتجهة لـ ${trip.destinationCity}.`);
      }
    } catch (error: any) {
      console.error('Failed to dispatch dist trip:', error);
    }
  };

  const handleExecuteDistTrip = async (trip: DistributionTrip) => {
    const executedList = trip.quantities.map(q => {
      const exec = executedQuantities[q.palletTypeId] || { cartons: q.cartonCount, bundles: q.bundleCount };
      return {
        palletTypeId: q.palletTypeId,
        cartonCount: exec.cartons,
        bundleCount: exec.bundles
      };
    });

    try {
      const updates = {
        status: 'executed' as const,
        executedDate: new Date().toISOString().split('T')[0],
        executedQuantities: executedList
      };
      await setDoc(doc(db, 'distributionTrips', trip.id), updates, { merge: true });
      setSelectedDistTripForDetail({ ...trip, ...updates });
      if (onNotify) {
        onNotify('✅ تم التوصيل والتنفيذ الفني', `تم إنهاء توثيق التوصيل لـ ${trip.destinationCity} ومقارنة الكميات المخططة والمنفذة.`);
      }
    } catch (error: any) {
      console.error('Failed to execute dist trip:', error);
    }
  };

  const activeTrip = useMemo(() => {
    return trips.find(t => t.id === activeTestTripId) || testTrips[0] || null;
  }, [activeTestTripId, testTrips, trips]);

  const activeTripRecords = useMemo(() => {
    if (!activeTrip) return [];
    return testRecords.filter(r => r.tripId === activeTrip.id);
  }, [activeTrip, testRecords]);

  // مراكز التوزيع والمطابع المتاحة
  const pressUsers = useMemo(() => users.filter(u => u.role === 'factory'), [users]);
  const centerUsers = useMemo(() => users.filter(u => u.role === 'center'), [users]);

  // 1. توليد الرحلة التجريبية والملصقات
  const handleGenerateTestTrip = async () => {
    const testId = `TEST_${generateUUID().substring(0, 8)}`;
    const tripNum = `LAB${Math.floor(1000 + Math.random() * 9000)}`;
    const tripBarcode = `${selectedPress}${selectedCenter}${tripNum}`;

    const newTrip: Trip = {
      id: testId,
      tripNumber: tripNum,
      tripBarcode: tripBarcode,
      pressCode: selectedPress,
      centerCode: selectedCenter,
      startDate: Date.now(),
      status: 'active'
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'trips', testId), newTrip);

      // تحديد تسلسل وهمي لباركودات المختبر
      let currentSeq = Math.floor(10000 + Math.random() * 5000);
      const yearDigit = year.slice(-1);
      const pType = palletTypes.find(t => t.id === selectedType);

      for (let i = 0; i < palletQty; i++) {
        const recordId = `TEST_${generateUUID()}`;
        const seqStr = currentSeq.toString();
        const palletBarcode = `${pType?.stageCode || 'G01'}${selectedPress}${seqStr}${semester}${yearDigit}`;

        const record: InventoryRecord = {
          id: recordId,
          palletTypeId: selectedType,
          palletBarcode,
          tripId: testId,
          truckId: 'LAB-TRUCK-1',
          status: 'pending',
          timestamp: Date.now(),
          scannedBy: 'factory',
          destination: selectedCenter,
          extraCartons: i === 0 ? extraCartons : 0,
          missingCartons: 0,
          isExtraOnly: false,
          notes: 'طبلية مختبر تجريبية 🧪'
        };

        batch.set(doc(db, 'records', recordId), record);
        currentSeq++;
      }

      await batch.commit();
      setActiveTestTripId(testId);
      if (onNotify) {
        onNotify('🧪 تم إنشاء رحلة المختبر', `تم إنشاء الرحلة التجريبية ${tripNum} وتوليد ${palletQty} طبلية بنجاح.`);
      }
    } catch (error: any) {
      console.error('Failed to create test trip:', error);
      if (onNotify) onNotify('❌ خطأ', `فشل في إنشاء البيانات التجريبية: ${error.message}`);
    }
  };

  // 2. محاكاة تحميل وتصدير رحلة المختبر (جعلها في الطريق)
  const handleDispatchAll = async () => {
    if (activeTripRecords.length === 0) return;
    try {
      const batch = writeBatch(db);
      activeTripRecords.forEach(record => {
        if (record.status === 'pending') {
          batch.update(doc(db, 'records', record.id), {
            status: 'in_transit',
            factoryTimestamp: Date.now(),
            timestamp: Date.now()
          });
        }
      });
      await batch.commit();
      if (onNotify) {
        onNotify('🚚 تم الشحن والتصدير التجريبي', 'تم تحويل حالة جميع طبليات الرحلة إلى "في الطريق (In Transit)".');
      }
    } catch (error: any) {
      console.error('Failed to dispatch test items:', error);
    }
  };

  // 3. محاكاة استلام طبلية مفردة (سليمة / توجيه خاطئ / نقص / زيادة / تالفة)
  const handleSimulateReceive = async (record: InventoryRecord) => {
    const isWrongDestination = record.destination.trim().toUpperCase() !== receivingCenter.trim().toUpperCase();
    
    // إعداد الملاحظات المدمجة والتفاصيل تلقائياً
    const extraNotes = [
      notes,
      record.status === 'pending' ? '[تم الاستلام دون الخروج من المطبعة التجريبية]' : '',
      isWrongDestination ? `[توجيه خاطئ: تم استلامها بالخطأ في ${receivingCenter} بينما وجهتها الأساسية هى ${record.destination}]` : ''
    ].filter(Boolean).join(' ');

    const updates: Partial<InventoryRecord> = {
      status: 'received',
      timestamp: Date.now(),
      centerTimestamp: Date.now(),
      scannedBy: 'center',
      isWrongDestination: isWrongDestination,
      receivedByCenter: receivingCenter,
      receivedByUsername: `فاحص تجريبي (${receivingCenter})`,
      condition: receivingCondition,
      externalDamageQty: receivingCondition !== 'intact' ? externalDamage : 0,
      internalDamageQty: receivingCondition !== 'intact' ? internalDamage : 0,
      notes: extraNotes,
      hasDiscrepancy: hasDiscrepancy,
      discrepancyType: hasDiscrepancy ? discrepancyType : undefined,
      discrepancyCartonsQty: hasDiscrepancy ? discrepancyCartons : 0,
      discrepancyBundlesQty: hasDiscrepancy ? discrepancyBundles : 0
    };

    // إزالة قيم undefined لتفادي أخطاء قاعدة بيانات Firestore
    Object.keys(updates).forEach(key => {
      if ((updates as any)[key] === undefined) {
        delete (updates as any)[key];
      }
    });

    try {
      await setDoc(doc(db, 'records', record.id), updates, { merge: true });
      setSelectedRecordForDetail({ ...record, ...updates });
      if (onNotify) {
        onNotify('📥 استلام تجريبي موثق', `تم استلام الطبلية (${record.palletBarcode}) في مركز (${receivingCenter}) بنجاح.`);
      }
    } catch (error: any) {
      console.error('Failed to receive test pallet:', error);
      if (onNotify) onNotify('❌ خطأ في الاستلام', error.message);
    }
  };

  // 4. تصفية وحذف كافة رحلات وسجلات المختبر
  const handleClearAllTestData = async () => {
    try {
      const batch = writeBatch(db);
      testRecords.forEach(r => batch.delete(doc(db, 'records', r.id)));
      testTrips.forEach(t => batch.delete(doc(db, 'trips', t.id)));
      testDistTrips.forEach(d => batch.delete(doc(db, 'distributionTrips', d.id)));
      await batch.commit();
      setActiveTestTripId('');
      setSelectedRecordForDetail(null);
      setSelectedDistTripForDetail(null);
      if (onNotify) {
        onNotify('🧹 تم تنظيف المختبر', 'تم مسح كافة سجلات ورحلات السجل التجريبي والمخازن والتحويلات دون التأثير على بيانات الإنتاج.');
      }
    } catch (error: any) {
      console.error('Failed to clear test data:', error);
    }
  };

  const getStatusBadge = (status: PalletStatus) => {
    switch (status) {
      case 'pending': return <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black">جاهز للتحميل 📥</span>;
      case 'in_transit': return <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-black">في الطريق 🚚</span>;
      case 'received': return <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black">مستلمة ✓</span>;
      case 'cancelled': return <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-black">ملغاة ❌</span>;
      default: return <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">غير معروف</span>;
    }
  };

  const currentTypeMeta = useMemo(() => {
    return palletTypes.find(t => t.id === selectedType);
  }, [selectedType, palletTypes]);

  // محاكاة المسح الضوئي التجريبي
  const handlePerformScanInput = () => {
    const formattedCode = scanningBarcode.trim().toUpperCase();
    const found = testRecords.find(r => r.palletBarcode === formattedCode);
    if (found) {
      setSelectedRecordForDetail(found);
      setScanningBarcode('');
      if (onNotify) onNotify('🔍 تم التعرف على الكود', `تم جلب الطبلية ${formattedCode} بنجاح. يمكنك استلامها أو نقلها الآن.`);
    } else {
      if (onNotify) onNotify('⚠️ كود غير موجود في المختبر', `الباركود ${formattedCode} غير مدرج في سجل البارامترات التجريبية للمختبر.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* رأس المختبر والتنبيهات المبدئية */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-700 text-white p-6 rounded-[2.5rem] shadow-xl space-y-3 relative overflow-hidden">
        <div className="absolute top-0 left-0 translate-x-[-20%] translate-y-[-20%] opacity-15">
          <Activity size={240} />
        </div>
        <div className="relative flex justify-between items-start">
          <div className="space-y-1">
            <span className="text-[10px] bg-violet-500 text-white px-3 py-1 rounded-full font-black tracking-widest uppercase">LAB & PLAYGROUND</span>
            <h2 className="text-xl font-black">🧪 مختبر العمليات التجريبية الذكي</h2>
            <p className="text-xs text-violet-100 max-w-lg leading-relaxed font-medium">
              مرحبًا بك في بيئة المحاكاة الآمنة. صُمم هذا القسم لتمكينك من تجريب ومراقبة دورة حياة الطبليات كاملة — من لحظة طباعة الملصق، مروراً بـ "التصدير وشحن الشاحنات"، وانتهاءً بـ "الاستلام في المراكز"، مع رصد حالات التوجيه الخاطئ، التلفيات، والنقص والزيادة دون المساس بالإحصائيات الحقيقية للنظام.
            </p>
          </div>
          {(testTrips.length > 0 || testDistTrips.length > 0) && (
            <button 
              onClick={handleClearAllTestData}
              className="bg-rose-500/20 hover:bg-rose-500 hover:text-white text-rose-200 border border-rose-500/30 px-4 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-1"
            >
              <RotateCcw size={14} />
              حذف بيانات المختبر ({testTrips.length + testDistTrips.length} رحلة)
            </button>
          )}
        </div>
      </div>

      {/* شريط الاختيار الفرعي للمحاكاة */}
      <div className="flex bg-slate-150 p-1.5 rounded-2xl w-full max-w-2xl mx-auto border border-slate-200">
        <button
          onClick={() => setLabSubTab('pallets')}
          className={`flex-1 py-3 px-4 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 ${labSubTab === 'pallets' ? 'bg-white text-indigo-900 shadow-md border border-indigo-50/50' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <Layers3 size={14} />
          📦 محاكاة الاستلام وسلسلة الإمداد للطبليات (مطبعة ➔ مركز)
        </button>
        <button
          onClick={() => setLabSubTab('distribution')}
          className={`flex-1 py-3 px-4 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 ${labSubTab === 'distribution' ? 'bg-white text-indigo-900 shadow-md border border-indigo-50/50' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <Truck size={14} />
          🚚 محاكاة رحلات التوزيع الفرعية ومطابقة التسليم (مركز ➔ مدارس)
        </button>
      </div>

      {labSubTab === 'pallets' ? (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* العمود الأول: إعداد وإنشاء الملصقات والرحلة (المطابع) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-5">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">1</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 1: طباعة الملصقات وتوليد الرحلة</h3>
              <p className="text-[10px] text-slate-400">محاكاة تصرف "المطابع" عند الإنشاء</p>
            </div>
          </div>

          <div className="space-y-3">
            {/* المطبعة ومركز التوحيد */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">المطبعة المصنعة</label>
                <select 
                  className="w-full bg-slate-50 text-slate-800 font-bold p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={selectedPress}
                  onChange={(e) => setSelectedPress(e.target.value)}
                >
                  {pressUsers.map(p => (
                    <option key={p.id} value={p.code}>{p.displayName}</option>
                  ))}
                  {pressUsers.length === 0 && (
                    <>
                      <option value="OPK">مطبعة العبيكان (OPK)</option>
                      <option value="UNI">المطبعة المتحدة (UNI)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">المركز الموجه إليه (الرسمي)</label>
                <select 
                  className="w-full bg-slate-50 text-slate-800 font-bold p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  value={selectedCenter}
                  onChange={(e) => setSelectedCenter(e.target.value)}
                >
                  {centerUsers.map(c => (
                    <option key={c.id} value={c.code}>{c.displayName}</option>
                  ))}
                  {centerUsers.length === 0 && (
                    <>
                      <option value="DMM">مركز الدمام (DMM)</option>
                      <option value="RYD">مركز الرياض (RYD)</option>
                      <option value="JED">مركز جدة (JED)</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* تفاصيل وحمولة الطبلية */}
            <div>
              <label className="text-[10px] font-black text-slate-500 block mb-1">نوع ومحتوى الطبلية (المرحلة الدراسية)</label>
              <select 
                className="w-full bg-slate-50 text-slate-800 font-bold p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
              >
                {palletTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.stageName} ({t.stageCode})</option>
                ))}
              </select>
              {currentTypeMeta && (
                <span className="text-[9px] text-slate-400 block mt-1">
                  💡 الكود: {currentTypeMeta.stageCode} | الحمولة الأساسية: {currentTypeMeta.cartonsPerPallet} كرتون / {currentTypeMeta.bundlesPerCarton * currentTypeMeta.cartonsPerPallet} حزمة
                </span>
              )}
            </div>

            {/* الأعداد والتوليد الوفير */}
            <div className="grid grid-cols-2 gap-3 pb-2">
              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">عدد الطبليات المطلوبة</label>
                <input 
                  type="number" 
                  min="1" 
                  max="50"
                  className="w-full bg-slate-50 p-2 text-center text-xs font-black text-indigo-700 rounded-xl border border-slate-200"
                  value={palletQty}
                  onChange={(e) => setPalletQty(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">كراتين إضافية (مرفقة)</label>
                <input 
                  type="number" 
                  min="0"
                  className="w-full bg-slate-50 p-2 text-center text-xs font-black text-indigo-700 rounded-xl border border-slate-200"
                  value={extraCartons}
                  onChange={(e) => setExtraCartons(Math.max(0, parseInt(e.target.value) || 0))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pb-3">
              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">الفصل الدراسي</label>
                <select 
                  className="w-full bg-slate-50 text-xs font-bold p-2 rounded-xl border border-slate-200"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                >
                  <option value="1">الفصل الأول (1)</option>
                  <option value="2">الفصل الثاني (2)</option>
                  <option value="3">الفصل الثالث (3)</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 block mb-1">السنة الدراسية</label>
                <select 
                  className="w-full bg-slate-50 text-xs font-bold p-2 rounded-xl border border-slate-200"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                >
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                </select>
              </div>
            </div>

            <button 
              onClick={handleGenerateTestTrip}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-100"
            >
              <Zap size={14} />
              1. إنشاء الرحلة والملصقات تجريبياً
            </button>
          </div>

          {/* تحديد وعرض الرحلة المختارة للتحكم */}
          {testTrips.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <label className="text-[10px] font-black text-slate-500 block mb-1">اختر رحلة المختبر النشطة للتحكم بها</label>
              <select 
                value={activeTestTripId}
                onChange={(e) => setActiveTestTripId(e.target.value)}
                className="w-full bg-slate-100 font-black text-xs p-2.5 rounded-xl text-indigo-900 border border-indigo-200"
              >
                <option value="">-- اختر رحلة لمتابعتها --</option>
                {testTrips.map(t => (
                  <option key={t.id} value={t.id}>
                    الرحلة {t.tripNumber} ({users.find(u => u.code === t.pressCode)?.displayName || t.pressCode} ➔ {users.find(u => u.code === t.centerCode)?.displayName || t.centerCode})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* العمود الثاني: محاكاة الشحن ونقل الشاحنات */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">2</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 2: الشحن ومغادرة المطبعة</h3>
              <p className="text-[10px] text-slate-400">تحويل اللصيقات إلى حالة "في الطريق (In Transit)"</p>
            </div>
          </div>

          {!activeTrip ? (
            <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl p-4">
              <Truck className="w-12 h-12 text-slate-200 mb-2 animate-bounce" />
              <p className="font-bold text-xs">لا توجد رحلة تجريبية نشطة حالياً</p>
              <p className="text-[10px]">قم بتوليد ملصقات جديدة من القسم الأول للبدء في حركة التصدير والشحن التجريبية.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-indigo-50/70 p-4 rounded-2xl border border-indigo-100 text-right space-y-1">
                <span className="text-[8px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded-full font-bold">معلومات الرحلة المختارة</span>
                <div className="flex justify-between items-center text-xs font-black text-indigo-900">
                  <span>رحلة اختبارية: {activeTrip.tripNumber}</span>
                  <span>الرمز: {activeTrip.tripBarcode}</span>
                </div>
                <div className="text-[9px] text-indigo-600 font-bold">
                  مركز الاستقبال المستهدف: {users.find(u => u.code === activeTrip.centerCode)?.locationName || activeTrip.centerCode}
                </div>
              </div>

              {/* قائمة الحركات / الطلبيات داخل الرحلة */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-500">طبليات الرحلة ({activeTripRecords.length} طبليات)</span>
                  <button 
                    onClick={handleDispatchAll}
                    disabled={!activeTripRecords.some(r => r.status === 'pending')}
                    className="text-[10px] bg-indigo-100 text-indigo-700 disabled:opacity-40 font-black px-3 py-1 rounded-lg hover:bg-indigo-200 transition-all flex items-center gap-1"
                  >
                    🚀 شحن الكل في الطريق
                  </button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1.5 border p-2 rounded-xl bg-slate-50/50">
                  {activeTripRecords.length === 0 ? (
                    <p className="text-[10px] text-slate-400 text-center py-4">لم يتم توليد طبليات لهذه الرحلة بعد.</p>
                  ) : (
                    activeTripRecords.map(record => (
                      <div 
                        key={record.id}
                        onClick={() => setSelectedRecordForDetail(record)}
                        className={`p-2 rounded-xl text-right cursor-pointer border transition-all text-xs flex justify-between items-center ${selectedRecordForDetail?.id === record.id ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-100' : 'bg-white hover:bg-slate-50 border-slate-100'}`}
                      >
                        <div className="space-y-0.5">
                          <div className="font-extrabold text-slate-800">{record.palletBarcode}</div>
                          <div className="text-[9px] text-slate-400 flex items-center gap-1">
                            <span>{palletTypes.find(t => t.id === record.palletTypeId)?.stageName || record.palletTypeId}</span>
                            {record.extraCartons ? <span className="text-indigo-600 font-bold">(+{record.extraCartons} كرتون إضافي)</span> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(record.status)}
                          <ArrowRight size={12} className="text-slate-300" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* المسح اليدوي التجريبي */}
              <div className="border-t pt-3 space-y-2">
                <label className="text-[10px] font-black text-slate-500 block">قم بمحاكاة "قراءة الباركود" يدوياً</label>
                <div className="flex gap-2">
                  <input 
                    type="text"
                    placeholder="أدخل الباركود لمسحه ضوئيًا..."
                    className="flex-1 bg-slate-100 p-2 rounded-xl text-xs font-mono text-center focus:ring-2 focus:ring-indigo-600 text-slate-800 border-none"
                    value={scanningBarcode}
                    onChange={(e) => setScanningBarcode(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePerformScanInput()}
                  />
                  <button 
                    onClick={handlePerformScanInput}
                    className="bg-indigo-600 text-white p-2 rounded-xl hover:bg-indigo-700 transition"
                  >
                    <Check size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* العمود الثالث: استلام وفحص الطبلية (مراكز التوزيع) */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">3</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 3: فحص واستلام المركز</h3>
              <p className="text-[10px] text-slate-400">تجربة سيناريوهات الاستلام وتوثيقها</p>
            </div>
          </div>

          {!selectedRecordForDetail ? (
            <div className="h-80 flex flex-col items-center justify-center text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl p-4">
              <CheckCircle className="w-12 h-12 text-slate-200 mb-2 animate-pulse" />
              <p className="font-bold text-xs">لم يتم اختيار طبلية للفحص حالياً</p>
              <p className="text-[10px]">اضغط على أي طبلية من العمود الثاني أو قم بمسح باركود لبدء محاكاة عملية الفحص والاستلام التفصيلية.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* تفاصيل اللصيقة المحددة للفحص */}
              <div className="p-3 bg-slate-50 rounded-xl space-y-2 border text-right">
                <div className="flex justify-between items-center border-b pb-1.5">
                  <span className="text-[10px] font-extrabold text-indigo-700">📋 بطاقة فحص الطبلية</span>
                  <button onClick={() => setSelectedRecordForDetail(null)} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="text-xs space-y-1">
                  <div>الباركود: <strong className="font-mono text-indigo-900">{selectedRecordForDetail.palletBarcode}</strong></div>
                  <div>المرحلة: <strong>{palletTypes.find(t => t.id === selectedRecordForDetail.palletTypeId)?.stageName || selectedRecordForDetail.palletTypeId}</strong></div>
                  <div>الوجهة الأصلية المخططة: <strong className="text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">{users.find(u => u.code === selectedRecordForDetail.destination)?.displayName || selectedRecordForDetail.destination}</strong></div>
                  <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                    <span>الحالة الحالية: {getStatusBadge(selectedRecordForDetail.status)}</span>
                    {selectedRecordForDetail.extraCartons ? <span>الكراتين الزائدة: {selectedRecordForDetail.extraCartons}</span> : null}
                  </div>
                </div>
              </div>

              {/* إعدادات الاستلام والمحاكاة الذكية */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black text-slate-500">⚙️ خيارات ومؤشرات عملية الاستلام:</h4>

                {/* مركز الاستلام الفعلي */}
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1">المركز الذي يقوم بالاستلام الفعلي</label>
                  <select 
                    value={receivingCenter}
                    onChange={(e) => setReceivingCenter(e.target.value)}
                    className="w-full bg-slate-50 font-bold text-xs p-2 rounded-xl border border-slate-200 text-slate-800"
                  >
                    {centerUsers.map(c => (
                      <option key={c.id} value={c.code}>{c.displayName}</option>
                    ))}
                  </select>
                  {selectedRecordForDetail.destination.trim().toUpperCase() !== receivingCenter.trim().toUpperCase() && (
                    <div className="text-[10px] bg-rose-50 text-rose-600 p-2 rounded-lg mt-1 border border-rose-100 font-extrabold flex items-center gap-1">
                      <AlertTriangle size={12} />
                      تنبيه: المركز المستلم يختلف عن الوجهة! سيتم تسجيل الشحنة تـحت بند (توجيه خاطئ).
                    </div>
                  )}
                </div>

                {/* حالة وصلاحية الشحنة (معيب / سليم) */}
                <div>
                  <label className="text-[10px] font-black text-slate-500 block mb-1">حالة الطبلية والكراتين</label>
                  <select 
                    value={receivingCondition}
                    onChange={(e) => setReceivingCondition(e.target.value as PalletCondition)}
                    className="w-full bg-slate-50 font-bold text-xs p-2 rounded-xl border border-slate-200 text-slate-800"
                  >
                    <option value="intact">سليمة بالكامل (Intact)</option>
                    <option value="external_box_damage">تلف كراتين خارجي (External Damage)</option>
                    <option value="internal_content_damage">تلف كراتين داخلي (Internal Damage)</option>
                    <option value="both">تلف خارجي وداخلي معاً</option>
                    <option value="damaged">طبلية تالفة بالكامل (Damaged)</option>
                  </select>
                </div>

                {receivingCondition !== 'intact' && (
                  <div className="grid grid-cols-2 gap-3 bg-rose-50/50 p-2 border border-rose-100 rounded-xl">
                    <div>
                      <label className="text-[10px] font-bold text-rose-700 block mb-1">عدد التلفيات الخارجي</label>
                      <input 
                        type="number" 
                        min="0"
                        className="w-full bg-white p-1 text-center text-xs font-black text-rose-700 rounded-lg border border-rose-200"
                        value={externalDamage}
                        onChange={(e) => setExternalDamage(Math.max(0, parseInt(e.target.value) || 0))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-rose-700 block mb-1">عدد التلفيات الداخلي</label>
                      <input 
                        type="number" 
                        min="0"
                        className="w-full bg-white p-1 text-center text-xs font-black text-rose-700 rounded-lg border border-rose-200"
                        value={internalDamage}
                        onChange={(e) => setInternalDamage(Math.max(0, parseInt(e.target.value) || 0))}
                      />
                    </div>
                  </div>
                )}

                {/* النقص والزيادة الفورية */}
                <div className="border border-slate-100 p-2 rounded-xl bg-slate-50/50">
                  <label className="flex items-center gap-2 cursor-pointer pb-1.5 select-none">
                    <input 
                      type="checkbox" 
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" 
                      checked={hasDiscrepancy}
                      onChange={(e) => setHasDiscrepancy(e.target.checked)}
                    />
                    <span className="text-[10px] font-black text-slate-700">هل يوجد نقص أو زيادة غير متوقعة؟</span>
                  </label>

                  {hasDiscrepancy && (
                    <div className="space-y-2 mt-1 border-t pt-1.5">
                      <div className="flex justify-around items-center py-1">
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input 
                            type="radio" 
                            name="testDiscType" 
                            checked={discrepancyType === 'shortage'}
                            onChange={() => setDiscrepancyType('shortage')}
                          />
                          <span>نقص 📉</span>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input 
                            type="radio" 
                            name="testDiscType" 
                            checked={discrepancyType === 'excess'}
                            onChange={() => setDiscrepancyType('excess')}
                          />
                          <span>زيادة 📈</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] font-semibold text-slate-500 block mb-0.5">عدد الكراتين</label>
                          <input 
                            type="number" 
                            min="0"
                            className="w-full bg-white p-1 text-center text-xs font-black rounded-lg border"
                            value={discrepancyCartons}
                            onChange={(e) => setDiscrepancyCartons(Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-slate-500 block mb-0.5">عدد الحزم (Bundles)</label>
                          <input 
                            type="number" 
                            min="0"
                            className="w-full bg-white p-1 text-center text-xs font-black rounded-lg border"
                            value={discrepancyBundles}
                            onChange={(e) => setDiscrepancyBundles(Math.max(0, parseInt(e.target.value) || 0))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* زر التنفيذ والحفظ النهائي */}
                <button 
                  onClick={() => handleSimulateReceive(selectedRecordForDetail)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 rounded-xl transition-all flex items-center justify-center gap-1 shadow-lg shadow-emerald-100"
                >
                  <CheckCircle size={14} />
                  3. محاكاة وترحيل الاستلام 📥
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* العمود الأول: تخطيط وتصميم الرحلة */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">1</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 1: تخطيط وتصميم الرحلة</h3>
              <p className="text-[10px] text-slate-400">تحديد مركز البدء والوجهة الفرعية والمقررات</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 block mb-1">مركز الانطلاق الفعلي</label>
              <select 
                className="w-full bg-slate-50 text-slate-800 font-bold p-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                value={distOriginCenter}
                onChange={(e) => setDistOriginCenter(e.target.value)}
              >
                {centerUsers.map(c => (
                  <option key={c.id} value={c.code}>{c.displayName}</option>
                ))}
                {centerUsers.length === 0 && (
                  <>
                    <option value="DMM">مركز الدمام (DMM)</option>
                    <option value="RYD">مركز الرياض (RYD)</option>
                    <option value="JED">مركز جدة (JED)</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 block mb-1 font-bold">الوجهة الفرعية (مدرسة / مكتب تعليم / محافظة)</label>
              <input 
                type="text" 
                placeholder="مثال: مدرسة الملك فهد، مكتب تعليم الظهران..."
                className="w-full bg-slate-50 p-2.5 text-xs text-slate-800 font-bold rounded-xl border border-slate-200"
                value={distDestinationCity}
                onChange={(e) => setDistDestinationCity(e.target.value)}
              />
            </div>

            {/* إدخال الكميات المخصصة لكل نوع مقررات */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-700 block mt-2 border-b pb-1">📚 كميات التوزيع المخصصة للمقررات:</label>
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {palletTypes.map(t => {
                  const currentVal = distQuantities[t.id] || { cartons: 0, bundles: 0 };
                  return (
                    <div key={t.id} className="p-2 border rounded-xl bg-slate-50 flex items-center justify-between text-right gap-2">
                      <div className="flex-1">
                        <span className="text-[10px] font-black block text-slate-800">{t.stageName}</span>
                        <span className="text-[9px] text-slate-400 block">كود: {t.stageCode} | {t.bundlesPerCarton} حزمة لكل كرتون</span>
                      </div>
                      <div className="flex items-center gap-1.5 w-24">
                        <div className="flex-1">
                          <span className="text-[8px] text-slate-400 font-bold block text-center">كراتين</span>
                          <input 
                            type="number" 
                            min="0"
                            className="w-full bg-white p-1 text-center text-xs font-black text-indigo-700 rounded-lg border border-slate-200"
                            value={currentVal.cartons || ""}
                            placeholder="0"
                            onChange={(e) => {
                              const val = Math.max(0, parseInt(e.target.value) || 0);
                              setDistQuantities(prev => ({
                                ...prev,
                                [t.id]: {
                                  cartons: val,
                                  bundles: val * t.bundlesPerCarton
                                }
                              }));
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button 
              onClick={handleCreateDistTrip}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-100"
            >
              <Zap size={14} />
              بناء وإدراج مسار التوزيع الفرعي 🚚
            </button>
          </div>
        </div>

        {/* العمود الثاني: رحلات التوزيع التجريبية وإطلاق الشحنات */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">2</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 2: رحلات التوزيع بالمختبر</h3>
              <p className="text-[10px] text-slate-400">متابعة شحن الشاحنات ومغادرة النقاط الفرعية</p>
            </div>
          </div>

          {testDistTrips.length === 0 ? (
            <div className="h-72 flex flex-col items-center justify-center text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl p-4">
              <Truck className="w-12 h-12 text-slate-200 mb-2 animate-bounce" />
              <p className="font-bold text-xs text-slate-500">لا توجد رحلات توزيع تجريبية حالياً</p>
              <p className="text-[10px] text-slate-400 mt-1">حدد كشف الكميات بالعمود الأول وانقر فوق بناء وإدراج مسار التوزيع للبدء فورا.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <span className="text-[10px] font-black text-slate-500 block">رحلات التوزيع المسجلة ({testDistTrips.length})</span>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {testDistTrips.map(trip => {
                  const originInfo = users.find(u => u.code === trip.originCenter)?.locationName || trip.originCenter;
                  return (
                    <div 
                      key={trip.id}
                      onClick={() => {
                        setSelectedDistTripForDetail(trip);
                        const initExecuted: Record<string, { cartons: number; bundles: number }> = {};
                        trip.quantities.forEach(q => {
                          initExecuted[q.palletTypeId] = {
                            cartons: q.cartonCount,
                            bundles: q.bundleCount
                          };
                        });
                        setExecutedQuantities(initExecuted);
                      }}
                      className={`p-3.5 rounded-2xl cursor-pointer border text-right transition-all text-xs space-y-2 ${selectedDistTripForDetail?.id === trip.id ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-50' : 'bg-white hover:bg-slate-50 border-slate-150'}`}
                    >
                      <div className="flex justify-between items-center font-black">
                        <span className="text-indigo-950 text-xs font-black">شحنة {trip.tripNumber}</span>
                        {trip.status === 'planned' && <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-black">📝 مسودة</span>}
                        {trip.status === 'dispatched' && <span className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-black animate-pulse">🚚 في الطريق</span>}
                        {trip.status === 'executed' && <span className="text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-black font-extrabold text-xs">منفذة ومستلمة ✓</span>}
                      </div>
                      
                      <div className="space-y-1 text-[10px] text-slate-650 font-bold">
                        <div className="flex justify-between"><span>المركز المصدّر:</span> <span className="text-slate-800">{originInfo}</span></div>
                        <div className="flex justify-between"><span>الوجهة المدرسية:</span> <span className="text-indigo-700 font-black">{trip.destinationCity}</span></div>
                        <div className="flex justify-between pt-1 border-t border-dashed mt-1 md:text-[9px] text-slate-400 font-extrabold flex items-center justify-between">
                          <span>مقررات مضافة:</span>
                          <span className="text-indigo-850 font-black">{trip.quantities.length} صنف</span>
                        </div>
                      </div>

                      {trip.status === 'planned' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDispatchDistTrip(trip);
                          }}
                          className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-black text-[10px] py-1.5 rounded-xl transition flex items-center justify-center gap-1 shadow-md shadow-blue-100"
                        >
                          <Truck size={12} />
                          إطلاق الشاحنة وتصديرها 🚚
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* العمود الثالث: استلام المدرسة وتسجيل الفروقات والمطابقة */}
        <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">3</div>
            <div>
              <h3 className="font-black text-slate-800 text-sm">المحاكاة 3: التسليم والمطابقة الرقمية</h3>
              <p className="text-[10px] text-slate-400">مراجعة كشوف المقررات ومطابقة التوصيل الفعلي</p>
            </div>
          </div>

          {!selectedDistTripForDetail ? (
            <div className="h-80 flex flex-col items-center justify-center text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl p-4">
              <CheckCircle className="w-12 h-12 text-slate-200 mb-2 animate-pulse" />
              <p className="font-bold text-xs text-slate-500">اختر رحلة توزيع لبدء محاكاة الفحص</p>
              <p className="text-[10px] text-slate-400 mt-1">انقر على أي شحنة من العمود الأوسط لتعديل حمولات التسليم ورصد الفروقات المدرسية تلقائياً.</p>
            </div>
          ) : (
            <div className="space-y-4 text-right">
              <div className="bg-slate-50 border p-3 rounded-2xl space-y-1">
                <div className="flex justify-between items-center border-b pb-1.5">
                  <span className="text-xs font-black text-indigo-900">📦 بطاقة تشغيل تفصيلية {selectedDistTripForDetail.tripNumber}</span>
                  <button onClick={() => setSelectedDistTripForDetail(null)} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                </div>
                
                <div className="text-xs space-y-1 text-slate-600 font-bold">
                  <div>المرسل الأصلي: <strong>{users.find(u => u.code === selectedDistTripForDetail.originCenter)?.displayName || selectedDistTripForDetail.originCenter}</strong></div>
                  <div>الوجهة المستلمة: <strong className="text-indigo-805">{selectedDistTripForDetail.destinationCity}</strong></div>
                  <div>الحالة الحالية: 
                    {selectedDistTripForDetail.status === 'planned' && <span className="mr-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black">مخططة</span>}
                    {selectedDistTripForDetail.status === 'dispatched' && <span className="mr-1 text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-black">مغادرة في الطريق</span>}
                    {selectedDistTripForDetail.status === 'executed' && <span className="mr-1 text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded font-black font-extrabold text-xs">منفذة ومستلمة ✓</span>}
                  </div>
                </div>
              </div>

              <div className="space-y-3.5">
                <h4 className="text-[11px] font-black text-slate-500 border-b pb-1">📊 المقررات الصادرة والحمولات الفعلية:</h4>
                
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedDistTripForDetail.quantities.map(q => {
                    const t = palletTypes.find(type => type.id === q.palletTypeId);
                    const currentExec = executedQuantities[q.palletTypeId] || { cartons: q.cartonCount, bundles: q.bundleCount };
                    const hasDiff = currentExec.cartons !== q.cartonCount;

                    return (
                      <div key={q.palletTypeId} className="p-3 border rounded-xl bg-slate-50/50 space-y-2 text-right">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-extrabold text-slate-850">{t?.stageName || q.palletTypeId}</span>
                          <span className="text-[9px] text-slate-400 font-bold">المخطط: {q.cartonCount} كرتون</span>
                        </div>

                        {selectedDistTripForDetail.status === 'dispatched' ? (
                          <div className="grid grid-cols-2 gap-2 bg-white p-2 border rounded-xl shadow-inner">
                            <div>
                              <label className="text-[8px] text-slate-400 block mb-0.5 font-bold">الكراتين المستلمة فعلياً</label>
                              <input 
                                type="number" 
                                min="0"
                                className="w-full bg-slate-50 p-1 text-center font-black text-xs text-indigo-700 rounded-lg"
                                value={currentExec.cartons}
                                onChange={(e) => {
                                  const val = Math.max(0, parseInt(e.target.value) || 0);
                                  setExecutedQuantities(prev => ({
                                    ...prev,
                                    [q.palletTypeId]: {
                                      cartons: val,
                                      bundles: val * (t?.bundlesPerCarton || 20)
                                    }
                                  }));
                                }}
                              />
                            </div>
                            <div className="flex flex-col justify-end">
                              <span className="text-[8px] text-slate-400 block mb-0.5 font-bold">الحزم الناتجة تلقائياً</span>
                              <span className="text-xs font-black text-indigo-900 border bg-slate-100/50 rounded-lg p-1 text-center h-8 flex items-center justify-center">
                                {currentExec.bundles}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-[10px] space-y-1 font-bold">
                            <div className="flex justify-between">
                              <span>الكمية المنفذة المستلمة:</span>
                              <span className={hasDiff ? "text-amber-600 font-black text-xs" : "text-emerald-600 font-black text-xs"}>
                                {selectedDistTripForDetail.executedQuantities?.find(ex => ex.palletTypeId === q.palletTypeId)?.cartonCount ?? q.cartonCount} كرتون
                              </span>
                            </div>
                            {hasDiff && (
                              <div className="text-[9px] bg-amber-50 text-amber-700 p-1 border border-amber-100 rounded flex items-center justify-between">
                                <span>عجز / فوارق التوصيل:</span>
                                <span>
                                  {((selectedDistTripForDetail.executedQuantities?.find(ex => ex.palletTypeId === q.palletTypeId)?.cartonCount ?? q.cartonCount) - q.cartonCount)} كرتون
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedDistTripForDetail.status === 'planned' && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-2xl text-[10px] font-bold text-center leading-relaxed">
                    🚀 يرجى شحن مغادرة الشاحنة من العمود الأوسط أولاً لتتمكن من تدوين كشف كميات وفروق التفريغ والوصول النهائي بالمدارس!
                  </div>
                )}

                {selectedDistTripForDetail.status === 'dispatched' && (
                  <button
                    onClick={() => handleExecuteDistTrip(selectedDistTripForDetail)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-1 shadow-lg shadow-emerald-50"
                  >
                    <CheckCircle size={14} />
                    تأكيد وتسجيل الاستلام بالمدارس ✅
                  </button>
                )}

                {selectedDistTripForDetail.status === 'executed' && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3.5 rounded-2xl text-[10px] font-bold text-center leading-relaxed space-y-1">
                    <p>✓ تم تنفيذ هذه الرحلة وتسجيلها بقاعدة البيانات التجريبية بنجاح.</p>
                    <p className="text-[9px] text-slate-500 font-medium">متاحة الآن للمطابقة في شاشة Reconciliation Comparison!</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* تقرير التدقيق الفوري ومحاكاة السجلات (Audit Report Panel) */}
      <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl space-y-6">
        <div className="flex justify-between items-center border-b pb-3">
          <div className="flex items-center gap-2">
            <Activity className="text-violet-600 animate-pulse" size={18} />
            <h3 className="font-black text-slate-800 text-sm">🕵️ لوحة التدقيق الفنية وإحصائيات المطابقة والمحاكاة الذكية</h3>
          </div>
          <span className="text-[10px] bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full font-black">نمط المحاكاة الفعال</span>
        </div>

        {(testRecords.length === 0 && testDistTrips.length === 0) ? (
          <div className="py-12 text-center text-slate-400 text-xs border-2 border-dashed border-slate-100 rounded-3xl">
            <Layers className="w-12 h-12 text-slate-200 mx-auto mb-2 animate-pulse" />
            <p className="font-extrabold text-slate-500">لا توجد سجلات أو رحلات للتوزيع تجريبية حاليًا</p>
            <p className="text-[10px] text-slate-400 mt-1">تولى إنشاء أو تنشيط كائنات المعمل وضخ بيانات التوزيع من الأشرطة العلوية لبدء تحليل المؤشرات الفنية والنسب الرياضية.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* المستوى الأول: بطاقات الحسابات الرياضية التفصيلية */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* بطاقة 1: الطبليات بالتفصيل */}
              <div className="p-4 bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 rounded-2xl border border-indigo-100/80 text-right space-y-2">
                <span className="text-[9px] font-black text-indigo-600 block">📦 حركة الطبليات المعملية</span>
                <span className="text-3xl font-black text-indigo-900 block">{stats.totalPallets} <span className="text-xs font-medium text-slate-400">طبلية</span></span>
                <div className="text-[10px] space-y-1 text-slate-600 font-bold border-t pt-2">
                  <div className="flex justify-between"><span>بانتظار التحميل:</span> <span className="text-amber-600">{stats.pendingPallets}</span></div>
                  <div className="flex justify-between"><span>في الطريق:</span> <span className="text-blue-600">{stats.transitPallets}</span></div>
                  <div className="flex justify-between"><span>مستلمة ومرحلة:</span> <span className="text-emerald-600">{stats.receivedPallets}</span></div>
                </div>
              </div>

              {/* بطاقة 5: رحلات التوزيع الفرعية للشحنات والمدارس */}
              <div className="p-4 bg-gradient-to-br from-violet-50/50 to-violet-100/30 rounded-2xl border border-violet-100/80 text-right space-y-2">
                <span className="text-[9px] font-black text-violet-600 block">🚚 رحلات التوزيع الفرعية</span>
                <span className="text-3xl font-black text-violet-900 block">{stats.totalDistTripsCount} <span className="text-xs font-medium text-slate-400">رحلة</span></span>
                <div className="text-[10px] space-y-1 text-slate-600 font-bold border-t pt-2">
                  <div className="flex justify-between"><span>بمرحلة المسودة:</span> <span className="text-amber-600">{stats.plannedDistTripsCount}</span></div>
                  <div className="flex justify-between"><span>في الطريق والشحن:</span> <span className="text-blue-600">{stats.dispatchedDistTripsCount}</span></div>
                  <div className="flex justify-between"><span>مستلمة بالمدارس:</span> <span className="text-emerald-600">{stats.executedDistTripsCount}</span></div>
                </div>
              </div>

              {/* بطاقة 2: الكراتين بالتفصيل */}
              <div className="p-4 bg-gradient-to-br from-blue-50/50 to-blue-100/30 rounded-2xl border border-blue-100/80 text-right space-y-2">
                <span className="text-[9px] font-black text-blue-600 block">📦 محاكاة الكراتين (Cartons)</span>
                <div className="space-y-1">
                  <span className="text-2xl font-black text-blue-900 block">
                    {stats.totalReceivedCartons} <span className="text-[10px] font-medium text-slate-400">مستلمة / {stats.totalShippedCartons} مشحونة</span>
                  </span>
                </div>
                <div className="text-[10px] space-y-1 text-slate-600 font-bold border-t pt-2">
                  <div className="flex justify-between"><span>الارتجاع الفعلي:</span> <span>{stats.totalShippedCartons > 0 ? `${Math.round((stats.totalReceivedCartons / stats.totalShippedCartons) * 100)}%` : '0%'}</span></div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                    <div 
                      className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                      style={{ width: `${stats.totalShippedCartons > 0 ? Math.min(100, (stats.totalReceivedCartons / stats.totalShippedCartons) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* بطاقة 3: الحزم بالكامل */}
              <div className="p-4 bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 rounded-2xl border border-emerald-100/80 text-right space-y-2">
                <span className="text-[9px] font-black text-emerald-600 block">📚 إجمالي عدد الحزم والكتب</span>
                <div className="space-y-1">
                  <span className="text-2xl font-black text-emerald-900 block">
                    {stats.totalReceivedBundles} <span className="text-[10px] font-medium text-slate-400">حزمة / {stats.totalShippedBundles} مشحونة</span>
                  </span>
                </div>
                <div className="text-[10px] space-y-1 text-slate-600 font-bold border-t pt-2">
                  <div className="flex justify-between"><span>نسبة إنجاز الشحنات الفنية:</span> <span>{stats.totalShippedBundles > 0 ? `${Math.round((stats.totalReceivedBundles / stats.totalShippedBundles) * 100)}%` : '0%'}</span></div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
                    <div 
                      className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                      style={{ width: `${stats.totalShippedBundles > 0 ? Math.min(100, (stats.totalReceivedBundles / stats.totalShippedBundles) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* بطاقة 4: العيوب وخلافه */}
              <div className="p-4 bg-gradient-to-br from-rose-50/50 to-rose-100/30 rounded-2xl border border-rose-100/80 text-right space-y-2">
                <span className="text-[9px] font-black text-rose-600 block">⚠️ الفروقات والعيوب الرصدية</span>
                <span className="text-3xl font-black text-rose-900 block">
                  {stats.totalShortageCartons + stats.totalExcessCartons + stats.wrongDestinationCount} <span className="text-xs font-medium text-slate-400">فروقات</span>
                </span>
                <div className="text-[10px] space-y-1 text-slate-600 font-bold border-t pt-2">
                  <div className="flex justify-between"><span>توجيه خاطئ:</span> <span className="text-rose-600 font-black">{stats.wrongDestinationCount} صنف</span></div>
                  <div className="flex justify-between"><span>الحاجة للتسوية الإدارية:</span> <span className="text-amber-600 font-black">{stats.totalShortageCartons > 0 ? 'موجود عجوزات 📉' : 'لا يوجد عجز'}</span></div>
                </div>
              </div>
            </div>

            {/* المستوى الثاني: تشريح دقيق للعجز والزيادة والضرر لتوثيق الفحوصات */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* قسم العجز الفني */}
              <div className="p-4 bg-slate-50 border rounded-2xl text-right space-y-2">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-xs font-black text-slate-700">عجوزات الشحنات (📉 Shortage)</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center pt-1">
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">كراتين ناقصة</span>
                    <span className="text-sm font-black text-amber-700">{stats.totalShortageCartons} كرتون</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">حزم ناقصة</span>
                    <span className="text-sm font-black text-amber-700">{stats.totalShortageBundles} حزمة</span>
                  </div>
                </div>
              </div>

              {/* قسم الزيادة الفنية */}
              <div className="p-4 bg-slate-50 border rounded-2xl text-right space-y-2">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-xs font-black text-slate-700">الزيادات المكتشفة (📈 Excess)</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center pt-1">
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">كراتين زائدة</span>
                    <span className="text-sm font-black text-emerald-700">{stats.totalExcessCartons} كرتون</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">حزم صاعدة</span>
                    <span className="text-sm font-black text-emerald-700">{stats.totalExcessBundles} حزمة</span>
                  </div>
                </div>
              </div>

              {/* قسم التلفيات */}
              <div className="p-4 bg-slate-50 border rounded-2xl text-right space-y-2">
                <div className="flex items-center gap-1.5 justify-end">
                  <span className="text-xs font-black text-slate-700">التلفيات وتأكيد الجودة (📦 Damage)</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center pt-1">
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">معيب خارجي</span>
                    <span className="text-sm font-black text-red-600">{stats.totalExternalDamage} كرتون</span>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border">
                    <span className="text-[9px] text-slate-400 block font-semibold">معيب داخلي</span>
                    <span className="text-sm font-black text-red-600">{stats.totalInternalDamage} كرتون</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* عرض جدول تفصيلي لكل المعاملات لبيان التوجيه الخاطئ وكيف يبدو في النظام */}
        {testRecords.length > 0 && (
          <div className="overflow-x-auto border rounded-xl bg-slate-50/30">
            <table className="w-full text-xs text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b">
                  <th className="p-3 text-slate-500 font-black">الباركود التجريبي</th>
                  <th className="p-3 text-slate-500 font-black">نوع الطبلية</th>
                  <th className="p-3 text-slate-500 font-black">الجهة الأصلية</th>
                  <th className="p-3 text-slate-500 font-black">الجهة المستلمة</th>
                  <th className="p-3 text-slate-500 font-black">الحالة الفورية</th>
                  <th className="p-3 text-slate-500 font-black">المطابقة والتوجيه</th>
                  <th className="p-3 text-slate-500 font-black">تقرير الملاحظات والتلفيات</th>
                </tr>
              </thead>
              <tbody>
                {testRecords.map(record => {
                  const isWrong = record.isWrongDestination;
                  return (
                    <tr key={record.id} className="border-b bg-white hover:bg-slate-50/50">
                      <td className="p-3 font-mono font-bold text-slate-700">{record.palletBarcode}</td>
                      <td className="p-3">{palletTypes.find(t => t.id === record.palletTypeId)?.stageName || record.palletTypeId}</td>
                      <td className="p-3 font-extrabold text-slate-600">{users.find(u => u.code === record.destination)?.displayName || record.destination}</td>
                      <td className="p-3 font-extrabold text-slate-600">
                        {record.receivedByCenter ? (users.find(u => u.code === record.receivedByCenter)?.displayName || record.receivedByCenter) : '---'}
                      </td>
                      <td className="p-3">{getStatusBadge(record.status)}</td>
                      <td className="p-3">
                        {record.status !== 'received' ? (
                          <span className="text-[10px] text-slate-400">بانتظار الاستقبال الفعلي...</span>
                        ) : isWrong ? (
                          <span className="text-[10px] bg-rose-100 text-rose-700 px-2.5 py-1 rounded-full font-black animate-pulse flex items-center gap-1 justify-center w-fit">
                            <ShieldAlert size={10} />
                            ⚠️ توجيه خاطئ ومصحح
                          </span>
                        ) : (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-black flex items-center gap-1 justify-center w-fit">
                            <CheckCircle size={10} />
                            توجيه سليم ومطابق
                          </span>
                        )}
                      </td>
                      <td className="p-3 max-w-xs truncate text-[10px] text-slate-500">
                        {record.notes || record.damageDetails || '---'}
                        {record.externalDamageQty ? ` (تلف خارجي: ${record.externalDamageQty})` : ''}
                        {record.internalDamageQty ? ` (تلف داخلي: ${record.internalDamageQty})` : ''}
                        {record.hasDiscrepancy ? ` (فرق في الحمولة: ${record.discrepancyType === 'shortage' ? 'نقص' : 'زيادة'} ${record.discrepancyCartonsQty || 0} كـرتون)` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-slate-100/80 p-5 rounded-[2rem] border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5 text-right">
          <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1 justify-end">
            <span>كيف يعمل المختبر مع السجلات والتحكم؟</span>
            <HelpCircle size={14} className="text-slate-400" />
          </h4>
          <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
            جميع السجلات والرحلات داخل هذا المختبر تُخلق مسبوقةً بالمعرّف الفريد <code className="font-mono bg-indigo-50 text-indigo-700 px-1 py-0.5 rounded">TEST_</code>. عند تصفح "السجل العام للمخرجات"، يمكنك رؤيتها بالتزامن مع باقي الحسابات، وعند تفعيل تصفير دورة المختبر لن تحذف إلا السجلات المسبوقة بهذا المعرف لتفادي الإضرار ببيانات العمل الفعلية.
          </p>
        </div>
        <div className="space-y-1 text-right">
          <h4 className="font-extrabold text-slate-800 text-xs flex items-center gap-1 justify-end">
            <span>أمثلة وتطبيقات للفحص والتدريس:</span>
            <HelpCircle size={14} className="text-slate-400" />
          </h4>
          <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
            • <strong>حالة التوجيه الخاطئ:</strong> قم بتوليد طبلية موجهة إلى (مركز الرياض RYD)، ثم في العمود الثالث ضع مركز الاستلام الفعلي (الدمام DMM) واضغط استلام لتجربة رصد التوجيه الخاطئ فورا بتقرير التلفيات.<br />
            • <strong>نقص الشحنات:</strong> اضغط على خيار نقص/زيادة وضع الرقم الفعلي لمعاينة مطابقة الأرقام تلقائياً بلوحات تدقيق السرد.
          </p>
        </div>
      </div>
    </div>
  );
};
