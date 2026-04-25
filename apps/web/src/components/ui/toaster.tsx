import { create } from 'zustand';
import { useEffect } from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';

type ToastKind = 'default' | 'destructive';

export interface ToastItem {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastKind;
  duration?: number;
}

interface ToastState {
  toasts: ToastItem[];
  show: (t: Omit<ToastItem, 'id'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (t) => {
    const id = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36)) as string;
    set((state) => ({ toasts: [...state.toasts, { id, ...t }] }));
    return id;
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export function toast(input: Omit<ToastItem, 'id'>) {
  return useToastStore.getState().show(input);
}

export function dismissToast(id: string) {
  useToastStore.getState().dismiss(id);
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <ToastProvider>
      {toasts.map((item) => (
        <ToastItemRenderer
          key={item.id}
          item={item}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(item.id);
            }
          }}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}

function ToastItemRenderer({
  item,
  onOpenChange,
}: {
  item: ToastItem;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    // noop; Radix handles auto-dismiss via duration prop
  }, [item.id]);
  return (
    <Toast
      variant={item.variant}
      duration={item.duration ?? 4200}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-0.5">
        {item.title ? <ToastTitle>{item.title}</ToastTitle> : null}
        {item.description ? (
          <ToastDescription>{item.description}</ToastDescription>
        ) : null}
      </div>
      <ToastClose />
    </Toast>
  );
}
