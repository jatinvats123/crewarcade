'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type ToastTone = 'info' | 'success' | 'danger';
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<((text: string, tone?: ToastTone) => void) | null>(null);

const TONE: Record<ToastTone, string> = {
  info: 'border-border',
  success: 'border-success/50',
  danger: 'border-danger/60',
};
const ICON: Record<ToastTone, string> = { info: 'ℹ️', success: '✅', danger: '⚠️' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setItems(list => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 3500);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe" aria-live="polite" role="status">
        {items.map(t => (
          <div
            key={t.id}
            className={cn(
              'animate-slide-up pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl border bg-surface px-4 py-3 text-sm shadow-card',
              TONE[t.tone],
            )}
          >
            <span aria-hidden>{ICON[t.tone]}</span>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
