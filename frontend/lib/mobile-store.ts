import { openDB, type IDBPDatabase } from 'idb';
import bcrypt from 'bcryptjs';
import { deviceDate } from './device-time';
import type { BusinessProfile, Category, DashboardInsights, Product, Sale, SaleItem, Session } from './types';

type Customer = { id: number; name: string; phone: string };
type Provisioning = {
  version: number;
  clientId: string;
  business: Record<string, string | number>;
  admin: { username: string; passwordHash: string };
  developerKeyHash: string;
  sampleData?: boolean;
};
type StoredSale = Sale & { idempotency_key?: string; cashier: string; items: SaleItem[] };
type MobileState = {
  clientId: string;
  username: string;
  passwordHash: string;
  developerKeyHash: string;
  mustChangePassword: boolean;
  sessions: string[];
  profile: BusinessProfile;
  categories: Category[];
  products: Product[];
  customers: Customer[];
  sales: StoredSale[];
  nextCategoryId: number;
  nextProductId: number;
  nextCustomerId: number;
  nextSaleId: number;
};

let databasePromise: Promise<IDBPDatabase> | null = null;
let mutationQueue: Promise<unknown> = Promise.resolve();

const clean = (value: unknown) => String(value ?? '').trim();
const required = (value: unknown, label: string) => {
  const result = clean(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
};
const integer = (value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`Invalid ${label}.`);
  return value as number;
};
const now = () => new Date().toISOString();
const visibleProducts = (state: MobileState) => state.products.filter(item => state.categories.some(category => category.id === item.category_id && category.is_active));
const productWithCategory = (state: MobileState, product: Product) => ({ ...product, category_name: state.categories.find(category => category.id === product.category_id)?.name || '' });
const user = (state: MobileState): Session['user'] => ({ id: 1, username: state.username, role: 'BUSINESS_ADMIN', mustChangePassword: state.mustChangePassword });
const session = (state: MobileState): Session => {
  const token = crypto.randomUUID();
  state.sessions.push(token);
  return { token, user: user(state) };
};
const validUser = (state: MobileState, token?: string) => {
  if (!token || !state.sessions.includes(token)) throw new Error('Session expired. Please sign in again.');
  if (state.mustChangePassword) throw new Error('Change the temporary password before using the POS.');
};
const editable = (sale: StoredSale) => {
  if (sale.status !== 'DRAFT') throw new Error('Completed or cancelled sale is locked.');
};
const byId = (state: MobileState, id: number) => {
  const sale = state.sales.find(row => row.id === id);
  if (!sale) throw new Error('Sale not found.');
  return sale;
};
const saleId = (value: string) => integer(Number(value), 'sale ID', 1);

function calculate(state: MobileState, sale: StoredSale) {
  const subtotal = sale.items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const discount = sale.discount_type === 'FIXED'
    ? Math.min(subtotal, sale.discount_value || 0)
    : sale.discount_type === 'PERCENTAGE'
      ? Math.min(subtotal, Math.round(subtotal * (sale.discount_value || 0) / 10000)) : 0;
  let allocated = 0;
  let tax = 0;
  for (const [index, item] of sale.items.entries()) {
    const lineSubtotal = item.unit_price_cents * item.quantity;
    const lineDiscount = index === sale.items.length - 1 ? discount - allocated : Math.floor(discount * lineSubtotal / (subtotal || 1));
    allocated += lineDiscount;
    const product = state.products.find(row => row.id === item.product_id);
    const rate = product?.is_taxable ? product.tax_rate_override_bps ?? state.profile.default_tax_rate_bps : 0;
    const lineTax = Math.round((lineSubtotal - lineDiscount) * rate / 10000);
    tax += lineTax;
    item.line_total_cents = lineSubtotal - lineDiscount + lineTax;
  }
  sale.subtotal_cents = subtotal;
  sale.discount_cents = discount;
  sale.tax_cents = tax;
  sale.total_cents = subtotal - discount + tax;
}

