# Offline POS MVP

A single business POS that runs on one Windows computer. The browser interface, REST API, and SQLite database all run locally. Card payments are recorded only; no card data is processed or stored.

## Requirements

- Node.js 22.13 or newer
- Windows for USB, Bluetooth, or system printer spooler support. Network ESC/POS printing works wherever Node.js runs.

## Start

For the Next.js/Electron client, first run `npm run client:prepare -- <username>` from `frontend`. Then start the backend in a separate terminal for browser development:

```powershell
cd C:\pos-application\backend
npm install
node src/apply-provisioning.js ..\frontend\provisioning\client.json
npm run server.js
```

`npm run server.js`, `npm run dev`, and `npm start` start the same local API on `127.0.0.1:5000`. Provisioning checks for existing business/users and leaves existing data untouched. Electron handles provisioning and backend startup automatically, so a separate server is unnecessary for `npm run desktop:dev` or an installed desktop app. The three-screen Next.js frontend requires a client login and password change before showing business data.

The older standalone backend setup remains available:

From `backend`:

```powershell
npm.cmd install
npm.cmd run bootstrap -- systemadmin
npm.cmd start
```

The bootstrap command prints a temporary system administrator password once. Open <http://127.0.0.1:5000>. Sign in as `systemadmin`, replace the temporary password, and create the business and initial business admin account. The business admin can then configure staff, categories, products, taxes, and printers. A cashier can open a shift and take orders.

`POS_DATA_DIR` can point to a directory for the SQLite database and backups. The default is `backend/data`. Keep this directory on persistent local storage and copy backups to separate storage. The server listens only on `127.0.0.1`.

To reset a provisioned client's forgotten password, stop the desktop app, point `POS_DATA_DIR` at that client's `%APPDATA%\OfflinePOS\<clientId>\pos-data`, and run `npm run reset-client -- <username> <developer-key-file>`. This only resets the password and sessions. It preserves the SQLite sales, menu, and backup files. See `../frontend/README.md` for the full desktop workflow.

## Operations

- Temporary passwords expire after 24 hours. Five failed logins lock an account for 15 minutes.
- Sales and payment records are committed in one SQLite transaction. Checkout prints only when the cashier chooses **Complete & print**. A receipt can be printed later from Sales History. Failed print jobs can be retried there.
- Menu deletion is a soft delete. Removing a category also removes its products from the active menu; historical sale item snapshots remain available for receipts and reports.
- Network printers use ESC/POS over TCP, commonly port 9100. For Windows USB, Bluetooth, and system printers, install the printer in Windows and enter its exact Windows printer name as the device identifier.
- Automatic backups run once per UTC day while the server is running. The default retention is 30 backups. Manual backup and restore are available to the business admin. Restore creates a safety backup and stops the server; restart it afterward.
- Prices, salary, payments, totals, and tax are stored in cents or basis points. Sales keep product and category snapshots.

## Verify

```powershell
npm.cmd test
```

The integration test uses a temporary local SQLite database and covers setup, forced password changes, cashier creation, phone order checkout, duplicate checkout protection, failed printing, reports, shift reconciliation, and backup creation.

## Current limits

This MVP is for one installation and one business. It records card payment methods but has no card terminal integration. Windows printer drivers must be installed outside the app. It does not include cloud sync or multiple terminals. SQLite is supplied by Node's `node:sqlite` module, which Node 22 currently labels experimental.
