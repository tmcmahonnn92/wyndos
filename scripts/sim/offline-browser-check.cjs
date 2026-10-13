// Offline queue browser test (Playwright). Needs the built app on :3000 and the local demo
// business (sam@example.com, work day 177 jobs 1040-1047). Resets nothing itself: reset those
// jobs to PENDING and delete payments with clientRequestId like 'T-%' first.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const DB = "postgresql://wy@localhost:5433/wyndos?host=/var/tmp";
const q = (sql) => execSync(`psql "${DB}" -Atc "${sql.replace(/"/g, '\\"')}"`).toString().trim();
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const idb = {
  put: (p, store, items) => p.evaluate(([store, items]) => new Promise((res, rej) => {
    const r = indexedDB.open('wyndos-offline', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['queue', 'problems']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => { const t = r.result.transaction(store, 'readwrite'); for (const i of items) t.objectStore(store).put(i); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
  }), [store, items]),
  all: (p, store) => p.evaluate((store) => new Promise((res) => {
    const r = indexedDB.open('wyndos-offline', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['queue', 'problems']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => { const g = r.result.transaction(store).objectStore(store).getAll(); g.onsuccess = () => { r.result.close(); res(g.result); }; };
  }), store),
};
const item = (id, kind, jobId, extra = {}) => ({ id, kind, jobId, workDayId: 177, createdAt: Date.now(), order: Date.now() * 1000 + (item.n = (item.n || 0) + 1), label: `Job ${jobId}`, ...extra });
const nudge = (p) => p.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
async function until(fn, ms = 25000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(700); } return false; }

(async () => {
  const b = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 400, height: 900 } });
  const p = await ctx.newPage();
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 150)));
  const signIn = async () => {
    await p.goto('http://127.0.0.1:3000/auth/signin');
    await p.fill('input[type=email]', 'sam@example.com'); await p.fill('input[type=password]', 'GuideDemo123!');
    await p.click('button[type=submit]'); await p.waitForTimeout(3000);
  };
  await signIn();
  if (process.env.SKIP_TO_7) { await p.goto('http://127.0.0.1:3000/days/177'); await p.waitForTimeout(3000); }
  await p.goto('http://127.0.0.1:3000/days/177'); await p.waitForTimeout(4000);
  // Let the service worker take control (first visit), then reload under it.
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(3000);
  check('service worker controls the page', await p.evaluate(() => Boolean(navigator.serviceWorker.controller)));

  // 1. Real tap with no signal.
  await ctx.setOffline(true);
  const doneBtn = p.locator('div').filter({ hasText: 'Laura Ward' }).filter({ has: p.getByRole('button', { name: /^Done$/ }) }).last().getByRole('button', { name: /^Done$/ });
  console.log('Done buttons for Laura:', await doneBtn.count());
  await doneBtn.first().click(); await p.waitForTimeout(1500);
  let queue = await idb.all(p, 'queue');
  check('offline tap saved in phone database', queue.length === 1 && queue[0].kind === 'complete' && queue[0].jobId === 1040, JSON.stringify(queue.map((x) => x.kind + x.jobId)));
  check('label saved with it', queue[0]?.label?.startsWith('Laura Ward'), queue[0]?.label);
  check('no signal bar shows 1 change', (await p.getByText(/1 change saved on this phone/).count()) > 0);
  const tags = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; try { return r.sync ? await r.sync.getTags() : 'no-sync-api'; } catch (e) { return 'unavailable here: ' + e.message; } });
  console.log('      background sync tags:', JSON.stringify(tags));
  // Reload with no signal: still there.
  await p.reload().catch(() => {}); await p.waitForTimeout(2500);
  check('still saved after reopening offline', (await idb.all(p, 'queue')).length === 1);
  await ctx.setOffline(false); await nudge(p);
  check('sent when signal returns', await until(() => q("select status from \"Job\" where id=1040") === 'COMPLETE'));
  check('queue empty after sending', await until(async () => (await idb.all(p, 'queue')).length === 0));

  // 2. Mixed batch, in order, one refused in the middle.
  await ctx.setOffline(true);
  await idb.put(p, 'queue', [
    item('T-a', 'skip', 1042),
    item('T-b', 'note', 1043, { notes: 'Gate code 1234' }),
    item('T-bad', 'complete', 999999, { label: 'Ghost Customer, 1 Nowhere' }),
    item('T-c', 'price', 1044, { price: 13 }),
    item('T-d', 'complete', 1045),
    item('T-pay1', 'pay', 1045, { customerId: 1000, allocations: [{ jobId: 1045, amount: 16 }], method: 'CASH', notes: 'paid at door', createdAt: Date.now() - 3600_000 }),
  ]);
  await ctx.setOffline(false); await nudge(p);
  check('batch: queue empties', await until(async () => (await idb.all(p, 'queue')).length === 0));
  check('skip applied', q("select status from \"Job\" where id=1042") === 'SKIPPED');
  check('note applied', q("select coalesce(notes,'') from \"Job\" where id=1043").includes('Gate code 1234'));
  check('price applied', q("select price from \"Job\" where id=1044") === '13');
  check('complete + payment applied', q("select status from \"Job\" where id=1045") === 'COMPLETE' && q("select count(*) from \"Payment\" where \"clientRequestId\"='T-pay1'") === '1');
  check('payment dated when taken, note kept', q("select (\"paidAt\" < now() - interval '50 minutes')::text || coalesce(notes,'') from \"Payment\" where \"clientRequestId\"='T-pay1'").startsWith('true') && q("select coalesce(notes,'') from \"Payment\" where \"clientRequestId\"='T-pay1'").includes('paid at door'));
  let problems = await idb.all(p, 'problems');
  check('refused one kept under Needs checking', problems.length === 1 && problems[0].id === 'T-bad', problems.map((x) => x.error).join('|'));
  await p.waitForTimeout(1000);
  check('Needs checking bar shows', (await p.getByText(/1 offline change needs checking/).count()) > 0);

  // 3. Sent twice: payment not doubled.
  await idb.put(p, 'queue', [item('T-pay1', 'pay', 1045, { customerId: 1000, allocations: [{ jobId: 1045, amount: 16 }], method: 'CASH' })]);
  await nudge(p);
  await until(async () => (await idb.all(p, 'queue')).length === 0);
  check('same payment sent again is not recorded twice', q("select count(*) from \"Payment\" where \"clientRequestId\"='T-pay1'") === '1');

  // 4. Needs checking: Try again (still refused), then Remove.
  await p.getByText(/needs checking/).click(); await p.waitForTimeout(500);
  check('shows what and why', (await p.getByText(/Done: Ghost Customer/).count()) > 0 && (await p.getByText(/Not saved:/).count()) > 0);
  await p.getByRole('button', { name: 'Try again' }).click();
  await p.waitForTimeout(4000);
  problems = await idb.all(p, 'problems');
  check('Try again: refused again, still listed', problems.length === 1 && (await idb.all(p, 'queue')).length === 0);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.getByRole('button', { name: 'Remove' }).click(); await p.waitForTimeout(1500);
  check('Remove clears it', (await idb.all(p, 'problems')).length === 0 && (await p.getByText(/needs checking/).count()) === 0);
  p.removeAllListeners('dialog'); p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

  // 5. Saved by the older version (plain browser storage): moved across and sent.
  await ctx.setOffline(true);
  await p.evaluate(() => localStorage.setItem('wyndos-offline-queue', JSON.stringify([{ id: 'T-legacy', kind: 'complete', jobId: 1046, workDayId: 177, createdAt: Date.now() }])));
  await ctx.setOffline(false);
  await p.reload(); await p.waitForTimeout(2000); await nudge(p);
  check('older saved change moved and sent', await until(() => q("select status from \"Job\" where id=1046") === 'COMPLETE'));
  check('older storage emptied', await p.evaluate(() => localStorage.getItem('wyndos-offline-queue')) === null);

  // 6. Background sender (service worker) on its own: a page without the app.
  const p2 = await ctx.newPage();
  await p2.goto('http://127.0.0.1:3000/offline.html'); await p2.waitForTimeout(1000);
  const controlled = await p2.evaluate(() => Boolean(navigator.serviceWorker.controller));
  await p.close();
  await idb.put(p2, 'queue', [item('T-sw', 'note', 1047, { notes: 'Sent by background' })]);
  await p2.evaluate(() => navigator.serviceWorker.controller.postMessage({ type: 'send-offline' }));
  check('service worker sends on its own', controlled && await until(() => q("select coalesce(notes,'') from \"Job\" where id=1047").includes('Sent by background')));
  check('service worker empties queue', await until(async () => (await idb.all(p2, 'queue')).length === 0));

  // 7. Signed out (server answers 401): kept, says so, sent once signed in again.
  const p4 = await ctx.newPage(); p4.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await p4.goto('http://127.0.0.1:3000/days/177'); await p4.waitForTimeout(3000);
  await p4.route('**/api/offline/sync', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Signed out"}' }));
  await idb.put(p4, 'queue', [item('T-out', 'note', 1047, { notes: 'After signing in again' })]);
  await nudge(p4); await p4.waitForTimeout(4000);
  check('signed out: change kept', (await idb.all(p4, 'queue')).length === 1);
  check('signed out: bar says sign in', (await p4.getByText(/Sign in again to send them/).count()) > 0);
  await p4.unroute('**/api/offline/sync');
  await nudge(p4);
  check('sent after signing in', await until(() => q("select coalesce(notes,'') from \"Job\" where id=1047").includes('After signing in again')));
  // Logged-out request to the real server: refused with 401, nothing done.
  const anon = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
  const ap = await anon.newPage();
  const resp = await ap.request.post('http://127.0.0.1:3000/api/offline/sync', { data: { items: [{ id: 'T-anon', kind: 'skip', jobId: 1046 }] }, maxRedirects: 0 });
  check('signed-out request does nothing', resp.status() !== 200 && q("select status from \"Job\" where id=1046") === 'COMPLETE', String(resp.status()));
  await anon.close();

  // 8. Sign out with unsent changes: warned, Cancel keeps you in.
  await p4.goto('http://127.0.0.1:3000/settings?tab=account'); await p4.waitForTimeout(3000);
  await ctx.setOffline(true);
  await idb.put(p4, 'queue', [item('T-keep', 'skip', 1047)]);
  await p4.evaluate(() => window.dispatchEvent(new Event('wyndos-offline-queue-changed')));
  await p4.reload().catch(() => {}); await p4.waitForTimeout(2500);
  dialogs.length = 0;
  await p4.getByRole('tab', { name: /account/i }).click(); await p4.waitForTimeout(800);
  const so = p4.locator('button:visible:has-text("Sign out")').first(); console.log('      visible sign-out buttons:', await p4.locator('button:visible:has-text("Sign out")').count());
  if (await so.count()) { await so.click(); await p4.waitForTimeout(1500); }
  check('sign-out warns about unsent changes', dialogs.some((m) => /haven't been sent yet|hasn't been sent yet/.test(m)), dialogs[0]?.slice(0, 80));
  check('Cancel: still saved', (await idb.all(p4, 'queue')).length === 1);
  await ctx.setOffline(false); await nudge(p4);
  check('then sent', await until(() => q("select status from \"Job\" where id=1047") === 'SKIPPED'));

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
})().catch((e) => { console.log('CRASH', e.message); process.exit(1); });
