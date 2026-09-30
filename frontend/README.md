# Offline POS desktop app

Next.js provides Dashboard, Billing, Today's Sales, Sales History, Menus, and Printer Connection. Electron runs the local Express API and keeps SQLite data outside the installed application. Every launch starts at a login gate until the session is verified. The first login, and any login after a developer reset, requires a new password.

## Prepare a client

Each client has a profile in `clients/<clientId>.json`. Keep `clientId` stable for that customer. Set `name`, `appName`, and `logo`, and enter business details. Place the referenced logo in `branding/`. SVG, PNG, and JPG are supported. `sampleData: true` provisions example menu items; `false` starts with an empty menu. No sample sales are created. `client:select` copies a profile into the active `branding/client.json` before preparing or building.

From `frontend`:

```powershell
npm install
npm run client:select -- downtown-coffee-house
npm run client:prepare -- coffeeadmin
```

The command prompts you to choose a temporary client password and a different developer reset key. Input is hidden and is not passed through command arguments. It stores the temporary password in `private/<clientId>.json` and the reset key in `branding/developer-<clientId>.key` on the developer computer. These plaintext files are excluded from Git and from the installer; back them up securely. The installer contains only their hashes in `provisioning/<clientId>.json`. Give the username and temporary password to the client separately from the installer; never send the developer key. Rerunning `client:prepare` with the same username leaves credentials unchanged.

For the already prepared Downtown Coffee House and Pizza Hut profiles, choose new credentials **before anyone installs them**:

```powershell
npm run client:credentials -- set downtown-coffee-house
npm run client:credentials -- set pizza-hut
npm run client:credentials -- show pizza-hut
```

`set` asks you to confirm the client ID, then prompts for a chosen temporary password and developer reset key. It updates only that client's future installer configuration. `show` prints the saved username, original temporary password, and reset key in your terminal. Keep terminal output private. The original temporary password stops working after the client changes it. Run `desktop:dist` again after changing credentials; an already built installer still contains the old hashes. `set` does not rotate the key or password in an installation already in use.

For Pizza Hut, run `npm run client:select -- pizza-hut` and use admin username `pizzahut`. Its profile uses USD, `America/New_York`, a 0% default tax rate, and an empty menu. Select Downtown again whenever building its installer. Selection changes build inputs only; it does not touch either client's installed SQLite data.

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
node src/apply-provisioning.js ..\frontend\provisioning\pizza-hut.json
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

The newest Windows installer for each client is in `release/<clientId>/latest-version/`. For example, Pizza Hut's installer is in `release/pizza-hut/latest-version/`. The folder also contains release metadata and, when generated, update files. Building a newer version for the same client replaces older installer files in that client's `latest-version` folder. Send that client's installer using your normal download or file-sharing channel. They run the installer and launch the desktop shortcut. The package includes Next.js, the local backend, the client business setup, and the chosen icon. No Node.js install is needed on the client's machine.

### Publish one selected client's update

Before the first installation, finish `client:credentials -- set <clientId>` and verify the saved username and temporary password with `client:credentials -- show <clientId>`. Create the public downloads-only repository described below and sign in with `gh auth login`. Then run:

```powershell
cd C:\pos-application\frontend
npm run push-client
```

Choose the client, **Software update**, and enter the message. After you confirm, the command bumps the version, builds only that client's installer, commits and pushes the source to the private repository, publishes the installer under a client-specific tag in the public downloads repository, then publishes only that client's feed and update notice. The release folder, provisioning manifest, developer key, and saved temporary password are ignored by Git. If you choose **Normal code change**, only source code is pushed. A direct `git push` does not build, publish, or notify clients.

### Manual build without publishing

For a local installer test, select the client and run `npm run desktop:dist`. This creates the installer in `release/<clientId>/latest-version/` without pushing source or publishing a feed. Use `npm run push-client` with **Software update** when a selected client should receive a real update.

### Windows publisher warning

An unsigned installer shows **Unknown publisher**. The `signing with signtool.exe` line in build output does not prove it was signed. Check the actual file:

```powershell
$installer = Get-ChildItem '.\release\downtown-coffee-house\latest-version\* Setup *.exe' | Select-Object -First 1
Get-AuthenticodeSignature -LiteralPath $installer.FullName | Select-Object Status,SignerCertificate
```

To display a verified publisher, obtain a trusted Windows code-signing certificate for your business. Keep its private key outside the project. For a `.pfx` certificate, set the signing environment variables only in the build terminal, rebuild, and verify `Status` is `Valid`:

