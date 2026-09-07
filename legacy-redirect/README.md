# Redirect the old Cloudflare Pages preview

The previous site lived at https://khazendar-site.pages.dev. To point it at the new address, run once from this folder's parent (needs an interactive Cloudflare login):

```bash
npx wrangler login
npx wrangler pages deploy legacy-redirect --project-name khazendar-site --branch main
```

Or delete the old project in the Cloudflare dashboard (Workers & Pages → khazendar-site → Settings → Delete).
