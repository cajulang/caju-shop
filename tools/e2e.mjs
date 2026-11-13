// End-to-end tests in a real browser (Playwright): the store, the cart, the checkout, the account
// and the panel, with the program in WebAssembly running (hydration, the API calls) and without it
// (the plain forms). Needs the server running with the demonstration data:
//   ./server reset && ./server migrate && ./server seed && ./server &
//   BASE=http://127.0.0.1:3800 node tools/e2e.mjs        (SHOTS=dir saves screenshots)
import { chromium } from "playwright"

const BASE = process.env.BASE || "http://127.0.0.1:3800"
const SHOTS = process.env.SHOTS || ""
let failures = 0
let passed = 0
const problems = []

function check(cond, what) {
  if (cond) { passed++; console.log("  ok   " + what) } else { failures++; console.log("  FAIL " + what) }
}

let current = null
async function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  console.log(name)
  try { await fn() } catch (e) {
    failures++
    console.log("  FAIL " + name + ": " + e.message.split("\n").slice(0, 2).join(" ") + (current ? " (at " + current.url() + ")" : ""))
    if (SHOTS && current) await current.screenshot({ path: `${SHOTS}/fail-${name.split(":")[0].replace(/\W+/g, "-")}.png` }).catch(() => {})
  }
}

// the program in the worker is ready once the page answers an event: wait for hydration
async function hydrated(page) {
  await page.waitForFunction(() => document.querySelector("#app") && window.__UI_FNS__, null, { timeout: 10000 })
  await page.waitForTimeout(700)
}

async function shot(page, name) { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) }

async function signIn(page, email, password) {
  current = page
  await page.goto(BASE + "/entrar")
  await page.fill("#f-email", email)
  await page.fill("#f-password", password)
  await Promise.all([page.waitForNavigation(), page.click("form[action='/entrar'] button[type=submit]")])
}

const browser = await chromium.launch()
const watch = (page) => {
  current = page
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message))
  page.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !m.text().startsWith("Failed to load resource")) problems.push(m.type() + ": " + m.text().slice(0, 200)) })
  page.on("response", (r) => { if (r.status() === 404 && !r.url().includes("/nao-existe") && r.url() !== BASE + "/admin") problems.push("404: " + r.url()) })
}

// ---------------------------------------------------------------- the store
await test("home: sections, departments, hydration", async () => {
  const page = await browser.newPage()
  watch(page)
  await page.goto(BASE + "/")
  await hydrated(page)
  check(await page.locator("h1").first().textContent() !== "", "has a heading")
  check(await page.locator("[data-product]").count() >= 8, "shows products in sections")
  check(await page.locator("nav[aria-label=Departamentos] a").count() >= 5, "shows the departments")
  await shot(page, "home")
  await page.close()
})

await test("search: words, typos, filters, order, pages", async () => {
  const page = await browser.newPage()
  watch(page)
  await page.goto(BASE + "/busca?q=cocada")
  await hydrated(page)
  const n = Number(await page.getAttribute("[data-total]", "data-total"))
  check(n > 0, `"cocada" finds products (${n})`)
  const names = await page.locator("[data-product] a").allTextContents()
  check(names.slice(0, 10).every((t) => /cocada/i.test(t)), "the cocadas come first (then other coconut sweets)")
  await page.goto(BASE + "/busca?q=cachaca")
  const accents = Number(await page.getAttribute("[data-total]", "data-total"))
  check(accents > 0, `"cachaca" without the accent finds cachaças (${accents})`)
  await page.goto(BASE + "/busca?q=cocadas")
  check(Number(await page.getAttribute("[data-total]", "data-total")) > 0, "the plural finds them too")
  await page.goto(BASE + "/busca?q=cocda")
  check(Number(await page.getAttribute("[data-total]", "data-total")) > 0, "a typo (cocda) still finds them")
  // the filters: with the program, the checkbox applies at once
  await page.goto(BASE + "/busca")
  await hydrated(page)
  const all = Number(await page.getAttribute("[data-total]", "data-total"))
  await Promise.all([page.waitForURL(/promo=1/), page.check("input[name=promo]")])
  const sale = Number(await page.getAttribute("[data-total]", "data-total"))
  check(sale > 0 && sale < all, `"Só promoções" narrows ${all} to ${sale}`)
  check(await page.locator("[data-product] .price-old").count() === await page.locator("[data-product]").count(), "every result is on sale")
  await hydrated(page)
  await Promise.all([page.waitForURL(/sort=price-asc/), page.selectOption("select[name=sort]", "price-asc")])
  const prices = await page.locator("[data-product] .price-now, [data-product] .price-now-sale").allTextContents()
  const cents = prices.map((t) => Number(t.replace(/[^0-9]/g, "")))
  check(cents.every((c, i) => i === 0 || cents[i - 1] <= c), "sorted by price, lowest first")
  await page.goto(BASE + "/busca?min=100&max=200")
  const ranged = await page.locator("[data-product] .price-now, [data-product] .price-now-sale").allTextContents()
  check(ranged.length > 0 && ranged.map((t) => Number(t.replace(/[^0-9]/g, ""))).every((c) => c >= 10000 && c <= 20000), "the price range filters (R$ 100 to 200)")
  await page.goto(BASE + "/busca")
  check(await page.locator("nav[aria-label=Páginas] a").count() > 0, "has pages")
  await page.goto(BASE + "/busca?page=2")
  check(await page.locator("[aria-current=page]").last().textContent() === "2", "page 2 opens")
  await page.close()
})

