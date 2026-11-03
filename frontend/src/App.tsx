import { useEffect, useState } from 'react';

interface Product { id: string; name: string; description: string; price: number; image_url: string; category: string | null }

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  useEffect(() => {
    fetch('/api/products')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setProducts(d); setState('ready'); })
      .catch(() => setState('error'));
  }, []);

  return (
    <main className="page">
      <header><h1>Nexus Commerce</h1><p>Products served through the API Gateway.</p></header>
      {state === 'loading' && <p role="status">Loading products…</p>}
      {state === 'error' && <p role="alert">Could not load products. Check that the gateway is running.</p>}
      {state === 'ready' && products.length === 0 && <p>No products yet.</p>}
      <section className="grid">
        {products.map((p) => (
          <article key={p.id} className="card">
            <img src={p.image_url} alt={p.name} />
            <span>{p.category}</span><h2>{p.name}</h2><p>{p.description}</p>
            <strong>${p.price.toFixed(2)}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