```powershell
$env:WIN_CSC_LINK = 'C:\secure\publisher-certificate.pfx'
$env:WIN_CSC_KEY_PASSWORD = Read-Host 'Certificate password'
npm run desktop:dist
Get-AuthenticodeSignature -LiteralPath $installer.FullName | Select-Object Status,SignerCertificate
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

The command privately prompts you to choose and confirm a new temporary password. It expires old sessions and marks the account for a required password change. It leaves menu items, sales, customers, and backups intact. The reset password expires after 24 hours; run the command again if needed. Keep the developer key private. The key file must match the key used when that installation was first provisioned; changing a future installer does not rotate an installed database's key. The developer key is not a remote backdoor: a person needs the key plus access to that machine's data. No file distributed to a client can remain secret from a client who controls that computer.

## Verify

```powershell
npm run typecheck
npm run build
```

The Electron renderer uses a restricted preload bridge to call the Express API. The API validates the session and calculates final billing amounts. Dashboard and Today's Sales show current sales; Sales History filters by date and day period and opens receipt details. Billing can complete a sale with or without printing. Sales History can print the receipt later. Menus lets business admins remove individual products or a category with its products; past sales retain their item snapshots.

Printer Connection lists receipt printer queues installed in Windows, including USB cable and paired Bluetooth printers. Choose one, connect it to the POS, and use Test Print. Disconnect stops the POS from sending new receipts; it does not uninstall the Windows printer. The nearby Bluetooth scan in Electron uses Web Bluetooth for discoverable Bluetooth LE devices. Classic Bluetooth printers may only appear after pairing in Windows. In both cases Windows must expose a printer queue before the POS can print; printer drivers and pairing are managed by Windows. Windows queue status is shown on the page, but a successful Test Print is the practical connection check.

## Client notifications and updates

Create Markdown announcements in `frontend/notifications/` using the front matter documented in `frontend/notifications/README.md`. The navbar bell shows the unread count and latest five notices; View All shows the complete received history. Opening a notice marks it read for that user on this computer. `npm run notifications:build` bundles only notices addressed to this build's `clientId` or `all-clients`. The desktop loads bundled and cached notices at startup. Press the refresh icon beside the bell to check the selected client's remote feed. New notices show a temporary in-app alert. The last successful feed remains available offline; there is no background notification polling or WebSocket connection.

For automatic delivery, the client profile must contain these fields **before building the installer**. Downtown Coffee House and Pizza Hut profiles now point to the public downloads-only repository:

```json
{
  "notificationFeedUrl": "https://raw.githubusercontent.com/sanjuconnectrader/pos-system-updates/main/downtown-coffee-house/notifications.json",
  "updateFeedUrl": "https://raw.githubusercontent.com/sanjuconnectrader/pos-system-updates/main/downtown-coffee-house/windows/"
}
```

The notification endpoint must return the generated JSON with the matching top-level `clientId`. The Windows update directory serves `latest.yml` and `release.json`. `latest.yml` points to the matching installer and blockmap attached to a client-specific public GitHub release. The app checks `clientId`, app ID, and version in `release.json` before downloading. The publisher uploads the installer first, then `release.json`, `latest.yml`, and finally the notification. A Markdown notice with `updateAvailable: true` shows the configured button; clicking it checks the actual installer feed, downloads the update, displays progress, and offers **Restart & Update**. Markdown by itself cannot install an update.

The project source remains private. Create an empty **public** repository `sanjuconnectrader/pos-system-updates` with a README and a `main` branch. Install GitHub CLI (`winget install --id GitHub.cli`), reopen PowerShell, and run `gh auth login`. Create the downloads repository on GitHub's website, or from a directory outside the POS source run `gh repo create sanjuconnectrader/pos-system-updates --public --add-readme`. Do not pass `--source .` from this project. That public repository holds only downloads and feeds, never POS source, passwords, provisioning manifests, or developer keys. `electron-builder` produces Windows update metadata when `updateFeedUrl` is configured. The first updater-enabled installer must be sent to clients once: Downtown Coffee POS 1.1.3 has no feed address inside it, so a Git push cannot reach that installed version. Keep each client's `clientId`, app ID, and feed path stable; SQLite data remains under `%APPDATA%\OfflinePOS\<clientId>\pos-data`.

Register each client ID in `frontend/clients/<clientId>.json` without credentials. Once the public downloads repository and `gh` login are ready, run `npm run push-client` from `frontend`. Choose one client and **Software update**. The script increases the version, selects that client, creates a notice, builds its installer, checks staged files for secrets, commits and pushes the private source, creates a client-specific public GitHub release, then publishes that client's feed and notification. Other clients' feed paths are left alone. The **Notification**, **Bug fix**, and **New feature** choices publish a notice without rebuilding the app; use **Software update** whenever the client needs new executable code. `all-clients` supports notices only. A direct `git push` does not run this workflow.

If the source push succeeds but feed publishing fails, do not bump the version again. Fix the reported cause and retry `npm run client:publish -- <clientId>` from `frontend` for the already built version. For a notice-only retry, run `npm run notifications:export` and then `npm run client:publish -- <clientId> --notifications-only`.
