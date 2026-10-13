import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { mobileRequest } from '../lib/mobile-store';
import type { BusinessProfile, Category, DashboardInsights, Product, Sale, Session } from '../lib/types';

test('mobile POS provisions once, works offline, and preserves sales through a developer reset', async () => {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  const initialPassword = 'initial-password-123';
  const developerKey = 'developer-key-unique-456';
  const clientId = `mobile-test-${randomUUID()}`;
  const manifest = {
    version: 1, clientId,
    business: { name: 'Test Cafe', ownerName: 'Owner', defaultTaxRateBps: 825 },
    admin: { username: 'cafeadmin', passwordHash: await bcrypt.hash(initialPassword, 4) },
    developerKeyHash: createHash('sha256').update(developerKey).digest('hex'),
    sampleData: false
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(manifest), { status: 200 });
  try {
    const login = await mobileRequest<Session>('/auth/login', 'POST', { username: 'cafeadmin', password: initialPassword });
    assert.equal(login.user.mustChangePassword, true);
    await assert.rejects(mobileRequest('/categories', 'GET', undefined, login.token), /Change the temporary password/);
    const ready = await mobileRequest<Session>('/auth/change-password', 'POST', { currentPassword: initialPassword, newPassword: 'owner-password-789', confirmPassword: 'owner-password-789' }, login.token);
    assert.equal(ready.user.mustChangePassword, false);
    const token = ready.token;
    const category = await mobileRequest<Category>('/categories', 'POST', { name: 'Coffee' }, token);
    const product = await mobileRequest<Product>('/products', 'POST', { categoryId: category.id, name: 'Latte', priceCents: 525, isTaxable: true }, token);
    const draft = await mobileRequest<Sale>('/sales', 'POST', { orderType: 'TAKEAWAY', orderSource: 'POS' }, token);
    await mobileRequest(`/sales/${draft.id}/items/${product.id}`, 'PUT', { quantity: 2 }, token);
    const completed = await mobileRequest<Sale>(`/sales/${draft.id}/checkout`, 'POST', { idempotencyKey: randomUUID(), paymentMethod: 'CASH', cashReceivedCents: 1200, printReceipt: false }, token);
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.subtotal_cents, 1050);
    assert.equal(completed.tax_cents, 87);
    assert.equal(completed.total_cents, 1137);
    const history = await mobileRequest<Sale[]>('/sales', 'GET', undefined, token);
    assert.equal(history.length, 1);
    const preview = await mobileRequest<{ text: string }>(`/sales/${draft.id}/receipt-preview`, 'GET', undefined, token);
    assert.match(preview.text, /Test Cafe/);
    assert.match(preview.text, /Latte/);
    const insights = await mobileRequest<DashboardInsights>('/dashboard/insights', 'GET', undefined, token);
    assert.equal(insights.topItems[0].quantity, 2);

    await mobileRequest('/auth/developer-reset', 'POST', { username: 'cafeadmin', developerKey, temporaryPassword: 'reset-password-abc' });
    await assert.rejects(mobileRequest('/sales', 'GET', undefined, token), /Session expired/);
    const resetLogin = await mobileRequest<Session>('/auth/login', 'POST', { username: 'cafeadmin', password: 'reset-password-abc' });
    assert.equal(resetLogin.user.mustChangePassword, true);
    const resetReady = await mobileRequest<Session>('/auth/change-password', 'POST', { currentPassword: 'reset-password-abc', newPassword: 'another-password-123', confirmPassword: 'another-password-123' }, resetLogin.token);
    assert.equal((await mobileRequest<Sale[]>('/sales', 'GET', undefined, resetReady.token)).length, 1);
    assert.equal((await mobileRequest<BusinessProfile>('/business', 'GET', undefined, resetReady.token)).name, 'Test Cafe');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