function seed(manifest: Provisioning): MobileState {
  const b = manifest.business;
  const categories: Category[] = manifest.sampleData ? [
    ['Coffee', 'Espresso and brewed coffee'], ['Tea', 'Hot and iced tea'],
    ['Breakfast', 'Morning favorites'], ['Bakery', 'Fresh pastries']
  ].map(([name, description], index) => ({ id: index + 1, name, description, is_active: 1 })) : [];
  const products: Product[] = manifest.sampleData ? [
    [1, 'Espresso', 350], [1, 'Cappuccino', 525], [1, 'Iced Latte', 575],
    [2, 'English Breakfast Tea', 375], [2, 'Chai Latte', 495],
    [3, 'Breakfast Sandwich', 895], [4, 'Butter Croissant', 425]
  ].map(([categoryId, name, price], index) => ({ id: index + 1, category_id: Number(categoryId), name: String(name), price_cents: Number(price), is_active: 1, is_taxable: 1 })) : [];
  return {
    clientId: manifest.clientId,
    username: manifest.admin.username,
    passwordHash: manifest.admin.passwordHash,
    developerKeyHash: manifest.developerKeyHash,
    mustChangePassword: true,
    sessions: [],
    profile: {
      name: String(b.name), owner_name: String(b.ownerName), phone: String(b.phone || ''),
      address_line_1: String(b.addressLine1 || ''), address_line_2: String(b.addressLine2 || ''),
      city: String(b.city || ''), state: String(b.state || ''), zip_code: String(b.zipCode || ''),
      default_tax_rate_bps: Number(b.defaultTaxRateBps || 0),
      hours: Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, is_closed: 1, opening_time: null, closing_time: null }))
    },
    categories, products, customers: [], sales: [],
    nextCategoryId: categories.length + 1, nextProductId: products.length + 1, nextCustomerId: 1, nextSaleId: 1
  };
}

async function database() {
  if (!databasePromise) databasePromise = openDB('serveflow-pos-mobile', 1, {
    upgrade(db) { if (!db.objectStoreNames.contains('clients')) db.createObjectStore('clients'); }
  });
  return databasePromise;
}

async function provisionedState(): Promise<{ db: IDBPDatabase; state: MobileState }> {
  const response = await fetch('./mobile-provisioning.json');
  if (!response.ok) throw new Error('Mobile provisioning is missing. Build with npm run mobile:build.');
  const manifest = await response.json() as Provisioning;
  if (manifest.version !== 1 || !manifest.clientId || !manifest.admin?.passwordHash || !manifest.developerKeyHash) throw new Error('Mobile provisioning is invalid.');
  const db = await database();
  let state = await db.get('clients', manifest.clientId) as MobileState | undefined;
  if (!state) {
    state = seed(manifest);
    await db.put('clients', state, manifest.clientId);
  }
  return { db, state };
}

