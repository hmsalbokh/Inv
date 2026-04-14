
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
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getDocFromServer } from 'firebase/firestore';

const STORAGE_KEY_TYPES = 'v13_types';
const STORAGE_KEY_RECORDS = 'v13_records';
const STORAGE_KEY_TRIPS = 'v13_trips';
const STORAGE_KEY_SHEET_URL = 'v13_sheet_url';
const STORAGE_KEY_USERS = 'v13_users';
const STORAGE_KEY_LAST_RESET = 'v13_last_reset';

const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbzhIpnjpnEPOSYTfxcJtFkVYmGV5jSqowQYM0wdH9kRgeeO2oIGBK2CZu2eRwOyREmB/exec';

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
  { id: 'p1', stageCode: 'G01', stageName: 'الصف الأول الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'p2', stageCode: 'G02', stageName: 'الصف الثاني الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'p3', stageCode: 'G03', stageName: 'الصف الثالث الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'p4', stageCode: 'G04', stageName: 'الصف الرابع الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'p5', stageCode: 'G05', stageName: 'الصف الخامس الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'p6', stageCode: 'G06', stageName: 'الصف السادس الابتدائي', cartonsPerPallet: 24, bundlesPerCarton: 5 },
  { id: 'm1', stageCode: 'G07', stageName: 'الصف الأول المتوسط', cartonsPerPallet: 20, bundlesPerCarton: 4 },
  { id: 'm2', stageCode: 'G08', stageName: 'الصف الثاني المتوسط', cartonsPerPallet: 20, bundlesPerCarton: 4 },
  { id: 'm3', stageCode: 'G09', stageName: 'الصف الثالث المتوسط', cartonsPerPallet: 20, bundlesPerCarton: 4 },
  { id: 's1', stageCode: 'G11', stageName: 'الصف الأول الثانوي', cartonsPerPallet: 18, bundlesPerCarton: 3 },
  { id: 's2', stageCode: 'G12', stageName: 'الصف الثاني الثانوي', cartonsPerPallet: 18, bundlesPerCarton: 3 },
  { id: 's3', stageCode: 'G13', stageName: 'الصف الثالث الثانوي', cartonsPerPallet: 18, bundlesPerCarton: 3 },
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
  const [sheetUrl, setSheetUrl] = useState<string>(localStorage.getItem(STORAGE_KEY_SHEET_URL) || DEFAULT_SHEET_URL);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [isSystemResetting, setIsSystemResetting] = useState(false);
  const [showNotification, setShowNotification] = useState<{ title: string, msg: string } | null>(null);
  const [currentTripId, setCurrentTripId] = useState<string>('');
  const [currentTruckNumber, setCurrentTruckNumber] = useState<string>('1');
  const [distributionTrips, setDistributionTrips] = useState<DistributionTrip[]>([]);
  
  // طابع التصفير لفلترة البيانات الشبحية
  const [lastResetTimestamp, setLastResetTimestamp] = useState<number>(Number(localStorage.getItem(STORAGE_KEY_LAST_RESET)) || 0);

  const isSyncingRef = useRef(false);
  const isPushingRef = useRef(false);

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

  // Firebase Auth Listener (Disabled for now as per user request)
  useEffect(() => {
    // We'll just set auth as ready and use local storage/state for users
    setIsAuthReady(true);
    /* 
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      ...
    });
    return () => unsubscribe();
    */
  }, []);

  // Real-time Listeners
  useEffect(() => {
    if (!isAuthReady) return; // Removed firebaseUser check to allow local login with Firestore data

    const unsubTypes = onSnapshot(collection(db, 'palletTypes'), (snapshot) => {
      const types = snapshot.docs.map(doc => doc.data() as PalletType);
      if (types.length > 0) setPalletTypes(types);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'palletTypes'));

    const unsubTrips = onSnapshot(query(collection(db, 'trips'), orderBy('startDate', 'desc')), (snapshot) => {
      const tripsData = snapshot.docs.map(doc => doc.data() as Trip);
      const filteredTrips = tripsData.filter(t => (t.startDate || 0) > lastResetTimestamp);
      setTrips(filteredTrips);
      const active = filteredTrips.find(t => t.status === 'active');
      if (active) setCurrentTripId(active.id);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'trips'));

    const unsubRecords = onSnapshot(query(collection(db, 'records'), orderBy('timestamp', 'desc')), (snapshot) => {
      const recordsData = snapshot.docs.map(doc => doc.data() as InventoryRecord);
      const filteredRecords = recordsData.filter(r => (r.timestamp || 0) > lastResetTimestamp);
      setRecords(filteredRecords);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'records'));

    const unsubConfig = onSnapshot(doc(db, 'config', 'system'), (snapshot) => {
      if (snapshot.exists()) {
        const config = snapshot.data();
        if (config.lastResetTimestamp > lastResetTimestamp) {
          setLastResetTimestamp(config.lastResetTimestamp);
          localStorage.setItem(STORAGE_KEY_LAST_RESET, config.lastResetTimestamp.toString());
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/system'));

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const usersData = snapshot.docs.map(doc => doc.data() as UserCredentials);
      if (usersData.length > 0) setUsers(usersData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    const unsubDistTrips = onSnapshot(collection(db, 'distributionTrips'), (snapshot) => {
      const distData = snapshot.docs.map(doc => doc.data() as DistributionTrip);
      setDistributionTrips(distData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'distributionTrips'));

    return () => {
      unsubTypes();
      unsubTrips();
      unsubRecords();
      unsubConfig();
      unsubUsers();
      unsubDistTrips();
    };
  }, [isAuthReady, firebaseUser, lastResetTimestamp]);

  const handleLoginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setFirebaseUser(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleLogin = (user: UserCredentials) => setCurrentUser(user);

  // منطق الدمج الذكي الذي يقارن السجلات بطابع التصفير
  const mergeRecords = useCallback((local: InventoryRecord[], remote: InventoryRecord[], resetTime: number) => {
    if (isSystemResetting) return [];

    // 1. تصفية البيانات البعيدة: تجاهل أي سجل أقدم من تاريخ التصفير
    const filteredRemote = remote.filter(r => (r.timestamp || 0) > resetTime);

    // معالجة الصور في البيانات البعيدة المتبقية
    const processedRemote = filteredRemote.map(r => {
      let photos = r.photos;
      if (typeof (photos as any) === 'string') {
        try { 
          const parsed = JSON.parse(photos as unknown as string); 
          photos = Array.isArray(parsed) ? parsed : [];
        } catch(e) { 
          photos = (photos as unknown as string).startsWith('data:image') ? [photos as unknown as string] : []; 
        }
      }
      return { ...r, photos: Array.isArray(photos) ? photos : [] };
    });

    // 2. تصفية البيانات المحلية أيضاً بنفس المنطق لضمان الاتساق
    const filteredLocal = local.filter(r => (r.timestamp || 0) > resetTime);

    if (filteredLocal.length === 0) return processedRemote;

    const merged = [...filteredLocal];
    processedRemote.forEach(rem => {
      const lIdx = merged.findIndex(l => l.id === rem.id || l.palletBarcode === rem.palletBarcode);
      if (lIdx === -1) {
        merged.push(rem);
      } else {
        const localRec = merged[lIdx];
        if ((rem.timestamp || 0) > (localRec.timestamp || 0)) {
           merged[lIdx] = rem;
        }
      }
    });
    return merged;
  }, [isSystemResetting]);

  const fetchFromSheet = useCallback(async (isSilent = false, overrideUrl?: string) => {
    const urlToUse = overrideUrl || sheetUrl;
    if (!urlToUse || isSyncingRef.current || isPushingRef.current || isSystemResetting) return;
    if (!isSilent) setSyncing(true);
    isSyncingRef.current = true;
    try {
      const response = await fetch(`${urlToUse}?action=getAll`, { method: 'GET', mode: 'cors' });
      if (!response.ok) throw new Error("Connection failed");
      const data = await response.json();
      
      // جلب طابع التصفير من السحاب إذا وجد (يفضل أن يتم تخزينه في السحاب أيضاً)
      const remoteResetTime = data.lastResetTimestamp || 0;
      const effectiveResetTime = Math.max(lastResetTimestamp, remoteResetTime);
      
      if (effectiveResetTime > lastResetTimestamp) {
          setLastResetTimestamp(effectiveResetTime);
          localStorage.setItem(STORAGE_KEY_LAST_RESET, effectiveResetTime.toString());
      }

      if (data.users && data.users.length > 0) setUsers(data.users);
      if (data.types && data.types.length > 0) setPalletTypes(data.types);
      
      if (data.trips) {
        // تصفية الرحلات أيضاً بناءً على تاريخ التصفير
        const filteredTrips = data.trips.filter((t: Trip) => (t.startDate || 0) > effectiveResetTime);
        setTrips(filteredTrips);
        const active = filteredTrips.find((t: Trip) => t.status === 'active');
        if (active) setCurrentTripId(active.id);
      }

      const remoteRecords = data.records || [];
      setRecords(prev => mergeRecords(prev, remoteRecords, effectiveResetTime));
      
      setLastSyncTime(new Date().toLocaleTimeString('ar-SA'));
      setSyncError(null);
    } catch (error: any) {
      setSyncError('⚠️ خطأ اتصال');
    } finally {
      isSyncingRef.current = false;
      if (!isSilent) setSyncing(false);
    }
  }, [sheetUrl, isSystemResetting, mergeRecords, lastResetTimestamp]);

  const pushToSheet = async (newTypes = palletTypes, newRecords = records, newTrips = trips, newUsers = users, resetTime = lastResetTimestamp) => {
    if (!sheetUrl || isSystemResetting || isPushingRef.current) return;
    
    setSyncing(true);
    isPushingRef.current = true;
    try {
      const processedRecords = newRecords.map(r => ({ 
        ...r, 
        photos: Array.isArray(r.photos) ? JSON.stringify(r.photos) : (r.photos || "[]") 
      }));
      
      const payload = { 
        action: 'syncAll', 
        types: newTypes, 
        records: processedRecords, 
        trips: newTrips, 
        users: newUsers,
        lastResetTimestamp: resetTime // إرسال طابع التصفير للسحاب
      };

      const response = await fetch(sheetUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload) 
      });

      if (!response.ok) throw new Error("Sync failed");

      setLastSyncTime(new Date().toLocaleTimeString('ar-SA'));
      setSyncError(null);
    } catch (e: any) {
      setSyncError('⚠️ فشل مزامنة');
    } finally { 
      setTimeout(() => { 
        isPushingRef.current = false; 
        setSyncing(false); 
      }, 500);
    }
  };

  const handleResetAllData = async () => {
    if (!window.confirm("هل أنت متأكد من تصفير النظام؟ سيتم تجاهل كافة البيانات الحالية نهائياً ولن تقبل إلا البيانات الجديدة المضافة بعد الآن.")) return;
    
    setIsSystemResetting(true);
    setSyncing(true);
    
    const newResetTime = Date.now();
    
    try {
      // 1. تحديث الطابع محلياً
      setLastResetTimestamp(newResetTime);
      localStorage.setItem(STORAGE_KEY_LAST_RESET, newResetTime.toString());
      
      // 2. تحديث الطابع في Firestore
      await setDoc(doc(db, 'config', 'system'), { lastResetTimestamp: newResetTime });

      // 3. مسح البيانات في Firestore (اختياري، أو مجرد الاعتماد على الفلترة)
      // هنا سنعتمد على الفلترة لضمان السرعة، ولكن يمكن مسح السجلات القديمة لاحقاً

      setShowNotification({ title: 'تم التصفير الذكي', msg: 'تم تحديث نقطة البداية للنظام بنجاح. أي بيانات قديمة لن تظهر مرة أخرى.' });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'config/system');
    } finally {
      setIsSystemResetting(false);
      setSyncing(false);
      setActiveTab('dashboard');
    }
  };

  // ... (باقي الدوال handleScan و handleCreateTrip وال useEffects تبقى كما هي)
  const handleScan = useCallback(async (barcode: string, conditionData?: { condition: PalletCondition, externalDamageQty?: number, internalDamageQty?: number, photos?: string[], notes?: string, damageDetails?: string }) => {
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
          damageDetails: conditionData?.damageDetails || '' 
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

      selections.forEach(sel => {
        const pType = palletTypes.find(t => t.id === sel.typeId);
        for (let i = 0; i < sel.count; i++) {
          const recordId = generateUUID();
          const seq = Math.floor(Math.random() * 10000).toString().padStart(4, '0'); // Simplified sequence
          const palletBarcode = `${pType?.stageCode}${press}${seq}${semester}${year}`;
          
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
        }
      });

      await batch.commit();
      setCurrentTripId(tripId);
      setShowNotification({ title: 'تم إنشاء الرحلة', msg: 'تم حفظ الرحلة والطبليات في قاعدة البيانات السحابية.' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'trips/records');
    }
  }, [trips, palletTypes]);

  useEffect(() => {
    fetchFromSheet(true);
  }, [fetchFromSheet]);

  useEffect(() => {
    const savedRecords = localStorage.getItem(STORAGE_KEY_RECORDS);
    if (savedRecords) {
        const parsed = JSON.parse(savedRecords);
        // فلترة البيانات المحفوظة محلياً عند التشغيل بناءً على تاريخ التصفير
        setRecords(parsed.filter((r: InventoryRecord) => (r.timestamp || 0) > lastResetTimestamp));
    }
    const savedTrips = localStorage.getItem(STORAGE_KEY_TRIPS);
    if (savedTrips) {
      const parsed = JSON.parse(savedTrips);
      const filteredTrips = parsed.filter((t: Trip) => (t.startDate || 0) > lastResetTimestamp);
      setTrips(filteredTrips);
      const active = filteredTrips.find((t: Trip) => t.status === 'active');
      if (active) setCurrentTripId(active.id);
    }
  }, [lastResetTimestamp]);

  useEffect(() => {
    if (!isSystemResetting) {
      localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(records));
      localStorage.setItem(STORAGE_KEY_TRIPS, JSON.stringify(trips));
    }
  }, [records, trips, isSystemResetting]);

  if (!isAuthReady) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (!currentUser) return <Login users={users} onLogin={handleLogin} onLoginWithGoogle={handleLoginWithGoogle} />;

  return (
    <div className="min-h-screen flex flex-col w-full max-w-7xl mx-auto bg-slate-50 shadow-2xl relative lg:border-x lg:border-slate-200">
      <ConfirmModal isOpen={!!showNotification} title={showNotification?.title || ''} message={showNotification?.msg || ''} confirmText="فهمت" onConfirm={() => setShowNotification(null)} onCancel={() => setShowNotification(null)} />
      
      <header className={`p-6 shadow-xl rounded-b-[2.5rem] text-white transition-all duration-500 ${currentUser.role === 'factory' ? 'bg-indigo-900' : currentUser.role === 'center' ? 'bg-emerald-900' : 'bg-slate-900'}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md shadow-inner">
                <SubulLogo size={24} color="white" />
             </div>
             <div className="text-right">
                <h1 className="text-sm font-black tracking-tight leading-none">{currentUser.displayName}</h1>
                <button onClick={handleLogout} className="text-[9px] opacity-60 font-bold hover:opacity-100 uppercase tracking-widest mt-1">تسجيل خروج</button>
             </div>
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className={`px-3 py-1 rounded-full text-[8px] font-black transition-all ${syncing ? 'bg-white/30 animate-pulse' : 'bg-white/10'}`}>
                {syncing ? 'مزامنة...' : syncError || (lastSyncTime ? `تحديث: ${lastSyncTime}` : 'متصل سحابياً ✓')}
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
        {activeTab === 'scan' && <Scanner onScan={handleScan} role={currentUser.role} currentTruck={currentTruckNumber} onTruckChange={setCurrentTruckNumber} currentTripId={currentTripId} records={records} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} palletTypes={palletTypes} sheetUrl={sheetUrl} />}
        {activeTab === 'history' && <History records={records} trips={trips} palletTypes={palletTypes} role={currentUser.role} userCode={currentUser.code} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} users={users} />}
        {activeTab === 'settings' && currentUser.code === 'ADMIN' && (
          <Settings 
            palletTypes={palletTypes} 
            users={users} 
            onUpdateUsers={async (nu) => { 
              // Update each user in Firestore
              const batch = writeBatch(db);
              nu.forEach(u => batch.set(doc(db, 'users', u.id), u));
              await batch.commit();
            }} 
            onUpdate={async (u) => { 
              await setDoc(doc(db, 'palletTypes', u.id), u);
            }} 
            onAdd={async (t) => { 
              const id = generateUUID();
              await setDoc(doc(db, 'palletTypes', id), { ...t, id });
            }} 
            onDelete={async (id) => { 
              await deleteDoc(doc(db, 'palletTypes', id));
            }} 
            sheetUrl={sheetUrl} 
            onUrlChange={(newUrl) => { setSheetUrl(newUrl); localStorage.setItem(STORAGE_KEY_SHEET_URL, newUrl); }} 
            onManualSync={() => {}} 
            onResetData={handleResetAllData} 
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
