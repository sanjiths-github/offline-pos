# POS notifications

Create one `.md` file per announcement. Example:

```md
---
heading: "Billing improvements"
description: "The billing screen is faster and receipt printing is more reliable."
date: "2026-09-30"
type: "feature"
targetClient: "downtown-coffee-house"
updateAvailable: true
version: "1.1.4"
buttonText: "Update Now"
---

The full announcement goes here. Markdown is supported.
```

Use the stable `clientId` from `branding/client.json`, or `all-clients`.
Set `version` to the new app version for an update notice; omit it for general
announcements. The `buttonText` field is used only when `updateAvailable` is true. An update
button checks the configured update feed; the Markdown file alone cannot install
software. Do not put passwords, developer keys, or confidential client data here
if you will publish notifications on a public feed.
