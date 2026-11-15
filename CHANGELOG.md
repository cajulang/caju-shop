# Changelog

All notable changes to caju-shop. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
Fixes for the findings of the security audit (phase 5, caju-shop):

- **D-1** (high): `next` after signing in or up is a local path in printable ASCII only, so CR/LF
  cannot add a `Set-Cookie` header (session fixation) (`back/limits.caju`, `safe_next`).
- **D-2**: the same check refuses tabs, `//` and `/\`, so `next=/%09/evil.com` is no longer an
  open redirect.
- **D-3** (high): sign-in, sign-up and password change are limited to 20 attempts per address (an
  IPv6 address counts by its /64) and 5 failures per e-mail in 15 minutes, counted in the database
  (new table `login_attempts`, migration `002_security.sql`), and each process hashes at most
  30 s of every minute (503 with `Retry-After` beyond that). Malformed forms never get to the hash.
  The client's address comes from `X-Forwarded-For` only from `TRUSTED_PROXIES` (web 0.3.0's
  `Engine.trusted_proxies`).
- **D-4** (high): customers can no longer mark their own orders as paid. The route
  `POST /pedidos/:id/pagar` and its button exist only with `SHOP_DEMO_PAYMENTS=1`; in the panel,
  only administrators confirm payments (operators still ship and deliver).
- **D-5**: `./server seed` and `./server reset` need `--dev`; the demonstration accounts get
  random passwords, printed once (or `SEED_*_PASSWORD`); the sign-in page no longer shows any.
- **D-6**: no database password in the code: `DATABASE_URL` is required. `deploy/postgres.yaml`
  uses a ClusterIP Service (no LoadBalancer on every interface of the host) and takes the password
  from a Secret. An existing volume keeps the password it was created with: change it with
  `ALTER ROLE shop PASSWORD '...'`.
- **D-7**: a new password needs the current one; changing it ends the account's other sessions
  and gives this browser a new token.
- Account enumeration: an e-mail without an account is checked against a dummy hash and gets the
  wrong password's answer (the sign-up still says when an e-mail is taken; the per-address limit
  bounds it).
- The session cookie is `Secure` with `SECURE_COOKIES=1`.
- `X-Frame-Options: DENY`, a Content Security Policy (`frame-ancestors 'none'`, scripts only from
  the store plus the page's inline script by its hash, `'wasm-unsafe-eval'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'self'`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`.
- PBKDF2-HMAC-SHA256 at 600,000 iterations (OWASP's minimum; `SHOP_PBKDF2_ITERATIONS`); older
  hashes are made again when their owners sign in.
- Bounded memory and tables: the anonymous pages' cache (2,000 pages and 32 MB per process), the
  products' pictures' cache (20,000 ids), new visitors' sessions per address (60 per 10 minutes per
  process, else 429); visitors' sessions last 7 days; expired sessions, abandoned visitors' carts
  and day-old attempts are swept every 10 minutes and by `./server sweep`.

### Changed
- `server.cajux` is split: `shop.cajux` holds the routes (`shop.routes()`, which the new
  `http_test.caju` drives with `web.test_request`), `server.cajux` the commands.
- `tools/e2e.mjs` and `tools/perf.mjs` take the seeded passwords from `SEED_*_PASSWORD` and need
  `DATABASE_URL`.
- Moved to the published packages web 0.3.0, ui 0.4.1 and fetch 0.1.1, with caju 0.9.0;
  `public/shop.js` is gone (the program calls the API with fetch).
