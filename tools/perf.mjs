// Measures the store: the server (latency of each page, throughput with 1 and 4 processes, memory),
// what each page transfers, and the browser (first paint, hydration, Slow 4G). Writes PERF.md.
//   ./server must be built and the database seeded; this script starts its own servers.
//   node tools/perf.mjs            (DATABASE_URL, RUNS=3)
import { chromium } from "playwright"
import http from "node:http"
import zlib from "node:zlib"
import fs from "node:fs"
import { spawn, execSync } from "node:child_process"

const DSN = process.env.DATABASE_URL || "postgres://shop:shop-dev@192.168.0.6:55440/shop"
const RUNS = Number(process.env.RUNS || 3)
const PORT = 3890
const BASE = `http://127.0.0.1:${PORT}`
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function start(workers) {
  try { execSync(`ss -ltnp | grep -q ':${PORT} '`); throw new Error(`port ${PORT} is taken`) } catch (e) { if (e.message.includes("taken")) throw e }
  const p = spawn("./server", [], { env: { ...process.env, DATABASE_URL: DSN, PORT: String(PORT), WORKERS: String(workers), QUIET: "1" }, stdio: "ignore" })
  return new Promise((res) => {
    const poll = () => http.get(BASE + "/shop.css", (r) => { r.resume(); res(p) }).on("error", () => setTimeout(poll, 100))
    poll()
  })
}
const stop = (p) => new Promise((res) => {
  if (p.exitCode !== null) return res()
  p.on("exit", res)
  p.kill()
})

function get(path, headers = {}) {
  return new Promise((res, rej) => {
    http.get(BASE + path, { headers: { "accept-encoding": "gzip", ...headers } }, (r) => {
      const c = []
      r.on("data", (x) => c.push(x))
      r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) }))
    }).on("error", rej)
  })
}

function rss() {
  const pid = execSync(`ss -ltnp | grep ':${PORT} ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2`).toString().trim()
  const ppid = execSync(`ps -o ppid= -p ${pid}`).toString().trim()
  // the listening process and its siblings (the workers share the parent)
  const root = execSync(`ps -o comm= -p ${ppid}`).toString().trim() === "server" ? ppid : pid
  const all = execSync(`ps -o rss= --ppid ${root} -p ${root}`).toString().trim().split(/\s+/).map(Number)
  return { mb: all.reduce((a, b) => a + b, 0) / 1024, procs: all.length }
}

async function cookieOf(email, password) {
  const body = `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`
  return new Promise((res) => {
    const req = http.request(BASE + "/entrar", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": body.length } }, (r) => {
      r.resume()
      res((r.headers["set-cookie"] || [""])[0].split(";")[0])
    })
    req.end(body)
  })
}

async function load(path, headers, total, conc) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: conc })
  const lat = []
  let n = 0
  const one = () => new Promise((res) => {
    const t0 = performance.now()
    http.get(BASE + path, { agent, headers: { "accept-encoding": "gzip", ...headers } }, (r) => { r.resume(); r.on("end", () => { lat.push(performance.now() - t0); res() }) })
  })
  const t0 = performance.now()
  await Promise.all(Array.from({ length: conc }, async () => { while (n < total) { n++; await one() } }))
  const secs = (performance.now() - t0) / 1000
  agent.destroy()
  lat.sort((a, b) => a - b)
  return { rps: total / secs, p50: lat[Math.floor(lat.length * 0.5)], p99: lat[Math.floor(lat.length * 0.99)] }
}

const PAGES = [
  ["Home", "/"],
  ["Search (words)", "/busca?q=cocada"],
  ["Search with filters", "/busca?promo=1&min=10&max=80&sort=price-asc"],
  ["Category", "/categoria/bebidas"],
  ["Product", "/produto/cachaca-envelhecida-em-umburana-700-ml"],
  ["Panel: dashboard", "/admin"],
  ["Panel: orders", "/admin/pedidos"],
]

