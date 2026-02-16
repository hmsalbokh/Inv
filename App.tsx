
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PalletType, InventoryRecord, Trip, UserCredentials, UserRole, PressCode, CenterCode, PalletCondition } from './types';
import { Dashboard, SubulLogo } from './components/Dashboard';
import { Scanner } from './components/Scanner';
import { Settings } from './components/Settings';
import { History } from './components/History';
import { Login } from './components/Login';
import { ConfirmModal } from './components/ConfirmModal';

const STORAGE_KEY_TYPES = 'v13_types';
const STORAGE_KEY_RECORDS = 'v13_records';
const STORAGE_KEY_TRIPS = 'v13_trips';
const STORAGE_KEY_SHEET_URL = 'v13_sheet_url';
const STORAGE_KEY_USERS = 'v13_users';

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

  const isSyncingRef = useRef(false);
  const isPushingRef = useRef(false);

  // تعديل منطق الدمج ليكون أكثر حذراً
  const mergeRecords = (local: InventoryRecord[], remote: InventoryRecord[]) => {
    // إذا كان النظام في حالة تصفير، لا تدمج شيئاً
    if (isSystemResetting) return [];

    const processedRemote = remote.map(r => {
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

    // إذا كانت القائمة المحلية فارغة (بسبب حذف يدوي مثلاً)، نقبل السحابية كلياً
    if (local.length === 0) return processedRemote;

    const merged = [...local];
    processedRemote.forEach(rem => {
      const lIdx = merged.findIndex(l => l.id === rem.id || l.palletBarcode === rem.palletBarcode);
      if (lIdx === -1) {
        // لا تضف السجل من السحاب إذا كان قد تم حذفه محلياً عمداً
        // (في هذا الإصدار البسيط، سنفترض أن أي سجل جديد في السحاب يجب أن يظهر)
        merged.push(rem);
      } else {
        const localRec = merged[lIdx];
        // تحديث السجل فقط إذا كان الطابع الزمني للسحاب أحدث
        if ((rem.timestamp || 0) > (localRec.timestamp || 0)) {
           merged[lIdx] = rem;
        }
      }
    });
    return merged;
  };

  const fetchFromSheet = useCallback(async (isSilent = false, overrideUrl?: string) => {
    const urlToUse = overrideUrl || sheetUrl;
    if (!urlToUse || isSyncingRef.current || isPushingRef.current || isSystemResetting) return;
    if (!isSilent) setSyncing(true);
    isSyncingRef.current = true;
    try {
      const response = await fetch(`${urlToUse}?action=getAll`, { method: 'GET', mode: 'cors' });
      if (!response.ok) throw new Error("Connection failed");
      const data = await response.json();
      
      // تحديث البيانات بحذر
      if (data.users && data.users.length > 0) setUsers(data.users);
      if (data.types && data.types.length > 0) setPalletTypes(data.types);
      
      if (data.trips) {
        setTrips(data.trips);
        const active = data.trips.find((t: Trip) => t.status === 'active');
        if (active) setCurrentTripId(active.id);
      }

      const remoteRecords = data.records || [];
      setRecords(prev => mergeRecords(prev, remoteRecords));
      
      setLastSyncTime(new Date().toLocaleTimeString('ar-SA'));
      setSyncError(null);
    } catch (error: any) {
      setSyncError('⚠️ خطأ اتصال');
    } finally {
      isSyncingRef.current = false;
      if (!isSilent) setSyncing(false);
    }
  }, [sheetUrl, isSystemResetting]);

  const pushToSheet = async (newTypes = palletTypes, newRecords = records, newTrips = trips, newUsers = users) => {
    // منع الدفع إذا كنا نصفر أو الرابط فارغ
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
        users: newUsers 
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
    if (!window.confirm("هل أنت متأكد من حذف كافة البيانات نهائياً من الجهاز ومن السحاب؟")) return;
    
    setIsSystemResetting(true);
    setSyncing(true);
    isPushingRef.current = true; // منع أي عمليات مزامنة أخرى أثناء المسح
    
    try {
      // 1. مسح محلي
      localStorage.removeItem(STORAGE_KEY_RECORDS);
      localStorage.removeItem(STORAGE_KEY_TRIPS);
      setRecords([]);
      setTrips([]);
      setCurrentTripId('');
      
      // 2. إرسال أمر مسح صريح للسحاب
      const payload = { 
        action: 'syncAll', 
        types: palletTypes, 
        records: [], 
        trips: [], 
        users: users 
      };

      const response = await fetch(sheetUrl, { 
        method: 'POST', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload) 
      });

      if (!response.ok) throw new Error("Cloud delete failed");

      setShowNotification({ title: 'تم التصفير الشامل', msg: 'تم تنظيف النظام والسحاب بنجاح.' });
    } catch (e) {
      console.error("Reset Error:", e);
      setShowNotification({ title: 'تحذير', msg: 'تم المسح من جهازك ولكن فشل الاتصال بالسحاب. قد تعود البيانات عند الاتصال ثانية.' });
    } finally {
      // تأخير بسيط لضمان استقرار الحالة
      setTimeout(() => { 
        setIsSystemResetting(false); 
        isPushingRef.current = false; 
        setSyncing(false); 
        setActiveTab('dashboard');
      }, 2000);
    }
  };

  // ... (باقي الدوال handleScan, handleCreateTrip تبقى كما هي)
  const handleScan = useCallback((barcode: string, conditionData?: { condition: PalletCondition, externalDamageQty?: number, internalDamageQty?: number, photos?: string[], notes?: string, damageDetails?: string }) => {
    if (isSystemResetting) return { success: false, message: 'النظام في حالة صيانة' };
    const cleanBarcode = barcode.trim().toUpperCase();
    if (!currentUser) return { success: false, message: 'يرجى تسجيل الدخول' };
    
    let scanResult = { success: false, message: '' };
    let newRecordsArray: InventoryRecord[] = [];

    setRecords(prev => {
      newRecordsArray = prev.map(r => {
        if (currentUser.role === 'factory' && r.palletBarcode === cleanBarcode && r.tripId === currentTripId) {
          scanResult = { success: true, message: `تم تحميل: ${cleanBarcode}` };
          return { ...r, status: 'in_transit', timestamp: Date.now(), factoryTimestamp: Date.now(), truckId: currentTruckNumber };
        } else if (currentUser.role === 'center' && r.palletBarcode === cleanBarcode && r.status !== 'received') {
          scanResult = { success: true, message: `تأكيد استلام: ${cleanBarcode}` };
          return { ...r, status: 'received', timestamp: Date.now(), centerTimestamp: Date.now(), scannedBy: 'center', condition: conditionData?.condition || 'intact', externalDamageQty: conditionData?.externalDamageQty ?? 0, internalDamageQty: conditionData?.internalDamageQty ?? 0, photos: conditionData?.photos || [], notes: conditionData?.notes || '', damageDetails: conditionData?.damageDetails || '' };
        }
        return r;
      });
      return newRecordsArray;
    });

    if (scanResult.success) {
      setTimeout(() => pushToSheet(palletTypes, newRecordsArray, trips, users), 100);
      return scanResult;
    }
    return { success: false, message: 'الكود غير موجود أو مستخدم مسبقاً' };
  }, [currentUser, currentTripId, currentTruckNumber, palletTypes, trips, users, isSystemResetting]);

  const handleCreateTrip = useCallback((press: PressCode, center: CenterCode, selections: { typeId: string, count: number }[], semester: string, year: string) => {
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

    const newRecords: InventoryRecord[] = [];
    selections.forEach(sel => {
      const pType = palletTypes.find(t => t.id === sel.typeId);
      for (let i = 0; i < sel.count; i++) {
        const seq = (records.length + newRecords.length + 1).toString().padStart(4, '0');
        const palletBarcode = `${pType?.stageCode}${press}${seq}${semester}${year}`;
        
        newRecords.push({
          id: generateUUID(),
          palletTypeId: sel.typeId,
          palletBarcode,
          tripId: tripId,
          truckId: '1',
          status: 'pending',
          timestamp: Date.now(),
          scannedBy: 'factory',
          destination: center
        });
      }
    });

    const updatedTrips = [...trips.map(t => ({...t, status: 'completed' as const})), newTrip];
    const updatedRecords = [...newRecords, ...records];

    setTrips(updatedTrips);
    setRecords(updatedRecords);
    setCurrentTripId(tripId);
    setActiveTab('scan');
    
    pushToSheet(palletTypes, updatedRecords, updatedTrips, users);
  }, [trips, records, palletTypes, users]);

  useEffect(() => {
    fetchFromSheet(true);
  }, [fetchFromSheet]);

  useEffect(() => {
    if (currentUser) fetchFromSheet(true);
  }, [currentUser, fetchFromSheet]);

  useEffect(() => {
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') fetchFromSheet(true); };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchFromSheet]);

  useEffect(() => {
    const interval = setInterval(() => fetchFromSheet(true), 60000);
    return () => clearInterval(interval);
  }, [fetchFromSheet]);

  useEffect(() => {
    const savedRecords = localStorage.getItem(STORAGE_KEY_RECORDS);
    if (savedRecords) setRecords(JSON.parse(savedRecords));
    const savedTrips = localStorage.getItem(STORAGE_KEY_TRIPS);
    if (savedTrips) {
      const parsed = JSON.parse(savedTrips);
      setTrips(parsed);
      const active = parsed.find((t: Trip) => t.status === 'active');
      if (active) setCurrentTripId(active.id);
    }
    const savedTypes = localStorage.getItem(STORAGE_KEY_TYPES);
    if (savedTypes) setPalletTypes(JSON.parse(savedTypes));
    const savedUsers = localStorage.getItem(STORAGE_KEY_USERS);
    if (savedUsers) setUsers(JSON.parse(savedUsers));
  }, []);

  useEffect(() => {
    if (!isSystemResetting) {
      localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(records));
      localStorage.setItem(STORAGE_KEY_TRIPS, JSON.stringify(trips));
      localStorage.setItem(STORAGE_KEY_TYPES, JSON.stringify(palletTypes));
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    }
  }, [records, trips, palletTypes, users, isSystemResetting]);

  const handleLogin = (user: UserCredentials) => setCurrentUser(user);

  if (!currentUser) return <Login users={users} onLogin={handleLogin} />;

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto bg-slate-50 shadow-2xl relative border-x border-slate-200">
      <ConfirmModal isOpen={!!showNotification} title={showNotification?.title || ''} message={showNotification?.msg || ''} confirmText="فهمت" onConfirm={() => setShowNotification(null)} onCancel={() => setShowNotification(null)} />
      
      <header className={`p-6 shadow-xl rounded-b-[2.5rem] text-white transition-all duration-500 ${currentUser.role === 'factory' ? 'bg-indigo-900' : currentUser.role === 'center' ? 'bg-emerald-900' : 'bg-slate-900'}`}>
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-md shadow-inner">
                <SubulLogo size={24} color="white" />
             </div>
             <div className="text-right">
                <h1 className="text-sm font-black tracking-tight leading-none">{currentUser.displayName}</h1>
                <button onClick={() => setCurrentUser(null)} className="text-[9px] opacity-60 font-bold hover:opacity-100 uppercase tracking-widest mt-1">تسجيل خروج</button>
             </div>
          </div>
          <div className="flex flex-col items-end gap-1">
             <div className={`px-3 py-1 rounded-full text-[8px] font-black transition-all ${syncing ? 'bg-white/30 animate-pulse' : 'bg-white/10'}`}>
                {syncing ? 'مزامنة...' : syncError || (lastSyncTime ? `تحديث: ${lastSyncTime}` : 'متصل ✓')}
             </div>
          </div>
        </div>
      </header>
      
      <main className="flex-1 overflow-y-auto p-4 pb-28">
        {activeTab === 'dashboard' && <Dashboard palletTypes={palletTypes} records={records} trips={trips} currentTripId={currentTripId} role={currentUser.role} userCode={currentUser.code} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} users={users} onSelectCenter={() => {}} onNewTrip={handleCreateTrip} />}
        {activeTab === 'scan' && <Scanner onScan={handleScan} role={currentUser.role} currentTruck={currentTruckNumber} onTruckChange={setCurrentTruckNumber} currentTripId={currentTripId} records={records} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} palletTypes={palletTypes} sheetUrl={sheetUrl} />}
        {activeTab === 'history' && <History records={records} trips={trips} palletTypes={palletTypes} role={currentUser.role} userCode={currentUser.code} userCenter={currentUser.role === 'center' ? currentUser.code as CenterCode : null} users={users} />}
        {activeTab === 'settings' && currentUser.code === 'ADMIN' && (
          <Settings 
            palletTypes={palletTypes} 
            users={users} 
            onUpdateUsers={(nu) => { setUsers(nu); pushToSheet(palletTypes, records, trips, nu); }} 
            onUpdate={(u) => { const nt = palletTypes.map(t => t.id === u.id ? u : t); setPalletTypes(nt); pushToSheet(nt, records, trips, users); }} 
            onAdd={(t) => { const nt = [...palletTypes, { ...t, id: generateUUID() }]; setPalletTypes(nt); pushToSheet(nt, records, trips, users); }} 
            onDelete={(id) => { const nt = palletTypes.filter(t => t.id !== id); setPalletTypes(nt); pushToSheet(nt, records, trips, users); }} 
            sheetUrl={sheetUrl} 
            onUrlChange={(newUrl) => { setSheetUrl(newUrl); localStorage.setItem(STORAGE_KEY_SHEET_URL, newUrl); fetchFromSheet(false, newUrl); }} 
            onManualSync={() => fetchFromSheet(false)} 
            onResetData={handleResetAllData} 
          />
        )}
      </main>
      
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-lg z-50">
        <div className="bg-white/95 backdrop-blur-2xl shadow-2xl rounded-[2.5rem] flex justify-around p-3 ring-1 ring-slate-200">
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
  <button onClick={onClick} className={`flex flex-col items-center px-5 py-3 rounded-2xl transition-all duration-300 ${active ? 'bg-indigo-600 text-white shadow-lg scale-105' : 'text-slate-400 hover:text-indigo-400'}`}>
    <span className="text-[11px] font-black">{label}</span>
  </button>
);
