
import React, { useState, useMemo } from 'react';
import { UserCredentials } from '../types';

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
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-right" dir="rtl">
      <div className="w-full max-w-md bg-white p-8 rounded-[3rem] shadow-2xl space-y-8 animate-fadeIn">
        <div className="text-center space-y-2">
          <div className="text-6xl mb-4">📚</div>
          <h1 className="text-2xl font-black text-indigo-900">بوابة اللوجستيات</h1>
        </div>
        <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setCategory('monitor')} className={`p-4 rounded-2xl border-2 ${category === 'monitor' ? 'bg-indigo-900 text-white' : 'bg-slate-50'}`}>مسئول</button>
            <button onClick={() => setCategory('factory')} className={`p-4 rounded-2xl border-2 ${category === 'factory' ? 'bg-indigo-900 text-white' : 'bg-slate-50'}`}>مطبعة</button>
            <button onClick={() => setCategory('center')} className={`p-4 rounded-2xl border-2 ${category === 'center' ? 'bg-indigo-900 text-white' : 'bg-slate-50'}`}>مركز</button>
        </div>
        {category && (
          <form onSubmit={handleLogin} className="space-y-4">
             <select value={selectedEntityId} onChange={e => setSelectedEntityId(e.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 font-bold outline-none border-2">
                <option value="">اختر الحساب...</option>
                {filteredUsers.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
             </select>
             {selectedEntityId && (
               <>
                 <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 font-bold outline-none border-2" placeholder="اسم المستخدم" />
                 <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 font-bold outline-none border-2" placeholder="كلمة المرور" />
                 <button type="submit" className="w-full bg-indigo-900 text-white p-5 rounded-2xl font-black shadow-xl">دخول</button>
               </>
             )}
             {error && <p className="text-rose-500 text-center font-black">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
};