// ---------------------------------------------------------------- the server
let server = await start(1)
const admin = await cookieOf("admin@emporiocaju.dev", "admin123")
const customer = await cookieOf("cliente@emporiocaju.dev", "cliente123")
const signed = (path) => ({ cookie: path.startsWith("/admin") ? admin : customer })
const idle = rss()
async function timed(path, headers) {
  for (let i = 0; i < 5; i++) await get(path, headers)
  const times = []
  for (let i = 0; i < 30; i++) { const t0 = performance.now(); await get(path, headers); times.push(performance.now() - t0) }
  return median(times)
}
const pages = []
for (const [name, path] of PAGES) {
  const visitor = path.startsWith("/admin") ? NaN : await timed(path, {})
  const rendered = await timed(path, signed(path))
  const r = await get(path, signed(path))
  pages.push({ name, path, visitor, ms: rendered, gz: r.body.length, raw: zlib.gunzipSync(r.body).length })
}
const LOADS = [["Home, visitor", "/", false], ["Search, visitor", "/busca?q=queijo", false], ["Search, signed in", "/busca?q=queijo", true], ["Panel: dashboard", "/admin", true]]
const one = {}
for (const [name, path, auth] of LOADS) {
  const h = auth ? signed(path) : {}
  await load(path, h, 200, 8)
  one[name] = await load(path, h, auth ? 2000 : 10000, 16)
}
const busy1 = rss()
await stop(server)
server = await start(4)
const admin4 = await cookieOf("admin@emporiocaju.dev", "admin123")
const customer4 = await cookieOf("cliente@emporiocaju.dev", "cliente123")
const four = {}
for (const [name, path, auth] of LOADS) {
  const h = auth ? { cookie: path.startsWith("/admin") ? admin4 : customer4 } : {}
  await load(path, h, 400, 16)
  four[name] = await load(path, h, auth ? 4000 : 20000, 32)
}
const busy4 = rss()

// ---------------------------------------------------------------- the files
// as the pages reference them (shop.css, shop.js and ui.js with their version; the worker, the
// host and the wasm are fetched by ui.js without one, and revalidated with their ETag)
const homeHtml = zlib.gunzipSync((await get("/")).body).toString()
const refs = [...homeHtml.matchAll(/(?:href|src)="(\/(?:shop\.css|shop\.js|__ui\/ui\.js)[^"]*)"/g)].map((m) => m[1])
const files = {}
for (const f of [...refs, "/__ui/worker.js", "/__ui/caju-host.mjs", "/__ui/app.wasm"]) {
  const r = await get(f)
  const again = r.headers.etag ? await get(f, { "if-none-match": r.headers.etag }) : { status: 200 }
  files[f.split("?")[0]] = { gz: r.body.length, raw: r.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(r.body).length : r.body.length, cache: r.headers["cache-control"].startsWith("public") ? "immutable (versioned URL)" : again.status === 304 ? "revalidated: 304" : r.headers["cache-control"] }
}

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch()
async function visit(path, next, throttle) {
  const ctx = await browser.newContext()
  if (path.startsWith("/admin")) await ctx.addCookies([{ name: "sid", value: admin4.split("=")[1], url: BASE }])
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Network.enable")
  if (throttle) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  let bytes = 0
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength })
  const ready = () => page.waitForFunction(() => [...document.querySelectorAll("input, button, select, form, rect")].some((e) => e.__mods), null, { timeout: 60000, polling: 10 })
  // a first visit (a new browser profile: nothing in the cache)
  let t0 = Date.now()
  await page.goto(BASE + path, { waitUntil: "load" })
  await ready()
  const hydrated = Date.now() - t0
  const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime || 0)
  const first = bytes
  // the next page, with the cache warm
  bytes = 0
  t0 = Date.now()
  await page.goto(BASE + next, { waitUntil: "load" })
  await ready()
  const nextHydrated = Date.now() - t0
  const nextKb = bytes / 1024
  await ctx.close()
  return { fcp, hydrated, kb: first / 1024, nextHydrated, nextKb }
}
const browse = []
for (const [name, path, next] of [["Home", "/", "/busca?q=cocada"], ["Search", "/busca?q=cocada", "/produto/cocada-branca-200-g"], ["Product", "/produto/cocada-branca-200-g", "/categoria/doces"], ["Panel", "/admin", "/admin/pedidos"]]) {
  const fast = [], slow = []
  for (let i = 0; i < RUNS; i++) { fast.push(await visit(path, next, false)); slow.push(await visit(path, next, true)) }
  const m = (xs, k) => median(xs.map((x) => x[k]))
  browse.push({ name, fcp: m(fast, "fcp"), hyd: m(fast, "hydrated"), kb: m(fast, "kb"), nkb: m(fast, "nextKb"), nhyd: m(fast, "nextHydrated"), fcp4g: m(slow, "fcp"), hyd4g: m(slow, "hydrated"), nhyd4g: m(slow, "nextHydrated") })
}
await browser.close()
await stop(server)

