'use client';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Building2, CalendarDays, Clock3, Coffee, History, LayoutDashboard, LogOut, Menu as MenuIcon, Printer, Search, ShoppingCart } from 'lucide-react';
import Dashboard from '@/components/dashboard';
import Billing from '@/components/billing';
import Menus from '@/components/menus';
import Sales from '@/components/sales';
import PrinterConnection from '@/components/printer-connection';
import BusinessProfilePage from '@/components/business-profile';
import NotificationCenter from '@/components/notification-center';
import clientBrand from '@/branding/client.json';
import { api, logIn } from '@/lib/api';
import { deviceDate } from '@/lib/device-time';
import type { BusinessProfile, Category, DashboardInsights, Page, Product, Report, Sale, Session } from '@/lib/types';

const navigation = [{ id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard }, { id: 'billing', label: 'Billing', Icon: ShoppingCart }, { id: 'today', label: "Today's Sales", Icon: CalendarDays }, { id: 'history', label: 'Sales History', Icon: History }, { id: 'menus', label: 'Menus', Icon: MenuIcon }, { id: 'printer', label: 'Printer Connection', Icon: Printer }, { id: 'profile', label: 'Business Profile', Icon: Building2 }] as const;
const emptyReport: Report = { totals: { orders: 0, revenue_cents: 0, subtotal_cents: 0, discount_cents: 0, tax_cents: 0 }, orderTypes: [], orderSources: [], payments: [] };
const emptyInsights: DashboardInsights = { weeklySales: [], topItems: [] };
const readSession = () => { try { return sessionStorage.getItem('pos-session'); } catch { return null; } };
const saveSession = (value: Session) => { try { sessionStorage.setItem('pos-session', JSON.stringify(value)); } catch { /* Session stays usable in memory. */ } };
const clearSession = () => { try { sessionStorage.removeItem('pos-session'); } catch { /* Storage may be unavailable. */ } };