function write<T>(action: (state: MobileState) => Promise<T> | T): Promise<T> {
  const operation = mutationQueue.then(async () => {
    const { db, state } = await provisionedState();
    const result = await action(state);
    await db.put('clients', state, state.clientId);
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}
async function read<T>(action: (state: MobileState) => T): Promise<T> {
  await mutationQueue;
  const { state } = await provisionedState();
  return action(state);
}

function receipt(state: MobileState, sale: StoredSale) {
  const profile = state.profile;
  const address = [profile.address_line_1, profile.address_line_2, [profile.city, profile.state, profile.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return [profile.name, profile.phone, address, '', sale.receipt_number || '', new Date(sale.completed_at || '').toLocaleString(),
    `Cashier: ${sale.cashier}`, `Customer: ${sale.customer_name || 'Walk-in'}`, '--------------------------------',
    ...sale.items.map(item => `${item.quantity} x ${item.product_name_snapshot}  ${money(item.line_total_cents)}`),
    '--------------------------------', `Subtotal: ${money(sale.subtotal_cents)}`, `Discount: ${money(sale.discount_cents)}`,
    `Tax: ${money(sale.tax_cents)}`, `Total: ${money(sale.total_cents)}`, `Payment: ${sale.payment_method || ''}`,
    '', 'Thank you for your business!'].filter(line => line !== undefined).join('\n');
}

function insights(state: MobileState): DashboardInsights {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const dates = Array.from({ length: 7 }, (_, index) => deviceDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
  const weeklySales = dates.map(date => {
    const rows = state.sales.filter(sale => sale.status === 'COMPLETED' && sale.completed_at && deviceDate(new Date(sale.completed_at)) === date);
    return { date, orders: rows.length, revenue_cents: rows.reduce((sum, row) => sum + row.total_cents, 0) };
  });
  const ranked = new Map<string, DashboardInsights['topItems'][number]>();
  for (const sale of state.sales.filter(row => row.status === 'COMPLETED')) for (const item of sale.items) {
    const category = state.categories.find(row => row.id === state.products.find(product => product.id === item.product_id)?.category_id)?.name || '';
    const key = `${item.product_name_snapshot}\0${category}`;
    const current = ranked.get(key) || { name: item.product_name_snapshot, category, quantity: 0, revenue_cents: 0 };
    current.quantity += item.quantity;
    current.revenue_cents += item.line_total_cents;
    ranked.set(key, current);
  }
  return { weeklySales, topItems: [...ranked.values()].sort((a, b) => b.quantity - a.quantity || b.revenue_cents - a.revenue_cents).slice(0, 5) };
}

export async function mobileRequest<T>(path: string, method: string, data?: unknown, token?: string): Promise<T> {
  const body = (data || {}) as Record<string, unknown>;
  const url = new URL(path, 'https://mobile.local');
  const route = url.pathname;
  const verb = method.toUpperCase();
  const mutate = verb !== 'GET';
  const action = async (state: MobileState): Promise<unknown> => {
    if (route === '/auth/login' && verb === 'POST') {
      if (clean(body.username) !== state.username || !await bcrypt.compare(String(body.password || ''), state.passwordHash)) throw new Error('Invalid username or password.');
      return session(state);
    }
    if (route === '/auth/developer-reset' && verb === 'POST') {
      const key = required(body.developerKey, 'Developer key');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (clean(body.username) !== state.username || hex !== state.developerKeyHash) throw new Error('Invalid username or developer key.');
      const password = required(body.temporaryPassword, 'Temporary password');
      if (password.length < 10 || password.length > 128) throw new Error('Temporary password must have 10–128 characters.');
      state.passwordHash = await bcrypt.hash(password, 12);
      state.mustChangePassword = true;
      state.sessions = [];
      return { ok: true };
    }
    if (route === '/auth/me' && verb === 'GET') {
      if (!token || !state.sessions.includes(token)) throw new Error('Session expired. Please sign in again.');
      return { user: user(state) };
    }
    if (route === '/auth/change-password' && verb === 'POST') {
      if (!token || !state.sessions.includes(token)) throw new Error('Session expired. Please sign in again.');
      if (!await bcrypt.compare(String(body.currentPassword || ''), state.passwordHash)) throw new Error('Current password is incorrect.');
      const password = required(body.newPassword, 'New password');
      if (password.length < 10 || password.length > 128 || password !== body.confirmPassword) throw new Error('New passwords must match and contain 10–128 characters.');
      state.passwordHash = await bcrypt.hash(password, 12);
      state.mustChangePassword = false;
      state.sessions = [];
      return session(state);
    }
    if (route === '/auth/logout' && verb === 'POST') {
      state.sessions = state.sessions.filter(value => value !== token);
      return { ok: true };
    }
    validUser(state, token);

    if (route === '/business') {
      if (verb === 'GET') return state.profile;
      if (verb === 'PATCH') {
        const map: Record<string, keyof BusinessProfile> = { name: 'name', ownerName: 'owner_name', phone: 'phone', addressLine1: 'address_line_1', addressLine2: 'address_line_2', city: 'city', state: 'state', zipCode: 'zip_code' };
        for (const [source, target] of Object.entries(map)) if (body[source] !== undefined) (state.profile as unknown as Record<string, unknown>)[target] = clean(body[source]);
        required(state.profile.name, 'Business name');
        required(state.profile.owner_name, 'Owner name');
        if (body.hours !== undefined) {
          if (!Array.isArray(body.hours) || body.hours.length !== 7) throw new Error('Enter all seven business days.');
          state.profile.hours = body.hours.map((hour: Record<string, unknown>, index: number) => {
            if (hour.dayOfWeek !== index) throw new Error('Business hours must include each day once.');
            const closed = Boolean(hour.isClosed);
            const opening = closed ? null : clean(hour.openingTime);
            const closing = closed ? null : clean(hour.closingTime);
            if (!closed && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(opening || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closing || '') || opening === closing)) throw new Error('Enter valid opening and closing times.');
            return { day_of_week: index, is_closed: closed ? 1 : 0, opening_time: opening, closing_time: closing };
          });
        }
        return state.profile;
      }
    }
    if (route === '/dashboard/insights' && verb === 'GET') return insights(state);
    if (route === '/categories') {
      if (verb === 'GET') return state.categories.filter(category => category.is_active).sort((a, b) => a.name.localeCompare(b.name));
      if (verb === 'POST') {
        const name = required(body.name, 'Category name');
        if (state.categories.some(row => row.is_active && row.name.toLowerCase() === name.toLowerCase())) throw new Error('Category already exists.');
        const category: Category = { id: state.nextCategoryId++, name, description: clean(body.description), is_active: 1 };
        state.categories.push(category); return category;
      }
    }
    const categoryMatch = route.match(/^\/categories\/(\d+)$/);
    if (categoryMatch && verb === 'DELETE') {
      const id = Number(categoryMatch[1]);
      const category = state.categories.find(row => row.id === id && row.is_active);
      if (!category) throw new Error('Category not found.');
      category.is_active = 0;
      for (const product of state.products.filter(row => row.category_id === id)) product.is_active = 0;
      return { ok: true };
    }
    if (route === '/products') {
      if (verb === 'GET') return visibleProducts(state).map(product => productWithCategory(state, product)).sort((a, b) => a.name.localeCompare(b.name));
      if (verb === 'POST') {
        const categoryId = integer(body.categoryId, 'category ID', 1);
        if (!state.categories.some(row => row.id === categoryId && row.is_active)) throw new Error('Active category not found.');
        const product: Product = { id: state.nextProductId++, category_id: categoryId, name: required(body.name, 'Item name'), description: clean(body.description), price_cents: integer(body.priceCents, 'price'), is_active: 1, is_taxable: body.isTaxable === false ? 0 : 1 };
        state.products.push(product); return productWithCategory(state, product);
      }
    }
    const productMatch = route.match(/^\/products\/(\d+)$/);
    if (productMatch) {
      const product = state.products.find(row => row.id === Number(productMatch[1]));
      if (!product) throw new Error('Menu item not found.');
      if (verb === 'DELETE') { product.is_active = 0; state.products = state.products.filter(row => row.id !== product.id); return { ok: true }; }
      if (verb === 'PATCH') {
        if (body.categoryId !== undefined) {
          const id = integer(body.categoryId, 'category ID', 1);
          if (!state.categories.some(row => row.id === id && row.is_active)) throw new Error('Active category not found.');
          product.category_id = id;
        }
        if (body.name !== undefined) product.name = required(body.name, 'Item name');
        if (body.description !== undefined) product.description = clean(body.description);
        if (body.priceCents !== undefined) product.price_cents = integer(body.priceCents, 'price');
        if (body.isTaxable !== undefined) product.is_taxable = body.isTaxable ? 1 : 0;
        if (body.isActive !== undefined) product.is_active = body.isActive ? 1 : 0;
        return productWithCategory(state, product);
      }
    }
    if (route === '/customers') {
      if (verb === 'GET') return state.customers.filter(row => row.phone.includes(url.searchParams.get('phone') || '')).slice(0, 50);
      if (verb === 'POST') {
        const name = required(body.name, 'Customer name');
        const phone = required(body.phone, 'Customer phone');
        let customer = state.customers.find(row => row.phone === phone);
        if (customer) customer.name = name;
        else { customer = { id: state.nextCustomerId++, name, phone }; state.customers.push(customer); }
        return customer;
      }
    }
    if (route === '/sales/drafts' && verb === 'GET') return state.sales.filter(sale => sale.status === 'DRAFT').sort((a, b) => b.id - a.id);
    if (route === '/sales') {
      if (verb === 'GET') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const period = url.searchParams.get('period') || 'ALL';
        return state.sales.filter(sale => {
          if (sale.status === 'DRAFT') return false;
          const stamp = new Date(sale.completed_at || sale.created_at || '');
          const day = deviceDate(stamp);
          const hour = stamp.getHours();
          if (from && day < from || to && day > to) return false;
          if (period === 'MORNING') return hour >= 5 && hour < 12;
          if (period === 'NOON') return hour >= 12 && hour < 17;
          if (period === 'EVENING') return hour >= 17 && hour < 21;
          if (period === 'NIGHT') return hour >= 21 || hour < 5;
          return true;
        }).sort((a, b) => b.id - a.id).slice(0, 500);
      }
      if (verb === 'POST') {
        const orderType = body.orderType === 'DINE_IN' ? 'DINE_IN' : 'TAKEAWAY';
        const orderSource = body.orderSource === 'PHONE' ? 'PHONE' : 'POS';
        if (orderSource === 'PHONE') { required(body.customerName, 'Customer name'); required(body.customerPhone, 'Customer phone'); }
        const sale: StoredSale = { id: state.nextSaleId++, cashier: state.username, status: 'DRAFT', order_type: orderType, order_source: orderSource, customer_name: clean(body.customerName), customer_phone: clean(body.customerPhone), table_number: clean(body.tableNumber), created_at: now(), subtotal_cents: 0, discount_type: 'NONE', discount_value: 0, discount_cents: 0, tax_cents: 0, total_cents: 0, items: [] };
        state.sales.push(sale); return sale;
      }
    }
    const saleMatch = route.match(/^\/sales\/(\d+)(?:\/(.*))?$/);
    if (saleMatch) {
      const sale = byId(state, saleId(saleMatch[1]));
      const suffix = saleMatch[2] || '';
      if (!suffix && verb === 'GET') return sale;
      if (!suffix && verb === 'PATCH') {
        editable(sale);
        if (body.orderType !== undefined) sale.order_type = body.orderType === 'DINE_IN' ? 'DINE_IN' : 'TAKEAWAY';
        if (body.orderSource !== undefined) sale.order_source = body.orderSource === 'PHONE' ? 'PHONE' : 'POS';
        if (body.customerName !== undefined) sale.customer_name = clean(body.customerName);
        if (body.customerPhone !== undefined) sale.customer_phone = clean(body.customerPhone);
        if (body.tableNumber !== undefined) sale.table_number = clean(body.tableNumber);
        if (body.discountType !== undefined) sale.discount_type = body.discountType as Sale['discount_type'];
        if (body.discountValue !== undefined) sale.discount_value = integer(body.discountValue, 'discount', 0);
        if (sale.order_source === 'PHONE') { required(sale.customer_name, 'Customer name'); required(sale.customer_phone, 'Customer phone'); }
        calculate(state, sale); return sale;
      }
      if (suffix === 'items' && verb === 'DELETE') { editable(sale); sale.items = []; calculate(state, sale); return sale; }
      const itemMatch = suffix.match(/^items\/(\d+)$/);
      if (itemMatch && verb === 'PUT') {
        editable(sale);
        const productId = Number(itemMatch[1]);
        const quantity = integer(body.quantity, 'quantity', 0, 999);
        sale.items = sale.items.filter(item => item.product_id !== productId);
        if (quantity) {
          const product = visibleProducts(state).find(row => row.id === productId && row.is_active);
          if (!product) throw new Error('Active menu item not found.');
          sale.items.push({ id: productId, product_id: productId, product_name_snapshot: product.name, unit_price_cents: product.price_cents, quantity, line_total_cents: product.price_cents * quantity });
        }
        calculate(state, sale); return sale;
      }
      if (suffix === 'cancel' && verb === 'POST') { editable(sale); sale.status = 'CANCELLED'; return sale; }
      if (suffix === 'checkout' && verb === 'POST') {
        if (sale.status === 'COMPLETED' && sale.idempotency_key === body.idempotencyKey) return sale;
        editable(sale);
        if (!sale.items.length) throw new Error('Bill is empty.');
        calculate(state, sale);
        const paymentMethod = String(body.paymentMethod || '') as Sale['payment_method'];
        if (!['CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'OTHER'].includes(paymentMethod || '')) throw new Error('Invalid payment method.');
        const cashReceived = paymentMethod === 'CASH' ? integer(body.cashReceivedCents, 'cash received') : undefined;
        if (cashReceived !== undefined && cashReceived < sale.total_cents) throw new Error('Cash received must cover the total.');
        sale.status = 'COMPLETED'; sale.completed_at = now(); sale.receipt_number = 'POS-' + String(sale.id + 100000).padStart(6, '0');
        sale.idempotency_key = required(body.idempotencyKey, 'Idempotency key');
        sale.payment_method = paymentMethod;
        sale.payment = { method: paymentMethod!, cash_received_cents: cashReceived, change_cents: cashReceived === undefined ? undefined : cashReceived - sale.total_cents };
        return { ...sale, printJob: null };
      }
      if (suffix === 'receipt-preview' && verb === 'GET') return { text: receipt(state, sale) };
      if (suffix === 'print-jobs' && verb === 'GET') return [];
      if (suffix === 'reprint' && verb === 'POST') throw new Error('Mobile receipt printing is not configured. View the receipt on this device.');
    }
    if (route.startsWith('/printer')) throw new Error('Printer management is available in the desktop app.');
    throw new Error(`Mobile operation is unavailable: ${verb} ${route}`);
  };
  return (mutate ? write(action) : read(state => action(state))) as Promise<T>;
}
