'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Minus, Phone, Plus, Printer, Search, ShoppingBag, ShoppingCart, Trash2, Utensils } from 'lucide-react';
import { api, money } from '@/lib/api';
import type { Category, OrderSource, OrderType, PaymentMethod, Product, Sale } from '@/lib/types';

type Props = { categories: Category[]; products: Product[]; token: string; taxRateBps?: number; onComplete: (sale: Sale) => void };
type Customer = { id: number; name: string; phone: string };
export default function Billing({ categories, products, token, taxRateBps = 0, onComplete }: Props) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [orderType, setOrderType] = useState<OrderType>('TAKEAWAY');
  const [orderSource, setOrderSource] = useState<OrderSource>('POS');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [discountType, setDiscountType] = useState<'NONE'|'FIXED'|'PERCENTAGE'>('NONE');
  const [discountValue, setDiscountValue] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceived, setCashReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<Sale | null>(null);
  useEffect(() => { if (orderSource === 'PHONE') setCustomerOpen(true); }, [orderSource]);
  useEffect(() => {
    if (customerPhone.trim().length < 2) { setCustomers([]); return; }
    const timer = setTimeout(() => api<Customer[]>(`/customers?phone=${encodeURIComponent(customerPhone.trim())}`,'GET',undefined,token).then(setCustomers).catch(() => setCustomers([])), 250);
    return () => clearTimeout(timer);
  }, [customerPhone, token]);
  const filtered = products.filter(product => product.is_active && (!categoryId || product.category_id === categoryId) && product.name.toLowerCase().includes(search.toLowerCase()));
  const lines = useMemo(() => products.filter(product => (cart[product.id] || 0) > 0).map(product => ({ product, quantity: cart[product.id], total: product.price_cents * cart[product.id] })), [products, cart]);
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const requestedDiscount = discountType === 'FIXED' ? Math.round(Number(discountValue || 0)*100) : discountType === 'PERCENTAGE' ? Math.round(subtotal*Number(discountValue || 0)/100) : 0;
  const discount = Math.max(0, Math.min(subtotal, requestedDiscount));
  const taxable = lines.reduce((sum, line) => sum + (line.product.is_taxable ? line.total : 0), 0);
  const tax = Math.round((taxable - (subtotal ? discount*taxable/subtotal : 0))*taxRateBps/10000);
  const total = subtotal - discount + tax;
  function setQuantity(id: number, quantity: number) { setCart(current => { const next = { ...current }; if (quantity <= 0) delete next[id]; else next[id] = Math.min(quantity,999); return next; }); }
  async function checkout(printReceipt: boolean) {
    setError(''); setCompleted(null);
    if (!lines.length) return setError('Add at least one menu item.');
    if (orderSource === 'PHONE' && (!customerName.trim() || !customerPhone.trim())) return setError('Phone orders need a customer name and phone number.');
    if (Number(discountValue) < 0 || Number(discountValue) > (discountType === 'PERCENTAGE' ? 100 : subtotal/100)) return setError('Enter a valid discount.');
    if (paymentMethod === 'CASH' && Math.round(Number(cashReceived)*100) < total) return setError('Cash received must cover the total.');
    setBusy(true);
    try {
      let sale = await api<Sale>('/sales','POST',{ orderType, orderSource, customerName: customerName.trim(), customerPhone: customerPhone.trim(), tableNumber: tableNumber.trim() },token);
      for (const line of lines) await api<Sale>(`/sales/${sale.id}/items/${line.product.id}`,'PUT',{ quantity: line.quantity },token);
      if (discountType !== 'NONE') await api<Sale>(`/sales/${sale.id}`,'PATCH',{ discountType, discountValue: Math.round(Number(discountValue)*100) },token);
      sale = await api<Sale>(`/sales/${sale.id}/checkout`,'POST',{ idempotencyKey: crypto.randomUUID(), paymentMethod, printReceipt, ...(paymentMethod === 'CASH' ? { cashReceivedCents: Math.round(Number(cashReceived)*100) } : {}) },token);
      if (customerName.trim() && customerPhone.trim()) api('/customers','POST',{ name: customerName.trim(), phone: customerPhone.trim() },token).catch(() => {});
      setCompleted(sale); onComplete(sale); setCart({}); setCashReceived(''); setDiscountType('NONE'); setDiscountValue('0'); setCustomerName(''); setCustomerPhone(''); setTableNumber('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Checkout failed'); }
    finally { setBusy(false); }
  }
  return <div className="billing-layout clean-billing"><section className="billing-catalog"><div className="section-title"><div><h2>New Sale</h2><p>Select menu items</p></div><span className="pill-soft"><ShoppingCart size={15} /> {lines.reduce((sum,line)=>sum+line.quantity,0)} items</span></div><div className="catalog-toolbar"><div className="search-field"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search menu items" /></div><div className="category-tabs"><button className={!categoryId?'active':''} onClick={() => setCategoryId(null)}>All</button>{categories.map(category => <button className={categoryId===category.id?'active':''} key={category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div></div><div className="billing-products">{filtered.map(product => <button key={product.id} className="billing-product" onClick={() => setQuantity(product.id,(cart[product.id]||0)+1)}><span className="billing-product-top"><span className="product-glyph"><ShoppingBag size={22} /></span><span className="billing-product-status">Available</span></span><span className="billing-product-category">{product.category_name || categories.find(category => category.id === product.category_id)?.name || 'Menu item'}</span><strong>{product.name}</strong><small>{product.description}</small><span className="product-bottom"><b>{money(product.price_cents)}</b><span className="billing-product-add"><Plus size={16} /></span></span></button>)}{!filtered.length && <div className="empty-state">No menu items found.</div>}</div></section>
    <aside className="bill-panel"><div className="section-title"><div><h2>Current bill</h2><p>{lines.length} distinct items</p></div></div><div className="order-modes"><label>Order type<div className="mode-buttons"><button className={orderType==='DINE_IN'?'selected':''} onClick={() => setOrderType('DINE_IN')}><Utensils size={16} /> Dine-in</button><button className={orderType==='TAKEAWAY'?'selected':''} onClick={() => setOrderType('TAKEAWAY')}><ShoppingBag size={16} /> Takeaway</button></div></label><label>Source<div className="mode-buttons"><button className={orderSource==='POS'?'selected':''} onClick={() => setOrderSource('POS')}>POS</button><button className={orderSource==='PHONE'?'selected':''} onClick={() => setOrderSource('PHONE')}><Phone size={16} /> Phone</button></div></label></div>{orderType==='DINE_IN' && <label className="form-field">Table number<input value={tableNumber} onChange={event => setTableNumber(event.target.value)} placeholder="Optional" /></label>}
      <details className="clean-customer-details" open={customerOpen} onToggle={event => setCustomerOpen(event.currentTarget.open)}><summary>Customer details <span>{orderSource==='PHONE'?'Required for phone orders':'Optional'}</span></summary><div className="phone-fields"><label className="form-field">Name<input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" /></label><label className="form-field">Phone<input value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="Phone number" /></label></div>{customers.length>0 && <div className="clean-customer-results">{customers.map(customer => <button key={customer.id} onClick={() => { setCustomerName(customer.name); setCustomerPhone(customer.phone); setCustomers([]); }}>{customer.name} · {customer.phone}</button>)}</div>}</details>
      <div className="bill-items"><div className="bill-items-head"><h3>Items</h3>{lines.length>0 && <button onClick={() => setCart({})}><Trash2 size={15} /> Clear</button>}</div>{lines.length ? lines.map(line => <div className="bill-item" key={line.product.id}><div className="bill-item-glyph"><ShoppingBag size={18} /></div><div className="bill-item-info"><strong>{line.product.name}</strong><small>{money(line.product.price_cents)} each</small><div className="quantity-control"><button onClick={() => setQuantity(line.product.id,line.quantity-1)}><Minus size={14} /></button><span>{line.quantity}</span><button onClick={() => setQuantity(line.product.id,line.quantity+1)}><Plus size={14} /></button></div></div><b>{money(line.total)}</b></div>) : <div className="bill-empty"><ShoppingCart size={27} /><strong>Bill is empty</strong><small>Select an item to begin.</small></div>}</div>
      <div className="bill-bottom"><div className="discount-row"><label>Discount<select value={discountType} onChange={event => setDiscountType(event.target.value as typeof discountType)}><option value="NONE">None</option><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percent</option></select></label>{discountType!=='NONE' && <input type="number" min="0" value={discountValue} onChange={event => setDiscountValue(event.target.value)} />}</div><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Discount</span><b>-{money(discount)}</b></div><div><span>Estimated tax</span><b>{money(tax)}</b></div><div className="grand-total"><span>Total</span><strong>{money(total)}</strong></div></div><label className="form-field">Payment method<span className="select-wrap"><select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="CREDIT_CARD">Credit card</option><option value="DEBIT_CARD">Debit card</option><option value="OTHER">Other</option></select><ChevronDown size={16} /></span></label>{paymentMethod==='CASH' && <label className="form-field">Cash received<input type="number" min="0" step="0.01" value={cashReceived} onChange={event => setCashReceived(event.target.value)} placeholder="0.00" /></label>}{error && <p className="form-error">{error}</p>}<div className="clean-checkout-actions"><button className="secondary-button" disabled={busy||!lines.length} onClick={() => checkout(false)}>{busy?'Completing…':'Complete without receipt'}</button><button className="primary-button" disabled={busy||!lines.length} onClick={() => checkout(true)}><Printer size={16} /> Complete & print</button></div>{completed && <div className="checkout-success"><Check size={17} /> {completed.receipt_number} completed{completed.printJob?.status==='FAILED'?' · Printer unavailable':''}</div>}</div>
    </aside></div>;
}
