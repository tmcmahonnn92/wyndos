// GoCardless API stand-in for tests (no network). State: mandates, payments, refunds.
// Behaves like GoCardless where money is concerned:
//  - Idempotency-Key: the same key again → 409 idempotent_creation_conflict naming the first payment
//  - POST /payments/:id/actions/cancel only while pending_submission / pending_customer_approval
//  - POST /refunds: only confirmed / paid_out payments, never more than the payment, and
//    total_amount_confirmation must equal everything refunded so far plus this one
//  - list filters: mandates?customer=, payments?mandate=
// Test controls under /_test/*: reset, mandate, mandate-status, payment, status, state,
// drop-next (create the next payment/refund but answer 500, like a connection lost).
const http = require("http");
const state = { mandates: [], payments: [], refunds: [], subscriptions: [], n: 0, keys: {}, posts: [], dropNext: false };
let run = Date.now().toString(36).toUpperCase();
const id = (p) => `${p}T${run}${String(++state.n).padStart(4, "0")}`;
const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const err = (res, code, type, message, extra = {}) => send(res, code, { error: { type, message, code, errors: [{ message, ...extra }] } });
const conflict = (res, existing) => err(res, 409, "invalid_state", "A resource has already been created with this idempotency key", { reason: "idempotent_creation_conflict", links: { conflicting_resource_id: existing } });

http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => {
    const url = new URL(req.url, "http://x"); const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname;
    const key = req.headers["idempotency-key"];
    if (p === "/_test/reset") { run = Date.now().toString(36).toUpperCase(); Object.assign(state, { mandates: [], payments: [], refunds: [], subscriptions: [], n: 0, keys: {}, posts: [], dropNext: false }); return send(res, 200, {}); }
    if (p === "/_test/mandate") { state.mandates.push(body); return send(res, 200, body); }
    if (p === "/_test/mandate-status") {
      const m = state.mandates.find((x) => x.id === body.id); if (m) m.status = body.status;
      // Like GoCardless: a cancelled/failed mandate cancels its payments not yet sent to the bank.
      if (m && ["cancelled", "failed", "expired"].includes(body.status)) for (const pm of state.payments) if (pm.links.mandate === m.id && ["pending_submission", "pending_customer_approval"].includes(pm.status)) pm.status = "cancelled";
      return send(res, 200, m || {});
    }
    if (p === "/_test/payment") { const pm = { id: id("PM"), created_at: new Date().toISOString(), ...body }; state.payments.push(pm); return send(res, 200, pm); }
    if (p === "/_test/status") { const pm = state.payments.find((x) => x.id === body.id) || state.refunds.find((x) => x.id === body.id); if (pm) pm.status = body.status; return send(res, 200, pm || {}); }
    if (p === "/_test/subscription") { const sub = { id: id("SB"), status: "active", interval: 1, interval_unit: "monthly", ...body }; state.subscriptions.push(sub); return send(res, 200, sub); }
    if (p === "/_test/drop-next") { state.dropNext = true; return send(res, 200, {}); }
    if (p === "/_test/state") return send(res, 200, state);

    if (req.method === "POST" && p === "/payments") {
      if (key && state.keys[key]) return conflict(res, state.keys[key]);
      const b = body.payments;
      if (!b || !Number.isInteger(b.amount) || b.amount <= 0) return err(res, 422, "validation_failed", "amount must be a positive whole number of pence");
      const m = state.mandates.find((x) => x.id === b.links?.mandate);
      if (m && !["active", "pending_submission", "submitted", "pending_customer_approval"].includes(m.status)) return err(res, 422, "invalid_state", `Mandate is ${m.status}`);
      const pm = { id: id("PM"), amount: b.amount, status: "pending_submission", charge_date: "2026-11-06", created_at: new Date().toISOString(), description: b.description, metadata: b.metadata, links: { mandate: b.links.mandate }, key };
      state.payments.push(pm); if (key) state.keys[key] = pm.id; state.posts.push({ path: p, key, id: pm.id, amount: b.amount });
      if (state.dropNext) { state.dropNext = false; return err(res, 500, "gocardless", "connection lost (test)"); }
      return send(res, 201, { payments: pm });
    }
    const cancel = p.match(/^\/payments\/(\w+)\/actions\/cancel$/);
    if (req.method === "POST" && cancel) {
      const pm = state.payments.find((x) => x.id === cancel[1]);
      if (!pm) return err(res, 404, "invalid_api_usage", "not found");
      if (!["pending_submission", "pending_customer_approval"].includes(pm.status)) return err(res, 422, "invalid_state", `Payment is ${pm.status} and can't be cancelled`);
      pm.status = "cancelled"; return send(res, 200, { payments: pm });
    }
    if (req.method === "POST" && p === "/refunds") {
      if (key && state.keys[key]) return conflict(res, state.keys[key]);
      const b = body.refunds; const pm = state.payments.find((x) => x.id === b.links?.payment);
      if (!pm) return err(res, 404, "invalid_api_usage", "payment not found");
      if (!["confirmed", "paid_out"].includes(pm.status)) return err(res, 422, "invalid_state", `Payment is ${pm.status}`);
      const before = state.refunds.filter((r) => r.links.payment === pm.id && !["cancelled", "bounced", "funds_returned"].includes(r.status)).reduce((s, r) => s + r.amount, 0);
      if (b.total_amount_confirmation !== before + b.amount) return err(res, 422, "validation_failed", `total_amount_confirmation should be ${before + b.amount}`, { reason: "total_amount_confirmation_invalid" });
      if (before + b.amount > pm.amount) return err(res, 422, "validation_failed", "Refund would be more than the payment", { reason: "refund_payment_invalid_state" });
      const r = { id: id("RF"), amount: b.amount, status: "created", created_at: new Date().toISOString(), links: b.links, metadata: b.metadata };
      state.refunds.push(r); if (key) state.keys[key] = r.id; state.posts.push({ path: p, key, id: r.id, amount: b.amount });
      if (state.dropNext) { state.dropNext = false; return err(res, 500, "gocardless", "connection lost (test)"); }
      return send(res, 201, { refunds: r });
    }
    if (req.method === "GET" && p === "/creditors") return send(res, 200, { creditors: [{ name: "Test creditor", verification_status: "successful" }], meta: { cursors: { after: null } } });
    const one = p.match(/^\/(payments|mandates|refunds)\/(\w+)$/);
    if (one) { const x = state[one[1]].find((y) => y.id === one[2]); return x ? send(res, 200, { [one[1]]: x }) : err(res, 404, "invalid_api_usage", "not found"); }
    const list = p.replace(/^\//, "");
    if (req.method === "GET" && state[list]) {
      let items = state[list];
      if (list === "mandates" && url.searchParams.get("customer")) items = items.filter((m) => m.links?.customer === url.searchParams.get("customer"));
      if (list === "payments" && url.searchParams.get("mandate")) items = items.filter((m) => m.links?.mandate === url.searchParams.get("mandate"));
      if (url.searchParams.get("status")) items = items.filter((m) => m.status === url.searchParams.get("status"));
      return send(res, 200, { [list]: items, meta: { cursors: { after: null } } });
    }
    if (req.method === "GET") return send(res, 200, { [list]: [], meta: { cursors: { after: null } } });
    send(res, 404, { error: { message: `mock: ${req.method} ${p}` } });
  });
}).listen(4600, "127.0.0.1", () => console.log("gc mock on 4600"));
