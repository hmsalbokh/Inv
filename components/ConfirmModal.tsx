
import React from 'react';

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'info';
}

export const ConfirmModal: React.FC<Props> = ({ isOpen, title, message, onConfirm, onCancel, confirmText = 'تأكيد', cancelText = 'إلغاء', type = 'info' }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[2000] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-6 animate-fadeIn">
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 shadow-2xl text-right">
        <h3 className="text-xl font-black text-slate-800">{title}</h3>
        <p className="text-sm text-slate-500 font-bold">{message}</p>
        <div className="flex flex-col gap-2 pt-4">
          <button onClick={onConfirm} className={`w-full p-5 rounded-2xl font-black text-sm text-white ${type === 'danger' ? 'bg-rose-600' : 'bg-indigo-900'}`}>{confirmText}</button>
          <button onClick={onCancel} className="w-full bg-slate-100 p-4 rounded-2xl font-black text-xs">إلغاء</button>
        </div>
      </div>
    </div>
  );
};
