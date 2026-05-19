import React, { useEffect } from 'react';
import { CheckCircle2, X, AlertCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
  type?: 'success' | 'error' | 'warning';
}

const Toast: React.FC<ToastProps> = ({ message, isVisible, onClose, duration = 3000, type = 'success' }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose, duration]);

  if (!isVisible) return null;

  const isSuccess = type === 'success';
  const bgColor = isSuccess ? 'bg-emerald-600' : type === 'error' ? 'bg-red-600' : 'bg-amber-600';
  const borderColor = isSuccess ? 'border-emerald-400/30' : type === 'error' ? 'border-red-400/30' : 'border-amber-400/30';

  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[1000] animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className={`bg-[#1E1E2E] border ${borderColor} text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[300px]`}>
        <div className={`w-8 h-8 ${bgColor} rounded-full flex items-center justify-center flex-shrink-0`}>
          {isSuccess ? <CheckCircle2 size={18} className="text-white" /> : <AlertCircle size={18} className="text-white" />}
        </div>
        <p className="font-black text-sm flex-1">{message}</p>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>
    </div>
  );
};

export default Toast;