await test("categories: department, subcategory, facets", async () => {
  const page = await browser.newPage()
  watch(page)
  await page.goto(BASE + "/categoria/bebidas")
  const dept = Number(await page.getAttribute("[data-total]", "data-total"))
  check(dept > 0, `Bebidas has ${dept} products`)
  check(await page.locator("nav[aria-label=Subcategorias] a").count() >= 3, "shows the subcategories")
  await page.click("nav[aria-label=Subcategorias] a:has-text('Cachaças')")
  await page.waitForURL(/categoria\/cachacas/)
  const sub = Number(await page.getAttribute("[data-total]", "data-total"))
  check(sub > 0 && sub < dept, `Cachaças (${sub}) is part of Bebidas`)
  check((await page.textContent("nav[aria-label='Você está em']")).includes("Bebidas"), "the breadcrumbs show the department")
  await page.goto(BASE + "/categoria/nao-existe")
  check((await page.textContent("h2")).includes("não encontrada"), "an unknown category is a 404 page")
  await page.close()
})

await test("suggestions while typing", async () => {
  const page = await browser.newPage()
  watch(page)
  await page.goto(BASE + "/")
  await hydrated(page)
  await page.locator("input[name=q]").first().pressSequentially("queij", { delay: 40 })
  await page.waitForSelector("[role=listbox] a", { timeout: 5000 })
  const items = await page.locator("[role=listbox] a").allTextContents()
  check(items.some((t) => /queijo/i.test(t)), `suggests cheeses (${items.length - 1} suggestions)`)
  await page.close()
})

// ---------------------------------------------------------------- the cart and the checkout
await test("cart: add without leaving the page, change, remove", async () => {
  const page = await browser.newPage()
  watch(page)
  await page.goto(BASE + "/produto/cocada-branca-200-g")
  await hydrated(page)
  await page.fill("input[name=qty]", "2")
  await page.click("[data-add]")
  await page.waitForSelector("[data-cart-count]", { timeout: 5000 })
  check(await page.getAttribute("[data-cart-count]", "data-cart-count") === "2", "the header counts 2 items")
  check(page.url().includes("/produto/"), "stayed on the product page")
  check((await page.textContent("[role=status]")).includes("carrinho"), "a toast confirms it")
  await page.goto(BASE + "/busca?q=queijo")
  await hydrated(page)
  await page.locator("[data-product] [data-add]").first().click()
  await page.waitForFunction(() => document.querySelector("[data-cart-count]")?.dataset.cartCount === "3")
  check(true, "a card's button adds one more (3)")
  await page.goto(BASE + "/carrinho")
  await hydrated(page)
  check(await page.locator("[data-line]").count() === 2, "the cart has 2 lines")
  const before = Number(await page.getAttribute("[data-subtotal]", "data-subtotal"))
  await page.locator("[data-line] button[aria-label='Mais um']").first().click()
  await page.waitForFunction((b) => Number(document.querySelector("[data-subtotal]").dataset.subtotal) > b, before)
  check(await page.getAttribute("[data-line] [data-qty]", "data-qty") === "3", "+ raises the quantity in place")
  await page.locator("[data-line] button:has-text('Remover')").last().click()
  await page.waitForFunction(() => document.querySelectorAll("[data-line]").length === 1)
  check(true, "Remover takes a line out")
  check(await page.getAttribute("[data-cart-count]", "data-cart-count") === "3", "the header follows (3)")
  await shot(page, "cart")
  await page.close()
})

