import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from './api';

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

interface GuestCartState {
  items: CartItem[];
  add: (item: CartItem) => void;
  setQty: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  subtotal: () => number;
}

export const useGuestCart = create<GuestCartState>()(persist(
  (set, get) => ({
    items: [],
    add: (item) => set((s) => {
      const ex = s.items.find((i) => i.productId === item.productId);
      if (ex) return { items: s.items.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + item.quantity } : i)) };
      return { items: [...s.items, item] };
    }),
    setQty: (productId, quantity) => set((s) => ({
      items: quantity <= 0 ? s.items.filter((i) => i.productId !== productId)
        : s.items.map((i) => (i.productId === productId ? { ...i, quantity } : i)),
    })),
    remove: (productId) => set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
    clear: () => set({ items: [] }),
    subtotal: () => Math.round(get().items.reduce((a, i) => a + i.unitPrice * i.quantity, 0) * 100) / 100,
  }),
  { name: 'nexus-guest-cart' },
));

interface WishlistState { ids: string[]; toggle: (id: string) => void; has: (id: string) => boolean }
export const useWishlist = create<WishlistState>()(persist(
  (set, get) => ({
    ids: [],
    toggle: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
    has: (id) => get().ids.includes(id),
  }),
  { name: 'nexus-wishlist' },
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
