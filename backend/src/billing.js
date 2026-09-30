const { db } = require('./db');
function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Object.assign(new Error(`${name} must be an integer between ${min} and ${max}`), { status: 400 });
  return value;
}
function calculate(saleId) {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
  if (!sale) throw Object.assign(new Error('Sale not found'), { status: 404 });
  const rows = db.prepare('SELECT si.*, p.is_taxable, p.tax_rate_override_bps, b.default_tax_rate_bps FROM sale_items si LEFT JOIN products p ON p.id=si.product_id CROSS JOIN businesses b WHERE si.sale_id=? ORDER BY si.id').all(saleId);
  const subtotal = rows.reduce((sum, r) => sum + r.unit_price_cents * r.quantity, 0);
  let discount = sale.discount_type === 'FIXED' ? sale.discount_value : sale.discount_type === 'PERCENTAGE' ? Math.round(subtotal * sale.discount_value / 10000) : 0;
  if (discount > subtotal) throw Object.assign(new Error('Discount exceeds subtotal'), { status: 400 });
  let remainingDiscount = discount, tax = 0;
  const items = rows.map((r, i) => {
    const lineSubtotal = r.unit_price_cents * r.quantity;
    const lineDiscount = i === rows.length - 1 ? remainingDiscount : Math.floor(discount * lineSubtotal / (subtotal || 1));
    remainingDiscount -= lineDiscount;
    const rate = r.is_taxable ? (r.tax_rate_override_bps ?? r.default_tax_rate_bps) : 0;
    const lineTax = Math.round((lineSubtotal - lineDiscount) * rate / 10000);
    tax += lineTax;
    return { ...r, line_subtotal_cents: lineSubtotal, discount_cents: lineDiscount, tax_rate_snapshot: rate, tax_cents: lineTax, line_total_cents: lineSubtotal - lineDiscount + lineTax };
  });
  return { subtotal_cents: subtotal, discount_cents: discount, tax_cents: tax, total_cents: subtotal - discount + tax, items };
}
function persistCalculation(saleId) {
  const bill = calculate(saleId);
  const update = db.prepare('UPDATE sale_items SET line_subtotal_cents=?,discount_cents=?,tax_rate_snapshot=?,tax_cents=?,line_total_cents=? WHERE id=?');
  bill.items.forEach(i => update.run(i.line_subtotal_cents,i.discount_cents,i.tax_rate_snapshot,i.tax_cents,i.line_total_cents,i.id));
  db.prepare('UPDATE sales SET subtotal_cents=?,discount_cents=?,tax_cents=?,total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(bill.subtotal_cents,bill.discount_cents,bill.tax_cents,bill.total_cents,saleId);
  return bill;
}
module.exports = { integer, calculate, persistCalculation };
