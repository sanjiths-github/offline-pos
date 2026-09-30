# Offline POS REST API

Base URL: `http://127.0.0.1:5000/api`

Send JSON request bodies with `Content-Type: application/json`. After login, send `Authorization: Bearer <token>`. Tokens expire after 12 hours. Except for login, logout, `me`, and password change, users with `mustChangePassword: true` cannot use protected routes.

Roles: **S** = `SYSTEM_ADMIN`, **A** = `BUSINESS_ADMIN`, **C** = `CASHIER`. A cashier can access only their own sales and shifts. All money amounts in requests and responses are integer **cents**. Tax rates and percentage discounts use integer **basis points** (`825` = 8.25%).

## 1. Health and authentication

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/health` | Public | Local service status. |
| POST | `/auth/login` | Public | `{ "username": "sarah", "password": "..." }`. Returns `token` and `user`. |
| GET | `/auth/me` | S/A/C | Current user and password-change flag. |
| POST | `/auth/change-password` | S/A/C | `{ "currentPassword": "...", "newPassword": "...", "confirmPassword": "..." }`. Returns a replacement token. New password must be 10–128 characters. |
| POST | `/auth/logout` | S/A/C | Invalidate current token. |

Before the first API login, run `npm.cmd run bootstrap -- systemadmin` locally. It creates the system administrator and displays a one-time temporary password.

## 2. System administrator setup

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/system/status` | S | Business profile and business admin accounts. |
| POST | `/system/business` | S | Create the one business and its first admin. Required: `name`, `ownerName`, `adminUsername`. Optional: `addressLine1`, `addressLine2`, `city`, `state`, `zipCode`, `phone`, `email`, `taxId`, `timezone`, `defaultTaxRateBps`, `receiptFooter`. Returns the admin's temporary password once. |
| PATCH | `/system/business/status` | S | `{ "status": "ACTIVE" }` or `INACTIVE`. |
| POST | `/system/users/:id/reset-password` | S | Reset a business admin account. Returns a temporary password once and invalidates its sessions. |

## 3. Business and cashier accounts

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/business` | A/C | Read business profile. |
| PATCH | `/business` | A | Update profile fields, including `defaultTaxRateBps`. Uses the same camelCase field names as business creation. |
| GET | `/users` | A | List business admin and cashier accounts, without password hashes. |
| POST | `/users` | A | Create cashier login: `{ "username": "sarah", "employeeId": 1 }`; `employeeId` optional. Returns temporary password once. |
| PATCH | `/users/:id` | A | Activate/deactivate cashier: `{ "isActive": false }`. Invalidates their sessions. |
| POST | `/users/:id/reset-password` | A | Reset cashier password. Returns temporary password once and invalidates sessions. |

## 4. Employees

All employee routes require **A**. Salary is not exposed to cashiers.

| Method | Endpoint | Purpose / request body |
| --- | --- | --- |
| GET | `/employees` | List employees. |
| GET | `/employees/:id` | Employee detail. |
| POST | `/employees` | Create employee. Required: `firstName`, `lastName`, `phone`, `jobRole`. Optional: `employeeCode`, `email`, `addressLine1`, `addressLine2`, `city`, `state`, `zipCode`, `salaryCents`, `salaryType`, `hireDate`, `employmentStatus`, `notes`. |
| PATCH | `/employees/:id` | Update any employee field. |
| DELETE | `/employees/:id` | Mark employee `INACTIVE`; history remains. |

`salaryType`: `HOURLY`, `WEEKLY`, `MONTHLY`, `ANNUAL`. `employmentStatus`: `ACTIVE`, `INACTIVE`, `TERMINATED`.

## 5. Categories, products, customers

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/categories` | A/C | List categories. `?active=true` limits to active ones. |
| GET | `/categories/:id` | A/C | Category detail. |
| POST | `/categories` | A | `{ "name": "Coffee", "description": "...", "displayOrder": 0 }`. |
| PATCH | `/categories/:id` | A | Update `name`, `description`, `displayOrder`, `isActive`. |
| DELETE | `/categories/:id` | A | Deactivate category. |
| GET | `/products` | A/C | List products. Filters: `categoryId`, `search`, `active=true/false`. |
| GET | `/products/:id` | A/C | Product detail. |
| POST | `/products` | A | Required: `categoryId`, `name`, `priceCents`. Optional: `description`, `isTaxable`, `taxRateOverrideBps`. |
| PATCH | `/products/:id` | A | Update `categoryId`, `name`, `description`, `priceCents`, `isTaxable`, `taxRateOverrideBps`, `isActive`. |
| DELETE | `/products/:id` | A | Soft delete product. Old sales retain their snapshots. |
| GET | `/customers?phone=512` | A/C | Search saved customers by phone. Customer CRUD is not part of this MVP; phone order details are stored on each sale. |