// ---------------------------------------------------------------- the report
const kb = (n) => (n / 1024).toFixed(1)
const r0 = (n) => Math.round(n)
let md = `# caju-shop: performance, transfer and memory

${new Date().toISOString().slice(0, 10)} · \`node tools/perf.mjs\` · the native Caju server, PostgreSQL 17 in the local k3s
(same machine, through the cluster's load balancer), headless Chromium · medians. Demonstration
data: 157 products, 60 customers, 420 orders.

## Server

Each page, one request at a time. A visitor without a session gets the page from the cache (the
same for everyone, gzipped once, dropped when the catalog or the stock changes); a signed-in
customer gets it rendered on the spot (queries, rendering, gzip):

| Page | Visitor (cache) | Signed in (rendered) | HTML (gzip) | HTML |
|---|--:|--:|--:|--:|
${pages.map((p) => `| ${p.name} | ${isNaN(p.visitor) ? "—" : p.visitor.toFixed(1) + " ms"} | ${p.ms.toFixed(1)} ms | ${kb(p.gz)} KB | ${kb(p.raw)} KB |`).join("\n")}

Throughput (requests per second, keep-alive connections):

| Page | 1 process | p50 | p99 | 4 processes | p50 | p99 |
|---|--:|--:|--:|--:|--:|--:|
${Object.keys(one).map((k) => `| ${k} | ${r0(one[k].rps)}/s | ${one[k].p50.toFixed(1)} ms | ${one[k].p99.toFixed(1)} ms | ${r0(four[k].rps)}/s | ${four[k].p50.toFixed(1)} ms | ${four[k].p99.toFixed(1)} ms |`).join("\n")}

Memory (RSS): ${idle.mb.toFixed(1)} MB idle, ${busy1.mb.toFixed(1)} MB after the load with 1 process, ${busy4.mb.toFixed(1)} MB for the
${busy4.procs} processes together after the load with 4 (each with its own connection pool and page cache).

Most of a rendered page's time goes to the database (2 to 4 queries, each a round trip through
k3s) and to gzip (in Caju, at its fast level), about 40% each; rendering the components takes less
than 10% (\`PROFILE=1 ./server\` prints the split for every page).

## Files

| File | Transferred | Size | Cache |
|---|--:|--:|---|
${Object.entries(files).map(([f, v]) => `| \`${f}\` | ${kb(v.gz)} KB | ${kb(v.raw)} KB | ${v.cache} |`).join("\n")}

Each page's CSS (its caju style sheet) goes inside its HTML. Only the first visit downloads the
rest: \`shop.css\`, \`shop.js\` and \`ui.js\` carry their version in the URL and stay cached for good;
\`ui.js\` fetches the worker, the host and the wasm without one, and later visits get a 304.

## Browser

"Hydrated" is when the WebAssembly program has taken over the page (events answer); before that,
links and forms already work without it. First visit: a new browser profile, nothing cached.
Next page: the following navigation, with the cache warm.

| Page | First paint | Hydrated | Transferred | Next page: transferred | hydrated |
|---|--:|--:|--:|--:|--:|
${browse.map((b) => `| ${b.name} | ${r0(b.fcp)} ms | ${r0(b.hyd)} ms | ${r0(b.kb)} KB | ${r0(b.nkb)} KB | ${r0(b.nhyd)} ms |`).join("\n")}

On Slow 4G (1.6 Mbit/s, 150 ms latency, Lighthouse's profile):

| Page | First paint | Hydrated | Next page: hydrated |
|---|--:|--:|--:|
${browse.map((b) => `| ${b.name} | ${r0(b.fcp4g)} ms | ${r0(b.hyd4g)} ms | ${r0(b.nhyd4g)} ms |`).join("\n")}

The browser's byte count leaves out what the worker downloads: the wasm, ${kb(files["/__ui/app.wasm"].gz)} KB gzipped, on the
first visit (a 304 afterwards).
`
fs.writeFileSync("PERF.md", md)
console.log(md)
