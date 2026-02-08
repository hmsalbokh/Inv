
import React, { useState, useMemo } from 'react';
import { UserCredentials } from '../types';
import { SubulLogo } from './Dashboard';

interface Props {
  users: UserCredentials[];
  onLogin: (user: UserCredentials) => void;
}

type LoginCategory = 'center' | 'factory' | 'monitor' | null;

export const Login: React.FC<Props> = ({ users, onLogin }) => {
  const [category, setCategory] = useState<LoginCategory>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const filteredUsers = useMemo(() => {
    if (!category) return [];
    return users.filter(u => u.role === category);
  }, [category, users]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.id === selectedEntityId);
    if (user && user.username === username && user.password === password) { onLogin(user); }
    else { setError('بيانات خطأ'); setTimeout(() => setError(''), 3000); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-right overflow-hidden relative" dir="rtl">
      {/* عناصر خلفية جمالية */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-2xl"></div>

      <div className="w-full max-w-md bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 animate-fadeIn relative z-10 border border-slate-100">
        <div className="text-center space-y-4">
          <div className="inline-flex p-5 bg-gradient-to-br from-indigo-900 to-indigo-700 rounded-[2.5rem] shadow-2xl shadow-indigo-900/30">
             <SubulLogo size={70} color="white" />
          </div>
          <div className="space-y-1">
             <h1 className="text-2xl font-black text-indigo-900">بوابة اللوجستيات</h1>
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">منصة سبل لإدارة مخزون الكتب</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setCategory('monitor')} className={`p-4 rounded-2xl border-2 transition-all font-black text-[10px] ${category === 'monitor' ? 'bg-indigo-900 text-white border-transparent shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>مسئول</button>
            <button onClick={() => setCategory('factory')} className={`p-4 rounded-2xl border-2 transition-all font-black text-[10px] ${category === 'factory' ? 'bg-indigo-900 text-white border-transparent shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>مطبعة</button>
            <button onClick={() => setCategory('center')} className={`p-4 rounded-2xl border-2 transition-all font-black text-[10px] ${category === 'center' ? 'bg-indigo-900 text-white border-transparent shadow-lg' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>مركز</button>
        </div>

        {category ? (
          <form onSubmit={handleLogin} className="space-y-4 animate-slideDown">
             <select value={selectedEntityId} onChange={e => setSelectedEntityId(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 font-black text-xs outline-none border-2 border-slate-100 focus:border-indigo-500 transition-colors">
                <option value="">اختر الحساب...</option>
                {filteredUsers.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
             </select>
             {selectedEntityId && (
               <div className="space-y-3 animate-fadeIn">
                 <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 font-bold text-xs outline-none border-2 border-slate-100 focus:border-indigo-500 transition-colors" placeholder="اسم المستخدم" />
                 <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 font-bold text-xs outline-none border-2 border-slate-100 focus:border-indigo-500 transition-colors" placeholder="كلمة المرور" />
                 <button type="submit" className="w-full bg-gradient-to-r from-indigo-900 to-indigo-700 text-white p-6 rounded-2xl font-black shadow-xl shadow-indigo-900/20 active:scale-95 transition-all text-sm">دخول النظام</button>
               </div>
             )}
          </form>
        ) : (
          <div className="py-10 text-center space-y-2">
             <p className="text-xs font-bold text-slate-400">يرجى اختيار نوع الحساب للمتابعة</p>
             <div className="flex justify-center gap-1">
                <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
                <div className="w-1 h-1 bg-slate-200 rounded-full"></div>
             </div>
          </div>
        )}
        {error && <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-center font-black text-xs border border-rose-100 animate-shake">{error}</div>}
      </div>
    </div>
  );
};
