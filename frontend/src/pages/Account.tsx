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
