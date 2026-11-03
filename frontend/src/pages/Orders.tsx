import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money } from '../api';
import { useToast } from '../store';

const badge = (s: string) => {
  const map: Record<string, string> = { CONFIRMED: 'bg-green-100 text-green-800', PAID: 'bg-green-100 text-green-800', PAYMENT_FAILED: 'bg-red-100 text-red-700', CANCELLED: 'bg-slate-200 text-slate-700', PENDING: 'bg-amber-100 text-amber-800' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${map[s] ?? 'bg-blue-100 text-blue-800'}`}>{s}</span>;
};

export function OrdersPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['orders'], queryFn: api.orders });
  if (isLoading) return <p role="status">Loading orders…</p>;
  if (isError) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Could not load orders.</p>;
  if (!data?.length) return <div className="card p-10 text-center"><h1 className="text-xl font-bold">No orders yet</h1><Link to="/" className="btn mt-4">Start shopping</Link></div>;
  return (
    <div>
      <h1 className="text-2xl font-bold">Order history</h1>
      <div className="mt-6 space-y-3">
        {data.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="card flex flex-wrap items-center gap-4 p-4 hover:shadow">
            <span className="font-mono text-sm">{o.id.slice(0, 8)}…</span>
            <span className="flex-1 text-sm text-slate-500">{new Date(o.createdAt).toLocaleString()}</span>
            {badge(o.status)}<strong>{money(o.totalAmount)}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data: o, isLoading, isError } = useQuery({ queryKey: ['order', id], queryFn: () => api.order(id) });
  const qc = useQueryClient();
  const toast = useToast((s) => s.push);
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); toast('Order cancelled'); },
    onError: (e: Error) => toast(e.message, 'err'),
  });
  if (isLoading) return <p role="status">Loading…</p>;
  if (isError || !o) return <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">Order not found.</p>;
  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="flex-1 text-xl font-bold">Order {o.id.slice(0, 8)}…</h1>{badge(o.status)}
      </div>
      <p className="mt-2 text-sm text-slate-500">{new Date(o.createdAt).toLocaleString()}</p>
      <ul className="mt-6 space-y-2">
        {(o.items ?? []).map((i, idx) => <li key={idx} className="flex justify-between text-sm"><span>{i.productName} × {i.quantity}</span><span>{money(i.unitPrice * i.quantity)}</span></li>)}
      </ul>
      <p className="mt-4 border-t pt-4 text-right">Total: <strong>{money(o.totalAmount)}</strong></p>
      {['PENDING', 'CONFIRMED'].includes(o.status) && <button className="btn-danger mt-6" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</button>}
    </div>
  );
}
