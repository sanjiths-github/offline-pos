# Client registry

Add one JSON profile per client, named `<clientId>.json`. Include the stable
`clientId`, business `name`, desktop `appName`, and the `logo` filename in
`frontend/branding/`. Set currency, timezone, tax rate, and sample data as
needed. `npm run client:select -- <clientId>` activates the profile for
development and builds. `npm run push-client` reads this registry for target
selection. Keep passwords, provisioning manifests, and developer keys outside
these tracked profiles.
