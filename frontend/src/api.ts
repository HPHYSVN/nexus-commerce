import { useAuth } from './store';

export interface Product { id: string; name: string; slug: string; description: string; price: number; image_url: string; category: string | null; ratingAverage?: number; rating_average?: number; ratingCount?: number; rating_count?: number }
export interface Stock { productId: string; quantity: number; reserved: number; available: number }
export interface Review { id: string; productId: string; userId: string; userName: string; rating: number; comment: string; createdAt: string }
export interface Address { id: string; label?: string; recipientName: string; phone: string; addressLine: string; city: string; isDefault: boolean }
export const ratingOf = (p: Product) => ({ avg: p.ratingAverage ?? p.rating_average ?? 0, count: p.ratingCount ?? p.rating_count ?? 0 });
export interface Category { id: string; name: string; slug: string }
export interface CartItem { productId: string; productName: string; unitPrice: number; quantity: number }
export interface Cart { userId: string; items: CartItem[]; subtotal: number }
export interface OrderItem { productId: string; productName: string; unitPrice: number; quantity: number }
export interface ShippingInfo { recipientName: string; phone: string; addressLine: string; city: string; note?: string; method: string }
export interface Order { id: string; userId: string; status: string; totalAmount: number; subtotal?: number; shippingFee?: number; discountAmount?: number; couponCode?: string; shipping?: ShippingInfo; items: OrderItem[]; createdAt: string }
export interface AppNotification { id: string; eventType: string; message: string; status: string; createdAt: string }
export interface AdminStats { totalOrders: number; totalRevenue: number; ordersByStatus: Record<string, number>; revenueByDay: Array<{ date: string; revenue: number; orders: number }> }

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const { refreshToken, login, logout } = useAuth.getState();
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) { logout(); return false; }
        const r = await res.json();
        const u = r.user ?? {};
        login(r.accessToken, r.refreshToken, { id: u.id, email: u.email, fullName: u.fullName ?? '', role: u.role });
        return true;
      } catch { return false; } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = useAuth.getState().accessToken;
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 401 && !retried && !path.startsWith('/api/auth/') && (await tryRefresh())) {
    return request<T>(path, init, true);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? data?.detail ?? `Request failed (${res.status})`);
  return data as T;
}

const j = (method: string, body?: unknown): RequestInit => ({ method, body: body ? JSON.stringify(body) : undefined });

export const api = {
  products: (q = '', page = 1) => request<Product[]>(`/api/products?q=${encodeURIComponent(q)}&page=${page}&size=20`),
  product: (id: string) => request<Product>(`/api/products/${id}`),
  categories: () => request<Category[]>('/api/categories').catch(() => [] as Category[]),
  createProduct: (b: object) => request<Product>('/api/products', j('POST', b)),
  updateProduct: (id: string, b: object) => request<Product>(`/api/products/${id}`, j('PUT', b)),
  deleteProduct: (id: string) => request<unknown>(`/api/products/${id}`, j('DELETE')),
  register: (b: object) => request<any>('/api/auth/register', j('POST', b)),
  login: (b: object) => request<any>('/api/auth/login', j('POST', b)),
  googleLogin: (idToken: string) => request<any>('/api/auth/google', j('POST', { idToken })),
  verifyEmail: (token: string) => request<any>('/api/auth/verify-email', j('POST', { token })),
  resendVerification: () => request<any>('/api/auth/resend-verification', j('POST', {})),
  forgotPassword: (email: string) => request<any>('/api/auth/forgot-password', j('POST', { email })),
  resetPassword: (token: string, newPassword: string) => request<any>('/api/auth/reset-password', j('POST', { token, newPassword })),
  updateMe: (fullName: string) => request<any>('/api/auth/me', j('PUT', { fullName })),
  changePassword: (currentPassword: string, newPassword: string) => request<any>('/api/auth/change-password', j('POST', { currentPassword, newPassword })),
  me: () => request<any>('/api/auth/me'),
  cart: () => request<Cart>('/api/cart'),
  addToCart: (b: object) => request<Cart>('/api/cart/items', j('POST', b)),
  updateCartItem: (id: string, quantity: number) => request<Cart>(`/api/cart/items/${id}`, j('PUT', { quantity })),
  removeCartItem: (id: string) => request<Cart>(`/api/cart/items/${id}`, j('DELETE')),
  clearCart: () => request<unknown>('/api/cart', j('DELETE')),
  createOrder: (b: object, idempotencyKey?: string) => request<Order>('/api/orders', { ...j('POST', b), headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  orders: () => request<Order[]>('/api/orders'),
  order: (id: string) => request<Order>(`/api/orders/${id}`),
  cancelOrder: (id: string) => request<Order>(`/api/orders/${id}/cancel`, j('POST', {})),
  notifications: () => request<AppNotification[]>('/api/notifications?limit=50'),
  adminOrders: (status = '') => request<Order[]>(`/api/admin/orders?size=100${status ? `&status=${status}` : ''}`),
  adminStats: () => request<AdminStats>('/api/admin/stats'),
  setOrderStatus: (id: string, status: string) => request<Order>(`/api/admin/orders/${id}/status`, j('PUT', { status })),
  stockBatch: (ids: string[]) => (ids.length ? request<Stock[]>(`/api/inventory?ids=${ids.join(',')}`) : Promise.resolve([] as Stock[])),
  reviews: (productId: string) => request<{ items: Review[]; average: number; count: number }>(`/api/products/${productId}/reviews`),
  createReview: (productId: string, b: object) => request<Review>(`/api/products/${productId}/reviews`, j('POST', b)),
  addresses: () => request<Address[]>('/api/auth/addresses'),
  createAddress: (b: object) => request<Address>('/api/auth/addresses', j('POST', b)),
  updateAddress: (id: string, b: object) => request<Address>(`/api/auth/addresses/${id}`, j('PUT', b)),
  deleteAddress: (id: string) => request<unknown>(`/api/auth/addresses/${id}`, j('DELETE')),
  getStock: (id: string) => request<any>(`/api/inventory/${id}`),
  setStock: (id: string, quantity: number) => request<any>(`/api/inventory/${id}`, j('PUT', { quantity })),
};

export const money = (n: number) => `$${Number(n).toFixed(2)}`;
