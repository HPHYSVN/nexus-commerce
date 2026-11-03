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
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">{p.category ?? 'General'}</p>
        <Link to={`/products/${p.id}`} className="mt-1 block font-display text-lg font-semibold leading-snug hover:text-pine">{p.name}</Link>
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
      <section className="mb-10 grid items-center gap-8 border-b border-line pb-10 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-ochre">The everyday store</p>
          <h1 className="mt-3 font-display text-5xl font-semibold leading-[1.05] tracking-tight">Well-made things for daily rituals.</h1>
          <p className="mt-4 max-w-md leading-relaxed text-inksoft">Audio, homeware and carry goods — honestly priced, in stock, and shipped within two business days.</p>
          <div className="mt-6 flex gap-3">
            <a href="#catalogue" className="btn">Shop the collection</a>
            <Link to="/orders" className="btn-secondary">Track an order</Link>
          </div>
          <dl className="mt-8 flex gap-8 text-sm">
            <div><dt className="text-inksoft">Delivery</dt><dd className="font-bold">2–4 days</dd></div>
            <div><dt className="text-inksoft">Returns</dt><dd className="font-bold">30 days</dd></div>
            <div><dt className="text-inksoft">Warranty</dt><dd className="font-bold">12 months</dd></div>
          </dl>
        </div>
        <img src="https://picsum.photos/seed/nexus-hero/1000/760" alt="Featured products" className="aspect-[4/3] w-full rounded-2xl object-cover" />
      </section>
      <div id="catalogue" className="mb-5 flex flex-wrap items-center gap-3">
        <input className="input max-w-sm" placeholder="Search products…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search products" />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <button className={`chip ${!category ? 'chip-active' : ''}`} onClick={() => setCategory('')}>All</button>
          {(cats.data ?? []).map((c) => <button key={c.id} className={`chip ${category === c.name ? 'chip-active' : ''}`} onClick={() => setCategory(c.name)}>{c.name}</button>)}
        </div>
      </div>
      {isLoading && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading products">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-72" />)}</div>}
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
