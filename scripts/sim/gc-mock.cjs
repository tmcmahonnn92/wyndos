// Tiny GoCardless API stand-in for tests (no network). State: mandates, payments, refunds.
const http = require("http");
const state = { mandates: [], payments: [], refunds: [], subscriptions: [], n: 0 };
let run = Date.now().toString(36).toUpperCase();
const id = (p) => `${p}T${run}${String(++state.n).padStart(4, "0")}`;
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const url = new URL(req.url, "http://x"); const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname;
    if (p === "/_test/reset") { run = Date.now().toString(36).toUpperCase(); Object.assign(state, { mandates: [], payments: [], refunds: [], subscriptions: [], n: 0 }); return send(res, 200, {}); }
    if (p === "/_test/mandate") { state.mandates.push(body); return send(res, 200, body); }
    if (p === "/_test/mandate-status") { const m = state.mandates.find((x) => x.id === body.id); if (m) m.status = body.status; return send(res, 200, m || {}); }
    if (p === "/_test/payment") { const pm = { id: id("PM"), created_at: new Date().toISOString(), ...body }; state.payments.push(pm); return send(res, 200, pm); }
    if (p === "/_test/status") { const pm = state.payments.find((x) => x.id === body.id); if (pm) pm.status = body.status; return send(res, 200, pm || {}); }
    if (p === "/_test/state") return send(res, 200, state);
    if (req.method === "POST" && p === "/payments") {
      const b = body.payments; const pm = { id: id("PM"), amount: b.amount, status: "pending_submission", charge_date: "2026-11-06", created_at: new Date().toISOString(), description: b.description, metadata: b.metadata, links: { mandate: b.links.mandate } };
      state.payments.push(pm); return send(res, 201, { payments: pm });
    }
    if (req.method === "POST" && p === "/refunds") { const b = body.refunds; const r = { id: id("RF"), amount: b.amount, status: "created", created_at: new Date().toISOString(), links: b.links }; state.refunds.push(r); return send(res, 201, { refunds: r }); }
    const one = p.match(/^\/(payments|mandates)\/(\w+)$/);
    if (one) { const x = state[one[1]].find((y) => y.id === one[2]); return x ? send(res, 200, { [one[1]]: x }) : send(res, 404, { error: { message: "not found" } }); }
    const key = p.replace(/^\//, "");
    if (req.method === "GET" && state[key]) return send(res, 200, { [key]: state[key], meta: { cursors: { after: null } } });
    if (req.method === "GET") return send(res, 200, { [key]: [], meta: { cursors: { after: null } } });
    send(res, 404, { error: { message: `mock: ${req.method} ${p}` } });
  });
}).listen(4600, "127.0.0.1", () => console.log("gc mock on 4600"));
