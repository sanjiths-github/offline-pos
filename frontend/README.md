# Offline POS desktop app

Next.js provides Dashboard, Billing, Today's Sales, Sales History, Menus, and Printer Connection. Electron runs the local Express API and keeps SQLite data outside the installed application. Every launch starts at a login gate until the session is verified. The first login, and any login after a developer reset, requires a new password.

## Prepare a client

Edit `branding/client.json`: keep `clientId` stable for this customer, set `name`, `appName`, and `logo`, and enter business details. Place the logo image in `branding/`. SVG, PNG, and JPG are supported. `sampleData: true` provisions seven example menu items for this test client; set it to `false` for a clean catalog. No sample sales are created.

From `frontend`:

```powershell
npm install
npm run client:prepare -- coffeeadmin
```

This prints a temporary password once. Give the username and password to the client separately from the installer. It creates `provisioning/client.json` with password and developer-key **hashes** and a private `branding/developer-<clientId>.key` file. Keep the key file in the developer project and a separate secure backup. It is excluded from Git and from the installer. Rerunning `client:prepare` with the same client ID and username confirms the existing setup without changing credentials or printing the password again. A different username for the same client ID is rejected.

## Run locally

For the complete desktop app:

```powershell
cd C:\pos-application\frontend
npm install
npm run desktop:dev
```

This starts Next.js, Electron, and the local backend. To run the frontend in a browser and backend in separate PowerShell windows, provision the backend development database once:

```powershell
cd C:\pos-application\backend
npm install
node src/apply-provisioning.js ..\frontend\provisioning\client.json
npm run server.js
```

```powershell
cd C:\pos-application\frontend
npm run dev
```

Then open `http://127.0.0.1:3000`. Next.js proxies `/api` to the backend on `127.0.0.1:5000`. The browser development database lives in `backend/data`; Electron uses its own persistent client directory. `npm run dev` starts only Next.js. `npm run server.js` is an alias for the backend's `npm run dev` / `npm start`.

## Build and install

```powershell
cd C:\pos-application\frontend
npm run desktop:dist
```

Send the Windows installer in `release/` to the client using your normal download or file-sharing channel. They run the installer and launch the desktop shortcut. The package includes Next.js, the local backend, the client business setup, and the chosen icon. No Node.js install is needed on the client's machine.

### Windows publisher warning

An unsigned installer shows **Unknown publisher**. The `signing with signtool.exe` line in build output does not prove it was signed. Check the actual file:

```powershell
Get-AuthenticodeSignature -LiteralPath '.\release\Downtown Coffee POS Setup 1.1.1.exe' | Select-Object Status,SignerCertificate
```

To display a verified publisher, obtain a trusted Windows code-signing certificate for your business. Keep its private key outside the project. For a `.pfx` certificate, set the signing environment variables only in the build terminal, rebuild, and verify `Status` is `Valid`:

```powershell
$env:WIN_CSC_LINK = 'C:\secure\publisher-certificate.pfx'
$env:WIN_CSC_KEY_PASSWORD = Read-Host 'Certificate password'
npm run desktop:dist
Get-AuthenticodeSignature -LiteralPath '.\release\Downtown Coffee POS Setup 1.1.1.exe' | Select-Object Status,SignerCertificate
Remove-Item Env:\WIN_CSC_KEY_PASSWORD
```

The filename changes when the app version changes. A self-signed certificate does not establish a trusted publisher. Even a valid new certificate may initially show a SmartScreen **unrecognized app** prompt until its publisher or file reputation grows. Microsoft Store distribution is the most reliable way to avoid that download warning from the first install.

`npm run icons` regenerates the desktop ICO/PNG and the in-app logo from `branding/client.json`. Building runs it automatically. A new `appName` or logo only needs another build. Keep `clientId` the same for updates to an existing client's installation; it determines the stable data directory and application ID.

## Local data and reset

On Windows the database and backups are kept under `%APPDATA%\OfflinePOS\<clientId>\pos-data`, outside the installation directory. Rebuilding, updating, and normal uninstall/reinstall do not erase this directory. The desktop process checks for existing business/users and skips provisioning, so a new installer cannot overwrite the client's catalog or sales. The app also copies data from the previous Electron user-data location on the first upgraded launch if the new location is empty. Keep independent backups of this directory; clearing Windows app data or deleting it manually will remove local records.

