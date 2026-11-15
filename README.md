# caju-shop

A small online store written entirely in [Caju](https://github.com/cajulang/cajulang):
the server, the pages, the program that runs in the browser (WebAssembly), the CSS and the
PostgreSQL client. **Empório Caju** sells sweets, drinks, groceries, cheeses and crafts from the
Brazilian Northeast; its interface is in Portuguese.

It puts together everything built for Caju so far:

| | |
|---|---|
| [ui](https://github.com/cajulang/ui) | the components, rendered on the server and hydrated in the browser (WebAssembly in a worker) |
| [web](https://github.com/cajulang/web) | the routes, middlewares and forms |
| [pg](https://github.com/cajulang/pg) | PostgreSQL over its wire protocol, with a pool and transactions |
| [caju style](https://github.com/cajulang/caju-style) | the CSS: Tailwind's vocabulary compiled to one readable class per style, a sheet per page |

## What it does

**The store**
- A home made of sections the panel arranges ("Destaques", "Promoções", "Novidades"...), and the
  departments.
- Two levels of categories, with breadcrumbs and subcategory chips.
- Search with PostgreSQL's Portuguese full-text search (stems and accents: "cachaca" finds
  "cachaças"), typo tolerance (`pg_trgm`: "cocda" finds "cocada"), suggestions while typing,
  filters (department, price range, on sale, in stock), five orders, facets with counts and pages.
  The filters live in the URL, so a search can be shared and the page arrives rendered.
- Products with a generated picture (an SVG in the product's hue, with its department's figure).
- A cart that works for visitors and joins the customer's own on signing in; adding an item or
  changing a quantity happens in place, without reloading.
- Checkout: addresses, shipping by CEP range (free above a threshold), coupons (percent or fixed,
  minimum, limit of uses, expiry), and a simulated Pix payment.
- Orders: the stock is reserved in a transaction that locks the products' rows (`FOR UPDATE`), so
  two buyers cannot both get the last unit; a cancellation gives the stock and the coupon back.
- Accounts: sign up, sign in, profile (a new password needs the current one and signs out the
  account's other sessions), addresses, order history.

**The panel** (`/admin`)
- Dashboard: today's and the month's sales, average ticket, orders to ship, low stock, new
  customers, a chart of the last 30 days, best sellers, orders by status.
- Products: list with search, filters and order; create and edit (with a live picture preview);
  stock adjustments with a reason and their history; bulk activate, deactivate and move.
- Categories (tree of two levels), the home's sections (products in order, added by searching),
  orders (filters, detail, status changes with tracking code), customers (spending, block),
  coupons, settings (store name, free shipping, shipping table, the team's roles) and an audit
  log of every change.
- Two roles: administrators do everything; operators see the panel and handle orders and stock,
  but cannot change the catalog, coupons or settings.

**Without the WebAssembly program** every page still works: links and forms are plain HTML and the
server answers them. The program adds what needs no reload: the cart, the suggestions, the
filters that apply at once, the section editor, the chart, the picture preview.

**Security**
- Passwords with PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP's minimum) and a random salt. The
  count is in each hash: an older, cheaper hash is made again when its owner signs in.
- Hashing is slow on purpose and a process serves one request at a time, so it is rationed:
  sign-in, sign-up and password change are refused (429) after 20 attempts per address (an IPv6
  address counts by its /64) or 5 failures per e-mail in 15 minutes, counted in the database for
  every process; and each process hashes at most 30 s of every minute (503 with `Retry-After`
  beyond that), so a flood of sign-ins slows the sign-ins, not the store. A malformed form never
  gets to the hash.
- An e-mail without an account is checked against a dummy hash and gets the wrong password's
  answer. The sign-up still says when an e-mail is taken (there is no e-mail verification to send
  the answer to); the attempts per address limit how fast that can list accounts.
- Sessions in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` with `SECURE_COOKIES=1`) with 32
  random bytes, of which the database keeps only the SHA-256; a new session on signing in and on
  changing the password, which also ends the account's other sessions. A visitor's session lasts
  7 days, a customer's 30.
- Where a form sends the visitor back (`next`) is only a local path in printable ASCII: no CR/LF
  (no headers), no tab, `//` or `/\` (no other site).
- Only an administrator confirms a payment (in the panel). The customer's "Simular pagamento"
  exists only in a demonstration store (`SHOP_DEMO_PAYMENTS=1`).
- `X-Frame-Options: DENY`, `frame-ancestors 'none'` and a Content Security Policy that runs only
  the store's scripts, its WebAssembly and the page's one inline script (by its hash);
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.
- Bounded: the anonymous pages' cache (2,000 pages, 32 MB per process), the products' pictures'
  cache, the sessions one address can open (60 per 10 minutes per process), and the tables:
  expired sessions, abandoned visitors' carts (7 days) and day-old attempts are swept every 10
  minutes (or with `./server sweep`).
- Forms from another origin are refused; every SQL value goes as a parameter; there is no default
  database password (`DATABASE_URL` is required).

## How it is built

```
model.caju        the data of the pages, shared by the server and the browser (money, URLs)
app.cajux         the root: which page, inside which frame
layout.cajux      the store's frame (header, search, menu, footer) and the panel's
kit.cajux         shared pieces: product card, add-to-cart, fields, pagination, the API calls
pages/            home, catalog (search, category, product), cart (cart, checkout, order),
                  account, admin_catalog and admin_sales (the panel)
main.cajux        the browser: hydrates the page with the data the server put in it
shop.cajux        the routes, the forms, the JSON API, the panel, the files (routes())
server.cajux      the commands: serve, migrate, seed, reset, sweep
back/             the server's side: db (pool, migrations), auth (passwords, sessions, sign-in
                  limits), limits (next, counters, the hashing budget), catalog (search, menu),
                  orders (cart, shipping, coupons, orders), admin, images, seed
sql/              the migrations
theme.caju        the palette; shop_css.caju writes the CSS
```

The server renders each page with the same components the browser hydrates: `app.App` gets a
`model.Page` (as JSON in the page for the browser). A visitor without a session gets the public
pages from a cache, the same HTML for everyone, gzipped once and dropped when the catalog or the
stock changes. The browser's program calls the server's JSON API (`/api/...`) with
[fetch](https://github.com/cajulang/fetch) (the page's `fetch`, through ui's built-in page
functions), sending JSON bodies.

## Running it

Needs `caju` (0.9.0), checkouts of [caju-style](https://github.com/cajulang/caju-style) and
[pg](https://github.com/cajulang/pg) next to this one (`../caju-style`, `../caju-pg`), and a
PostgreSQL 14 or later with the `unaccent` and `pg_trgm` extensions (the official image has
them). [web](https://github.com/cajulang/web), [ui](https://github.com/cajulang/ui) and
[fetch](https://github.com/cajulang/fetch) are packages (`caju.toml`); `tools/build.sh` builds the
`caju-ui` command from the ui package the lock file pins (or takes `CAJU_UI=path`).

```sh
# any PostgreSQL; deploy/postgres.yaml has one for a local cluster (its comments: a Secret for the
# password, a port-forward on 127.0.0.1)
export DATABASE_URL=postgres://user:password@127.0.0.1:5432/shop
caju pkg install                            # web, ui and fetch
tools/build.sh                              # the CSS, the program (wasm) and ./server
./server migrate                            # the schema
./server seed --dev                         # demonstration data (development only)
./server                                    # http://localhost:3800
```

`./server seed --dev` gives the demonstration accounts `admin@emporiocaju.dev` (administrator),
`operador@emporiocaju.dev` (operator) and `cliente@emporiocaju.dev` (a customer with orders) random
passwords, printed once (`SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_PASSWORD` and
`SEED_CUSTOMER_PASSWORD` choose them instead). Coupons: `BEMVINDO10`, `FRETEJUNINO`, `CAJU20`.
`./server reset --dev` drops everything. Neither runs without `--dev`.

| variable | |
|---|---|
| `DATABASE_URL` | required: `postgres://user:password@host:port/database` |
| `PORT`, `HOST` | where to listen (3800, 127.0.0.1) |
| `WORKERS` | processes (each with its own connection pool, cache and hashing budget) |
| `TRUSTED_PROXIES` | the addresses of the reverse proxies in front of the store, comma-separated: their `X-Forwarded-For` is the client's address for the limits. Unset, the connection's address is used and the header is ignored (anyone could write it) |
| `SECURE_COOKIES=1` | the session cookie is `Secure`: set it when the store is reached over HTTPS |
| `SHOP_DEMO_PAYMENTS=1` | customers may mark their own orders as paid (a demonstration store) |
| `SHOP_PBKDF2_ITERATIONS` | the work of new hashes (600,000) |
| `SHOP_HASH_BUDGET_MS` | the milliseconds of each minute a process may spend hashing (30,000) |
| `SHOP_IP_ATTEMPTS`, `SHOP_ACCOUNT_FAILURES` | attempts per address, failures per e-mail in 15 minutes (20, 5) |
| `SHOP_GUEST_SESSIONS` | new visitors' sessions per address in 10 minutes, per process (60) |

A hash of 600,000 iterations takes about 5 s with caju 0.9's PBKDF2, and a process serves no one
else meanwhile: run several `WORKERS`, or lower `SHOP_PBKDF2_ITERATIONS` knowing what it costs.

## Tests

```sh
tools/build.sh                                    # first: http_test.caju imports the generated shop.caju
caju test                                         # money, URLs, slugs, the search's words, passwords,
                                                  # next, the limits' counters and budget
SHOP_TEST_DSN=postgres://.../shop_test caju test  # also against a database (emptied!): the last unit,
                                                  # cancellations, coupons, shipping, and the security
                                                  # rules over HTTP (http_test.caju, web.test_request)
npm install && node tools/e2e.mjs                 # 79 checks in Chromium against a running ./server
                                                  # with fresh data (the store, the cart with and
                                                  # without WebAssembly, checkout, accounts, the panel;
                                                  # its header says how to start the server)
```

## Performance

[PERF.md](PERF.md), from `node tools/perf.mjs`. In short: the public pages come from the cache in
under 1 ms (about 10,000 per second on one process); a page rendered for a signed-in customer
takes 5 to 11 ms (about 115 per second per process, 450 with four); a first visit transfers 20 to
45 KB plus the program (187 KB of wasm, once), and the next pages 6 to 30 KB.

## Limits

- **No TLS** in Caju yet: no real payment gateway or e-mail. The payment is a simulated Pix, and
  the server is meant to sit behind a proxy that terminates HTTPS.
- Caju has no threads: one process handles one request at a time (with an event loop for the
  connections). `WORKERS` runs several processes.
- Pictures are generated; there is no upload.

## License

MIT
