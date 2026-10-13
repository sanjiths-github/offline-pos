'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, MapPin, Minus, PauseCircle, Phone, Plus, Printer, ReceiptText, Search, ShoppingBag, Trash2, UtensilsCrossed, XCircle } from 'lucide-react';
import { api, money } from '@/lib/api';
import type { BusinessProfile, Category, OrderSource, OrderType, PaymentMethod, Product, Sale } from '@/lib/types';

type Props = { categories: Category[]; products: Product[]; token: string; profile: BusinessProfile | null; taxRateBps?: number; onComplete: (sale: Sale) => void; mobileApp?: boolean };
type Customer = { id: number; name: string; phone: string };

export default function Billing({ categories, products, token, profile, taxRateBps = 0, onComplete, mobileApp = false }: Props) {
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
  const [draftId, setDraftId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Sale[]>([]);
  const [confirmCancel, setConfirmCancel] = useState<number | 'current' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => { if (orderSource === 'PHONE') setCustomerOpen(true); }, [orderSource]);
  useEffect(() => {
    let active = true;
    api<Sale[]>('/sales/drafts', 'GET', undefined, token).then(rows => { if (active) setDrafts(rows); }).catch(() => {});
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (customerPhone.trim().length < 2) { setCustomers([]); return; }
    const timer = setTimeout(() => api<Customer[]>(`/customers?phone=${encodeURIComponent(customerPhone.trim())}`, 'GET', undefined, token).then(setCustomers).catch(() => setCustomers([])), 250);
    return () => clearTimeout(timer);
  }, [customerPhone, token]);

  const filtered = products.filter(product => product.is_active && (!categoryId || product.category_id === categoryId) && product.name.toLowerCase().includes(search.toLowerCase()));
  const lines = useMemo(() => products.filter(product => (cart[product.id] || 0) > 0).map(product => ({ product, quantity: cart[product.id], total: product.price_cents * cart[product.id] })), [products, cart]);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const requestedDiscount = discountType === 'FIXED' ? Math.round(Number(discountValue || 0) * 100) : discountType === 'PERCENTAGE' ? Math.round(subtotal * Number(discountValue || 0) / 100) : 0;
  const discount = Math.max(0, Math.min(subtotal, Number.isFinite(requestedDiscount) ? requestedDiscount : 0));
  let remainingDiscount = discount;
  const tax = lines.reduce((sum, line, index) => {
    const lineDiscount = index === lines.length - 1 ? remainingDiscount : Math.floor(discount * line.total / (subtotal || 1));
    remainingDiscount -= lineDiscount;
    const rate = line.product.is_taxable ? line.product.tax_rate_override_bps ?? taxRateBps : 0;
    return sum + Math.round((line.total - lineDiscount) * rate / 10000);
  }, 0);
  const total = subtotal - discount + tax;
  const address = [profile?.address_line_1, profile?.address_line_2, [profile?.city, profile?.state, profile?.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  function setQuantity(id: number, quantity: number) {
    setCart(current => { const next = { ...current }; if (quantity <= 0) delete next[id]; else next[id] = Math.min(quantity, 999); return next; });
    setNotice('');
  }
  function resetBill() {
    setDraftId(null); setCart({}); setCustomerName(''); setCustomerPhone(''); setTableNumber('');
    setOrderType('TAKEAWAY'); setOrderSource('POS'); setDiscountType('NONE'); setDiscountValue('0');
    setPaymentMethod('CASH'); setCashReceived(''); setCustomers([]); setError('');
  }
  async function reloadDrafts() { setDrafts(await api<Sale[]>('/sales/drafts', 'GET', undefined, token)); }
  function validateBill() {
    if (!lines.length) throw new Error('Add at least one menu item.');
    if (orderSource === 'PHONE' && (!customerName.trim() || !customerPhone.trim())) throw new Error('Phone orders need a customer name and phone number.');
    if (discountType !== 'NONE') {
      const number = Number(discountValue);
      if (!Number.isFinite(number) || number < 0 || number > (discountType === 'PERCENTAGE' ? 100 : subtotal / 100)) throw new Error('Enter a valid discount.');
    }
  }
  async function saveDraft() {
    validateBill();
    let id = draftId;
    if (!id) {
      const created = await api<Sale>('/sales', 'POST', { orderType, orderSource, customerName: customerName.trim(), customerPhone: customerPhone.trim(), tableNumber: tableNumber.trim() }, token);
      id = created.id;
      setDraftId(id);
    }
    await api<Sale>(`/sales/${id}`, 'PATCH', {
      orderType, orderSource, customerName: customerName.trim(), customerPhone: customerPhone.trim(), tableNumber: tableNumber.trim(),
      discountType: 'NONE', discountValue: 0
    }, token);
    await api<Sale>(`/sales/${id}/items`, 'DELETE', undefined, token);
    for (const line of lines) await api<Sale>(`/sales/${id}/items/${line.product.id}`, 'PUT', { quantity: line.quantity }, token);
    if (discountType !== 'NONE') await api<Sale>(`/sales/${id}`, 'PATCH', { discountType, discountValue: Math.round(Number(discountValue) * 100) }, token);
    return id;
  }
  async function holdBill() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const id = await saveDraft();
      await reloadDrafts(); resetBill(); setNotice(`Bill #${id} is on hold. Open it from Held bills when the customer returns.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not hold the bill.'); }
    finally { setBusy(false); }
  }
  async function checkout(printReceipt: boolean) {
    setError(''); setNotice(''); setBusy(true);
    try {
      validateBill();
      if (paymentMethod === 'CASH' && (!Number.isFinite(Number(cashReceived)) || Math.round(Number(cashReceived) * 100) < total)) throw new Error('Cash received must cover the total.');
      const id = await saveDraft();
      const sale = await api<Sale>(`/sales/${id}/checkout`, 'POST', { idempotencyKey: crypto.randomUUID(), paymentMethod, printReceipt, ...(paymentMethod === 'CASH' ? { cashReceivedCents: Math.round(Number(cashReceived) * 100) } : {}) }, token);
      if (customerName.trim() && customerPhone.trim()) api('/customers', 'POST', { name: customerName.trim(), phone: customerPhone.trim() }, token).catch(() => {});
      onComplete(sale); resetBill(); await reloadDrafts();
      const printMessage = !printReceipt ? 'without printing' : sale.printJob && sale.printJob.status !== 'FAILED' ? 'with a receipt queued for printing' : 'but no printer was available';
      setNotice(`${sale.receipt_number} completed ${printMessage}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the bill.'); }
    finally { setBusy(false); }
  }
  async function resumeDraft(draft: Sale) {
    if (lines.length || draftId) { setError('Hold or cancel the current bill before opening another.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const sale = await api<Sale>(`/sales/${draft.id}`, 'GET', undefined, token);
      const missing = sale.items?.filter(item => !products.some(product => product.id === item.product_id)) || [];
      if (missing.length) throw new Error('This held bill contains a menu item that was removed. Ask an administrator to review it.');
      setDraftId(sale.id);
      setCart(Object.fromEntries((sale.items || []).map(item => [item.product_id, item.quantity])));
      setOrderType(sale.order_type); setOrderSource(sale.order_source);
      setCustomerName(sale.customer_name || ''); setCustomerPhone(sale.customer_phone || ''); setTableNumber(sale.table_number || '');
      setDiscountType(sale.discount_type || 'NONE'); setDiscountValue(String((sale.discount_value || 0) / 100));
      setCustomerOpen(Boolean(sale.customer_name || sale.customer_phone));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open held bill.'); }
    finally { setBusy(false); }
  }
  async function cancelBill() {
    const target = confirmCancel;
    setConfirmCancel(null); setBusy(true); setError(''); setNotice('');
    try {
      const id = target === 'current' ? draftId : target;
      if (id) await api(`/sales/${id}/cancel`, 'POST', {}, token);
      if (target === 'current') resetBill();
      await reloadDrafts(); setNotice('Bill cancelled.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel the bill.'); }
    finally { setBusy(false); }
  }

  return <div className="premium-billing">
    <header className="billing-page-head"><div><span className="billing-eyebrow">POINT OF SALE</span><h2>Billing</h2><p>Select items, review the bill, then choose how to finish the sale.</p></div><div className="billing-business"><span className="billing-round-icon"><ReceiptText size={18} /></span><span><strong>{profile?.name || 'Business'}</strong>{address && <small><MapPin size={12} /> {address}</small>}{profile?.phone && <small><Phone size={12} /> {profile.phone}</small>}</span></div></header>
    <div className="billing-workspace">
      <section className="billing-catalog premium-panel"><div className="billing-section-head"><div><span className="billing-eyebrow">MENU</span><h3>Choose items</h3></div><span className="billing-count">{filtered.length} available</span></div><div className="billing-catalog-controls"><div className="billing-search"><Search size={17} /><input aria-label="Search menu items" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search menu items" /></div><div className="billing-categories"><button className={categoryId === null ? 'active' : ''} onClick={() => setCategoryId(null)}>All items</button>{categories.map(category => <button className={categoryId === category.id ? 'active' : ''} key={category.id} onClick={() => setCategoryId(category.id)}>{category.name}</button>)}</div></div><div className="billing-products">{filtered.map(product => <button key={product.id} className="billing-product" onClick={() => setQuantity(product.id, (cart[product.id] || 0) + 1)}><span className="billing-product-top"><span className="product-glyph"><UtensilsCrossed size={21} strokeWidth={1.6} /></span><span className="billing-product-status">Available</span></span><span className="billing-product-category">{product.category_name || categories.find(category => category.id === product.category_id)?.name || 'Menu item'}</span><strong>{product.name}</strong><small>{product.description || 'Freshly prepared'}</small><span className="product-bottom"><b>{money(product.price_cents)}</b><span className="billing-product-add"><Plus size={16} /></span></span></button>)}{!filtered.length && <div className="billing-empty-menu">No items match this search.</div>}</div></section>
      <aside className="billing-checkout premium-panel"><div className="billing-section-head"><div><span className="billing-eyebrow">CHECKOUT</span><h3>{draftId ? `Held bill #${draftId}` : 'Current bill'}</h3></div><span className="billing-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span></div>
        <div className="billing-checkout-scroll"><div className="billing-mode-grid"><div><span className="billing-field-title">Order type</span><div className="billing-segments"><button className={orderType === 'DINE_IN' ? 'selected' : ''} onClick={() => setOrderType('DINE_IN')}><UtensilsCrossed size={15} /> Dine-in</button><button className={orderType === 'TAKEAWAY' ? 'selected' : ''} onClick={() => setOrderType('TAKEAWAY')}><ShoppingBag size={15} /> Takeaway</button></div></div><div><span className="billing-field-title">Source</span><div className="billing-segments"><button className={orderSource === 'POS' ? 'selected' : ''} onClick={() => setOrderSource('POS')}>POS</button><button className={orderSource === 'PHONE' ? 'selected' : ''} onClick={() => setOrderSource('PHONE')}><Phone size={15} /> Phone</button></div></div></div>
          {orderType === 'DINE_IN' && <label className="billing-input-label">Table number<input value={tableNumber} onChange={event => setTableNumber(event.target.value)} placeholder="Optional" /></label>}
          <details className="billing-customer" open={customerOpen} onToggle={event => setCustomerOpen(event.currentTarget.open)}><summary><span><Phone size={15} /> Customer details</span><small>{orderSource === 'PHONE' ? 'Required' : 'Optional'}</small></summary><div className="billing-customer-grid"><label className="billing-input-label">Name<input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" /></label><label className="billing-input-label">Phone<input value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="Phone number" /></label></div>{customers.length > 0 && <div className="clean-customer-results">{customers.map(customer => <button key={customer.id} onClick={() => { setCustomerName(customer.name); setCustomerPhone(customer.phone); setCustomers([]); }}>{customer.name} · {customer.phone}</button>)}</div>}</details>
          <div className="billing-line-head"><h4>Order items</h4><span>{lines.length} selected</span></div><div className="billing-lines">{lines.length ? lines.map(line => <div className="billing-line" key={line.product.id}><span className="billing-line-glyph"><UtensilsCrossed size={16} /></span><div className="billing-line-copy"><strong>{line.product.name}</strong><small>{money(line.product.price_cents)} each</small><div className="billing-quantity"><button aria-label={`Remove one ${line.product.name}`} onClick={() => setQuantity(line.product.id, line.quantity - 1)}><Minus size={13} /></button><span>{line.quantity}</span><button aria-label={`Add one ${line.product.name}`} onClick={() => setQuantity(line.product.id, line.quantity + 1)}><Plus size={13} /></button></div></div><strong className="billing-line-total">{money(line.total)}</strong></div>) : <div className="billing-empty-cart"><ShoppingBag size={22} /><strong>Your bill is empty</strong><small>Select an item from the menu to begin.</small></div>}</div>
          <div className="billing-payment"><div className="billing-discount"><label className="billing-input-label">Discount<select value={discountType} onChange={event => setDiscountType(event.target.value as typeof discountType)}><option value="NONE">No discount</option><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></label>{discountType !== 'NONE' && <label className="billing-input-label">{discountType === 'FIXED' ? 'Amount' : 'Percent'}<input type="number" min="0" step="0.01" max={discountType === 'PERCENTAGE' ? 100 : undefined} value={discountValue} onChange={event => setDiscountValue(event.target.value)} /></label>}</div><div className="billing-total-rows"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Discount</span><strong>−{money(discount)}</strong></div><div><span>Tax ({(taxRateBps / 100).toFixed(2)}%)</span><strong>{money(tax)}</strong></div><div className="billing-grand-total"><span>Total due</span><strong>{money(total)}</strong></div></div><div className="billing-payment-fields"><label className="billing-input-label">Payment method<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}><option value="CASH">Cash</option><option value="CREDIT_CARD">Credit card</option><option value="DEBIT_CARD">Debit card</option><option value="OTHER">Other</option></select></label>{paymentMethod === 'CASH' && <label className="billing-input-label">Cash received<input type="number" min="0" step="0.01" value={cashReceived} onChange={event => setCashReceived(event.target.value)} placeholder="0.00" /></label>}</div></div>
        </div><div className="billing-actions">{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="billing-notice" role="status"><Check size={15} /> {notice}</p>}<div className="billing-primary-actions"><button disabled={busy || !lines.length} onClick={() => checkout(false)}><Check size={16} /> Complete sale</button>{!mobileApp && <button disabled={busy || !lines.length} onClick={() => checkout(true)}><Printer size={16} /> Complete & print</button>}</div><div className="billing-secondary-actions"><button disabled={busy || !lines.length} onClick={holdBill}><PauseCircle size={16} /> Hold bill</button><button disabled={busy || (!lines.length && !draftId)} onClick={() => setConfirmCancel('current')}><XCircle size={16} /> Cancel bill</button></div></div>
      </aside>
    </div>
    {drafts.length > 0 && <section className="billing-held premium-panel"><div className="billing-section-head"><div><span className="billing-eyebrow">SAVED FOR LATER</span><h3>Held bills</h3></div><span className="billing-count">{drafts.length}</span></div><div className="billing-held-list">{drafts.map(draft => <div className="billing-held-row" key={draft.id}><span className="billing-held-icon"><Clock3 size={16} /></span><div><strong>Bill #{draft.id}</strong><small>{draft.customer_name || 'Walk-in'} · {draft.order_type === 'DINE_IN' ? 'Dine-in' : 'Takeaway'}</small></div><strong>{money(draft.total_cents)}</strong><button disabled={busy || draftId === draft.id} onClick={() => resumeDraft(draft)}>Open</button><button className="billing-held-delete" disabled={busy} aria-label={`Cancel held bill ${draft.id}`} onClick={() => setConfirmCancel(draft.id)}><Trash2 size={16} /></button></div>)}</div></section>}
    {confirmCancel !== null && <div className="modal-backdrop"><div className="modal billing-confirm" role="dialog" aria-modal="true" aria-label="Cancel bill"><div className="modal-header"><div><h2>Cancel this bill?</h2><p>{confirmCancel === 'current' ? 'The current bill will be cleared.' : `Held bill #${confirmCancel} will be cancelled.`}</p></div></div><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirmCancel(null)}>No, keep it</button><button className="clean-danger-button" onClick={cancelBill}>Yes, cancel bill</button></div></div></div>}
  </div>;
}
