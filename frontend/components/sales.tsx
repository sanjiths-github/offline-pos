'use client';
import { useEffect, useState } from 'react';
import { CalendarDays, Printer, ReceiptText, Search, X } from 'lucide-react';
import { api, money } from '@/lib/api';
import { deviceDate, deviceDateTime } from '@/lib/device-time';
import type { Sale } from '@/lib/types';

type Period = 'ALL' | 'MORNING' | 'NOON' | 'EVENING' | 'NIGHT';
type PrintJob = { id: number; status: string; error_message?: string };
export default function Sales({ token, todayOnly }: { token: string; todayOnly: boolean }) {
  const today = deviceDate();
  const monthAgoDate = new Date();
  monthAgoDate.setDate(monthAgoDate.getDate() - 30);
  const monthAgo = deviceDate(monthAgoDate);
  const [from, setFrom] = useState(todayOnly ? today : monthAgo);
  const [to, setTo] = useState(today);
  const [period, setPeriod] = useState<Period>('ALL');
  const [query, setQuery] = useState('');
  const [sales, setSales] = useState<Sale[]>([]);
  const [selected, setSelected] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState('');
  const [job, setJob] = useState<PrintJob | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { setFrom(todayOnly ? today : monthAgo); setTo(today); setPeriod('ALL'); }, [todayOnly]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ from: todayOnly ? today : from, to: todayOnly ? today : to, period });
    api<Sale[]>(`/sales?${params}`, 'GET', undefined, token)
      .then(result => { if (alive) setSales(result); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load sales'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, from, to, period, todayOnly, today]);
  const visible = sales.filter(sale => `${sale.receipt_number || ''} ${sale.customer_name || ''} ${sale.customer_phone || ''}`.toLowerCase().includes(query.toLowerCase()));
  const completed = visible.filter(sale => sale.status === 'COMPLETED');
  const total = completed.reduce((sum, sale) => sum + sale.total_cents, 0);
  async function openSale(id: number) {
    setError(''); setReceipt(''); setJob(null);
    try {
      const detail = await api<Sale>(`/sales/${id}`, 'GET', undefined, token);
      setSelected(detail);
      if (detail.status === 'COMPLETED') {
        const [preview, jobs] = await Promise.all([
          api<{ text: string }>(`/sales/${id}/receipt-preview`, 'GET', undefined, token),
          api<PrintJob[]>(`/sales/${id}/print-jobs`, 'GET', undefined, token)
        ]);
        setReceipt(preview.text); setJob(jobs[0] || null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open sale'); }
  }
  async function printReceipt() {
    if (!selected) return;
    setPrinting(true); setError('');
    try {
      const latest = await api<PrintJob>(`/sales/${selected.id}/reprint`, 'POST', {}, token);
      setJob(latest);
      if (latest.status === 'PENDING') setTimeout(async () => {
        try { const jobs = await api<PrintJob[]>(`/sales/${selected.id}/print-jobs`, 'GET', undefined, token); setJob(jobs[0] || latest); } catch { /* Current result remains visible. */ }
      }, 2000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not print receipt'); }
    finally { setPrinting(false); }
  }
  return <div className="clean-sales-page">
    <div className="clean-page-heading"><div><h2>{todayOnly ? "Today's Sales" : 'Sales History'}</h2><p>{todayOnly ? 'Completed transactions for today' : 'Find transactions and print receipts'}</p></div></div>
    <div className="clean-stat-grid clean-sales-stats"><div className="clean-stat"><span>Sales</span><strong>{money(total)}</strong></div><div className="clean-stat"><span>Orders</span><strong>{completed.length}</strong></div><div className="clean-stat"><span>Average order</span><strong>{money(completed.length ? Math.round(total/completed.length) : 0)}</strong></div></div>
    <div className="clean-panel"><div className="clean-filter-bar"><div className="search-field"><Search size={17} /><input placeholder="Receipt or customer" value={query} onChange={event => setQuery(event.target.value)} /></div>{!todayOnly && <><label><CalendarDays size={15} /> From <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label></>}<select aria-label="Time period" value={period} onChange={event => setPeriod(event.target.value as Period)}><option value="ALL">All day</option><option value="MORNING">Morning · 5–12</option><option value="NOON">Noon · 12–17</option><option value="EVENING">Evening · 17–21</option><option value="NIGHT">Night · 21–5</option></select></div>
      {error && !selected && <p className="form-error">{error}</p>}
      {loading ? <div className="clean-empty">Loading sales…</div> : visible.length ? <div className="clean-table-wrap"><table className="clean-table"><thead><tr><th>Receipt</th><th>Date & time</th><th>Customer</th><th>Order</th><th>Payment</th><th>Status</th><th>Total</th><th></th></tr></thead><tbody>{visible.map(sale => <tr key={sale.id}><td>{sale.receipt_number || '—'}</td><td>{deviceDateTime(sale.completed_at)}</td><td>{sale.customer_name || 'Walk-in'}</td><td>{sale.order_type === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}</td><td>{sale.payment_method?.replaceAll('_',' ') || '—'}</td><td>{sale.status}</td><td>{money(sale.total_cents)}</td><td><button className="clean-link" onClick={() => openSale(sale.id)}>View</button></td></tr>)}</tbody></table></div> : <div className="clean-empty">No transactions match these filters.</div>}
    </div>
    {selected && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><div className="modal clean-receipt-modal"><div className="modal-header"><div><h2>{selected.receipt_number || `Order #${selected.id}`}</h2><p>{selected.completed_at ? deviceDateTime(selected.completed_at) : selected.status} · {selected.cashier}</p></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close"><X size={19} /></button></div><div className="modal-body"><div className="clean-receipt-meta"><span>Customer: {selected.customer_name || 'Walk-in'}</span><span>Phone: {selected.customer_phone || '—'}</span><span>Payment: {selected.payment?.method?.replaceAll('_',' ') || '—'}</span></div>{selected.status === 'COMPLETED' ? <pre className="clean-receipt-preview">{receipt}</pre> : <div className="clean-empty">This order was cancelled.</div>}{job && <p className={`clean-job-status ${job.status.toLowerCase()}`}>Print status: {job.status.toLowerCase()}{job.error_message ? ` — ${job.error_message}` : ''}</p>}{error && <p className="form-error">{error}</p>}</div><div className="modal-actions"><button className="secondary-button" onClick={() => setSelected(null)}>Close</button>{selected.status === 'COMPLETED' && <button className="primary-button" onClick={printReceipt} disabled={printing}><Printer size={16} /> {printing ? 'Printing…' : job ? 'Reprint receipt' : 'Print receipt'}</button>}</div></div></div>}
  </div>;
}
