(() => {
  window.__UI_FNS__ = {
    // "METHOD\nURL\nBODY" -> "STATUS\nBODY"
    api: (arg) => {
      const a = arg.indexOf("\n"), b = arg.indexOf("\n", a + 1)
      const method = arg.slice(0, a), url = arg.slice(a + 1, b), body = arg.slice(b + 1)
      const init = { method, credentials: "same-origin", headers: { "accept": "application/json" } }
      if (method !== "GET") { init.body = body; init.headers["content-type"] = "application/x-www-form-urlencoded" }
      return fetch(url, init).then((r) => r.text().then((t) => r.status + "\n" + t), () => "0\n")
    },
    go: (url) => { location.assign(url) },
  }
})()
