import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  action?: ToastAction;
}

// Single source of truth for auto-dismiss timing — shared by Toast.tsx (progress
// bar animation) and any caller whose "undo window" must match the toast's own
// visible lifetime (e.g. delete-with-undo).
export const TOAST_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  error:   8000,
  info:    4000,
  warning: 6000,
};

// Cap on simultaneously visible toasts — deleting many drafts in a row (each
// fires its own delete-with-undo toast) used to stack every single one with
// no limit, burying the whole screen. Oldest drops first when the cap is hit,
// same as most toast libraries' default behavior.
const MAX_VISIBLE_TOASTS = 3;

interface UiState {
  toasts: ToastItem[];
  historyVersion: number;

  toast: (type: ToastType, title: string, description?: string, action?: ToastAction) => void;
  dismissToast: (id: string) => void;
  bumpHistory: () => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  historyVersion: 0,

  toast: (type, title, description, action) => {
    const id = String(++toastCounter);
    set((s) => ({
      toasts: [...s.toasts, { id, type, title, description, action }].slice(-MAX_VISIBLE_TOASTS),
    }));
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  bumpHistory: () =>
    set((s) => ({ historyVersion: s.historyVersion + 1 })),
}));

export const toast = {
  success: (title: string, desc?: string, action?: ToastAction) =>
    useUiStore.getState().toast("success", title, desc, action),
  error:   (title: string, desc?: string, action?: ToastAction) =>
    useUiStore.getState().toast("error", title, desc, action),
  info:    (title: string, desc?: string, action?: ToastAction) =>
    useUiStore.getState().toast("info", title, desc, action),
  warning: (title: string, desc?: string, action?: ToastAction) =>
    useUiStore.getState().toast("warning", title, desc, action),
};
