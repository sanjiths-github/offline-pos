import type { Category, Product, Report, Sale } from './types';

export const demoCategories: Category[] = [
  { id: 1, name: 'Coffee', description: 'Espresso and brewed favorites', is_active: 1 },
  { id: 2, name: 'Tea', description: 'Hot and iced tea', is_active: 1 },
  { id: 3, name: 'Breakfast', description: 'Morning plates', is_active: 1 },
  { id: 4, name: 'Lunch', description: 'Fresh midday meals', is_active: 1 },
  { id: 5, name: 'Bakery', description: 'Baked today', is_active: 1 },
  { id: 6, name: 'Cold Drinks', description: 'Refreshers', is_active: 1 }
];

export const demoProducts: Product[] = [
  { id: 1, category_id: 1, name: 'Cappuccino', description: 'Espresso, steamed milk, soft foam', price_cents: 450, is_active: 1, is_taxable: 1 },
  { id: 2, category_id: 1, name: 'Caffè Latte', description: 'Double espresso and silky milk', price_cents: 500, is_active: 1, is_taxable: 1 },
  { id: 3, category_id: 1, name: 'Espresso', description: 'A rich double shot', price_cents: 300, is_active: 1, is_taxable: 1 },
  { id: 4, category_id: 1, name: 'Cold Brew', description: 'Slow brewed for 18 hours', price_cents: 475, is_active: 1, is_taxable: 1 },
  { id: 5, category_id: 2, name: 'Matcha Latte', description: 'Ceremonial matcha and milk', price_cents: 550, is_active: 1, is_taxable: 1 },
  { id: 6, category_id: 2, name: 'Chai Tea', description: 'Spiced black tea', price_cents: 425, is_active: 1, is_taxable: 1 },
  { id: 7, category_id: 3, name: 'Avocado Toast', description: 'Sourdough, avocado, chili flakes', price_cents: 850, is_active: 1, is_taxable: 1 },
  { id: 8, category_id: 3, name: 'Egg & Cheese Croissant', description: 'Warm butter croissant', price_cents: 775, is_active: 1, is_taxable: 1 },
  { id: 9, category_id: 4, name: 'Turkey Sandwich', description: 'Roasted turkey and greens', price_cents: 1050, is_active: 1, is_taxable: 1 },
  { id: 10, category_id: 4, name: 'Garden Salad', description: 'Seasonal greens', price_cents: 925, is_active: 1, is_taxable: 1 },
  { id: 11, category_id: 5, name: 'Blueberry Muffin', description: 'Fresh from the oven', price_cents: 375, is_active: 1, is_taxable: 1 },
  { id: 12, category_id: 5, name: 'Almond Croissant', description: 'Flaky and lightly sweet', price_cents: 495, is_active: 1, is_taxable: 1 },
  { id: 13, category_id: 6, name: 'Iced Lemonade', description: 'Fresh lemon and ice', price_cents: 400, is_active: 1, is_taxable: 1 },
  { id: 14, category_id: 6, name: 'Sparkling Water', description: 'Chilled mineral water', price_cents: 250, is_active: 1, is_taxable: 1 }
];

export const demoSales: Sale[] = [
  { id: 100045, receipt_number: 'POS-100045', cashier: 'Sarah Johnson', status: 'COMPLETED', order_type: 'TAKEAWAY', order_source: 'PHONE', customer_name: 'Michael Brown', completed_at: '2026-09-29 14:35:00', total_cents: 1686, subtotal_cents: 1650, tax_cents: 136, discount_cents: 100, payment_method: 'CASH' },
  { id: 100046, receipt_number: 'POS-100046', cashier: 'Sarah Johnson', status: 'COMPLETED', order_type: 'DINE_IN', order_source: 'POS', table_number: 'T05', completed_at: '2026-09-29 14:42:00', total_cents: 2840, subtotal_cents: 2624, tax_cents: 216, discount_cents: 0, payment_method: 'CREDIT_CARD' },
  { id: 100047, receipt_number: 'POS-100047', cashier: 'Alex Chen', status: 'COMPLETED', order_type: 'TAKEAWAY', order_source: 'POS', completed_at: '2026-09-29 14:51:00', total_cents: 1275, subtotal_cents: 1178, tax_cents: 97, discount_cents: 0, payment_method: 'DEBIT_CARD' },
  { id: 100048, receipt_number: 'POS-100048', cashier: 'Alex Chen', status: 'COMPLETED', order_type: 'DINE_IN', order_source: 'POS', table_number: 'T03', completed_at: '2026-09-29 15:05:00', total_cents: 3420, subtotal_cents: 3160, tax_cents: 260, discount_cents: 0, payment_method: 'CASH' }
];

export const demoReport: Report = {
  totals: { orders: 86, revenue_cents: 284550, subtotal_cents: 265000, discount_cents: 7500, tax_cents: 27050 },
  orderTypes: [{ order_type: 'DINE_IN', orders: 52, revenue_cents: 182500 }, { order_type: 'TAKEAWAY', orders: 34, revenue_cents: 102050 }],
  orderSources: [{ order_source: 'POS', orders: 74, revenue_cents: 246050 }, { order_source: 'PHONE', orders: 12, revenue_cents: 38500 }],
  payments: [{ method: 'CASH', orders: 32, revenue_cents: 98000 }, { method: 'CREDIT_CARD', orders: 38, revenue_cents: 135000 }, { method: 'DEBIT_CARD', orders: 16, revenue_cents: 51550 }, { method: 'OTHER', orders: 0, revenue_cents: 0 }]
};

export const demoRevenue = [45, 145, 170, 130, 260, 295, 420, 505, 355, 240, 300, 225, 425, 280, 145, 95, 52];
