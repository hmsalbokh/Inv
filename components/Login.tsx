
import React, { useState, useMemo } from 'react';
import { UserCredentials } from '../types';
import { SubulLogo } from './Dashboard';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

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

  const groupedEntities = useMemo(() => {
    if (!category) return [];
    const uniqueCodes = new Map();
    users.filter(u => u.role === category).forEach(u => {
      if (!uniqueCodes.has(u.code)) {
        // Find best display name for this code
        let baseName = u.displayName;
        if (baseName.includes('(')) {
           baseName = baseName.split('(')[1].replace(')', '').trim();
           // if standard format we might just use the code
        } else {
           // extract center name without user specific if possible, or just default to nice names
           if (category === 'center') {
             if (u.code === 'DMM') baseName = 'مركز الدمام';
             else if (u.code === 'RYD') baseName = 'مركز الرياض';
             else if (u.code === 'JED') baseName = 'مركز جدة';
           } else if (category === 'factory') {
             if (u.code === 'OPK') baseName = 'مطبعة العبيكان';
             else if (u.code === 'UNI') baseName = 'المطبعة المتحدة';
           }
        }
        uniqueCodes.set(u.code, { code: u.code, label: baseName });
      }
    });
    return Array.from(uniqueCodes.values());
  }, [category, users]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    // find any user that matches the selected code AND has the matching username/password
    const user = users.find(u => u.code === selectedEntityId && u.username === username && u.password === password);
    if (user) { 
      onLogin(user); 
    }
    else { 
      setError('بيانات خطأ'); 
      setTimeout(() => setError(''), 3000); 
      // Log the error
      try {
        await addDoc(collection(db, 'system_logs'), {
          timestamp: Date.now(),
          type: 'login_error',
          userId: username || 'مجهول',
          message: 'محاولة تسجيل دخول فاشلة',
          details: `تمت محاولة الدخول الكود: ${selectedEntityId} باسم مستخدم غير صحيح: ${username}`
        });
      } catch (err) {
        console.error('Failed to log error', err);
      }
    }
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
             <h1 className="text-2xl font-black text-indigo-900 leading-tight">منصة إدارة مخزون مشروع التعليم</h1>
             <p className="text-[12px] font-black text-slate-400 uppercase tracking-widest">بوابة اللوجستيات</p>
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
                <option value="">اختر المركز / الجهة...</option>
                {groupedEntities.map(g => <option key={g.code} value={g.code}>{g.label}</option>)}
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
