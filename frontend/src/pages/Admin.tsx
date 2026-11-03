import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money } from '../api';
import { useToast } from '../store';

export function AdminPage() {
  const products = useQuery({ queryKey: ['products', '', 1], queryFn: () => api.products('', 1) });
  const notes = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
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
  const setQty = useMutation({
    mutationFn: (v: { id: string; qty: number }) => api.setStock(v.id, v.qty),
    onSuccess: () => toast('Stock updated'), onError: (e: Error) => toast(e.message, 'err'),
  });
  const input = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: k === 'price' ? Number(e.target.value) : e.target.value });
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Admin dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-slate-500">Products</p><p className="text-3xl font-bold">{products.data?.length ?? '—'}</p></div>
        <div className="card p-5"><p className="text-sm text-slate-500">Notifications logged</p><p className="text-3xl font-bold">{notes.data?.length ?? '—'}</p></div>
        <div className="card p-5"><p className="text-sm text-slate-500">Latest event</p><p className="truncate text-lg font-semibold">{notes.data?.[0]?.eventType ?? '—'}</p></div>
      </div>

      <section className="card p-6">
        <h2 className="font-bold">{editing ? 'Edit product' : 'Create product'}</h2>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <input className="input" placeholder="Name" required value={form.name} onChange={input('name')} />
          <input className="input" placeholder="Slug" required value={form.slug} onChange={input('slug')} />
          <input className="input" placeholder="Description" value={form.description} onChange={input('description')} />
          <input className="input" type="number" min={0} step="0.01" placeholder="Price" required value={form.price || ''} onChange={input('price')} />
          <input className="input" placeholder="Image URL" value={form.image_url} onChange={input('image_url')} />
          <input className="input" placeholder="Category ID (optional)" value={form.category_id} onChange={input('category_id')} />
          <div className="flex gap-2">
            <button className="btn" disabled={save.isPending}>{editing ? 'Update' : 'Create'}</button>
            {editing && <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="card p-6">
        <h2 className="font-bold">Product management & stock</h2>
        {products.isLoading && <p>Loading…</p>}
        <div className="mt-4 space-y-2">
          {(products.data ?? []).map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-2 text-sm">
              <span className="min-w-40 flex-1 font-medium">{p.name}</span><span>{money(p.price)}</span>
              <input className="input max-w-24" type="number" min={0} placeholder="Stock qty" value={stock[p.id] ?? ''}
                onChange={(e) => setStock({ ...stock, [p.id]: e.target.value })} aria-label={`Stock for ${p.name}`} />
              <button className="btn-secondary" onClick={() => setQty.mutate({ id: p.id, qty: Number(stock[p.id] ?? 0) })}>Set stock</button>
              <button className="btn-secondary" onClick={() => { setEditing(p.id); setForm({ name: p.name, slug: p.slug, description: p.description, price: p.price, image_url: p.image_url, category_id: '' }); }}>Edit</button>
              <button className="btn-danger" onClick={() => del.mutate(p.id)}>Delete</button>
            </div>
          ))}
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-bold">Recent notifications</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {(notes.data ?? []).slice(0, 10).map((n) => <li key={n.id} className="flex gap-3"><span className="text-slate-400">{new Date(n.createdAt).toLocaleString()}</span><span>{n.message}</span></li>)}
          {notes.data?.length === 0 && <li className="text-slate-500">No notifications yet.</li>}
        </ul>
      </section>
    </div>
  );
}
