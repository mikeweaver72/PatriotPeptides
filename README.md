# Patriot Peptides USA · site + owner app

Fork of the Pep Shop Texas Black Label platform, rebranded to Patriot's **Old Glory Realism** look and adapted for a ship-everything store. Same tables, RPCs, owner app and alert system as PST.

## What's here
- Storefront: `index.html`, `catalog.html`, `product.html`, `cart.html`, `account.html`, policies, `research/` (37 articles from Jeff's old blog), `research-library.html`.
- Owner app (phone): `owner.html` + `js/pst-owner*.js`. Desktop admin fallback: `admin.html` and the other admin pages.
- Theme: `css/pst-bl.css` (base) + `css/patriot.css` (brand overrides). Fonts: Archivo Black + Inter.
- PWA: `manifest.webmanifest`, `owner.webmanifest`, `sw.js` (cache `ppu-v1`).
- Server: `server/functions/*` (edge functions, ported from PST with a `STAGING=1` env flag instead of hardcoded project refs), `server/sql/*` (schema, see below).
- Redirects from the old WordPress URLs: `vercel.json` (Vercel) and `js/ppu-redirects.js` via `404.html` (GitHub Pages).

## Patriot-specific behaviour
- Shipping only. Flat $20, free over $200 (`CFG.shipRate`, `CFG.freeShip` in `js/pst-core.js`).
- Kit savings: 3–4 research vials in the bag = 5% off those vials, 5+ = 10%. BAC water and 10-vial wholesale kits don't count. Logic: `kitInfo()` in `js/pst-core.js`; saved to `orders.vial_discount_amount`.
- Payments: Venmo `@Patriot-peptides-USA` (one-tap), Cash App `$inkfreak69`. Read from `site_payment_options` at runtime; the CFG values are fallbacks.
- Age gate 21+.
- Order numbers `PP-O######`, customers `PP-C######` (set in `server/sql/90_patriot_overrides.sql`).

## Environments
Placeholders in the source: `__PPU_SUPABASE_REF__`, `__PPU_SUPABASE_ANON_KEY__`, `__PPU_GITHUB_REPO__`.

```
python3 tools/configure.py --ref <staging_ref> --anon <anon> --repo <owner/repo> --staging   # staging build
python3 tools/configure.py --ref <live_ref>    --anon <anon> --repo <owner/repo>             # live build
```

## Database (new Supabase project, empty)
Run `python3 tools/configure.py` first (it fills the project ref inside the SQL too), then apply in order from `server/sql/` in the SQL editor: `00_extensions.sql`, `02_tables.sql`, `07_constraints_indexes.sql`, `01_migrations.sql`, `03_functions.sql`, `04_views.sql`, `05_triggers.sql`, `06_rls_policies.sql`, `08_cron_jobs.sql`, `90_patriot_overrides.sql`, `95_seed_catalog.sql`. Everything is idempotent, so a file can be re-run. Storage buckets `product-bottles` and `email-assets` are created by 01. `tools/import_pst_schema.py` refreshes 00–08 from the PST dump.

## Edge functions
Deploy each folder under `server/functions/` with **JWT verification off** (they check callers themselves). Secrets: `RESEND_API_KEY`, `FROM_EMAIL` ("Patriot Peptides USA <orders@patriotpeptides-usa.com>"), `REPLY_TO_EMAIL`, `SITE_URL`, `ADMIN_ALERT_EMAILS`, `PUBLISHERS`, `RELEASE_NOTIFY`, `GITHUB_REPO`, `GITHUB_TOKEN`; Twilio vars only if SMS is turned on; `STAGING=1` on the staging project.

## Release flow
Same as PST: bump `?v=` on css/js links and `V` in `sw.js`, push, phones pick it up on next open. Staging first, live second.
