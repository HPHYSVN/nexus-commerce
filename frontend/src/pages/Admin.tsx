import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadCsv, money, type Order } from '../api';
import { useToast } from '../store';

const NEXT: Record<string, string> = { CONFIRMED: 'PROCESSING', PROCESSING: 'SHIPPED', SHIPPED: 'DELIVERED' };
const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: '#0c5b4e', PROCESSING: '#b26f16', SHIPPED: '#31597f', DELIVERED: '#3f7a3a',
  PENDING: '#8a7d5c', PAYMENT_FAILED: '#b3362b', CANCELLED: '#6b7280',
};

function statusBadge(s: string) {
  return <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: `${STATUS_COLOR[s] ?? '#888'}1f`, color: STATUS_COLOR[s] ?? '#555' }}>{s}</span>;
}

function RevenueChart({ data }: { data: Array<{ date: string; revenue: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const total = data.reduce((a, d) => a + d.revenue, 0);
  return (
    <figure>
      <div className="flex h-44 items-end gap-1 border-b border-line" role="img" aria-label={`Revenue by day, total ${money(total)} over ${data.length} days`}>
        {data.map((d) => (
          <div key={d.date} className="group relative flex-1 rounded-t bg-pine/80 transition hover:bg-pine" style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }} title={`${d.date}: ${money(d.revenue)}`} />
        ))}
        {data.length === 0 && <p className="pb-4 text-sm text-inksoft">No revenue in the last 30 days yet.</p>}
      </div>
      <figcaption className="mt-2 flex justify-between text-xs text-inksoft"><span>{data[0]?.date ?? ''}</span><span>Daily revenue (paid orders)</span><span>{data[data.length - 1]?.date ?? ''}</span></figcaption>
    </figure>
  );
}

