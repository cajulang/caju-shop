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
- Accounts: sign up, sign in, profile, addresses, order history.

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

**Security**: passwords with PBKDF2-HMAC-SHA256 (60,000 rounds, random salt); sessions in an
`HttpOnly`, `SameSite=Lax` cookie with 32 random bytes, of which the database keeps only the
SHA-256; a new session on signing in; forms from another origin are refused; every SQL value goes
as a parameter.

## How it is built

```
model.caju        the data of the pages, shared by the server and the browser (money, URLs)
app.cajux         the root: which page, inside which frame
layout.cajux      the store's frame (header, search, menu, footer) and the panel's
kit.cajux         shared pieces: product card, add-to-cart, fields, pagination, the API calls
pages/            home, catalog (search, category, product), cart (cart, checkout, order),
                  account, admin_catalog and admin_sales (the panel)
main.cajux        the browser: hydrates the page with the data the server put in it
server.cajux      the routes, the forms, the JSON API, the panel, the files; also the commands
back/             the server's side: db (pool, migrations), auth (passwords, sessions), catalog
                  (search, menu), orders (cart, shipping, coupons, orders), admin, images, seed
sql/              the migrations
theme.caju        the palette; shop_css.caju writes the CSS
```

The server renders each page with the same components the browser hydrates: `app.App` gets a
`model.Page` (as JSON in the page for the browser). A visitor without a session gets the public
pages from a cache, the same HTML for everyone, gzipped once and dropped when the catalog or the
stock changes. The browser's program calls the server's JSON API (`/api/...`) through a page
function (`public/shop.js`), because the WebAssembly worker has no `fetch` of its own.

## Running it

Needs `caju` (0.5.0), checkouts of [ui](https://github.com/cajulang/ui) (with
`build/caju-ui` built), [caju-style](https://github.com/cajulang/caju-style) and
[pg](https://github.com/cajulang/pg) next to this one (`../caju-ui`, `../caju-style`,
`../caju-pg`), and a PostgreSQL 14 or later with the `unaccent` and `pg_trgm` extensions (the
official image has them).

```sh
kubectl apply -f deploy/postgres.yaml       # or any PostgreSQL: DATABASE_URL=postgres://...
caju pkg install                            # web
tools/build.sh                              # the CSS, the program (wasm) and ./server
./server migrate && ./server seed           # the schema and the demonstration data
./server                                    # http://localhost:3800 (PORT, HOST, WORKERS)
```

Demonstration accounts: `admin@emporiocaju.dev` / `admin123` (administrator),
`operador@emporiocaju.dev` / `operador123` (operator), `cliente@emporiocaju.dev` / `cliente123`
(a customer with orders). Coupons: `BEMVINDO10`, `FRETEJUNINO`, `CAJU20`.

`./server reset` drops everything. `WORKERS=4 ./server` serves with 4 processes (each with its own
connection pool and cache).

## Tests

```sh
caju test                                         # money, URLs, slugs, the search's words, passwords
SHOP_TEST_DSN=postgres://.../shop_test caju test  # also the rules against a database (emptied!):
                                                  # the last unit, cancellations, coupons, shipping
npm install && node tools/e2e.mjs                 # 79 checks in Chromium against a running ./server
                                                  # with fresh data (the store, the cart with and
                                                  # without WebAssembly, checkout, accounts, the panel)
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
