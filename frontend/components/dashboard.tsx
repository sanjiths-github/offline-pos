import { ArrowRight, Banknote, CreditCard, Package, ReceiptText } from 'lucide-react';
import { money } from '@/lib/api';
import { sqliteUtcDate } from '@/lib/device-time';
import type { DashboardInsights, Product, Report, Sale } from '@/lib/types';

type Props = { report: Report; sales: Sale[]; products: Product[]; insights: DashboardInsights; onBilling: () => void; onMenus: () => void; onToday: () => void; onHistory: () => void };
const orderName = (value: string) => ({ DINE_IN: 'Dine-in', TAKEAWAY: 'Takeaway' } as Record<string, string>)[value] || value;

export default function Dashboard({ report, sales, products, insights, onBilling, onMenus, onToday, onHistory }: Props) {
  const recent = sales.filter(sale => sale.status === 'COMPLETED').slice(0, 7);
  const average = report.totals.orders ? Math.round(report.totals.revenue_cents / report.totals.orders) : 0;
  const cards = [
    { label: 'Total sales', value: money(report.totals.revenue_cents), Icon: Banknote, tone: 'green', action: onToday },
    { label: 'Orders today', value: String(report.totals.orders), Icon: ReceiptText, tone: 'orange', action: onToday },
    { label: 'Average order', value: money(average), Icon: CreditCard, tone: 'purple', action: onToday },
    { label: 'Active menu items', value: String(products.filter(product => product.is_active).length), Icon: Package, tone: 'blue', action: onMenus }
  ];
  const peak = Math.max(1, ...insights.weeklySales.map(day => day.revenue_cents));
  const weeklyTotal = insights.weeklySales.reduce((sum, day) => sum + day.revenue_cents, 0);
  const time = (date?: string) => {
    const parsed = date ? sqliteUtcDate(date) : null;
    return parsed ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(parsed) : '—';
  };

  return <div className="clean-dashboard">
    <div className="clean-page-heading"><div><h2>Monitoring</h2><p>Today&apos;s business at a glance</p></div><button className="dashboard-new-sale" onClick={onBilling}><span>New sale</span><ArrowRight size={16} strokeWidth={1.8} /></button></div>
    <div className="clean-stat-grid">{cards.map(({ label, value, Icon, tone, action }) => <button className="clean-stat" key={label} onClick={action}><span>{label}</span><span className={`dashboard-icon tone-${tone}`}><Icon size={18} strokeWidth={1.8} /></span><strong>{value}</strong><span className="clean-stat-foot">View details <ArrowRight size={14} /></span></button>)}</div>
    <div className="clean-dashboard-grid">
      <section className="clean-panel dashboard-insight"><div className="clean-panel-header"><h3>Weekly Sales Performance</h3><span>This week</span></div><div className="weekly-chart"><div className="weekly-chart-total"><span>Total revenue</span><strong>{money(weeklyTotal)}</strong></div><div className="weekly-bars">{insights.weeklySales.map(day => <div className="weekly-day" key={day.date} title={`${day.date}: ${money(day.revenue_cents)} · ${day.orders} orders`}><span className="weekly-value">{day.revenue_cents ? money(day.revenue_cents) : ''}</span><div className="weekly-track"><div style={{ height: `${day.revenue_cents ? Math.max(6, day.revenue_cents / peak * 100) : 0}%` }} /></div><span className="weekly-label">{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</span></div>)}</div></div></section>
      <section className="clean-panel dashboard-insight"><div className="clean-panel-header"><h3>Top-Selling Menu Items</h3><span>All time</span></div><div className="top-items">{insights.topItems.length ? insights.topItems.map((item, index) => <div className="top-item" key={`${item.name}-${item.category}`}><span className="top-rank">{index + 1}</span><span className="top-item-info"><strong>{item.name}</strong><small>{item.category} · {item.quantity} sold</small></span><strong className="top-revenue">{money(item.revenue_cents)}</strong></div>) : <p className="clean-inline-empty">Top items appear after your first completed sale.</p>}</div></section>
      <section className="clean-panel clean-recent-panel"><div className="clean-panel-header"><h3>Recent Sales</h3><button onClick={onHistory}>Sales history <ArrowRight size={15} /></button></div>{recent.length ? <div className={`clean-table-wrap${recent.length > 5 ? ' clean-recent-scroll' : ''}`}><table className="clean-table"><thead><tr><th>Receipt</th><th>Time</th><th>Order</th><th>Customer</th><th>Total</th></tr></thead><tbody>{recent.map(sale => <tr key={sale.id}><td>{sale.receipt_number}</td><td>{time(sale.completed_at)}</td><td>{orderName(sale.order_type)}</td><td>{sale.customer_name || 'Walk-in'}</td><td>{money(sale.total_cents)}</td></tr>)}</tbody></table></div> : <div className="clean-empty">No sales recorded yet.</div>}</section>
    </div>
  </div>;
}
