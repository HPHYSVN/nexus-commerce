import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User { id: string; email: string; fullName: string; role: 'CUSTOMER' | 'ADMIN'; emailVerified?: boolean; provider?: string }

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(persist(
  (set) => ({
    accessToken: null, refreshToken: null, user: null,
    login: (accessToken, refreshToken, user) => set({ accessToken, refreshToken, user }),
    logout: () => set({ accessToken: null, refreshToken: null, user: null }),
  }),
  { name: 'nexus-auth' },
));

interface ToastState { toasts: Array<{ id: number; text: string; kind: 'ok' | 'err' }>; push: (text: string, kind?: 'ok' | 'err') => void }
let seq = 0;
export const useToast = create<ToastState>((set) => ({
  toasts: [],
  push: (text, kind = 'ok') => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
  },
}));
