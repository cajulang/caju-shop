# caju-shop: performance, transfer and memory

2026-11-13 · `node tools/perf.mjs` · the native Caju server, PostgreSQL 17 in the local k3s
(same machine, through the cluster's load balancer), headless Chromium · medians. Demonstration
data: 157 products, 60 customers, 420 orders.

## Server

Each page, one request at a time. A visitor without a session gets the page from the cache (the
same for everyone, gzipped once, dropped when the catalog or the stock changes); a signed-in
customer gets it rendered on the spot (queries, rendering, gzip):

| Page | Visitor (cache) | Signed in (rendered) | HTML (gzip) | HTML |
|---|--:|--:|--:|--:|
| Home | 0.6 ms | 8.6 ms | 10.2 KB | 73.5 KB |
| Search (words) | 0.6 ms | 9.3 ms | 6.9 KB | 39.5 KB |
| Search with filters | 0.6 ms | 8.0 ms | 8.8 KB | 54.8 KB |
| Category | 0.6 ms | 8.1 ms | 8.2 KB | 54.5 KB |
| Product | 0.5 ms | 5.1 ms | 5.6 KB | 22.9 KB |
| Panel: dashboard | — | 10.7 ms | 6.9 KB | 34.5 KB |
| Panel: orders | — | 6.8 ms | 6.9 KB | 39.3 KB |

Throughput (requests per second, keep-alive connections):

| Page | 1 process | p50 | p99 | 4 processes | p50 | p99 |
|---|--:|--:|--:|--:|--:|--:|
| Home, visitor | 9489/s | 1.5 ms | 4.6 ms | 11012/s | 2.5 ms | 6.8 ms |
| Search, visitor | 10411/s | 1.3 ms | 4.1 ms | 10782/s | 2.7 ms | 6.2 ms |
| Search, signed in | 121/s | 123.3 ms | 252.3 ms | 458/s | 69.0 ms | 156.6 ms |
| Panel: dashboard | 113/s | 131.4 ms | 277.9 ms | 426/s | 64.3 ms | 187.7 ms |

Memory (RSS): 15.4 MB idle, 51.9 MB after the load with 1 process, 186.8 MB for the
4 processes together after the load with 4 (each with its own connection pool and page cache).

Most of a rendered page's time goes to the database (2 to 4 queries, each a round trip through
k3s) and to gzip (in Caju, at its fast level), about 40% each; rendering the components takes less
than 10% (`PROFILE=1 ./server` prints the split for every page).

## Files

| File | Transferred | Size | Cache |
|---|--:|--:|---|
| `/shop.css` | 6.9 KB | 50.2 KB | immutable (versioned URL) |
| `/shop.js` | 0.4 KB | 0.6 KB | immutable (versioned URL) |
| `/__ui/ui.js` | 5.1 KB | 17.0 KB | immutable (versioned URL) |
| `/__ui/worker.js` | 1.1 KB | 2.2 KB | revalidated: 304 |
| `/__ui/caju-host.mjs` | 3.6 KB | 11.7 KB | revalidated: 304 |
| `/__ui/app.wasm` | 186.9 KB | 1756.5 KB | revalidated: 304 |

Each page's CSS (its caju style sheet) goes inside its HTML. Only the first visit downloads the
rest: `shop.css`, `shop.js` and `ui.js` carry their version in the URL and stay cached for good;
`ui.js` fetches the worker, the host and the wasm without one, and later visits get a 304.

## Browser

"Hydrated" is when the WebAssembly program has taken over the page (events answer); before that,
links and forms already work without it. First visit: a new browser profile, nothing cached.
Next page: the following navigation, with the cache warm.

| Page | First paint | Hydrated | Transferred | Next page: transferred | hydrated |
|---|--:|--:|--:|--:|--:|
| Home | 81 ms | 157 ms | 43 KB | 18 KB | 88 ms |
| Search | 66 ms | 117 ms | 35 KB | 6 KB | 61 ms |
| Product | 82 ms | 110 ms | 23 KB | 28 KB | 105 ms |
| Panel | 69 ms | 109 ms | 21 KB | 7 KB | 70 ms |

On Slow 4G (1.6 Mbit/s, 150 ms latency, Lighthouse's profile):

| Page | First paint | Hydrated | Next page: hydrated |
|---|--:|--:|--:|
| Home | 418 ms | 1902 ms | 695 ms |
| Search | 423 ms | 1874 ms | 545 ms |
| Product | 439 ms | 1712 ms | 723 ms |
| Panel | 414 ms | 1682 ms | 542 ms |

The browser's byte count leaves out what the worker downloads: the wasm, 186.9 KB gzipped, on the
first visit (a 304 afterwards).