## 6. Shifts

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/shifts` | A/C | List shifts; cashiers see their own. |
| POST | `/shifts/open` | A/C | `{ "openingCashCents": 10000 }`. One open shift per user. |
| POST | `/shifts/:id/close` | A/C | `{ "actualCashCents": 11515 }`. Returns cash sales, expected cash, and difference. |

Shifts are optional for sale creation; a new sale is linked to the current open shift when one exists.

## 7. Draft bills, checkout, and receipts

| Method | Endpoint | Role | Purpose / request body |
| --- | --- | --- | --- |
| GET | `/sales/drafts` | A/C | List the current user's saved drafts. |
| POST | `/sales` | A/C | Start a draft. Required: `orderType` (`DINE_IN` or `TAKEAWAY`), `orderSource` (`POS` or `PHONE`). Phone orders also require `customerName`, `customerPhone`. Optional: `tableNumber`, `guestCount`, `pickupTime`, `notes`. |
| GET | `/sales/:id` | A/C | Sale, item snapshots, payment, and print jobs. |
| PATCH | `/sales/:id` | A/C | Edit a draft's order details or discount. Fields: `orderType`, `orderSource`, `customerName`, `customerPhone`, `tableNumber`, `guestCount`, `pickupTime`, `notes`, `discountType`, `discountValue`. |
| PUT | `/sales/:id/items/:productId` | A/C | Set item quantity: `{ "quantity": 2 }`. Quantity `0` removes it. The server looks up the price and recalculates the bill. |
| DELETE | `/sales/:id/items` | A/C | Clear a draft bill. |
| POST | `/sales/:id/cancel` | A/C | Cancel a draft. |
| POST | `/sales/:id/checkout` | A/C | Complete sale atomically. Required: `idempotencyKey`, `paymentMethod`; cash also requires `cashReceivedCents`. |
| GET | `/sales` | A/C | History, excluding drafts. Filters: `receipt`, `from`, `to`, `cashierId`, `paymentMethod`, `orderType`, `orderSource`. Cashiers see their own history. |
| GET | `/sales/:id/receipt` | A/C | Plain-text completed-sale receipt. |
| POST | `/sales/:id/reprint` | A/C | Start a new receipt print job. |
| GET | `/payments` | A | Recent payment records. Payment creation happens during checkout. |

`discountType`: `NONE`, `FIXED`, `PERCENTAGE`. For `FIXED`, `discountValue` is cents. For `PERCENTAGE`, it is basis points (`1000` = 10%). `paymentMethod`: `CASH`, `CREDIT_CARD`, `DEBIT_CARD`, `OTHER`. Card numbers, CVV, and PIN are never accepted.

Example checkout:

```json
{
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "paymentMethod": "CASH",
  "cashReceivedCents": 2000
}
```

## 8. Reports and CSV

All report routes require **A**. Except for `/reports/today`, pass `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Omitted dates default to the current UTC date.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/reports/today` | Current day's totals and breakdowns. |
| GET | `/reports/sales` | Orders, subtotal, discount, tax, revenue, order type, order source, and payment breakdown. Use any date range for daily, weekly, monthly, or custom reports. |
| GET | `/reports/products` | Quantity and revenue by product snapshot name. |
| GET | `/reports/categories` | Quantity and revenue by category snapshot name. |
| GET | `/reports/tax` | Taxable sales, exempt sales, and tax collected. |
| GET | `/reports/discounts` | Discounted orders and amounts by type. |
| GET | `/reports/cashiers` | Orders, revenue, cash, and card totals by cashier. |
| GET | `/reports/export.csv` | Sales CSV download. |

## 9. Printers, settings, backups, audit

All routes below require **A**, except receipt reprinting listed above.

| Method | Endpoint | Purpose / request body |
| --- | --- | --- |
| GET | `/printer` | List configured printers. |
| POST | `/printer` | Add printer. Required: `name`, `connectionType` (`NETWORK`, `USB`, `BLUETOOTH`, `SYSTEM`). Optional: `receiptWidth` (`58` or `80`), `deviceIdentifier`, `ipAddress`, `port`, `autoPrint`, `copies`, `isActive`. |
| PATCH | `/printer/:id` | Update printer fields. |
| GET | `/printer/jobs` | Recent print jobs and their status. |
| GET | `/settings` | Backup settings. |
| PATCH | `/settings` | `{ "auto_backup": true, "backup_keep": 30 }`. |
| GET | `/backups` | List local backup filenames. |
| POST | `/backups` | Create a validated SQLite backup. |
| POST | `/backups/restore` | `{ "filename": "pos-YYYYMMDD-HHMMSSmmm.sqlite" }`. Creates a safety backup, restores, and stops the server. Restart the server afterward. |
| GET | `/audit-logs` | Recent audit events. |

## Response behavior

- Successful creates generally return HTTP `201`; reads and updates return `200`.
- Errors return JSON such as `{ "error": "Sale is locked" }` with an appropriate HTTP status.
- A completed or cancelled sale cannot be edited. A repeated checkout with the same idempotency key for that sale returns the original result.
- Receipt printing occurs after the sale transaction commits. A print failure does not roll back the sale.
