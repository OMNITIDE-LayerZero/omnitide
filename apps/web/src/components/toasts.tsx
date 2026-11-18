"use client";

import { useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, Loader2, X } from "lucide-react";

export interface Toast {
  id: number;
  kind: "pending" | "success" | "error";
  title: string;
  body?: string;
  href?: string;
}

let toasts: Toast[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export const toast = {
  push(t: Omit<Toast, "id">) {
    const id = ++seq;
    toasts = [...toasts, { ...t, id }].slice(-4);
    emit();
    if (t.kind !== "pending") setTimeout(() => toast.dismiss(id), 7_000);
    return id;
  },
  update(id: number, t: Partial<Omit<Toast, "id">>) {
    toasts = toasts.map((x) => (x.id === id ? { ...x, ...t } : x));
    emit();
    if (t.kind && t.kind !== "pending") setTimeout(() => toast.dismiss(id), 7_000);
  },
  dismiss(id: number) {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  },
};

const ICON = { pending: Loader2, success: CheckCircle2, error: CircleAlert };
const TONE = { pending: "text-accent-ink", success: "text-flood", error: "text-ebb" };

export function Toasts() {
  const list = useSyncExternalStore((s) => (subs.add(s), () => subs.delete(s)), () => toasts, () => toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {list.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className="rise pointer-events-auto flex gap-3 rounded-xl border border-line bg-card p-4 shadow-md">
            <Icon size={18} strokeWidth={1.5} className={`mt-0.5 shrink-0 ${TONE[t.kind]} ${t.kind === "pending" ? "animate-spin" : ""}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{t.title}</p>
              {t.body && <p className="mt-1 text-[13px] leading-5 break-words text-ink-2">{t.body}</p>}
              {t.href && (
                <a href={t.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-accent-ink hover:underline">
                  View transaction
                  <ExternalLink size={12} strokeWidth={1.5} />
                </a>
              )}
            </div>
            <button type="button" onClick={() => toast.dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
