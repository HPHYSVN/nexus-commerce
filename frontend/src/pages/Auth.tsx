import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useToast } from '../store';
import { GoogleButton } from './Account';

function normalizeUser(resp: any) {
  const u = resp.user ?? resp;
  return { id: u.id, email: u.email, fullName: u.fullName ?? u.full_name ?? '', role: u.role, emailVerified: u.emailVerified, provider: u.provider };
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const login = useAuth((s) => s.login);
  const toast = useToast((s) => s.push);
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.login({ email, password });
      login(r.accessToken, r.refreshToken, normalizeUser(r));
      toast('Welcome back'); navigate('/');
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">Login</h1>
      <div className="mt-4"><label className="label" htmlFor="email">Email</label><input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="mt-4"><label className="label" htmlFor="password">Password</label><input id="password" type="password" required minLength={6} className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="btn mt-6 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
      <p className="mt-4 text-sm text-slate-600">No account? <Link className="underline" to="/register">Register</Link></p>
      <p className="mt-2 text-sm"><Link className="underline" to="/forgot-password">Forgot password?</Link></p>
      <GoogleButton />
    </form>
  );
}

export function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast((s) => s.push);
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.register({ email, password, fullName }); toast('Account created, please login'); navigate('/login'); }
    catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card mx-auto max-w-md p-6">
      <h1 className="text-xl font-bold">Register</h1>
      <div className="mt-4"><label className="label" htmlFor="name">Full name</label><input id="name" required className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
      <div className="mt-4"><label className="label" htmlFor="email">Email</label><input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="mt-4"><label className="label" htmlFor="password">Password</label><input id="password" type="password" required minLength={6} className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="btn mt-6 w-full" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      <p className="mt-4 text-sm text-slate-600">Already registered? <Link className="underline" to="/login">Login</Link></p>
      <GoogleButton />
    </form>
  );
}
