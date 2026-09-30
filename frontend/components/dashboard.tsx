import { ArrowRight, Banknote, CalendarClock, Clock3, CreditCard, Package, Printer, ReceiptText, ShoppingBag, Store } from 'lucide-react';
import { money } from '@/lib/api';
import type { Category, Product, Report, Sale } from '@/lib/types';

type Props = {
  report: Report;
  sales: Sale[];
  categories: Category[];
  products: Product[];
  shift?: { username?: string; opening_cash_cents: number; opened_at: string; status: string } | null;
  printer?: { name: string; connection_type: string; receipt_width: number } | null;
  lastBackup?: string | null;
  timezone: string;
  onBilling: () => void;
  onMenus: () => void;
  onToday: () => void;
  onHistory: () => void;
  onPrinter: () => void;
};

function rowName(value: string) {
  return ({ DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway', CASH: 'Cash', CREDIT_CARD: 'Credit card', DEBIT_CARD: 'Debit card', OTHER: 'Other' } as Record<string, string>)[value] || value;
}

export default function Dashboard({ report, sales, categories, products, shift, printer, lastBackup, timezone, onBilling, onMenus, onToday, onHistory, onPrinter }: Props) {
  const recent = sales.filter(sale => sale.status === 'COMPLETED').slice(0, 5);
  const activeProducts = products.filter(product => product.is_active).length;
  const average = report.totals.orders ? Math.round(report.totals.revenue_cents / report.totals.orders) : 0;
  const cards = [
    { label: 'Total sales', value: money(report.totals.revenue_cents), Icon: Banknote, action: onToday },
    { label: 'Orders today', value: String(report.totals.orders), Icon: ReceiptText, action: onToday },
    { label: 'Average order', value: money(average), Icon: CreditCard, action: onToday },
    { label: 'Active menu items', value: String(activeProducts), Icon: Package, action: onMenus }
  ];
  const orderTotal = report.orderTypes.reduce((sum, row) => sum + row.orders, 0);
  const paymentTotal = report.payments.reduce((sum, row) => sum + row.revenue_cents, 0);
  const time = (date?: string) => {
    if (!date) return '—';
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(parsed);
  };

  return <div className="clean-dashboard">
    <div className="clean-page-heading"><div><h2>Monitoring</h2><p>Today&apos;s business at a glance</p></div><button className="primary-button" onClick={onBilling}>New sale <ArrowRight size={16} /></button></div>
    <div className="clean-stat-grid">{cards.map(({ label, value, Icon, action }) => <button className="clean-stat" key={label} onClick={action}><span>{label}</span><Icon size={19} strokeWidth={1.8} /><strong>{value}</strong><span className="clean-stat-foot">View details <ArrowRight size={14} /></span></button>)}</div>
    <div className="clean-dashboard-grid">
      <section className="clean-panel"><div className="clean-panel-header"><h3>Orders by type</h3><span>Today</span></div><div className="clean-breakdown">{report.orderTypes.map(row => <div className="clean-breakdown-row" key={row.order_type}><div><span>{rowName(row.order_type)}</span><strong>{row.orders} orders</strong></div><div className="clean-progress"><i style={{ width: `${orderTotal ? row.orders / orderTotal * 100 : 0}%` }} /></div><small>{money(row.revenue_cents)}</small></div>)}{!orderTotal && <p className="clean-inline-empty">No completed orders yet.</p>}</div></section>
      <section className="clean-panel"><div className="clean-panel-header"><h3>Payment methods</h3><span>Today</span></div><div className="clean-breakdown">{report.payments.filter(row => row.orders > 0).map(row => <div className="clean-breakdown-row" key={row.method}><div><span>{rowName(row.method)}</span><strong>{row.orders} orders</strong></div><div className="clean-progress"><i style={{ width: `${paymentTotal ? row.revenue_cents / paymentTotal * 100 : 0}%` }} /></div><small>{money(row.revenue_cents)}</small></div>)}{!paymentTotal && <p className="clean-inline-empty">No payments recorded yet.</p>}</div></section>
      <section className="clean-panel clean-recent-panel"><div className="clean-panel-header"><h3>Recent sales</h3><button onClick={onHistory}>Sales history <ArrowRight size={15} /></button></div>{recent.length ? <div className="clean-table-wrap"><table className="clean-table"><thead><tr><th>Receipt</th><th>Time</th><th>Order</th><th>Customer</th><th>Total</th></tr></thead><tbody>{recent.map(sale => <tr key={sale.id}><td>{sale.receipt_number}</td><td>{time(sale.completed_at)}</td><td>{rowName(sale.order_type)}</td><td>{sale.customer_name || 'Walk-in'}</td><td>{money(sale.total_cents)}</td></tr>)}</tbody></table></div> : <div className="clean-empty">No sales recorded yet.</div>}</section>
      <section className="clean-panel clean-status-panel"><div className="clean-panel-header"><h3>Workspace status</h3></div><div className="clean-status-list">
        <div><span className="clean-status-icon"><CalendarClock size={18} /></span><span><strong>Shift</strong><small>{shift ? `Open · ${shift.username || 'Cashier'}` : 'No open shift'}</small></span><i className={shift ? 'is-ready' : ''} /></div>
        <button onClick={onPrinter}><span className="clean-status-icon"><Printer size={18} /></span><span><strong>Receipt printer</strong><small>{printer ? printer.name : 'Not connected'}</small></span><ArrowRight size={16} /></button>
        <button onClick={onMenus}><span className="clean-status-icon"><Store size={18} /></span><span><strong>Menu</strong><small>{categories.filter(category => category.is_active).length} categories · {activeProducts} active items</small></span><ArrowRight size={16} /></button>
        {lastBackup && <div><span className="clean-status-icon"><Clock3 size={18} /></span><span><strong>Last backup</strong><small>{lastBackup}</small></span></div>}
        <button onClick={onBilling} className="clean-status-action"><span><ShoppingBag size={17} /> Create a bill</span><ArrowRight size={16} /></button>
      </div></section>
    </div>
  </div>;
}
