import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { hasError, error } = this.state;
    if (hasError) {
      let errorMessage = "حدث خطأ غير متوقع في النظام.";
      
      try {
        const parsedError = JSON.parse(error?.message || "");
        if (parsedError.error && parsedError.operationType) {
          errorMessage = `خطأ في قاعدة البيانات (${parsedError.operationType}): ${parsedError.error}`;
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-right" dir="rtl">
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border-2 border-rose-100 max-w-md w-full space-y-4">
            <div className="text-4xl text-center">⚠️</div>
            <h2 className="text-xl font-black text-rose-900 text-center">عذراً، حدث خطأ</h2>
            <p className="text-sm font-bold text-slate-600 leading-relaxed">
              {errorMessage}
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="w-full bg-indigo-900 text-white p-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all"
            >
              إعادة تحميل التطبيق
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