await test("cart without the program: the plain forms work", async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const page = await ctx.newPage()
  await page.goto(BASE + "/produto/cocada-queimada-200-g")
  await Promise.all([page.waitForNavigation(), page.click("[data-add]")])
  check(page.url().endsWith("/carrinho"), "the form goes to the cart")
  check(await page.locator("[data-line]").count() === 1, "with the product in it")
  await Promise.all([page.waitForNavigation(), page.click("[data-line] button[aria-label='Mais um']")])
  check(await page.getAttribute("[data-line] [data-qty]", "data-qty") === "2", "+ works as a form")
  await ctx.close()
})

// what a visitor without a session sees of a product's stock (that page comes from the cache)
async function publicStock(slug) {
  const html = await (await fetch(BASE + "/produto/" + slug)).text()
  const m = html.match(/<dt>Estoque<\/dt><dd>(\d+) unidade/)
  return m ? Number(m[1]) : -1
}

let orderUrl = ""
await test("checkout: sign in, address, coupon, order, pay", async () => {
  const stockBefore = await publicStock("cocada-de-forno-500-g")
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  watch(page)
  // a visitor's cart survives signing in
  await page.goto(BASE + "/produto/cocada-de-forno-500-g")
  await hydrated(page)
  await page.click("[data-add]")
  await page.waitForSelector("[data-cart-count]")
  await page.goto(BASE + "/finalizar")
  check(page.url().includes("/entrar?next=%2Ffinalizar"), "the checkout asks to sign in")
  await page.fill("#f-email", "cliente@emporiocaju.dev")
  await page.fill("#f-password", "cliente123")
  await Promise.all([page.waitForNavigation(), page.click("form[action='/entrar'] button[type=submit]")])
  check(page.url().includes("/finalizar"), "and comes back to it")
  await hydrated(page)
  check(await page.locator("input[name=address_id]").count() >= 1, "with the saved address")
  const total = Number(await page.getAttribute("[data-total]", "data-total"))
  check(total > 0, "a total with shipping")
  // a wrong coupon, then a right one, quoted in place
  await page.fill("input[name=cupom]", "NAOEXISTE")
  await page.click("form[action='/finalizar'] button:has-text('Aplicar')")
  await page.waitForSelector("[data-coupon-error]")
  check((await page.textContent("[data-coupon-error]")).includes("inválido"), "an invalid coupon is refused")
  await page.fill("input[name=cupom]", "BEMVINDO10")
  await page.click("form[action='/finalizar'] button:has-text('Aplicar')")
  await page.waitForSelector("[data-discount]")
  const discount = Number(await page.getAttribute("[data-discount]", "data-discount"))
  check(discount > 0, `BEMVINDO10 gives ${discount / 100} off`)
  check(Number(await page.getAttribute("[data-total]", "data-total")) === total - discount, "the total goes down by the discount")
  await shot(page, "checkout")
  await Promise.all([page.waitForNavigation(), page.click("button[form=checkout]")])
  check(/\/pedidos\/\d+$/.test(page.url()), "the order is placed")
  check(await publicStock("cocada-de-forno-500-g") === stockBefore - 1, `the visitors' cached page shows the new stock (${stockBefore} → ${stockBefore - 1})`)
  orderUrl = page.url()
  check(await page.getAttribute("[data-status]", "data-status") === "pending", "waiting for payment")
  check((await page.textContent("[data-pix]")).length > 20, "with a Pix code (demonstration)")
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Simular pagamento')")])
  check(await page.getAttribute("[data-status]", "data-status") === "paid", "paying marks it paid")
  await shot(page, "order")
  await page.goto(BASE + "/conta/pedidos")
  check((await page.textContent("main")).includes(orderUrl.split("/").pop()), "it is in Meus pedidos")
  await page.goto(BASE + "/carrinho")
  check(await page.locator("[data-line]").count() === 0, "the cart is empty again")
  await ctx.close()
})

await test("sign up and validation", async () => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE + "/cadastro")
  await page.fill("#f-name", "Teste E2E")
  await page.fill("#f-email", "cliente@emporiocaju.dev")
  await page.fill("#f-password", "12345678")
  await Promise.all([page.waitForNavigation(), page.click("form[action='/cadastro'] button[type=submit]")])
  check((await page.textContent("#f-email + .field-error, .field-error")).includes("Já existe"), "a taken e-mail is refused")
  const email = `e2e${Date.now()}@exemplo.com`
  await page.fill("#f-email", email)
  await page.fill("#f-password", "12345678")
  await Promise.all([page.waitForNavigation(), page.click("form[action='/cadastro'] button[type=submit]")])
  check(page.url().endsWith("/conta"), "a new account opens the account page")
  // the browser checks the required fields; the server checks the rest
  await page.fill("#f-cep", "123")
  for (const [k, v] of [["street", "Rua A"], ["number", "1"], ["district", "Centro"], ["city", "Recife"], ["state", "PE"]]) await page.fill("#f-" + k, v)
  await Promise.all([page.waitForNavigation(), page.click("form[action='/conta/enderecos'] button[type=submit]")])
  check((await page.textContent("main")).includes("8 dígitos"), "a short CEP is refused")
  await ctx.close()
  const fresh = await browser.newContext()
  const p2 = await fresh.newPage()
  await signIn(p2, email, "errada")
  check((await p2.textContent("[role=alert]")).includes("não conferem"), "a wrong password is refused")
  await fresh.close()
})

