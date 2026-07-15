"use client";

import { useCallback, useState } from "react";

export type ToastVariant = "success" | "error" | "warning";

interface ToastMessage {
  id: number;
  message: string;
  variant: ToastVariant;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-accent bg-accent/10 text-accent",
  error: "border-danger bg-danger/10 text-danger",
  warning: "border-warning bg-warning/10 text-warning",
};

const TOAST_DURATION_MS = 5000;

let nextToastId = 0;

// Lightweight toast system — no external library, scoped to whichever
// component calls useToasts(). Auto-dismisses after 5 seconds.
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return { toasts, showToast };
}

export function ToastContainer({ toasts }: { toasts: ToastMessage[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-md border px-4 py-3 text-sm shadow-lg fade-in-row ${VARIANT_STYLES[t.variant]}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
