
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PalletType, InventoryRecord, Trip, UserCredentials, UserRole, PressCode, CenterCode, PalletCondition, DistributionTrip } from './types';
import { Dashboard, SubulLogo } from './components/Dashboard';
import { Scanner } from './components/Scanner';
import { Settings } from './components/Settings';
import { History } from './components/History';
import { Login } from './components/Login';
import { ConfirmModal } from './components/ConfirmModal';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy,
  getDoc,
  getDocs,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth';
import { getDocFromServer } from 'firebase/firestore';

const STORAGE_KEY_TYPES = 'v13_types';
const STORAGE_KEY_RECORDS = 'v13_records';
const STORAGE_KEY_TRIPS = 'v13_trips';
const STORAGE_KEY_USERS = 'v13_users';
const STORAGE_KEY_LAST_RESET = 'v13_last_reset';

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const DEFAULT_USERS: UserCredentials[] = [
  { id: '1', role: 'monitor', code: 'ADMIN', username: 'admin', password: 'H0566749388h', displayName: 'مسئول النظام' },
  { id: '7', role: 'monitor', code: 'STATS', username: 'stats', password: '123', displayName: 'مسئول المراقبة والإحصاء' },
  { id: '2', role: 'factory', code: 'OPK', username: 'opk', password: '123', displayName: 'مطبعة العبيكان' },
  { id: '3', role: 'factory', code: 'UNI', username: 'uni', password: '123', displayName: 'المطبعة المتحدة' },
  { id: '4', role: 'center', code: 'DMM', username: 'dmm', password: '123', displayName: 'مركز الدمام' },
  { id: '5', role: 'center', code: 'RYD', username: 'ryd', password: '123', displayName: 'مركز الرياض' },
  { id: '6', role: 'center', code: 'JED', username: 'jed', password: '123', displayName: 'مركز جدة' },
];

