import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money, type CartItem } from '../api';
import { useAuth, useGuestCart, useToast } from '../store';

const fmtItems = (items: CartItem[]) => items.map((i) => ({ productId: i.productId, productName: i.productName, unitPrice: i.unitPrice, quantity: i.quantity }));

export function CartPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const server = useQuery({ queryKey: ['cart'], queryFn: api.cart, enabled: !!user });
  const guest = useGuestCart();
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cart'] });
  const update = useMutation({ mutationFn: (v: { id: string; qty: number }) => api.updateCartItem(v.id, v.qty), onSuccess: refresh, onError: (e: Error) => toast(e.message, 'err') });
  const remove = useMutation({ mutationFn: (id: string) => api.removeCartItem(id), onSuccess: refresh, onError: (e: Error) => toast(e.message, 'err') });

  const items: CartItem[] = user ? (server.data?.items ?? []) : guest.items;
  const subtotal = user ? (server.data?.subtotal ?? 0) : guest.subtotal();
  const setQty = (id: string, qty: number) => (user ? update.mutate({ id, qty }) : guest.setQty(id, qty));
  const del = (id: string) => (user ? remove.mutate(id) : guest.remove(id));

  if (user && server.isLoading) return <p role="status">Loading cart…</p>;
  if (user && server.isError) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Could not load cart.</p>;
  if (items.length === 0) return <div className="card p-10 text-center"><h1 className="font-display text-2xl font-semibold">Your cart is empty</h1><Link to="/" className="btn mt-5">Browse products</Link></div>;
  const freeShipIn = Math.max(0, 75 - subtotal);
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Shopping cart</h1>
      {!user && <p className="mt-2 text-sm text-inksoft">You're shopping as a guest — your cart will be saved to your account when you login.</p>}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-sand" role="progressbar" aria-valuenow={Math.min(100, (subtotal / 75) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free shipping">
        <div className="h-full bg-pine transition-all" style={{ width: `${Math.min(100, (subtotal / 75) * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-inksoft">{freeShipIn > 0 ? `Add ${money(freeShipIn)} more for free standard shipping.` : 'Your order ships free (standard).'}</p>
      <div className="mt-6 space-y-3">
        {items.map((i) => (
          <div key={i.productId} className="card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-48 flex-1"><Link to={`/products/${i.productId}`} className="font-medium hover:text-pine">{i.productName}</Link><p className="text-sm text-inksoft">{money(i.unitPrice)} each</p></div>
            <span className="flex items-center gap-1">
              <button className="btn-secondary !px-2.5" aria-label="Decrease quantity" onClick={() => setQty(i.productId, i.quantity - 1)}>−</button>
              <span className="w-10 text-center font-bold" aria-live="polite">{i.quantity}</span>
              <button className="btn-secondary !px-2.5" aria-label="Increase quantity" onClick={() => setQty(i.productId, i.quantity + 1)}>+</button>
            </span>
            <strong className="w-24 text-right">{money(i.unitPrice * i.quantity)}</strong>
            <button className="btn-danger !px-3 !py-1.5 text-xs" onClick={() => del(i.productId)}>Remove</button>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg">Subtotal: <strong>{money(subtotal)}</strong></p>
        {user
          ? <Link to="/checkout" className="btn">Proceed to checkout</Link>
          : <button className="btn" onClick={() => navigate('/login')}>Login to checkout</button>}
      </div>
    </div>
  );
}

export function CheckoutPage() {
  const { user } = useAuth();
  const { data: cart, isLoading } = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: api.addresses });
  const [ship, setShip] = useState({ recipientName: user?.fullName ?? '', phone: '', addressLine: '', city: '', note: '', method: 'STANDARD' });
  const [coupon, setCoupon] = useState('');
  const [token, setToken] = useState('tok_success');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast((s) => s.push);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [saveAddress, setSaveAddress] = useState(true);

  useEffect(() => {
    const d = addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0];
    if (d) setShip((s) => ({ ...s, recipientName: d.recipientName, phone: d.phone, addressLine: d.addressLine, city: d.city }));
  }, [addresses.data]);

  const goods = cart?.subtotal ?? 0;
  const shipFee = ship.method === 'EXPRESS' ? 12.99 : goods >= 75 ? 0 : 4.99;
  const set = (k: keyof typeof ship) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setShip({ ...ship, [k]: e.target.value });

  const place = useMutation({
    mutationFn: () => api.createOrder({ items: fmtItems(cart!.items), paymentToken: token, couponCode: coupon.trim() || undefined, shipping: ship }, idempotencyKey.current),
    onSuccess: async (order) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      if (saveAddress && addresses.data?.length === 0) {
        await api.createAddress({ label: 'Home', ...ship, isDefault: true }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ['addresses'] });
      }
      if (order.status === 'PAYMENT_FAILED') {
        toast('Payment failed — stock released, cart kept for retry', 'err');
      } else {
        await api.clearCart().catch(() => undefined);
        qc.invalidateQueries({ queryKey: ['cart'] });
        toast(`Order ${order.status.toLowerCase()}`);
      }
      idempotencyKey.current = crypto.randomUUID();
      navigate(`/orders/${order.id}`);
    },
    onError: (e: Error) => toast(e.message, 'err'),
  });

  if (isLoading) return <p role="status">Loading…</p>;
  if (!cart || cart.items.length === 0) return <p className="card p-8 text-center">Your cart is empty.</p>;
  return (
    <form className="grid gap-6 lg:grid-cols-5" onSubmit={(e) => { e.preventDefault(); place.mutate(); }}>
      <div className="space-y-6 lg:col-span-3">
        <section className="card p-6">
          <h1 className="font-display text-xl font-semibold">Delivery details</h1>
          {(addresses.data?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {addresses.data!.map((a) => (
                <button type="button" key={a.id} className="chip" onClick={() => setShip((s) => ({ ...s, recipientName: a.recipientName, phone: a.phone, addressLine: a.addressLine, city: a.city }))}>
                  {a.label || 'Address'} — {a.city}{a.isDefault ? ' (default)' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="co-name">Recipient name</label><input id="co-name" className="input" required value={ship.recipientName} onChange={set('recipientName')} /></div>
            <div><label className="label" htmlFor="co-phone">Phone</label><input id="co-phone" className="input" required value={ship.phone} onChange={set('phone')} /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="co-addr">Address</label><input id="co-addr" className="input" required value={ship.addressLine} onChange={set('addressLine')} /></div>
            <div><label className="label" htmlFor="co-city">City</label><input id="co-city" className="input" required value={ship.city} onChange={set('city')} /></div>
            <div><label className="label" htmlFor="co-note">Note (optional)</label><input id="co-note" className="input" value={ship.note} onChange={set('note')} /></div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> Save as my default address</label>
          <fieldset className="mt-5">
            <legend className="label">Shipping method</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`card cursor-pointer p-4 ${ship.method === 'STANDARD' ? '!border-pine ring-2 ring-pine/25' : ''}`}>
                <input type="radio" name="shipm" value="STANDARD" checked={ship.method === 'STANDARD'} onChange={set('method')} className="mr-2" />
                <strong>Standard</strong><span className="block text-sm text-inksoft">2–4 days · {goods >= 75 ? 'Free' : money(4.99)}</span>
              </label>
              <label className={`card cursor-pointer p-4 ${ship.method === 'EXPRESS' ? '!border-pine ring-2 ring-pine/25' : ''}`}>
                <input type="radio" name="shipm" value="EXPRESS" checked={ship.method === 'EXPRESS'} onChange={set('method')} className="mr-2" />
                <strong>Express</strong><span className="block text-sm text-inksoft">Next day · {money(12.99)}</span>
              </label>
            </div>
          </fieldset>
        </section>
        <section className="card p-6">
          <h2 className="font-display text-xl font-semibold">Payment</h2>
          <label className="label mt-3" htmlFor="pay">Mock payment simulation</label>
          <select id="pay" className="input" value={token} onChange={(e) => setToken(e.target.value)}>
            <option value="tok_success">Card — payment succeeds</option>
            <option value="tok_fail">Card — payment fails (tests stock release)</option>
          </select>
          <div className="mt-4"><label className="label" htmlFor="coupon">Coupon code (try WELCOME10)</label><input id="coupon" className="input max-w-xs" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Optional" /></div>
        </section>
      </div>
      <aside className="card h-fit p-6 lg:col-span-2">
        <h2 className="font-display text-xl font-semibold">Order summary</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {cart.items.map((i) => <li key={i.productId} className="flex justify-between gap-3"><span>{i.productName} × {i.quantity}</span><span className="font-medium">{money(i.unitPrice * i.quantity)}</span></li>)}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt className="text-inksoft">Subtotal</dt><dd>{money(goods)}</dd></div>
          <div className="flex justify-between"><dt className="text-inksoft">Shipping</dt><dd>{shipFee === 0 ? 'Free' : money(shipFee)}</dd></div>
          {coupon.trim() && <div className="flex justify-between"><dt className="text-inksoft">Coupon</dt><dd>Applied at confirmation</dd></div>}
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Estimated total</dt><dd>{money(goods + shipFee)}</dd></div>
        </dl>
        <button className="btn mt-6 w-full" disabled={place.isPending}>{place.isPending ? 'Processing…' : 'Place order'}</button>
        <p className="mt-3 text-center text-xs text-inksoft">Demo store — payments are simulated, no real charge.</p>
      </aside>
    </form>
  );
}