export default function Home() {
  const [page, setPage] = useState<Page>('dashboard');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [report, setReport] = useState<Report>(emptyReport);
  const [insights, setInsights] = useState<DashboardInsights>(emptyInsights);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [taxRateBps, setTaxRateBps] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<'loading' | 'login' | 'change' | 'ready'>('login');
  const [brand] = useState({ name: clientBrand.name, tagline: clientBrand.tagline });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [mobileApp, setMobileApp] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [developerKey, setDeveloperKey] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [clock, setClock] = useState<Date | null>(null);
  const lastBusinessDay = useRef<string | null>(null);

  useEffect(() => {
    setMobileApp(Capacitor.isNativePlatform());
    setClock(new Date());
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const currentDay = clock ? deviceDate(clock) : null;
  useEffect(() => {
    if (!currentDay || status !== 'ready' || !session) return;
    if (lastBusinessDay.current && lastBusinessDay.current !== currentDay) refresh(session).catch(() => {});
    lastBusinessDay.current = currentDay;
  }, [currentDay, status, session]);

  useEffect(() => {
    const saved = readSession();
    if (!saved) return;
    setStatus('loading');
    try {
      const previous = JSON.parse(saved) as Session;
      Promise.race([
        api<{ user: Session['user'] }>('/auth/me', 'GET', undefined, previous.token),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Session check timed out')), 6000))
      ])
        .then(async ({ user }) => {
          const current = { ...previous, user };
          setSession(current);
          if (user.mustChangePassword) setStatus('change');
          else { await refresh(current); setStatus('ready'); }
        })
        .catch(() => { clearSession(); setSession(null); setStatus('login'); });
    } catch { clearSession(); setStatus('login'); }
  }, []);

  async function refresh(current: Session) {
    const token = current.token;
    const [cats, prods, history, business, dashboardInsights] = await Promise.all([
      api<Category[]>('/categories', 'GET', undefined, token), api<Product[]>('/products', 'GET', undefined, token),
      api<Sale[]>('/sales', 'GET', undefined, token),
      api<BusinessProfile>('/business','GET',undefined,token),
      api<DashboardInsights>('/dashboard/insights','GET',undefined,token)
    ]);
    setCategories(cats); setProducts(prods); setSales(history);
    setTaxRateBps(business.default_tax_rate_bps);
    setBusinessProfile(business); setInsights(dashboardInsights);
    const today = deviceDate();
    const todaySales = await api<Sale[]>(`/sales?from=${today}&to=${today}`, 'GET', undefined, token);
    const completedToday = todaySales.filter(sale => sale.status === 'COMPLETED');
    const totals = completedToday.reduce((result, sale) => ({ orders: result.orders + 1, revenue_cents: result.revenue_cents + sale.total_cents, subtotal_cents: result.subtotal_cents + sale.subtotal_cents, discount_cents: result.discount_cents + sale.discount_cents, tax_cents: result.tax_cents + sale.tax_cents }), { ...emptyReport.totals });
    setReport({ totals,
      orderTypes: (['DINE_IN', 'TAKEAWAY'] as const).map(order_type => ({ order_type, orders: completedToday.filter(s => s.order_type === order_type).length, revenue_cents: completedToday.filter(s => s.order_type === order_type).reduce((n, s) => n + s.total_cents, 0) })),
      orderSources: (['POS', 'PHONE'] as const).map(order_source => ({ order_source, orders: completedToday.filter(s => s.order_source === order_source).length, revenue_cents: completedToday.filter(s => s.order_source === order_source).reduce((n, s) => n + s.total_cents, 0) })),
      payments: (['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'] as const).map(method => ({ method, orders: completedToday.filter(s => s.payment_method === method).length, revenue_cents: completedToday.filter(s => s.payment_method === method).reduce((n, s) => n + s.total_cents, 0) }))
    });
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await logIn(username.trim(), password);
      if (result.user.role === 'SYSTEM_ADMIN') throw new Error('Use a client account to sign in.');
      setSession(result); saveSession(result);
      if (result.user.mustChangePassword) setStatus('change');
      else { await refresh(result); setPassword(''); setStatus('ready'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }

  async function developerReset(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/auth/developer-reset', 'POST', { username: username.trim(), developerKey, temporaryPassword: resetPassword });
      setDeveloperKey(''); setResetPassword(''); setPassword(''); setResetMode(false);
      setError('Password reset. Sign in with the new temporary password, then create your own password.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reset password.'); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); if (!session) return;
    setError(''); setBusy(true);
    try {
      const result = await api<Session>('/auth/change-password', 'POST', { currentPassword: password, newPassword, confirmPassword }, session.token);
      setSession(result); saveSession(result);
      await refresh(result); setPassword(''); setNewPassword(''); setConfirmPassword(''); setStatus('ready');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change password'); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (session) await api('/auth/logout', 'POST', {}, session.token).catch(() => {});
    clearSession(); setSession(null); setStatus('login');
    setPassword(''); setCategories([]); setProducts([]); setSales([]); setReport(emptyReport);
    setBusinessProfile(null); setInsights(emptyInsights); setPage('dashboard');
  }
  function navigate(next: Page) { setPage(next); setMobileSidebar(false); }
  function completed(sale: Sale) { setSales(current => [sale, ...current]); if (session) refresh(session).catch(() => {}); }
  const title: Record<Page,string> = { dashboard: 'Dashboard', billing: 'Billing', today: "Today's Sales", history: 'Sales History', menus: 'Menus', printer: 'Printer Connection', profile: 'Business Profile' };
  const displayName = businessProfile?.name || brand.name;
  const currentHour = clock ? clock.getHours() : 12;
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = clock ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(clock) : '';
  const timeLabel = clock ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(clock) : '--:--';

  if (status !== 'ready' || !session) return <div className="auth-screen">
    <div className="auth-card">
      <div className="auth-logo"><img src="./branding/logo.png" alt="Client logo" onError={event => { event.currentTarget.style.display = 'none'; }} /><Coffee size={25} /></div>
      <div className="auth-eyebrow">LOCAL {mobileApp ? 'MOBILE' : 'DESKTOP'} POS</div>
      <h1>{resetMode ? 'Developer password reset' : status === 'change' ? 'Create your password' : `Welcome to ${brand.name}`}</h1>
      <p>{resetMode ? 'Enter the developer key and a new temporary password on this device.' : status === 'change' ? 'Replace the temporary password before using the register.' : 'Sign in with the account provided by your administrator.'}</p>
      {status === 'loading' ? <div className="auth-loading">Loading your local workspace…</div> : <form onSubmit={resetMode ? developerReset : status === 'change' ? changePassword : signIn}>
        {resetMode && <><label className="form-field">Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label><label className="form-field">Developer key<input type="password" autoComplete="off" value={developerKey} onChange={event => setDeveloperKey(event.target.value)} required /></label><label className="form-field">New temporary password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={resetPassword} onChange={event => setResetPassword(event.target.value)} required /></label></>}
        {!resetMode && status === 'login' && <label className="form-field">Username<input autoFocus autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>}
        {!resetMode && <label className="form-field">{status === 'change' ? 'Temporary password' : 'Password'}<input autoFocus={status === 'change'} autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>}
        {!resetMode && status === 'change' && <><label className="form-field">New password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label><label className="form-field">Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required /></label></>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Please wait…' : resetMode ? 'Reset password' : status === 'change' ? 'Save new password' : 'Sign in'}</button>
      </form>}
      <div className="auth-note">{status === 'change' ? 'Your new password must have at least 10 characters.' : mobileApp && status === 'login' ? <button type="button" className="auth-reset-link" onClick={() => { setError(''); setResetMode(value => !value); }}>{resetMode ? 'Back to sign in' : 'Developer reset'}</button> : 'Forgot your password? Contact your developer for a reset.'}</div>
    </div>
    <div className="auth-footer">Your business data stays on this {mobileApp ? 'device' : 'computer'}.</div>
  </div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileSidebar ? 'open' : ''}`}>
      <div className="brand-block"><div className="brand-top"><img src="./branding/logo.png" alt="Client logo" onError={event => { event.currentTarget.style.display = 'none'; }} /><div className="brand-copy"><strong title={displayName}>{displayName}</strong><small title={brand.tagline}>{brand.tagline}</small></div></div></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="sidebar-nav" aria-label="Main navigation">{navigation.filter(item => !mobileApp || item.id !== 'printer').map(({ id, label, Icon }) => <button key={id} onClick={() => navigate(id)} className={page === id ? 'active' : ''}><Icon size={21} strokeWidth={2.1} /><span>{label}</span></button>)}</nav>
      <div className="clean-sidebar-footer"><button onClick={signOut}><LogOut size={18} /> Log out</button></div>
    </aside>
    {mobileSidebar && <div className="mobile-scrim" onClick={() => setMobileSidebar(false)} />}
    <div className="main-area">
      <header className="topbar"><div className="header-left"><button className="mobile-menu" onClick={() => setMobileSidebar(true)} aria-label="Open menu"><MenuIcon size={22} /></button><div className="heading"><h1>{page === 'dashboard' ? greeting : title[page]}</h1><p>{page === 'dashboard' ? dateLabel : displayName}</p></div></div><div className="header-right"><div className="global-search"><Search size={18} /><input placeholder="Search menu items…" value={globalSearch} onChange={event => { setGlobalSearch(event.target.value); if (event.target.value) setPage('menus'); }} /></div><div className="clean-clock"><Clock3 size={17} /><span>{timeLabel}</span></div><NotificationCenter clientId={clientBrand.clientId} userId={session.user.id} /><span className="clean-user" title={session.user.username}><span className="avatar">{session.user.username.slice(0, 1).toUpperCase()}</span><span>{session.user.username}</span></span></div></header>
      <main className="content">
        {page === 'dashboard' && <Dashboard report={report} sales={sales} products={products} insights={insights} onBilling={() => navigate('billing')} onMenus={() => navigate('menus')} onToday={() => navigate('today')} onHistory={() => navigate('history')} />}
        {page === 'billing' && <Billing categories={categories} products={products} token={session.token} profile={businessProfile} taxRateBps={taxRateBps} onComplete={completed} mobileApp={mobileApp} />}
        {(page === 'today' || page === 'history') && <Sales token={session.token} todayOnly={page === 'today'} mobileApp={mobileApp} />}
        {page === 'printer' && <PrinterConnection token={session.token} canEdit={session.user.role === 'BUSINESS_ADMIN'} onChange={() => refresh(session).catch(() => {})} />}
        {page === 'menus' && <Menus categories={categories} products={products} token={session.token} demo={false} canEdit={session.user.role === 'BUSINESS_ADMIN'} initialSearch={globalSearch} onCategories={setCategories} onProducts={setProducts} />}
        {page === 'profile' && businessProfile && <BusinessProfilePage profile={businessProfile} token={session.token} canEdit={session.user.role === 'BUSINESS_ADMIN'} onSaved={setBusinessProfile} />}
      </main>
    </div>
  </div>;
}