// ---------------------------------------------------------------- the panel
await test("panel: access, dashboard, roles", async () => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  watch(page)
  await page.goto(BASE + "/admin")
  check(page.url().includes("/entrar"), "the panel asks to sign in")
  await signIn(page, "cliente@emporiocaju.dev", "cliente123")
  await page.goto(BASE + "/admin")
  check((await page.textContent("h2")).includes("não encontrada"), "a customer gets a 404")
  await ctx.close()
  const admin = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const p2 = await admin.newPage()
  watch(p2)
  await signIn(p2, "admin@emporiocaju.dev", "admin123")
  check(p2.url().endsWith("/admin"), "an admin lands on the dashboard")
  await hydrated(p2)
  check(await p2.locator(".admin-stat").count() === 5, "five indicators")
  check(await p2.locator("svg[aria-label='Vendas por dia'] rect").count() === 30, "a chart of 30 days")
  await p2.locator("svg[aria-label='Vendas por dia'] rect").nth(29).hover()
  await p2.waitForFunction(() => !document.querySelector("[data-chart-label]").textContent.startsWith("Passe"))
  check(true, "hovering a bar shows its day")
  await shot(p2, "admin-dashboard")
  await admin.close()
  const op = await browser.newContext()
  const p3 = await op.newPage()
  await signIn(p3, "operador@emporiocaju.dev", "operador123")
  await p3.goto(BASE + "/admin/cupons")
  check(p3.url().endsWith("/admin") && (await p3.textContent("[role=alert]")).includes("administradores"), "an operator cannot open the coupons")
  await p3.goto(BASE + "/admin/pedidos")
  check(await p3.locator("tbody tr").count() > 0, "but sees the orders")
  await op.close()
})

await test("panel: products (create, edit, stock, bulk)", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  watch(page)
  await signIn(page, "admin@emporiocaju.dev", "admin123")
  await page.goto(BASE + "/admin/produtos/novo")
  await hydrated(page)
  await page.$eval("form[action='/admin/produtos/novo']", (f) => { f.noValidate = true })
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Criar produto')")])
  check(await page.locator(".field-error").count() >= 2, "an empty form shows the errors")
  const name = "Doce de leite E2E " + Date.now()
  await page.fill("#f-name", name)
  await page.selectOption("#f-category_id", { label: "— Doces de corte" })
  await page.fill("#f-price", "19,90")
  await page.fill("#f-sale", "14,90")
  await page.fill("#f-stock", "7")
  await page.fill("#f-description", "Feito no teste.")
  await page.locator("input[type=range]").fill("200")
  await page.waitForFunction(() => document.querySelector("[data-hue]").dataset.hue === "200")
  check(true, "the color slider updates the picture in place")
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Criar produto')")])
  check(/\/admin\/produtos\/\d+$/.test(page.url()), "the product is created")
  const id = page.url().split("/").pop()
  check(await page.getAttribute("[data-stock]", "data-stock") === "7", "with its stock")
  await page.fill("#f-delta", "5")
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Ajustar estoque')")])
  check(await page.getAttribute("[data-stock]", "data-stock") === "12", "a stock entry adds 5")
  await page.fill("#f-price", "21,90")
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Salvar alterações')")])
  await page.goto(BASE + "/busca?q=" + encodeURIComponent("E2E"))
  check((await page.textContent("main")).includes(name), "it shows in the store")
  await page.goto(BASE + "/admin/produtos?q=E2E")
  await hydrated(page)
  await page.check(`input[name=ids][value='${id}']`)
  await page.waitForFunction(() => document.querySelector("[data-selected]").dataset.selected === "1")
  await Promise.all([page.waitForNavigation(), page.click("button[value=deactivate]")])
  await page.goto(BASE + "/busca?q=" + encodeURIComponent("E2E"))
  check(!(await page.textContent("main")).includes(name), "deactivated, it leaves the store")
  await page.goto(BASE + "/admin/auditoria")
  check((await page.textContent("main")).includes("preço: R$ 19,90 → R$ 21,90"), "the audit log has the price change")
  await shot(page, "admin-product")
  await ctx.close()
})

