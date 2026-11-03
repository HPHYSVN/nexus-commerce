import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth, useToast } from './store';
import { HomePage, ProductDetailPage } from './pages/Catalog';
import { LoginPage, RegisterPage } from './pages/Auth';
import { CartPage, CheckoutPage } from './pages/CartCheckout';
import { OrderDetailPage, OrdersPage } from './pages/Orders';
import { AdminPage } from './pages/Admin';
import { ForgotPasswordPage, ProfilePage, ResetPasswordPage, VerifyEmailPage } from './pages/Account';
import type { ReactNode } from 'react';

function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const cart = useQuery({ queryKey: ['cart'], queryFn: api.cart, enabled: !!user });
  const count = cart.data?.items.reduce((a, i) => a + i.quantity, 0) ?? 0;
  return (
    <>
    <div className="bg-pine text-center text-xs font-semibold tracking-wide text-white">
      <p className="mx-auto max-w-6xl px-5 py-1.5">Free shipping over $75 · 30-day returns · Secure checkout</p>
    </div>
    <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
        <Link to="/" className="font-display text-2xl font-semibold tracking-tight">Nexus<span className="text-pine">.</span></Link>
        <Link to="/" className="text-sm hover:underline">Products</Link>
        {user && <Link to="/cart" className="text-sm hover:underline">Cart{count > 0 ? ` (${count})` : ''}</Link>}
        {user && <Link to="/orders" className="text-sm hover:underline">Orders</Link>}
        {user?.role === 'ADMIN' && <Link to="/admin" className="text-sm font-medium hover:underline">Admin</Link>}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (<>
            <Link to="/profile" className="hidden text-slate-600 hover:underline sm:inline">{user.fullName || user.email}</Link>
            <button className="btn-secondary" onClick={() => { logout(); navigate('/'); }}>Logout</button>
          </>) : (<>
            <Link to="/login" className="hover:underline">Login</Link>
            <Link to="/register" className="btn">Register</Link>
          </>)}
        </div>
      </nav>
    </header>
    </>
  );
}

function Toasts() {
  const toasts = useToast((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-20 space-y-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2 text-sm text-white shadow ${t.kind === 'err' ? 'bg-red-600' : 'bg-slate-900'}`}>{t.text}</div>
      ))}
    </div>
  );
}

export default function App() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
          <Route path="/cart" element={<RequireAuth><CartPage /></RequireAuth>} />
          <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="/orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
          <Route path="/orders/:id" element={<RequireAuth><OrderDetailPage /></RequireAuth>} />
          <Route path="/admin" element={<RequireAuth admin><AdminPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 px-5">
          <div><p className="font-display text-lg font-semibold">Nexus.</p><p className="mt-1 max-w-xs text-xs leading-relaxed text-inksoft">A working microservices storefront. Payments are simulated for demonstration.</p></div>
          <div className="flex gap-10 text-sm">
            <div className="space-y-1.5"><p className="font-bold">Shop</p><Link to="/" className="block text-inksoft hover:text-pine">All products</Link><Link to="/cart" className="block text-inksoft hover:text-pine">Cart</Link></div>
            <div className="space-y-1.5"><p className="font-bold">Account</p><Link to="/orders" className="block text-inksoft hover:text-pine">Orders</Link><Link to="/profile" className="block text-inksoft hover:text-pine">Profile</Link></div>
            <div className="space-y-1.5"><p className="font-bold">Support</p><span className="block text-inksoft">Shipping & returns</span><span className="block text-inksoft">Contact us</span></div>
          </div>
        </div>
      </footer>
      <Toasts />
    </div>
  );
}
