import { useAuth } from './store';

export interface Product { id: string; name: string; slug: string; description: string; price: number; image_url: string; category: string | null }
export interface Category { id: string; name: string; slug: string }
export interface CartItem { productId: string; productName: string; unitPrice: number; quantity: number }
export interface Cart { userId: string; items: CartItem[]; subtotal: number }
export interface OrderItem { productId: string; productName: string; unitPrice: number; quantity: number }
export interface Order { id: string; userId: string; status: string; totalAmount: number; items: OrderItem[]; createdAt: string }
export interface AppNotification { id: string; eventType: string; message: string; status: string; createdAt: string }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().accessToken;
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
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
  me: () => request<any>('/api/auth/me'),
  cart: () => request<Cart>('/api/cart'),
  addToCart: (b: object) => request<Cart>('/api/cart/items', j('POST', b)),
  updateCartItem: (id: string, quantity: number) => request<Cart>(`/api/cart/items/${id}`, j('PUT', { quantity })),
  removeCartItem: (id: string) => request<Cart>(`/api/cart/items/${id}`, j('DELETE')),
  clearCart: () => request<unknown>('/api/cart', j('DELETE')),
  createOrder: (b: object) => request<Order>('/api/orders', j('POST', b)),
  orders: () => request<Order[]>('/api/orders'),
  order: (id: string) => request<Order>(`/api/orders/${id}`),
  cancelOrder: (id: string) => request<Order>(`/api/orders/${id}/cancel`, j('POST', {})),
  notifications: () => request<AppNotification[]>('/api/notifications?limit=50'),
  getStock: (id: string) => request<any>(`/api/inventory/${id}`),
  setStock: (id: string, quantity: number) => request<any>(`/api/inventory/${id}`, j('PUT', { quantity })),
};

export const money = (n: number) => `$${Number(n).toFixed(2)}`;