function Overview() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: api.adminStats });
  const products = useQuery({ queryKey: ['products', '', 1], queryFn: () => api.products('', 1) });
  const s = stats.data;
  const byStatus = Object.entries(s?.ordersByStatus ?? {}).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...byStatus.map(([, n]) => n));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Total revenue', s ? money(s.totalRevenue) : '—', 'Paid orders only'],
          ['Orders', s ? String(s.totalOrders) : '—', 'All statuses'],
          ['Avg. order value', s && s.totalOrders ? money(s.totalRevenue / Math.max(1, Object.entries(s.ordersByStatus).filter(([k]) => !['PAYMENT_FAILED', 'CANCELLED', 'PENDING'].includes(k)).reduce((a, [, n]) => a + n, 0))) : '—', 'Per paid order'],
          ['Products live', products.data ? String(products.data.length) : '—', 'First page shown in catalogue'],
        ].map(([label, value, hint]) => (
          <div key={label} className="card p-5"><p className="text-xs font-bold uppercase tracking-wider text-inksoft">{label}</p><p className="mt-1.5 font-display text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-inksoft">{hint}</p></div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card p-6 lg:col-span-3">
          <h2 className="font-display text-lg font-semibold">Revenue — last 30 days</h2>
          <p className="mb-4 text-sm text-inksoft">{s ? `${money(s.totalRevenue)} collected across paid orders.` : 'Loading…'}</p>
          <RevenueChart data={s?.revenueByDay ?? []} />
        </section>
        <section className="card p-6 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Orders by status</h2>
          <div className="mt-4 space-y-3">
            {byStatus.map(([status, n]) => (
              <div key={status}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{status}</span><span className="font-bold">{n}</span></div>
                <div className="h-2 rounded-full bg-sand"><div className="h-2 rounded-full" style={{ width: `${(n / maxStatus) * 100}%`, background: STATUS_COLOR[status] ?? '#888' }} /></div>
              </div>
            ))}
            {byStatus.length === 0 && <p className="text-sm text-inksoft">No orders yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function OrdersAdmin() {
  const [status, setStatus] = useState('');
  const orders = useQuery({ queryKey: ['admin-orders', status], queryFn: () => api.adminOrders(status) });
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const advance = useMutation({
    mutationFn: (v: { id: string; status: string }) => api.setOrderStatus(v.id, v.status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-orders'] }); qc.invalidateQueries({ queryKey: ['admin-stats'] }); toast('Order updated'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {['', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'PAYMENT_FAILED', 'CANCELLED'].map((s) => (
          <button key={s} className={`chip ${status === s ? 'chip-active' : ''}`} onClick={() => setStatus(s)}>{s || 'All orders'}</button>
        ))}
      </div>
      {orders.isLoading && <p role="status">Loading orders…</p>}
      {orders.isError && <p role="alert" className="text-red-700">Could not load orders.</p>}
      <div className="card overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {(orders.data ?? []).map((o: Order) => (
              <tr key={o.id}>
                <td className="font-mono text-xs">{o.id.slice(0, 8)}…</td>
                <td className="whitespace-nowrap">{new Date(o.createdAt).toLocaleDateString()}</td>
                <td className="font-mono text-xs">{o.userId.slice(0, 8)}…</td>
                <td>{(o.items ?? []).reduce((a, i) => a + i.quantity, 0)}</td>
                <td className="font-bold">{money(o.totalAmount)}</td>
                <td>{statusBadge(o.status)}</td>
                <td className="whitespace-nowrap text-right">
                  {NEXT[o.status] && <button className="btn mr-2 !px-3 !py-1.5 text-xs" disabled={advance.isPending} onClick={() => advance.mutate({ id: o.id, status: NEXT[o.status] })}>Mark {NEXT[o.status].toLowerCase()}</button>}
                  {['CONFIRMED', 'PROCESSING'].includes(o.status) && <button className="btn-danger !px-3 !py-1.5 text-xs" disabled={advance.isPending} onClick={() => advance.mutate({ id: o.id, status: 'CANCELLED' })}>Cancel & refund</button>}
                </td>
              </tr>
            ))}
            {orders.data?.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-inksoft">No orders in this view.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductsAdmin() {
  const products = useQuery({ queryKey: ['products', '', 1], queryFn: () => api.products('', 1) });
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const [form, setForm] = useState({ name: '', slug: '', description: '', price: 0, image_url: '', category_id: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [stock, setStock] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['products'] });
  const save = useMutation({
    mutationFn: () => (editing ? api.updateProduct(editing, form) : api.createProduct(form)),
    onSuccess: () => { refresh(); setEditing(null); setForm({ name: '', slug: '', description: '', price: 0, image_url: '', category_id: '' }); toast('Product saved'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteProduct(id), onSuccess: () => { refresh(); toast('Product deleted'); }, onError: (e: Error) => toast(e.message, 'err') });
  const setQty = useMutation({ mutationFn: (v: { id: string; qty: number }) => api.setStock(v.id, v.qty), onSuccess: () => toast('Stock updated'), onError: (e: Error) => toast(e.message, 'err') });
  const input = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: k === 'price' ? Number(e.target.value) : e.target.value });
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold">{editing ? 'Edit product' : 'New product'}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div><label className="label" htmlFor="p-name">Name</label><input id="p-name" className="input" required value={form.name} onChange={input('name')} /></div>
          <div><label className="label" htmlFor="p-slug">Slug</label><input id="p-slug" className="input" required value={form.slug} onChange={input('slug')} /></div>
          <div><label className="label" htmlFor="p-desc">Description</label><input id="p-desc" className="input" value={form.description} onChange={input('description')} /></div>
          <div><label className="label" htmlFor="p-price">Price (USD)</label><input id="p-price" className="input" type="number" min={0} step="0.01" required value={form.price || ''} onChange={input('price')} /></div>
          <div><label className="label" htmlFor="p-img">Image URL</label><input id="p-img" className="input" value={form.image_url} onChange={input('image_url')} /></div>
          <div><label className="label" htmlFor="p-cat">Category ID (optional)</label><input id="p-cat" className="input" value={form.category_id} onChange={input('category_id')} /></div>
          <div className="flex gap-2">
            <button className="btn" disabled={save.isPending}>{editing ? 'Update product' : 'Create product'}</button>
            {editing && <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>}
          </div>
        </form>
      </section>
      <section className="card overflow-x-auto">
        <table className="table min-w-[720px]">
          <thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Set stock qty</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {(products.data ?? []).map((p) => (
              <tr key={p.id}>
                <td><span className="flex items-center gap-3"><img src={p.image_url} alt="" className="h-10 w-10 rounded object-cover" /><span className="font-medium">{p.name}</span></span></td>
                <td>{p.category ?? '—'}</td><td className="font-bold">{money(p.price)}</td>
                <td><span className="flex items-center gap-2"><input className="input !w-24" type="number" min={0} placeholder="Qty" value={stock[p.id] ?? ''} onChange={(e) => setStock({ ...stock, [p.id]: e.target.value })} aria-label={`Stock quantity for ${p.name}`} /><button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setQty.mutate({ id: p.id, qty: Number(stock[p.id] ?? 0) })}>Set</button></span></td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn-secondary mr-2 !px-3 !py-1.5 text-xs" onClick={() => { setEditing(p.id); setForm({ name: p.name, slug: p.slug, description: p.description, price: p.price, image_url: p.image_url, category_id: '' }); }}>Edit</button>
                  <button className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => del.mutate(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Reports() {
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: api.adminStats });
  const orders = useQuery({ queryKey: ['admin-orders', ''], queryFn: () => api.adminOrders('') });
  const products = useQuery({ queryKey: ['products', '', 1], queryFn: () => api.products('', 1) });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const s = stats.data;
  const paid = (orders.data ?? []).filter((o) => !['PAYMENT_FAILED', 'CANCELLED', 'PENDING'].includes(o.status));
  const aov = paid.length ? paid.reduce((a, o) => a + o.totalAmount, 0) / paid.length : 0;
  const today = new Date().toISOString().slice(0, 10);
  const exportOrders = () => downloadCsv(`nexus-orders-${today}.csv`, [
    ['order_id', 'created_at', 'customer_id', 'status', 'items', 'total_usd'],
    ...(orders.data ?? []).map((o) => [o.id, o.createdAt, o.userId, o.status, (o.items ?? []).reduce((a, i) => a + i.quantity, 0), o.totalAmount]),
  ]);
  const exportRevenue = () => downloadCsv(`nexus-revenue-${today}.csv`, [
    ['date', 'orders', 'revenue_usd'],
    ...(s?.revenueByDay ?? []).map((d) => [d.date, d.orders, d.revenue]),
  ]);
  const exportProducts = () => downloadCsv(`nexus-products-${today}.csv`, [
    ['product_id', 'name', 'category', 'price_usd', 'slug'],
    ...(products.data ?? []).map((p) => [p.id, p.name, p.category ?? '', p.price, p.slug]),
  ]);
  return (
    <div className="space-y-6">
      <div id="report-print" className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div><p className="font-display text-2xl font-semibold">Sales report</p><p className="text-sm text-inksoft">Nexus Commerce · generated {new Date().toLocaleString()}</p></div>
          <p className="font-display text-lg">Nexus<span className="text-pine">.</span></p>
        </div>
        <div className="grid gap-4 py-5 sm:grid-cols-4">
          {[['Total revenue', s ? money(s.totalRevenue) : '—'], ['Paid orders', String(paid.length)], ['Avg. order value', money(aov)], ['All orders', s ? String(s.totalOrders) : '—']].map(([k, v]) => (
            <div key={k}><p className="text-xs font-bold uppercase tracking-wider text-inksoft">{k}</p><p className="mt-1 font-display text-2xl font-semibold">{v}</p></div>
          ))}
        </div>
        <h3 className="font-bold">Orders by status</h3>
        <table className="table mt-2">
          <thead><tr><th>Status</th><th>Orders</th><th>Share</th></tr></thead>
          <tbody>{Object.entries(s?.ordersByStatus ?? {}).map(([k, n]) => <tr key={k}><td>{k}</td><td>{n}</td><td>{s ? Math.round((n / Math.max(1, s.totalOrders)) * 100) : 0}%</td></tr>)}</tbody>
        </table>
        <h3 className="mt-6 font-bold">Revenue by day (30 days)</h3>
        <table className="table mt-2">
          <thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead>
          <tbody>{(s?.revenueByDay ?? []).map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.orders}</td><td>{money(d.revenue)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3">
        <button className="btn" onClick={exportOrders}>Export orders (CSV)</button>
        <button className="btn" onClick={exportRevenue}>Export revenue (CSV)</button>
        <button className="btn-secondary" onClick={exportProducts}>Export products (CSV)</button>
        <button className="btn-secondary" onClick={() => window.print()}>Print / save PDF</button>
      </div>
      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold">Recent system notifications</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {(notes.data ?? []).slice(0, 10).map((n) => <li key={n.id} className="flex gap-3"><span className="whitespace-nowrap text-inksoft">{new Date(n.createdAt).toLocaleString()}</span><span>{n.message}</span></li>)}
          {notes.data?.length === 0 && <li className="text-inksoft">No notifications yet.</li>}
        </ul>
      </section>
    </div>
  );
}

const TABS = [
  ['overview', 'Overview'], ['orders', 'Orders'], ['products', 'Products & stock'], ['reports', 'Reports & export'],
] as const;

export function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview');
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside>
        <h1 className="font-display text-2xl font-semibold">Admin</h1>
        <p className="mt-1 text-sm text-inksoft">Store operations</p>
        <nav className="mt-5 flex gap-2 lg:flex-col" aria-label="Admin sections">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}
              className={`rounded-lg px-3.5 py-2 text-left text-sm font-semibold transition ${tab === key ? 'bg-pine text-white' : 'text-inksoft hover:bg-sand hover:text-ink'}`}>{label}</button>
          ))}
        </nav>
      </aside>
      <div>
        {tab === 'overview' && <Overview />}
        {tab === 'orders' && <OrdersAdmin />}
        {tab === 'products' && <ProductsAdmin />}
        {tab === 'reports' && <Reports />}
      </div>
    </div>
  );
}