const DEFAULT_TYPES: PalletType[] = [
  // التعليم العام
  { id: 'g01', stageCode: 'G01', stageName: 'الصف الأول الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g02', stageCode: 'G02', stageName: 'الصف الثاني الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g03', stageCode: 'G03', stageName: 'الصف الثالث الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g04', stageCode: 'G04', stageName: 'الصف الرابع الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g05', stageCode: 'G05', stageName: 'الصف الخامس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g06', stageCode: 'G06', stageName: 'الصف السادس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g07', stageCode: 'G07', stageName: 'الصف الأول المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g08', stageCode: 'G08', stageName: 'الصف الثاني المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g09', stageCode: 'G09', stageName: 'الصف الثالث المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g11', stageCode: 'G11', stageName: 'الصف الأول الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g12', stageCode: 'G12', stageName: 'الصف الثاني الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'g13', stageCode: 'G13', stageName: 'الصف الثالث الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  
  // المدارس العالمية
  { id: 'ig01', stageCode: 'IG01', stageName: 'المدارس العالمية - الأول الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig02', stageCode: 'IG02', stageName: 'المدارس العالمية - الثاني الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig03', stageCode: 'IG03', stageName: 'المدارس العالمية - الثالث الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig04', stageCode: 'IG04', stageName: 'المدارس العالمية - الرابع الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig05', stageCode: 'IG05', stageName: 'المدارس العالمية - الخامس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig06', stageCode: 'IG06', stageName: 'المدارس العالمية - السادس الابتدائي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig07', stageCode: 'IG07', stageName: 'المدارس العالمية - الأول المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig08', stageCode: 'IG08', stageName: 'المدارس العالمية - الثاني المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig09', stageCode: 'IG09', stageName: 'المدارس العالمية - الثالث المتوسط', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig11', stageCode: 'IG11', stageName: 'المدارس العالمية - الأول الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig12', stageCode: 'IG12', stageName: 'المدارس العالمية - الثاني الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
  { id: 'ig13', stageCode: 'IG13', stageName: 'المدارس العالمية - الثالث الثانوي', cartonsPerPallet: 30, bundlesPerCarton: 8 },
];

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserCredentials | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<any>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [users, setUsers] = useState<UserCredentials[]>(DEFAULT_USERS);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scan' | 'history' | 'settings'>('dashboard');
  const [palletTypes, setPalletTypes] = useState<PalletType[]>(DEFAULT_TYPES);
  const [records, setRecords] = useState<InventoryRecord[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [isSystemResetting, setIsSystemResetting] = useState(false);
  const [showNotification, setShowNotification] = useState<{ title: string, msg: string } | null>(null);
  const [currentTripId, setCurrentTripId] = useState<string>('');
  const [currentTruckNumber, setCurrentTruckNumber] = useState<string>('1');
  const [distributionTrips, setDistributionTrips] = useState<DistributionTrip[]>([]);
  
  // طابع التصفير لفلترة البيانات الشبحية
  const [lastResetTimestamp, setLastResetTimestamp] = useState<number>(Number(localStorage.getItem(STORAGE_KEY_LAST_RESET)) || 0);

  // 0. مستمع حالة المصادقة في Firebase
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (!user) {
        signInAnonymously(auth).catch(err => {
          console.error("Anonymous login failed:", err);
          setShowNotification({
            title: 'خطأ في الاتصال السحابي',
            msg: 'يرجى تفعيل "Anonymous Sign-in" في وحدة تحكم Firebase لتتمكن من إدارة البيانات.'
          });
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // Test Firestore connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'config', 'system'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    }
    testConnection();
  }, []);

  // تنظيف مخلفات النسخ القديمة لضمان عدم تداخل البيانات المحلية مع بيانات Firebase
  useEffect(() => {
    localStorage.removeItem(STORAGE_KEY_RECORDS);
    localStorage.removeItem(STORAGE_KEY_TRIPS);
  }, []);

  // 1. مستمع الإعدادات (طابع التصفير) - يعمل مرة واحدة عند البداية
  useEffect(() => {
    const unsubConfig = onSnapshot(doc(db, 'config', 'system'), (snapshot) => {
      if (snapshot.exists()) {
        const config = snapshot.data();
        if (config.lastResetTimestamp) {
          setLastResetTimestamp(config.lastResetTimestamp);
        }
      }
    });
    return () => unsubConfig();
  }, []);

  // 2. مستمعو البيانات - يعتمدون على طابع التصفير لفلترة البيانات الشبحية
  useEffect(() => {
    setIsAuthReady(false);

    // مستمع المراحل
    const unsubTypes = onSnapshot(collection(db, 'palletTypes'), (snapshot) => {
      const types = snapshot.docs.map(doc => doc.data() as PalletType);
      setPalletTypes(types);
    });

    // مستمع الرحلات
    const unsubTrips = onSnapshot(query(collection(db, 'trips'), orderBy('startDate', 'desc')), (snapshot) => {
      const tripsData = snapshot.docs
        .map(doc => doc.data() as Trip)
        .filter(t => (t.startDate || 0) > lastResetTimestamp);
      setTrips(tripsData);
    });

    // مستمع السجلات (الطبليات)
    const unsubRecords = onSnapshot(query(collection(db, 'records'), orderBy('timestamp', 'desc')), (snapshot) => {
      const recordsData = snapshot.docs
        .map(doc => doc.data() as InventoryRecord)
        .filter(r => (r.timestamp || 0) > lastResetTimestamp);
      setRecords(recordsData);
    });

    // مستمع المستخدمين
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserCredentials);
      if (usersData.length > 0) setUsers(usersData);
    });

    // مستمع رحلات التوزيع
    const unsubDistTrips = onSnapshot(collection(db, 'distributionTrips'), (snapshot) => {
      const distData = snapshot.docs.map(doc => doc.data() as DistributionTrip);
      setDistributionTrips(distData);
    });

    const timer = setTimeout(() => {
      setIsAuthReady(true);
      setLastSyncTime(new Date().toLocaleTimeString('ar-SA'));
    }, 1000);

    return () => {
      clearTimeout(timer);
      unsubTypes();
      unsubTrips();
      unsubRecords();
      unsubUsers();
      unsubDistTrips();
    };
  }, [lastResetTimestamp]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setFirebaseUser(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleLogin = async (user: UserCredentials) => {
    setCurrentUser(user);
  };

  const handleResetAllData = async () => {
    setIsSystemResetting(true);
    setSyncing(true);
    
    const newResetTime = Date.now();
    
    try {
      // 1. تحديث الطابع محلياً
      setLastResetTimestamp(newResetTime);
      localStorage.setItem(STORAGE_KEY_LAST_RESET, newResetTime.toString());
      localStorage.removeItem(STORAGE_KEY_RECORDS);
      localStorage.removeItem(STORAGE_KEY_TRIPS);
      setRecords([]);
      setTrips([]);
      setDistributionTrips([]);
      
      // 2. تحديث الطابع في Firestore
      await setDoc(doc(db, 'config', 'system'), { lastResetTimestamp: newResetTime });

      // 3. مسح البيانات فعلياً من Firestore على دفعات (Batches)
      const collectionsToClear = ['records', 'trips', 'distributionTrips'];
      
      for (const collName of collectionsToClear) {
        const snap = await getDocs(collection(db, collName));
        const docs = snap.docs;
        
        // تقسيم العمليات إلى دفعات كل منها 400 عملية (الحد الأقصى هو 500)
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(db);
          const chunk = docs.slice(i, i + 400);
          chunk.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      setShowNotification({ 
        title: 'تم تصفير البيانات', 
        msg: 'تم حذف رحلات التوزيع وسجلات المخزون بنجاح. (المراحل والحسابات لم تتأثر)' 
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'reset-all-data');
    } finally {
      setIsSystemResetting(false);
      setSyncing(false);
      setActiveTab('dashboard');
    }
  };

  // ... (باقي الدوال handleScan و handleCreateTrip وال useEffects تبقى كما هي)
  const handleScan = useCallback(async (barcode: string, conditionData?: { condition: PalletCondition, externalDamageQty?: number, internalDamageQty?: number, photos?: string[], notes?: string, damageDetails?: string, hasDiscrepancy?: boolean, discrepancyType?: 'shortage' | 'excess', discrepancyCartonsQty?: number, discrepancyBundlesQty?: number }) => {
    if (isSystemResetting) return { success: false, message: 'النظام في حالة صيانة' };
    const cleanBarcode = barcode.trim().toUpperCase();
    if (!currentUser) return { success: false, message: 'يرجى تسجيل الدخول' };
    
    try {
      const record = records.find(r => r.palletBarcode === cleanBarcode);
      if (!record) return { success: false, message: 'الكود غير موجود' };

      let updates: Partial<InventoryRecord> = {};
      let successMessage = 'تم التحديث بنجاح';

      if (currentUser.role === 'factory' && record.tripId === currentTripId) {
        if (record.status !== 'pending') return { success: false, message: 'هذه الطبلية تم مسحها مسبقاً في المطبعة' };
        updates = { status: 'in_transit', timestamp: Date.now(), factoryTimestamp: Date.now(), truckId: currentTruckNumber };
      } else if (currentUser.role === 'center') {
        if (record.status === 'received') return { success: false, message: 'هذه الطبلية مستلمة مسبقاً' };
        
        const isWrongDestination = record.destination !== currentUser.code;
        const wasPending = record.status === 'pending';
        
        const destCenterName = users.find(u => u.code === record.destination)?.displayName || record.destination;
        
        if (isWrongDestination) {
          successMessage = `تم الاستلام (تنبيه: هذه الطبلية تخص ${destCenterName})`;
        } else if (wasPending) {
          successMessage = 'تم الاستلام (تنبيه: الطبلية لم تخرج من المطبعة رسمياً)';
        } else {
          successMessage = 'تم الاستلام بنجاح';
        }
        
        const extraNotes = [
          wasPending ? '[تم الاستلام بدون مسح في المطبعة]' : '',
          isWrongDestination ? `[توجيه خاطئ: تخص ${destCenterName}]` : ''
        ].filter(Boolean).join(' ');

        updates = { 
          status: 'received', 
          timestamp: Date.now(), 
          centerTimestamp: Date.now(), 
          scannedBy: 'center', 
          condition: conditionData?.condition || 'intact', 
          externalDamageQty: conditionData?.externalDamageQty ?? 0, 
          internalDamageQty: conditionData?.internalDamageQty ?? 0, 
          photos: conditionData?.photos || [], 
          notes: (conditionData?.notes || '') + (extraNotes ? ` ${extraNotes}` : ''), 
          damageDetails: conditionData?.damageDetails || '',
          hasDiscrepancy: conditionData?.hasDiscrepancy || false,
          discrepancyType: conditionData?.discrepancyType,
          discrepancyCartonsQty: conditionData?.discrepancyCartonsQty ?? 0,
          discrepancyBundlesQty: conditionData?.discrepancyBundlesQty ?? 0
        };
      } else {
        return { success: false, message: 'غير مصرح لك بمسح هذا الكود' };
      }

      await setDoc(doc(db, 'records', record.id), { ...record, ...updates }, { merge: true });
      return { success: true, message: successMessage };
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'records');
      return { success: false, message: 'فشل التحديث في قاعدة البيانات' };
    }
  }, [currentUser, currentTripId, currentTruckNumber, records, isSystemResetting]);

  const handleCreateTrip = useCallback(async (press: PressCode, center: CenterCode, selections: { typeId: string, count: number }[], semester: string, year: string) => {
    const tripId = generateUUID();
    const tripNumber = (trips.length + 1).toString().padStart(4, '0');
    
    const newTrip: Trip = {
      id: tripId,
      tripNumber,
      tripBarcode: `${press}${center}${tripNumber}`,
      pressCode: press,
      centerCode: center,
      startDate: Date.now(),
      status: 'active'
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'trips', tripId), newTrip);

      // حساب التسلسل التالي لهذه المطبعة
      const pressRecords = records.filter(r => r.palletBarcode.includes(press));
      let maxSeq = 0;
      pressRecords.forEach(r => {
        const pressIdx = r.palletBarcode.indexOf(press);
        if (pressIdx !== -1) {
          const seqPart = r.palletBarcode.substring(pressIdx + press.length, pressIdx + press.length + 5);
          const seqNum = parseInt(seqPart);
          if (!isNaN(seqNum) && seqNum > maxSeq) maxSeq = seqNum;
        }
      });
      
      let currentSeq = maxSeq + 1;
      const yearDigit = year.slice(-1);

      selections.forEach(sel => {
        const pType = palletTypes.find(t => t.id === sel.typeId);
        for (let i = 0; i < sel.count; i++) {
          const recordId = generateUUID();
          const seqStr = currentSeq.toString().padStart(5, '0');
          const palletBarcode = `${pType?.stageCode}${press}${seqStr}${semester}${yearDigit}`;
          
          const record: InventoryRecord = {
            id: recordId,
            palletTypeId: sel.typeId,
            palletBarcode,
            tripId: tripId,
            truckId: '1',
            status: 'pending',
            timestamp: Date.now(),
            scannedBy: 'factory',
            destination: center
          };
          batch.set(doc(db, 'records', recordId), record);
          currentSeq++;
        }
      });

      await batch.commit();
      setCurrentTripId(tripId);
      setShowNotification({ title: 'تم إنشاء الرحلة', msg: 'تم حفظ الرحلة والطبليات في قاعدة البيانات السحابية.' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'trips/records');
    }
  }, [trips, palletTypes, records]);

  useEffect(() => {
    if (lastResetTimestamp > 0) {
      localStorage.setItem(STORAGE_KEY_LAST_RESET, lastResetTimestamp.toString());
    }
  }, [lastResetTimestamp]);

  const handleResetStagesToDefault = async () => {
    try {
      const batch = writeBatch(db);
      // Delete existing types from Firestore
      const snapshot = await getDocs(collection(db, 'palletTypes'));
      snapshot.docs.forEach(d => {
        batch.delete(d.ref);
      });
      // Add default types
      DEFAULT_TYPES.forEach(t => {
        batch.set(doc(db, 'palletTypes', t.id), t);
      });
      await batch.commit();
      setShowNotification({ title: 'نجاح', msg: 'تمت إعادة تهيئة المراحل بنجاح في قاعدة البيانات.' });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'palletTypes');
    }
  };

  const isResettingRef = useRef(false);

  // تأثير للهجرة التلقائية للمراحل الجديدة عند دخول الأدمن أو مسئول الإحصاء
  useEffect(() => {
    if (isAuthReady && (currentUser?.code === 'ADMIN' || currentUser?.role === 'monitor')) {
      if (isResettingRef.current) return;

      // قائمة الأكواد المطلوبة حسب توجيهات المستخدم الأخيرة
      const requiredCodes = [
        'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G11', 'G12', 'G13',
        'IG01', 'IG02', 'IG03', 'IG04', 'IG05', 'IG06', 'IG07', 'IG08', 'IG09', 'IG11', 'IG12', 'IG13'
      ];
      
      const currentCodes = palletTypes.map(t => t.stageCode);
      const isMissingRequired = requiredCodes.some(code => !currentCodes.includes(code));
      const hasOldStages = palletTypes.some(t => t.id.startsWith('p') || t.id.startsWith('m') || t.id.startsWith('s'));
      
      // إذا كانت القائمة فارغة، أو تحتوي على بيانات قديمة، أو ينقصها أي من الأكواد الأساسية
      if (palletTypes.length === 0 || hasOldStages || isMissingRequired) {
        console.log('Migration triggered: Missing required stages or old data format detected.');
        isResettingRef.current = true;
        handleResetStagesToDefault().finally(() => {
          isResettingRef.current = false;
        });
      }
    }
  }, [isAuthReady, currentUser, palletTypes]);

  if (!isAuthReady) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (!currentUser) return <Login users={users} onLogin={handleLogin} />;

  return (
    <div className="min-h-screen flex flex-col w-full max-w-7xl mx-auto bg-slate-50 shadow-2xl relative lg:border-x lg:border-slate-200">
      <ConfirmModal isOpen={!!showNotification} title={showNotification?.title || ''} message={showNotification?.msg || ''} confirmText="فهمت" onConfirm={() => setShowNotification(null)} onCancel={() => setShowNotification(null)} />
      
      {isSystemResetting && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-md flex flex-col items-center justify-center text-white space-y-4">
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
          <p className="font-black text-sm">جاري تصفير البيانات... يرجى الانتظار</p>
        </div>
      )}

      <header className={`p-6 shadow-xl rounded-b-[2.5rem] text-white transition-all duration-500 ${currentUser.role === 'factory' ? 'bg-indigo-900' : currentUser.role === 'center' ? 'bg-emerald-900' : 'bg-slate-900'}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md shadow-inner">
                <SubulLogo size={24} color="white" />
             </div>
             <div className="text-right">
                <h1 className="text-sm font-black tracking-tight leading-none">{currentUser.displayName}</h1>
                <div className="flex items-center gap-2">
                  <button onClick={handleLogout} className="text-[9px] opacity-60 font-bold hover:opacity-100 uppercase tracking-widest mt-1">تسجيل خروج</button>
                  {currentUser.code === 'ADMIN' && (
                    <span className="text-[8px] bg-white/10 px-2 py-0.5 rounded-full mt-1">
                      {palletTypes.length} مرحلة
                    </span>
                  )}
                </div>
             </div>
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className={`px-3 py-1 rounded-full text-[8px] font-black transition-all ${syncing ? 'bg-white/30 animate-pulse' : 'bg-white/10'}`}>
                {syncing ? 'جاري التحديث...' : (lastSyncTime ? `آخر تحديث: ${lastSyncTime}` : 'متصل سحابياً ✓')}
             </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 overflow-y-auto p-4 pb-28">
        {activeTab === 'dashboard' && (
          <Dashboard 
            palletTypes={palletTypes} 
            records={records} 
            trips={trips} 
            distributionTrips={distributionTrips}
            currentTripId={currentTripId} 
            role={currentUser.role} 
            userCode={currentUser.code} 
            userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} 
            users={users} 
            onSelectCenter={() => {}} 
            onNewTrip={handleCreateTrip} 
            onNotify={(title, msg) => setShowNotification({ title, msg })}
          />
        )}
        {activeTab === 'scan' && <Scanner onScan={handleScan} role={currentUser.role} currentTruck={currentTruckNumber} onTruckChange={setCurrentTruckNumber} currentTripId={currentTripId} records={records} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} palletTypes={palletTypes} onNotify={(title, msg) => setShowNotification({ title, msg })} />}
        {activeTab === 'history' && <History records={records} trips={trips} palletTypes={palletTypes} role={currentUser.role} userCode={currentUser.code} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} users={users} />}
        {activeTab === 'settings' && currentUser.code === 'ADMIN' && (
          <Settings 
            palletTypes={palletTypes} 
            users={users} 
            onUpdateUsers={async (nu) => { 
              try {
                const batch = writeBatch(db);
                // Find users to delete
                const currentIds = users.map(u => u.id);
                const newIds = nu.map(u => u.id);
                const toDelete = currentIds.filter(id => !newIds.includes(id));
                
                toDelete.forEach(id => batch.delete(doc(db, 'users', id)));
                nu.forEach(u => batch.set(doc(db, 'users', u.id), u));
                
                await batch.commit();
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, 'users');
              }
            }} 
            onUpdate={async (u) => { 
              try {
                await setDoc(doc(db, 'palletTypes', u.id), u);
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, 'palletTypes');
              }
            }} 
            onAdd={async (t) => { 
              try {
                const id = generateUUID();
                await setDoc(doc(db, 'palletTypes', id), { ...t, id });
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, 'palletTypes');
              }
            }} 
            onDelete={async (id) => { 
              try {
                await deleteDoc(doc(db, 'palletTypes', id));
              } catch (e) {
                handleFirestoreError(e, OperationType.WRITE, 'palletTypes');
              }
            }} 
            onResetData={handleResetAllData} 
            onResetStages={handleResetStagesToDefault}
            onNotify={(title, msg) => setShowNotification({ title, msg })}
          />
        )}
      </main>
      
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-2xl z-50">
        <div className="bg-white/95 backdrop-blur-2xl shadow-2xl rounded-[2.5rem] flex justify-around p-2 md:p-3 ring-1 ring-slate-200">
          <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} label="📊 الرئيسية" />
          {currentUser.role !== 'monitor' && <NavItem active={activeTab === 'scan'} onClick={() => setActiveTab('scan')} label="📷 مسح" /> }
          <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} label="📋 السجل" />
          {currentUser.code === 'ADMIN' && <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="⚙️ الإعدادات" /> }
        </div>
      </nav>
    </div>
  );
};

const NavItem: React.FC<{ active: boolean; onClick: () => void; label: string }> = ({ active, onClick, label }) => (
  <button onClick={onClick} className={`flex flex-col items-center px-3 md:px-5 py-2 md:py-3 rounded-2xl transition-all duration-300 ${active ? 'bg-indigo-600 text-white shadow-lg scale-105' : 'text-slate-400 hover:text-indigo-400'}`}>
    <span className="text-[10px] md:text-[11px] font-black">{label}</span>
  </button>
);
