# Client registry

Add one JSON file per client, named `<clientId>.json`, with `clientId` and
`name`. IDs must match the stable ID in that client's branding and installer.
This registry is used by `npm run push-client` for target selection. It does
not contain passwords, provisioning manifests, or developer keys.
