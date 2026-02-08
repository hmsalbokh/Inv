
import React, { useState, useEffect } from 'react';
import { PalletType, UserCredentials, UserRole, PressCode, CenterCode } from '../types';
import { ConfirmModal } from './ConfirmModal';

interface Props {
  palletTypes: PalletType[];
  users: UserCredentials[];
  onUpdateUsers: (newUsers: UserCredentials[]) => void;
  onUpdate: (type: PalletType) => void;
  onAdd: (type: Omit<PalletType, 'id'>) => void;
  onDelete: (id: string) => void;
  sheetUrl: string;
  onUrlChange: (url: string) => void;
  onManualSync: () => void;
  onResetData: () => Promise<void>;
}

export const Settings: React.FC<Props> = ({ palletTypes, users, onUpdateUsers, onUpdate, onAdd, onDelete, sheetUrl, onUrlChange, onManualSync, onResetData }) => {
  const [tab, setTab] = useState<'stages' | 'users' | 'cloud'>('users');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState<string | null>(null);
  const [isUrlLocked, setIsUrlLocked] = useState(true);
  const [adminPassword, setAdminPassword] = useState('');
  const [tempUrl, setTempUrl] = useState(sheetUrl);
  
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
    cartonsPerPallet: 24
  });

  const CORRECT_ADMIN_PASSWORD = 'H0566749388h';

  useEffect(() => { setTempUrl(sheetUrl); }, [sheetUrl]);

  const handleUnlockCloud = () => {
    if (adminPassword === CORRECT_ADMIN_PASSWORD) { 
      setIsUrlLocked(false); 
      setAdminPassword(''); 
    } else { 
      alert('كلمة المرور غير صحيحة');
    }
  };

  const handleSaveUrl = () => { if (!tempUrl) return; onUrlChange(tempUrl); setIsUrlLocked(true); };

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
    let newUsers = [...users];
    if (editingUserId) newUsers = newUsers.map(u => u.id === editingUserId ? { ...userFormData, id: editingUserId } : u);
    else newUsers.push({ ...userFormData, id: crypto.randomUUID() });
    onUpdateUsers(newUsers); 
    setShowUserForm(false);
  };

  const handleOpenStageForm = (stage?: PalletType) => {
    if (stage) {
      setEditingStage(stage);
      setStageFormData({ stageCode: stage.stageCode, stageName: stage.stageName, cartonsPerPallet: stage.cartonsPerPallet });
    } else {
      setEditingStage(null);
      setStageFormData({ stageCode: '', stageName: '', cartonsPerPallet: 24 });
    }
    setShowStageForm(true);
  };

  const handleSaveStage = () => {
    if (editingStage) onUpdate({ ...stageFormData, id: editingStage.id });
    else onAdd(stageFormData);
    setShowStageForm(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-10 text-right" dir="rtl">
      <ConfirmModal isOpen={showResetConfirm} title="تصفير السجلات" message="سيتم حذف كافة السجلات والرحلات بشكل نهائي من الجهاز ومن جوجل شيت. هل أنت متأكد؟" type="danger" onConfirm={async () => { setShowResetConfirm(false); await onResetData(); }} onCancel={() => setShowResetConfirm(false)} />
      <ConfirmModal isOpen={!!showDeleteUserConfirm} title="حذف مستخدم" message="هل تريد حذف هذا الحساب؟ لن يتمكن المستخدم من الدخول بعد الآن." type="danger" onConfirm={() => { onUpdateUsers(users.filter(u => u.id !== showDeleteUserConfirm)); setShowDeleteUserConfirm(null); }} onCancel={() => setShowDeleteUserConfirm(null)} />
      
      <div className="flex bg-slate-200/50 p-1.5 rounded-3xl gap-1 sticky top-0 z-10 backdrop-blur-md">
        <button onClick={() => setTab('cloud')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'cloud' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>☁️ المزامنة</button>
        <button onClick={() => setTab('stages')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'stages' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>📚 المراحل</button>
        <button onClick={() => setTab('users')} className={`flex-1 py-3 rounded-2xl text-[11px] font-black transition-all ${tab === 'users' ? 'bg-indigo-900 text-white shadow-lg' : 'text-slate-500 hover:bg-white/50'}`}>👤 المستخدمين</button>
      </div>

      {tab === 'cloud' && (
        <div className="space-y-4 animate-fadeIn">
          <section className="bg-indigo-900 text-white p-8 rounded-[2.5rem] shadow-xl border-4 border-white/10">
            <h2 className="text-sm font-black mb-4 flex items-center gap-2">☁️ إعدادات الربط السحابي (Google Sheets)</h2>
            <div className="space-y-4">
              {isUrlLocked ? (
                <div className="space-y-4">
                   <div className="bg-black/20 p-4 rounded-xl text-[10px] break-all font-mono opacity-60 border border-white/5">{sheetUrl}</div>
                   <div className="flex gap-2">
                      <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} className="flex-1 bg-white/10 p-4 rounded-xl text-white outline-none border border-white/10 placeholder:text-white/30" placeholder="كلمة مرور المسئول" />
                      <button onClick={handleUnlockCloud} className="bg-white text-indigo-900 px-6 rounded-xl font-black text-xs active:scale-95 transition-all">فتح القفل</button>
                   </div>
                </div>
              ) : (
                <div className="space-y-4 animate-slideDown">
                   <div className="space-y-1">
                      <label className="text-[10px] font-black text-indigo-300 block mr-2">رابط Script API الخاص بجوجل شيت</label>
                      <textarea value={tempUrl} onChange={e => setTempUrl(e.target.value)} className="w-full bg-white p-4 rounded-xl text-indigo-900 text-[10px] font-mono min-h-[100px] outline-none" placeholder="https://script.google.com/..." />
                   </div>
                   <div className="flex gap-2">
                      <button onClick={handleSaveUrl} className="flex-1 bg-emerald-500 text-white p-4 rounded-xl font-black text-xs shadow-lg active:scale-95 transition-all">حفظ التغييرات</button>
                      <button onClick={() => setIsUrlLocked(true)} className="bg-white/10 px-6 rounded-xl font-black text-xs active:scale-95 transition-all">إلغاء</button>
                   </div>
                </div>
              )}
            </div>
          </section>
          <div className="grid grid-cols-2 gap-3">
             <button onClick={onManualSync} className="bg-white border-2 border-indigo-600 text-indigo-600 p-5 rounded-2xl font-black text-xs shadow-sm active:scale-95 transition-all">🔄 تحديث البيانات الآن</button>
             <button onClick={() => setShowResetConfirm(true)} className="bg-rose-50 text-rose-600 p-5 rounded-2xl border border-rose-100 font-black text-xs active:scale-95 transition-all">🗑️ تصفير النظام بالكامل</button>
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
            <button onClick={() => handleOpenStageForm()} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md">+ مرحلة جديدة</button>
          </div>
          <div className="grid gap-3">
            {palletTypes.map(t => (
              <div key={t.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm flex justify-between items-center group">
                <div className="text-right">
                  <h3 className="text-xs font-black text-slate-800">{t.stageName}</h3>
                  <div className="flex gap-2 items-center mt-1">
                    <span className="text-[8px] font-black px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 uppercase">كود: {t.stageCode}</span>
                    <span className="text-[8px] font-bold text-slate-400">{t.cartonsPerPallet} كرتون / طبلية</span>
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

      {/* نموذج إضافة/تعديل مستخدم */}
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
                   <select value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value as UserRole})} className="bg-slate-50 p-4 rounded-xl text-xs font-black">
                      <option value="factory">مطبعة</option>
                      <option value="center">مركز استلام</option>
                      <option value="monitor">مراقب/مسئول</option>
                   </select>
                   <input type="text" value={userFormData.code} onChange={e => setUserFormData({...userFormData, code: e.target.value as any})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكود (RYD, OPK..)" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveUser} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ</button>
                 <button onClick={() => setShowUserForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}

      {/* نموذج إضافة/تعديل مرحلة */}
      {showStageForm && (
        <div className="fixed inset-0 z-[7000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
           <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-5 shadow-2xl relative">
              <h3 className="text-lg font-black text-slate-800">{editingStage ? 'تعديل المرحلة' : 'إضافة مرحلة كتب جديدة'}</h3>
              <div className="space-y-3">
                <input type="text" value={stageFormData.stageName} onChange={e => setStageFormData({...stageFormData, stageName: e.target.value})} className="w-full bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="اسم المرحلة (مثلاً: الصف الأول الابتدائي)" />
                <div className="grid grid-cols-2 gap-2">
                   <input type="text" value={stageFormData.stageCode} onChange={e => setStageFormData({...stageFormData, stageCode: e.target.value})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="كود المرحلة (مثلاً: G01)" />
                   <input type="number" value={stageFormData.cartonsPerPallet} onChange={e => setStageFormData({...stageFormData, cartonsPerPallet: parseInt(e.target.value) || 0})} className="bg-slate-50 p-4 rounded-xl text-xs font-bold border border-slate-100 outline-none" placeholder="الكراتين لكل طبلية" />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                 <button onClick={handleSaveStage} className="flex-1 bg-indigo-900 text-white p-4 rounded-xl font-black text-xs active:scale-95 transition-all">حفظ المرحلة</button>
                 <button onClick={() => setShowStageForm(false)} className="bg-slate-100 text-slate-400 px-6 rounded-xl font-black text-xs">إلغاء</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
