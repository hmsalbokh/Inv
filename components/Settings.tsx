
import React, { useState, useEffect } from 'react';
import { PalletType, UserCredentials, UserRole, PressCode, CenterCode, SystemLog } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { db } from '../firebase';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface Props {
  palletTypes: PalletType[];
  users: UserCredentials[];
  onUpdateUsers: (newUsers: UserCredentials[]) => void;
  onUpdate: (type: PalletType) => void;
  onAdd: (type: Omit<PalletType, 'id'>) => void;
  onDelete: (id: string) => void;
  onResetData: () => Promise<void>;
  onResetStages: () => Promise<void>;
  onNotify: (title: string, msg: string) => void;
}

export const Settings: React.FC<Props> = ({ palletTypes, users, onUpdateUsers, onUpdate, onAdd, onDelete, onResetData, onResetStages, onNotify }) => {
  const [tab, setTab] = useState<'stages' | 'users' | 'logs'>('users');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showResetStagesConfirm, setShowResetStagesConfirm] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<SystemLog[]>([]);

  useEffect(() => {
    if (tab === 'logs') {
      const q = query(collection(db, 'system_logs'), orderBy('timestamp', 'desc'), limit(100));
      const unsub = onSnapshot(q, (snap) => {
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SystemLog)));
      });
      return () => unsub();
    }
  }, [tab]);
  
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userFormData, setUserFormData] = useState<Omit<UserCredentials, 'id'>>({
    role: 'factory',
    code: 'OPK',
    username: '',
    password: '',
    displayName: ''
  });

  const [showStageForm, setShowStageForm] = useState(false);
  const [editingStage, setEditingStage] = useState<PalletType | null>(null);
  const [stageFormData, setStageFormData] = useState<Omit<PalletType, 'id'>>({
    stageCode: '',
    stageName: '',
    cartonsPerPallet: 24,
    bundlesPerCarton: 5
  });

  const handleOpenUserForm = (user?: UserCredentials) => {
    if (user) { 
      setEditingUserId(user.id); 
      setUserFormData({ role: user.role, code: user.code, username: user.username, password: user.password, displayName: user.displayName }); 
    } else { 
      setEditingUserId(null); 
      setUserFormData({ role: 'factory', code: 'OPK', username: '', password: '', displayName: '' }); 
    }
    setShowUserForm(true);
  };

  const handleSaveUser = () => {
    if (!userFormData.username || !userFormData.password || !userFormData.displayName || !userFormData.code) {
      onNotify('تنبيه', 'يرجى إكمال كافة البيانات');
      return;
    }
    if (!editingUserId && users.some(u => u.username === userFormData.username)) {
      onNotify('تنبيه', 'اسم المستخدم موجود مسبقاً');
      return;
    }
    let newUsers = [...users];
    if (editingUserId) newUsers = newUsers.map(u => u.id === editingUserId ? { ...userFormData, id: editingUserId } : u);
    else newUsers.push({ ...userFormData, id: Date.now().toString() });
    onUpdateUsers(newUsers); 
    setShowUserForm(false);
  };

  const handleOpenStageForm = (stage?: PalletType) => {
    if (stage) {
      setEditingStage(stage);
      setStageFormData({ stageCode: stage.stageCode, stageName: stage.stageName, cartonsPerPallet: stage.cartonsPerPallet, bundlesPerCarton: stage.bundlesPerCarton || 5 });
    } else {
      setEditingStage(null);
      setStageFormData({ stageCode: '', stageName: '', cartonsPerPallet: 24, bundlesPerCarton: 5 });
    }
    setShowStageForm(true);
  };

  const handleSaveStage = () => {
    if (!stageFormData.stageName || !stageFormData.stageCode) {
      onNotify('تنبيه', 'يرجى إكمال بيانات المرحلة');
      return;
    }
    if (editingStage) onUpdate({ ...stageFormData, id: editingStage.id });
    else onAdd(stageFormData);
    setShowStageForm(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <ConfirmModal isOpen={showResetConfirm} title="تصفير البيانات" message="سيتم حذف رحلات التوزيع وسجلات المخزون فقط بشكل نهائي من السحابة. (المراحل والحسابات ستبقى كما هي). هل أنت متأكد؟" type="danger" onConfirm={async () => { setShowResetConfirm(false); await onResetData(); }} onCancel={() => setShowResetConfirm(false)} />
      <ConfirmModal isOpen={showResetStagesConfirm} title="إعادة تهيئة المراحل" message="سيتم حذف كافة المراحل الحالية واستبدالها بالمراحل الافتراضية للتعليم العام والعالمي. هل أنت متأكد؟" type="danger" onConfirm={async () => { setShowResetStagesConfirm(false); await onResetStages(); }} onCancel={() => setShowResetStagesConfirm(false)} />
      <ConfirmModal isOpen={!!showDeleteUserConfirm} title="حذف مستخدم" message="هل تريد حذف هذا الحساب؟ لن يتمكن المستخدم من الدخول بعد الآن." type="danger" onConfirm={() => { onUpdateUsers(users.filter(u => u.id !== showDeleteUserConfirm)); setShowDeleteUserConfirm(null); }} onCancel={() => setShowDeleteUserConfirm(null)} />
      
      <div className="flex bg-slate-200/50 p-1.5 rounded-3xl gap-1 sticky top-0 z-10 backdrop-blur-md">
        <button onClick={() => setTab('stages')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'stages' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>📚 المراحل</button>
        <button onClick={() => setTab('users')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'users' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>👤 المستخدمين</button>
        <button onClick={() => setTab('logs')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'logs' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>🚨 سجل الأخطاء</button>
      </div>

      <div className="px-4">
        <button onClick={() => setShowResetConfirm(true)} className="w-full bg-rose-50 text-rose-600 p-4 rounded-2xl border border-rose-100 font-black text-xs active:scale-95 transition-all mb-4">🗑️ تصفير كافة البيانات السحابية</button>
      </div>

      {tab === 'logs' && (
        <div className="space-y-4 animate-fadeIn px-2">
          <div className="flex justify-between items-center px-2">
            <h2 className="text-sm font-black text-slate-800">سجل أخطاء النظام الحية</h2>
            <span className="text-[10px] font-bold text-slate-400">آخر 100 خطأ</span>
          </div>
          <div className="space-y-3">
             {logs.length === 0 ? (
                <div className="text-center p-8 bg-slate-50 rounded-3xl">
                   <p className="text-slate-400 font-bold text-xs">لا توجد أخطاء مسجلة حالياً</p>
                </div>
             ) : (
                logs.map(log => (
                  <div key={log.id} className={`p-4 rounded-3xl border-2 flex flex-col gap-2 ${log.type === 'login_error' ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100'}`}>
                    <div className="flex justify-between items-center">
                       <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${log.type === 'login_error' ? 'bg-amber-200 text-amber-800' : 'bg-rose-200 text-rose-800'}`}>
                           {log.type === 'login_error' ? 'دخول خاطئ' : 'مسح الباركود'}
                       </span>
                       <span className="text-[10px] font-bold text-slate-500" dir="ltr">
                          {new Date(log.timestamp).toLocaleString('en-GB')}
                       </span>
                    </div>
                    <div>
                       <h4 className="text-xs font-black text-slate-800">{log.message}</h4>
                       <p className="text-[10px] font-bold text-slate-600 mt-1">{log.details}</p>
                    </div>
                    <div className="text-[10px] font-bold text-indigo-600 bg-white/50 w-fit px-2 py-1 rounded-md mt-1">
                       مُنفذ بواسطة: {log.userId}
                    </div>
                  </div>
                ))
             )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex justify-between items-center px-4">
            <h2 className="text-sm font-black text-slate-800">إدارة الحسابات المسموح لها</h2>
            <button onClick={() => handleOpenUserForm()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md">+ حساب جديد</button>
          </div>
          <div className="grid gap-3">
            {users.map(u => (
              <div key={u.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group hover:border-indigo-200 transition-all">
                <div className="text-right">
                  <h3 className="text-xs font-black text-slate-800">{u.displayName}</h3>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 uppercase tracking-widest">{u.role}</span>
                    <span className="text-[8px] font-bold text-slate-400">كود: {u.code}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => handleOpenUserForm(u)} className="p-2 text-indigo-400 hover:bg-indigo-50 rounded-lg">✏️</button>
                   {u.code !== 'ADMIN' && <button onClick={() => setShowDeleteUserConfirm(u.id)} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg">🗑️</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'stages' && (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex justify-between items-center px-4">
            <h2 className="text-sm font-black text-slate-800">إدارة المراحل والطبليات</h2>
            <div className="flex gap-2">
              <button onClick={() => setShowResetStagesConfirm(true)} className="bg-rose-50 text-rose-600 px-4 py-2 rounded-xl text-[10px] font-black border border-rose-100 shadow-sm">🔄 إعادة تهيئة</button>
              <button onClick={() => handleOpenStageForm()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md">+ مرحلة جديدة</button>
            </div>
          </div>
          <div className="grid gap-3">
            {palletTypes.map(t => (
              <div key={t.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group">
                <div className="text-right">
                  <h3 className="text-xs font-black text-slate-800">{t.stageName}</h3>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 uppercase">كود: {t.stageCode}</span>
                    <span className="text-[8px] font-bold text-slate-400">{t.cartonsPerPallet} كرتون | {t.bundlesPerCarton} حزمة/كرتون</span>
                  </div>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => handleOpenStageForm(t)} className="p-2 text-indigo-400 hover:bg-indigo-50 rounded-lg">✏️</button>
                   <button onClick={() => onDelete(t.id)} className="p-2 text-rose-400 hover:bg-rose-50 rounded-lg">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* نموذج تعديل مرحلة معدل ليشمل عدد الحزم */}
      {showStageForm && (
        <div className="fixed inset-0 z-[7000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl relative">
              <h3 className="text-lg font-black text-slate-800">{editingStage ? 'تعديل المرحلة' : 'إضافة مرحلة كتب جديدة'}</h3>
              <div className="space-y-3">
                <input type="text" value={stageFormData.stageName} onChange={e => setStageFormData({...stageFormData, stageName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المرحلة (مثلاً: الصف الأول الابتدائي)" />
                <div className="grid grid-cols-1 gap-2">
                   <input type="text" value={stageFormData.stageCode} onChange={e => setStageFormData({...stageFormData, stageCode: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="كود المرحلة (مثلاً: G01)" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 block mr-2">كرتون / طبلية</label>
                      <input type="number" value={stageFormData.cartonsPerPallet} onChange={e => setStageFormData({...stageFormData, cartonsPerPallet: parseInt(e.target.value) || 0})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكراتين" />
                   </div>
                   <div className="space-y-1">
                      <label className="text-[8px] font-black text-slate-400 block mr-2">حزمة / كرتون</label>
                      <input type="number" value={stageFormData.bundlesPerCarton} onChange={e => setStageFormData({...stageFormData, bundlesPerCarton: parseInt(e.target.value) || 0})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الحزم" />
                   </div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveStage} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ المرحلة</button>
                 <button onClick={() => setShowStageForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}

      {/* ... (rest of Settings form stay same) */}
      {showUserForm && (
        <div className="fixed inset-0 z-[7000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl relative">
              <h3 className="text-lg font-black text-slate-800">{editingUserId ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h3>
              <div className="space-y-3">
                <input type="text" value={userFormData.displayName} onChange={e => setUserFormData({...userFormData, displayName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الاسم المعروض (مثلاً: مطبعة العبيكان)" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={userFormData.username} onChange={e => setUserFormData({...userFormData, username: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المستخدم" />
                  <input type="password" value={userFormData.password} onChange={e => setUserFormData({...userFormData, password: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="كلمة المرور" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <select value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value as UserRole, code: e.target.value === 'center' ? 'DMM' : e.target.value === 'factory' ? 'OPK' : 'STATS'})} className="bg-slate-50 p-4 rounded-xl text-xs font-black outline-none border border-slate-100">
                      <option value="factory">مطبعة</option>
                      <option value="center">مركز استلام</option>
                      <option value="monitor">مراقب/مسئول</option>
                   </select>
                   
                   {userFormData.role === 'center' ? (
                     <div className="relative">
                       <select 
                         value={['DMM', 'RYD', 'JED'].includes(userFormData.code) ? userFormData.code : userFormData.code ? 'OTHER' : 'DMM'} 
                         onChange={e => setUserFormData({...userFormData, code: e.target.value === 'OTHER' ? '' : e.target.value})} 
                         className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none"
                       >
                         <option value="DMM">مركز الدمام (DMM)</option>
                         <option value="RYD">مركز الرياض (RYD)</option>
                         <option value="JED">مركز جدة (JED)</option>
                         <option value="OTHER">مركز آخر (إدخال يدوي)</option>
                       </select>
                       {!['DMM', 'RYD', 'JED'].includes(userFormData.code) && (
                         <input 
                           type="text" 
                           value={userFormData.code} 
                           onChange={e => setUserFormData({...userFormData, code: e.target.value})} 
                           placeholder="أدخل كود المركز الجديد" 
                           className="absolute inset-0 bg-white p-4 rounded-xl text-xs font-bold border border-indigo-500 outline-none w-full" 
                           autoFocus
                         />
                       )}
                     </div>
                   ) : userFormData.role === 'factory' ? (
                     <div className="relative">
                       <select 
                         value={['OPK', 'UNI'].includes(userFormData.code) ? userFormData.code : userFormData.code ? 'OTHER' : 'OPK'} 
                         onChange={e => setUserFormData({...userFormData, code: e.target.value === 'OTHER' ? '' : e.target.value})} 
                         className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none"
                       >
                         <option value="OPK">مطبعة العبيكان (OPK)</option>
                         <option value="UNI">المطبعة المتحدة (UNI)</option>
                         <option value="OTHER">مطبعة أخرى (إدخال يدوي)</option>
                       </select>
                       {!['OPK', 'UNI'].includes(userFormData.code) && (
                         <input 
                           type="text" 
                           value={userFormData.code} 
                           onChange={e => setUserFormData({...userFormData, code: e.target.value})} 
                           placeholder="أدخل كود المطبعة الجديد" 
                           className="absolute inset-0 bg-white p-4 rounded-xl text-xs font-bold border border-indigo-500 outline-none w-full" 
                           autoFocus
                         />
                       )}
                     </div>
                   ) : (
                     <input type="text" value={userFormData.code} onChange={e => setUserFormData({...userFormData, code: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكود (ADMIN, الخ)" />
                   )}
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveUser} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ</button>
                 <button onClick={() => setShowUserForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