await test("panel: orders, categories, sections, coupons, customers", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
  const page = await ctx.newPage()
  watch(page)
  await signIn(page, "admin@emporiocaju.dev", "admin123")
  // the order paid in the checkout test: ship it, then deliver
  const id = orderUrl.split("/").pop()
  await page.goto(BASE + "/admin/pedidos/" + id)
  await Promise.all([page.waitForNavigation(), page.click("[data-to=shipped]")])
  check((await page.textContent("main")).includes("rastreio"), "shipping without a tracking code is refused")
  await page.fill("#f-tracking", "BR123456789NE")
  await Promise.all([page.waitForNavigation(), page.click("[data-to=shipped]")])
  check(await page.getAttribute("[data-status]", "data-status") === "shipped", "shipped with its tracking code")
  await Promise.all([page.waitForNavigation(), page.click("[data-to=delivered]")])
  check(await page.getAttribute("[data-status]", "data-status") === "delivered", "then delivered")
  await shot(page, "admin-order")
  await page.goto(BASE + "/admin/pedidos?f=pending")
  await hydrated(page)
  const rows = await page.locator("tbody [data-status]").evaluateAll((els) => els.map((e) => e.dataset.status))
  check(rows.length > 0 && rows.every((s) => s === "pending"), "the status filter")
  // categories
  await page.goto(BASE + "/admin/categorias")
  await page.fill("#f-name", "Bolos E2E")
  await page.selectOption("#f-parent_id", { label: "Doces" })
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Criar categoria')")])
  check((await page.textContent("main")).includes("Bolos E2E"), "a category is created")
  const del = page.locator("form[action$='/remover'] button[aria-label='Remover Bolos E2E']")
  await Promise.all([page.waitForNavigation(), del.click()])
  check(!(await page.textContent("tbody")).includes("Bolos E2E"), "and removed")
  await Promise.all([page.waitForNavigation(), page.click("button[aria-label='Remover Doces']")])
  check((await page.textContent("[role=alert]")).includes("subcategorias"), "a department with subcategories cannot be removed")
  // sections: add a product by searching, move it up, save
  await page.goto(BASE + "/admin/secoes")
  await page.click("tbody a >> nth=0")
  await hydrated(page)
  const before = await page.locator("[data-item]").count()
  await page.fill("input[placeholder='Buscar produto…']", "rapadura")
  await page.waitForSelector(".admin-pick-results button")
  const have = await page.locator("[data-item]").allTextContents()
  const offers = await page.locator(".admin-pick-results button").allTextContents()
  const pick = offers.findIndex((t) => !have.some((h) => h.trim() === t.trim()))
  await page.locator(".admin-pick-results button").nth(pick).click()
  await page.waitForFunction((b) => document.querySelectorAll("[data-item]").length === b + 1, before)
  await page.locator("[data-item]").last().locator("button[aria-label=Subir]").click()
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Salvar ordem e produtos')")])
  check(await page.locator("[data-item]").count() === before + 1, "a section gets a product by search and keeps the order")
  // coupons
  await page.goto(BASE + "/admin/cupons")
  const code = "E2E" + String(Date.now()).slice(-6)
  await page.fill("#f-code", code)
  await page.fill("#f-value", "15")
  await Promise.all([page.waitForNavigation(), page.click("button:has-text('Criar cupom')")])
  check((await page.textContent("tbody")).includes(code), "a coupon is created")
  // customers
  await page.goto(BASE + "/admin/clientes?sort=spent")
  check(await page.locator("tbody tr").count() > 0, "customers sorted by spending")
  await page.click("tbody a >> nth=0")
  check(await page.locator("tbody tr").count() > 0, "a customer's orders")
  await page.goto(BASE + "/admin/configuracoes")
  check(await page.locator("form[action^='/admin/fretes/']").count() >= 5, "the shipping table")
  await shot(page, "admin-settings")
  await ctx.close()
})

await test("security: another site's form is refused", async () => {
  const r = await fetch(BASE + "/carrinho", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" }, body: "product_id=1&qty=1", redirect: "manual" })
  check(r.status === 403, "POST from another origin: 403")
  const n = await fetch(BASE + "/entrar?next=https://evil.example", { redirect: "manual" })
  check(!(await n.text()).includes("evil.example"), "an outside next= is dropped")
})

await browser.close()
const unique = [...new Set(problems)]
if (unique.length) {
  console.log("\nbrowser problems:")
  for (const p of unique) console.log("  " + p)
}
console.log(`\n${passed} passed, ${failures} failed`)
process.exit(failures || unique.length ? 1 : 0)
