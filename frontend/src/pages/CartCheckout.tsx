import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money } from '../api';
import { useToast } from '../store';

export function CartPage() {
  const { data: cart, isLoading, isError } = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const refresh = () => qc.invalidateQueries({ queryKey: ['cart'] });
  const update = useMutation({ mutationFn: (v: { id: string; qty: number }) => api.updateCartItem(v.id, v.qty), onSuccess: refresh, onError: (e: Error) => toast(e.message, 'err') });
  const remove = useMutation({ mutationFn: (id: string) => api.removeCartItem(id), onSuccess: refresh, onError: (e: Error) => toast(e.message, 'err') });
  if (isLoading) return <p role="status">Loading cart…</p>;
  if (isError) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Could not load cart.</p>;
  if (!cart || cart.items.length === 0) return <div className="card p-10 text-center"><h1 className="text-xl font-bold">Your cart is empty</h1><Link to="/" className="btn mt-4">Browse products</Link></div>;
  return (
    <div>
      <h1 className="text-2xl font-bold">Shopping cart</h1>
      <div className="mt-6 space-y-3">
        {cart.items.map((i) => (
          <div key={i.productId} className="card flex flex-wrap items-center gap-4 p-4">
            <div className="min-w-48 flex-1"><p className="font-medium">{i.productName}</p><p className="text-sm text-slate-500">{money(i.unitPrice)} each</p></div>
            <input type="number" min={0} className="input max-w-24" defaultValue={i.quantity} aria-label={`Quantity for ${i.productName}`}
              onBlur={(e) => update.mutate({ id: i.productId, qty: Number(e.target.value) })} />
            <strong className="w-24 text-right">{money(i.unitPrice * i.quantity)}</strong>
            <button className="btn-danger" onClick={() => remove.mutate(i.productId)}>Remove</button>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <p className="text-lg">Subtotal: <strong>{money(cart.subtotal)}</strong></p>
        <Link to="/checkout" className="btn">Proceed to checkout</Link>
      </div>
    </div>
  );
}

export function CheckoutPage() {
  const { data: cart, isLoading } = useQuery({ queryKey: ['cart'], queryFn: api.cart });
  const [token, setToken] = useState('tok_success');
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast((s) => s.push);
  const idempotencyKey = useRef(crypto.randomUUID());
  const place = useMutation({
    mutationFn: () => api.createOrder({ items: cart!.items.map((i) => ({ productId: i.productId, productName: i.productName, unitPrice: i.unitPrice, quantity: i.quantity })), paymentToken: token }, idempotencyKey.current),
    onSuccess: async (order) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      if (order.status === 'PAYMENT_FAILED') {
        // Keep the cart so the shopper can retry payment; stock was released server-side.
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
    <div className="card mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">Checkout</h1>
      <ul className="mt-4 space-y-2 text-sm">
        {cart.items.map((i) => <li key={i.productId} className="flex justify-between"><span>{i.productName} × {i.quantity}</span><span>{money(i.unitPrice * i.quantity)}</span></li>)}
      </ul>
      <p className="mt-4 border-t pt-4 text-right">Total: <strong>{money(cart.subtotal)}</strong></p>
      <label className="label mt-6" htmlFor="pay">Mock payment simulation</label>
      <select id="pay" className="input" value={token} onChange={(e) => setToken(e.target.value)}>
        <option value="tok_success">Card — payment succeeds</option>
        <option value="tok_fail">Card — payment fails (tests stock release)</option>
      </select>
      <button className="btn mt-6 w-full" disabled={place.isPending} onClick={() => place.mutate()}>{place.isPending ? 'Processing…' : 'Place order'}</button>
    </div>
  );
}
