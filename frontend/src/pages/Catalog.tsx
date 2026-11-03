import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money, type Product } from '../api';
import { useAuth, useToast } from '../store';

export function ProductCard({ p }: { p: Product }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const add = useMutation({
    mutationFn: () => api.addToCart({ productId: p.id, productName: p.name, unitPrice: p.price, quantity: 1 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cart'] }); toast('Added to cart'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  return (
    <article className="card overflow-hidden">
      <Link to={`/products/${p.id}`}><img src={p.image_url || 'https://picsum.photos/seed/nexus/600/400'} alt={p.name} className="h-44 w-full object-cover" /></Link>
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{p.category ?? 'General'}</p>
        <Link to={`/products/${p.id}`} className="mt-1 block font-semibold hover:underline">{p.name}</Link>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <strong>{money(p.price)}</strong>
          <button className="btn" disabled={add.isPending} onClick={() => (user ? add.mutate() : navigate('/login'))}>Add to cart</button>
        </div>
      </div>
    </article>
  );
}

export function HomePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({ queryKey: ['products', q, page], queryFn: () => api.products(q, page) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.categories });
  const items = (data ?? []).filter((p) => !category || p.category === category);
  return (
    <div>
      <section className="mb-8 rounded-2xl bg-slate-900 px-6 py-10 text-white">
        <h1 className="text-3xl font-bold">Nexus Commerce</h1>
        <p className="mt-2 max-w-xl text-slate-300">Demo e-commerce platform built with microservices: Spring Boot, FastAPI, Go, NestJS gateway, RabbitMQ events.</p>
      </section>
      <div className="mb-5 flex flex-wrap gap-3">
        <input className="input max-w-sm" placeholder="Search products…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search products" />
        <select className="input max-w-52" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      </div>
      {isLoading && <p role="status">Loading products…</p>}
      {isError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Could not load products. Check that services are running.</p>}
      {!isLoading && !isError && items.length === 0 && <p className="rounded-lg bg-white p-8 text-center text-slate-500">No products found.</p>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
      <div className="mt-8 flex items-center gap-3">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="text-sm">Page {page}</span>
        <button className="btn-secondary" disabled={(data ?? []).length < 20} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, isError } = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id) });
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const [qty, setQty] = useState(1);
  const add = useMutation({
    mutationFn: () => api.addToCart({ productId: p!.id, productName: p!.name, unitPrice: p!.price, quantity: qty }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cart'] }); toast('Added to cart'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (isLoading) return <p role="status">Loading…</p>;
  if (isError || !p) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Product not found.</p>;
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <img src={p.image_url} alt={p.name} className="w-full rounded-2xl object-cover" />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">{p.category ?? 'General'}</p>
        <h1 className="mt-2 text-3xl font-bold">{p.name}</h1>
        <p className="mt-4 text-slate-600">{p.description}</p>
        <p className="mt-6 text-2xl font-bold">{money(p.price)}</p>
        <div className="mt-6 flex items-center gap-3">
          <input type="number" min={1} className="input max-w-24" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} aria-label="Quantity" />
          <button className="btn" disabled={add.isPending} onClick={() => (user ? add.mutate() : navigate('/login'))}>Add to cart</button>
        </div>
      </div>
    </div>
  );
}
