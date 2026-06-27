import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface UiState {
  toasts: ToastItem[];

  toast: (type: ToastType, title: string, description?: string) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],

  toast: (type, title, description) => {
    const id = String(++toastCounter);
    set((s) => ({ toasts: [...s.toasts, { id, type, title, description }] }));
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, desc?: string) =>
    useUiStore.getState().toast("success", title, desc),
  error:   (title: string, desc?: string) =>
    useUiStore.getState().toast("error", title, desc),
  info:    (title: string, desc?: string) =>
    useUiStore.getState().toast("info", title, desc),
  warning: (title: string, desc?: string) =>
    useUiStore.getState().toast("warning", title, desc),
};
