import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money, ratingOf, type Product, type Stock } from '../api';
import { useAuth, useGuestCart, useToast, useWishlist } from '../store';

function Stars({ avg }: { avg: number }) {
  if (!avg) return null;
  return <span className="text-ochre" aria-label={`Rated ${avg} out of 5`}>{'★'.repeat(Math.round(avg))}<span className="text-line">{'★'.repeat(5 - Math.round(avg))}</span></span>;
}

export function stockLabel(s?: Stock) {
  if (!s) return null;
  if (s.available <= 0) return <span className="font-semibold text-red-700">Out of stock</span>;
  if (s.available <= 5) return <span className="font-semibold text-ochre">Only {s.available} left</span>;
  return <span className="font-semibold text-pine">In stock</span>;
}

export function ProductCard({ p, stock }: { p: Product; stock?: Stock }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const guestAdd = useGuestCart((s) => s.add);
  const wishlist = useWishlist();
  const out = stock && stock.available <= 0;
  const r = ratingOf(p);
  const add = useMutation({
    mutationFn: () => api.addToCart({ productId: p.id, productName: p.name, unitPrice: p.price, quantity: 1 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cart'] }); toast('Added to cart'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const onAdd = () => {
    if (user) add.mutate();
    else { guestAdd({ productId: p.id, productName: p.name, unitPrice: p.price, quantity: 1 }); toast('Added to cart'); navigate('/cart'); }
  };
  return (
    <article className="card group overflow-hidden">
      <div className="relative">
        <Link to={`/products/${p.id}`}><img src={p.image_url || 'https://picsum.photos/seed/nexus/600/400'} alt={p.name} loading="lazy" className="h-48 w-full object-cover transition duration-300 group-hover:scale-[1.02]" /></Link>
        <button onClick={() => { wishlist.toggle(p.id); toast(wishlist.has(p.id) ? 'Removed from wishlist' : 'Saved to wishlist'); }}
          aria-label={wishlist.has(p.id) ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={wishlist.has(p.id)}
          className={`absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-lg shadow-sm transition ${wishlist.has(p.id) ? 'text-red-600' : 'text-inksoft hover:text-red-600'}`}>
          {wishlist.has(p.id) ? '♥' : '♡'}
        </button>
      </div>
      <div className="p-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">{p.category ?? 'General'}</p>
        <Link to={`/products/${p.id}`} className="mt-1 block font-display text-lg font-semibold leading-snug hover:text-pine">{p.name}</Link>
        {r.count > 0 && <p className="mt-1 flex items-center gap-1.5 text-sm"><Stars avg={r.avg} /><span className="text-inksoft">{r.avg.toFixed(1)} ({r.count})</span></p>}
        <p className="mt-1 line-clamp-2 text-sm text-inksoft">{p.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <strong className="text-lg">{money(p.price)}</strong>
          <span className="text-xs">{stockLabel(stock)}</span>
        </div>
        <button className="btn mt-3 w-full" disabled={!!out || add.isPending} onClick={onAdd}>{out ? 'Out of stock' : 'Add to cart'}</button>
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
  const stocks = useQuery({
    queryKey: ['stocks', items.map((p) => p.id).join(',')],
    queryFn: () => api.stockBatch(items.map((p) => p.id)),
    enabled: items.length > 0,
  });
  const stockMap = new Map((stocks.data ?? []).map((s) => [s.productId, s]));
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
      {isLoading && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading products">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-80" />)}</div>}
      {isError && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Could not load products. Check that services are running.</p>}
      {!isLoading && !isError && items.length === 0 && <p className="card p-10 text-center text-inksoft">No products found. Try another search.</p>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => <ProductCard key={p.id} p={p} stock={stockMap.get(p.id)} />)}
      </div>
      <div className="mt-8 flex items-center gap-3">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="text-sm">Page {page}</span>
        <button className="btn-secondary" disabled={(data ?? []).length < 20} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function Reviews({ productId }: { productId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const reviews = useQuery({ queryKey: ['reviews', productId], queryFn: () => api.reviews(productId) });
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const submit = useMutation({
    mutationFn: () => api.createReview(productId, { rating, comment }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reviews', productId] }); qc.invalidateQueries({ queryKey: ['products'] }); setComment(''); toast('Review posted'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  const d = reviews.data;
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 className="font-display text-2xl font-semibold">Reviews {d && d.count > 0 ? `· ${d.average.toFixed(1)} / 5 (${d.count})` : ''}</h2>
      {reviews.isLoading && <p className="mt-3" role="status">Loading reviews…</p>}
      {d && d.items.length === 0 && <p className="mt-3 text-inksoft">No reviews yet — be the first to share your experience.</p>}
      <ul className="mt-5 space-y-4">
        {(d?.items ?? []).map((r) => (
          <li key={r.id} className="card p-4">
            <p className="flex items-center gap-2 text-sm"><Stars avg={r.rating} /><strong>{r.userName}</strong><span className="text-inksoft">{new Date(r.createdAt).toLocaleDateString()}</span></p>
            <p className="mt-1.5 text-sm leading-relaxed">{r.comment}</p>
          </li>
        ))}
      </ul>
      {user ? (
        <form className="card mt-6 p-5" onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
          <h3 className="font-bold">Write a review</h3>
          <label className="label mt-3" htmlFor="rv-rating">Rating</label>
          <select id="rv-rating" className="input max-w-40" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
          </select>
          <label className="label mt-3" htmlFor="rv-comment">Comment</label>
          <textarea id="rv-comment" className="input" rows={3} required maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn mt-4" disabled={submit.isPending}>Post review</button>
        </form>
      ) : (
        <p className="mt-5 text-sm text-inksoft"><Link className="font-semibold text-pine underline" to="/login">Login</Link> to write a review.</p>
      )}
    </section>
  );
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading, isError } = useQuery({ queryKey: ['product', id], queryFn: () => api.product(id) });
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const guestAdd = useGuestCart((s) => s.add);
  const [qty, setQty] = useState(1);
  const stock = useQuery({ queryKey: ['stock', id], queryFn: () => api.stockBatch([id]), enabled: !!id });
  const s = stock.data?.[0];
  const add = useMutation({
    mutationFn: () => api.addToCart({ productId: p!.id, productName: p!.name, unitPrice: p!.price, quantity: qty }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cart'] }); toast('Added to cart'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (isLoading) return <p role="status">Loading…</p>;
  if (isError || !p) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Product not found.</p>;
  const r = ratingOf(p);
  const out = s && s.available <= 0;
  const onAdd = () => {
    if (user) add.mutate();
    else { guestAdd({ productId: p.id, productName: p.name, unitPrice: p.price, quantity: qty }); toast('Added to cart'); navigate('/cart'); }
  };
  return (
    <div>
      <div className="grid gap-10 md:grid-cols-2">
        <img src={p.image_url} alt={p.name} className="aspect-[4/3] w-full rounded-2xl object-cover" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ochre">{p.category ?? 'General'}</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">{p.name}</h1>
          {r.count > 0 && <p className="mt-2 flex items-center gap-2"><Stars avg={r.avg} /><span className="text-sm text-inksoft">{r.avg.toFixed(1)} · {r.count} review{r.count > 1 ? 's' : ''}</span></p>}
          <p className="mt-4 leading-relaxed text-inksoft">{p.description}</p>
          <p className="mt-6 font-display text-3xl font-semibold">{money(p.price)}</p>
          <p className="mt-2 text-sm">{stockLabel(s)}</p>
          <div className="mt-6 flex items-center gap-3">
            <input type="number" min={1} max={s?.available ?? 99} className="input max-w-24" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} aria-label="Quantity" />
            <button className="btn" disabled={!!out || add.isPending} onClick={onAdd}>{out ? 'Out of stock' : 'Add to cart'}</button>
          </div>
          <ul className="mt-8 space-y-1.5 border-t border-line pt-5 text-sm text-inksoft">
            <li>Free standard shipping on orders over $75</li>
            <li>30-day returns, no questions asked</li>
            <li>12-month warranty included</li>
          </ul>
        </div>
      </div>
      <Reviews productId={p.id} />
    </div>
  );
}

export function WishlistPage() {
  const ids = useWishlist((s) => s.ids);
  const products = useQuery({ queryKey: ['wishlist-products', ids.join(',')], queryFn: async () => Promise.all(ids.map((id) => api.product(id).catch(() => null))), enabled: ids.length > 0 });
  const items = (products.data ?? []).filter(Boolean) as Product[];
  if (ids.length === 0) return <div className="card p-10 text-center"><h1 className="font-display text-2xl font-semibold">Your wishlist is empty</h1><p className="mt-2 text-inksoft">Tap the heart on any product to save it here.</p><Link to="/" className="btn mt-5">Browse products</Link></div>;
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Wishlist</h1>
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </div>
  );
}
