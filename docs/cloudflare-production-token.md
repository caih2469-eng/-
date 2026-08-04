# Cloudflare production token permissions

The `cloudflare-production` GitHub Environment token needs these least-privilege, account-scoped permissions to deploy `jinshan20-plaza`:

- Account / Workers Scripts / Edit
- Account / D1 / Read (or Edit when a deployment migrates D1)
- Account / Workers R2 Storage / Read (or Edit when a deployment changes R2)

Use no Global API Key. Add Zone permissions only for Routes or Custom Domains. After updating `CLOUDFLARE_API_TOKEN`, rerun the original failed Plaza workflow without bypassing `deploy-production`.