For a forgotten password, the developer must have local access to that client's data directory and the developer key file. Close the desktop app first. In PowerShell:

```powershell
cd C:\pos-application\backend
$env:POS_DATA_DIR = "$env:APPDATA\OfflinePOS\downtown-coffee-house\pos-data"
npm run reset-client -- coffeeadmin ..\frontend\branding\developer-downtown-coffee-house.key
```

The command prints a fresh temporary password, expires old sessions, and marks the account for a required password change. It leaves menu items, sales, customers, and backups intact. The reset password expires after 24 hours; run the command again if needed. The developer key is not a remote backdoor: a person needs the key plus access to that machine's data. Keep the key private; no file distributed to the client can remain secret from a client who controls that computer.

## Verify

```powershell
npm run typecheck
npm run build
```

The Electron renderer uses a restricted preload bridge to call the Express API. The API validates the session and calculates final billing amounts. Dashboard and Today's Sales show current sales; Sales History filters by date and day period and opens receipt details. Billing can complete a sale with or without printing. Sales History can print the receipt later. Menus lets business admins remove individual products or a category with its products; past sales retain their item snapshots.

Printer Connection lists receipt printer queues installed in Windows, including USB cable and paired Bluetooth printers. Choose one, connect it to the POS, and use Test Print. Disconnect stops the POS from sending new receipts; it does not uninstall the Windows printer. The nearby Bluetooth scan in Electron uses Web Bluetooth for discoverable Bluetooth LE devices. Classic Bluetooth printers may only appear after pairing in Windows. In both cases Windows must expose a printer queue before the POS can print; printer drivers and pairing are managed by Windows. Windows queue status is shown on the page, but a successful Test Print is the practical connection check.

## Client notifications and updates

Create Markdown announcements in `frontend/notifications/` using the front matter documented in `frontend/notifications/README.md`. The navbar bell shows the latest five, and the history view shows all received notices. `npm run notifications:build` bundles only notices addressed to this build's `clientId` or `all-clients`. The app also checks a remote feed every five minutes when configured and caches the last successful response for offline viewing.

For automatic delivery, add these fields to this client's `branding/client.json` **before building the installer**:

```json
{
  "notificationFeedUrl": "https://updates.example.com/downtown-coffee-house/notifications.json",
  "updateFeedUrl": "https://updates.example.com/downtown-coffee-house/windows/"
}
```

Use real HTTPS URLs containing the stable `clientId`; these are examples only. The notification endpoint must return the generated JSON with the matching top-level `clientId`. The Windows update directory must serve `latest.yml`, the NSIS installer named in that file, its `.blockmap` file, and `release.json` generated by `desktop:dist`. The app checks `clientId`, app ID, and version in `release.json` before downloading. Publish new installer files and `release.json` first, then publish `latest.yml` last. A Markdown notice with `updateAvailable: true` shows the configured button; clicking it checks the actual installer feed, downloads the update, displays progress, and offers **Restart & Update**. Markdown by itself cannot install an update.

The project source may be private, but installed apps need access to these HTTPS feeds. Do not embed a GitHub personal access token in the client installer. `electron-builder` produces the Windows update metadata when `updateFeedUrl` is configured. `npm run desktop:dist` builds locally without uploading files. A separate publishing workflow is required to put notification JSON and installer artifacts at the configured URLs. The first updater-enabled installer must be sent to existing clients once. Keep each client's `clientId`, app ID, and feed path stable; SQLite data remains under `%APPDATA%\OfflinePOS\<clientId>\pos-data`.

Register each client ID in `frontend/clients/<clientId>.json` without credentials. After the project has a Git remote, run `npm run push-client` from `frontend` to select the target, change type, message, and confirm before committing and pushing. The script writes release metadata to `frontend/update-metadata/` and a notice to `frontend/notifications/` for notification-related changes, and refuses to stage known secret and database paths. It does **not** publish releases by itself; connect GitHub Actions or another deployment system to the feed before expecting installed apps to see pushed notices. Direct `git push` bypasses this optional custom command.
