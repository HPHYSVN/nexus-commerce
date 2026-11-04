import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useToast } from '../store';

declare global { interface Window { google?: any } }

export function GoogleButton() {
  const ref = useRef<HTMLDivElement>(null);
  const login = useAuth((s) => s.login);
  const toast = useToast((s) => s.push);
  const navigate = useNavigate();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return;
    const init = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          try {
            const r = await api.googleLogin(resp.credential);
            const u = r.user ?? {};
            login(r.accessToken, r.refreshToken, { id: u.id, email: u.email, fullName: u.fullName ?? '', role: u.role, emailVerified: u.emailVerified, provider: u.provider });
            toast('Signed in with Google'); navigate('/');
          } catch (e) { toast((e as Error).message, 'err'); }
        },
      });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320 });
    };
    if (window.google) { init(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init;
    document.head.appendChild(s);
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
      <div ref={ref} className="flex justify-center" />
    </div>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'ok' | 'err'>('working');
  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState('err'); return; }
    api.verifyEmail(token).then(() => setState('ok')).catch(() => setState('err'));
  }, [params]);
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-bold">Email verification</h1>
      {state === 'working' && <p className="mt-3" role="status">Verifying…</p>}
      {state === 'ok' && <p className="mt-3 text-green-700">Email verified. <Link className="underline" to="/login">Continue to login</Link></p>}
      {state === 'err' && <p className="mt-3 text-red-600" role="alert">This verification link is invalid or expired. Login and resend from your profile.</p>}
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const toast = useToast((s) => s.push);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.forgotPassword(email); setSent(true); }
    catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">Forgot password</h1>
      {sent ? <p className="mt-3 text-green-700">If an account exists for this email, a reset link has been sent.</p> : (<>
        <div className="mt-4"><label className="label" htmlFor="email">Email</label><input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <button className="btn mt-6 w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </>)}
      <p className="mt-4 text-sm"><Link className="underline" to="/login">Back to login</Link></p>
    </form>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const toast = useToast((s) => s.push); const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { toast('Passwords do not match', 'err'); return; }
    setBusy(true);
    try { await api.resetPassword(params.get('token') ?? '', password); toast('Password updated, please login'); navigate('/login'); }
    catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">Reset password</h1>
      <div className="mt-4"><label className="label" htmlFor="pw">New password</label><input id="pw" type="password" required minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="mt-4"><label className="label" htmlFor="pw2">Confirm password</label><input id="pw2" type="password" required minLength={8} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      <button className="btn mt-6 w-full" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </form>
  );
}

function AddressBook() {
  const toast = useToast((s) => s.push);
  const [form, setForm] = useState({ label: 'Home', recipientName: '', phone: '', addressLine: '', city: '', isDefault: false });
  const [list, setList] = useState<Array<import('../api').Address>>([]);
  const [loading, setLoading] = useState(true);
  const load = () => { api.addresses().then(setList).catch(() => undefined).finally(() => setLoading(false)); };
  useEffect(load, []);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api.createAddress(form); toast('Address saved'); setForm({ label: 'Home', recipientName: '', phone: '', addressLine: '', city: '', isDefault: false }); load(); }
    catch (err) { toast((err as Error).message, 'err'); }
  }
  async function del(id: string) {
    try { await api.deleteAddress(id); toast('Address removed'); load(); } catch (err) { toast((err as Error).message, 'err'); }
  }
  return (
    <section className="card p-6">
      <h2 className="font-bold">Address book</h2>
      {loading && <p className="mt-2 text-sm" role="status">Loading addresses…</p>}
      <ul className="mt-3 space-y-2">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-sand px-4 py-3 text-sm">
            <span className="flex-1"><strong>{a.label || 'Address'}</strong>{a.isDefault ? ' · default' : ''}<br />{a.recipientName} — {a.addressLine}, {a.city} · {a.phone}</span>
            <button className="btn-danger !px-3 !py-1 text-xs" onClick={() => del(a.id)}>Delete</button>
          </li>
        ))}
        {!loading && list.length === 0 && <li className="text-sm text-inksoft">No saved addresses yet.</li>}
      </ul>
      <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="ab-label">Label</label><input id="ab-label" className="input" value={form.label} onChange={set('label')} /></div>
        <div><label className="label" htmlFor="ab-name">Recipient</label><input id="ab-name" className="input" required value={form.recipientName} onChange={set('recipientName')} /></div>
        <div><label className="label" htmlFor="ab-phone">Phone</label><input id="ab-phone" className="input" required value={form.phone} onChange={set('phone')} /></div>
        <div><label className="label" htmlFor="ab-city">City</label><input id="ab-city" className="input" required value={form.city} onChange={set('city')} /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="ab-addr">Address</label><input id="ab-addr" className="input" required value={form.addressLine} onChange={set('addressLine')} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={set('isDefault')} /> Set as default</label>
        <button className="btn">Add address</button>
      </form>
    </section>
  );
}

export function ProfilePage() {
  const { user, login, accessToken, refreshToken } = useAuth();
  const toast = useToast((s) => s.push);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [current, setCurrent] = useState(''); const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  async function saveName(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const u = await api.updateMe(fullName);
      login(accessToken!, refreshToken!, { ...user!, fullName: u.fullName ?? fullName, emailVerified: u.emailVerified, provider: u.provider });
      toast('Profile updated');
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.changePassword(current, next); toast('Password changed'); setCurrent(''); setNext(''); }
    catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>
      <section className="card p-6">
        <p className="text-sm text-slate-500">Email</p><p className="font-medium">{user.email}</p>
        <p className="mt-3 text-sm">
          Email status: {user.emailVerified
            ? <span className="text-green-700 font-medium">Verified</span>
            : (<> <span className="text-amber-700 font-medium">Not verified</span>{' '}
                <button className="underline" onClick={async () => { try { await api.resendVerification(); toast('Verification email sent'); } catch (e) { toast((e as Error).message, 'err'); } }}>Resend verification email</button></>)}
        </p>
        <p className="mt-1 text-sm text-slate-500">Sign-in method: {user.provider ?? 'LOCAL'} · Role: {user.role}</p>
        <form onSubmit={saveName} className="mt-5">
          <label className="label" htmlFor="fn">Full name</label>
          <input id="fn" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <button className="btn mt-4" disabled={busy}>Save</button>
        </form>
      </section>
      <AddressBook />
      <section className="card p-6">
        <h2 className="font-bold">Change password</h2>
        <form onSubmit={changePw} className="mt-3">
          <label className="label" htmlFor="cp">Current password</label>
          <input id="cp" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <label className="label mt-3" htmlFor="np">New password</label>
          <input id="np" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          <button className="btn mt-4" disabled={busy}>Change password</button>
        </form>
      </section>
    </div>
  );
}
