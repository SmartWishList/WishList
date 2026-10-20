// Logic tests: node tests/test.js
const assert = require('node:assert/strict');
const A = require('../app.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const S = () => ({ products: [], categories: [{ id: 'c1', name: 'Tools and DIY' }, { id: 'c2', name: 'Electronics' }], alerts: [], savedFilters: [] });
const mk = (o = {}) => A.normalizeProduct({ name: 'Drill', ...o });
const DAY = 864e5;

t('only name required; defaults applied', () => { const p = mk(); assert.equal(p.priority, 3); assert.equal(p.price, null); assert.equal(p.purchased, false); });
t('priority clamped 1..5', () => { assert.equal(mk({ priority: 9 }).priority, 5); assert.equal(mk({ priority: 0 }).priority, 3); });

t('price info: latest/prev/min/max/change/pct', () => {
  const s = S(), p = mk({ desired: 80, monitor: { enabled: true } });
  A.addObservation(s, p, 100, 'manual', 1000); A.addObservation(s, p, 90, 'manual', 2000); A.addObservation(s, p, 95, 'manual', 3000);
  const i = A.priceInfo(p);
  assert.equal(i.latest, 95); assert.equal(i.prev, 90); assert.equal(i.min, 90); assert.equal(i.max, 100);
  assert.equal(i.change, 5); assert.ok(Math.abs(i.pct - 5.5556) < 0.01); assert.equal(i.count, 3);
});

t('target-reached alert fires once on crossing', () => {
  const s = S(), p = mk({ desired: 80, monitor: { enabled: true, notifyTarget: true } });
  assert.equal(A.addObservation(s, p, 100, 'manual', 1).length, 0);
  const a = A.addObservation(s, p, 79, 'manual', 2); assert.equal(a.length, 1); assert.equal(a[0].kind, 'target'); assert.equal(a[0].prev, 100); assert.equal(a[0].now, 79);
  assert.equal(A.addObservation(s, p, 75, 'manual', 3).length, 0, 'no repeat while already below target');
  assert.equal(s.alerts.length, 1);
});
t('any-drop alert respects threshold', () => {
  const s = S(), p = mk({ monitor: { enabled: true, notifyAnyDrop: true, dropThreshold: 5 } });
  A.addObservation(s, p, 100, 'manual', 1);
  assert.equal(A.addObservation(s, p, 97, 'manual', 2).length, 0);
  assert.equal(A.addObservation(s, p, 90, 'manual', 3).length, 1);
});
t('discount % alert uses advertised regular price', () => {
  const s = S(), p = mk({ regularPrice: 200, monitor: { enabled: true, notifyDiscountPct: 30 } });
  A.addObservation(s, p, 150, 'manual', 1);
  assert.equal(A.addObservation(s, p, 139, 'manual', 2).length, 1);
});
t('no alerts when monitoring off or purchased', () => {
  const s = S(), p = mk({ desired: 80, monitor: { enabled: false } }); assert.equal(A.addObservation(s, p, 10, 'manual', 1).length, 0);
  const q = mk({ desired: 80, purchased: true, monitor: { enabled: true } }); assert.equal(A.addObservation(s, q, 10, 'manual', 1).length, 0);
});

t('statuses: none/paused/manual/waiting/active/failed/target/dropped/stale', () => {
  const now = Date.now();
  assert.equal(A.statusOf(mk()).key, 'none');
  assert.equal(A.statusOf(mk({ monitor: { enabled: false, everEnabled: true } })).key, 'paused');
  assert.equal(A.statusOf(mk({ store: 'Amazon.ca', url: 'https://www.amazon.ca/dp/B0', monitor: { enabled: true } })).key, 'manual');
  const auto = { store: 'BestBuy.ca', url: 'https://www.bestbuy.ca/x', monitor: { enabled: true, mode: 'auto' } };
  assert.equal(A.statusOf(mk(auto)).key, 'waiting', 'auto never checked must NOT claim active');
  assert.equal(A.statusOf(mk({ ...auto, monitor: { ...auto.monitor, lastOkAt: now - 3600e3 } })).key, 'active');
  assert.equal(A.statusOf(mk({ ...auto, monitor: { ...auto.monitor, lastOkAt: now - 40 * DAY } })).key, 'stale');
  assert.equal(A.statusOf(mk({ ...auto, monitor: { ...auto.monitor, lastOkAt: now - 1000, lastFailAt: now, lastError: 'blocked' } })).key, 'failed');
  assert.equal(A.statusOf(mk({ ...auto, desired: 50, history: [{ t: now, price: 40, source: 'auto' }], monitor: { ...auto.monitor, lastOkAt: now } })).key, 'target');
  assert.equal(A.statusOf(mk({ ...auto, history: [{ t: now - 2000, price: 100, source: 'auto' }, { t: now - 1000, price: 90, source: 'auto' }], monitor: { ...auto.monitor, lastOkAt: now } })).key, 'dropped');
  assert.equal(A.statusOf(mk({ purchased: true })).key, 'purchased');
});

t('failed check does not alter price/history (sync logic contract)', () => {
  const p = mk({ price: 100, history: [{ t: 1, price: 100, source: 'manual' }], monitor: { enabled: true, mode: 'auto' } });
  p.monitor.lastError = 'blocked'; p.monitor.lastFailAt = 5;
  assert.equal(p.price, 100); assert.equal(A.priceInfo(p).count, 1);
});

t('search across name, notes, tags, store, category', () => {
  const cats = S().categories, F = () => ({ ...A.defaultFilters(), purchased: 'all' });
  const ps = [mk({ name: 'Cordless Drill', store: 'Canadian Tire', categoryIds: ['c1'], notes: 'for deck', tags: ['gift'] }), mk({ name: 'Headphones', store: 'Best Buy', categoryIds: ['c2'] })];
  const q = s => A.filterProducts(ps, { ...F(), q: s }, cats).map(p => p.name);
  assert.deepEqual(q('drill'), ['Cordless Drill']); assert.deepEqual(q('deck'), ['Cordless Drill']); assert.deepEqual(q('gift'), ['Cordless Drill']);
  assert.deepEqual(q('best buy'), ['Headphones']); assert.deepEqual(q('electronics'), ['Headphones']); assert.deepEqual(q('zzz'), []);
});
t('filters: stars, price range, purchased, category, urgency, at target', () => {
  const cats = S().categories, base = { ...A.defaultFilters() };
  const ps = [mk({ name: 'A', priority: 5, price: 50, categoryIds: ['c1'], desired: 60 }), mk({ name: 'B', priority: 2, price: 500 }), mk({ name: 'C', purchased: true, price: 5 }),
    mk({ name: 'D', deadline: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) })];
  const names = F => A.filterProducts(ps, F, cats).map(p => p.name).sort();
  assert.deepEqual(names(base), ['A', 'B', 'D']);
  assert.deepEqual(names({ ...base, purchased: 'yes' }), ['C']);
  assert.deepEqual(names({ ...base, stars: 4 }), ['A']);
  assert.deepEqual(names({ ...base, min: '100' }), ['B']);
  assert.deepEqual(names({ ...base, max: '100' }), ['A']);
  assert.deepEqual(names({ ...base, cat: 'c1' }), ['A']);
  assert.deepEqual(names({ ...base, urgent: true }), ['D']);
  assert.deepEqual(names({ ...base, atTarget: true }), ['A']);
});
t('sorting: priority, price low/high (nulls last), newest, largest drop', () => {
  const cats = S().categories, b = A.defaultFilters();
  const ps = [mk({ name: 'A', priority: 2, price: 30, added: 1 }), mk({ name: 'B', priority: 5, price: 10, added: 2 }), mk({ name: 'C', priority: 3, added: 3 })];
  const s = k => A.filterProducts(ps, { ...b, sort: k }, cats).map(p => p.name).join('');
  assert.equal(s('priority'), 'BCA'); assert.equal(s('priceLow'), 'BAC'); assert.equal(s('priceHigh'), 'ABC'); assert.equal(s('newest'), 'CBA'); assert.equal(s('oldest'), 'ABC');
  const d1 = mk({ name: 'X', history: [{ t: 1, price: 100 }, { t: 2, price: 50 }] }), d2 = mk({ name: 'Y', history: [{ t: 1, price: 100 }, { t: 2, price: 90 }] });
  assert.equal(A.filterProducts([d2, d1], { ...b, sort: 'drop' }, cats)[0].name, 'X');
});

t('dashboard: totals, savings only with 2+ prices, no list-price savings', () => {
  const s = S();
  s.products = [mk({ name: 'A', price: 100, regularPrice: 999, history: [{ t: 1, price: 100 }] }), mk({ name: 'B', price: 70, history: [{ t: 1, price: 100 }, { t: 2, price: 70 }] }), mk({ name: 'C' })];
  const d = A.dashboardStats(s, 3);
  assert.equal(d.total, 3); assert.equal(d.cost, 170); assert.equal(d.unpriced, 1); assert.equal(d.savings, 30); assert.equal(d.onSale.length, 1);
});

t('CSV export escapes quotes/commas', () => {
  const s = S(); s.products = [mk({ name: 'He said "hi", ok', categoryIds: ['c1'] })];
  const csv = A.toCSV(s); assert.ok(csv.includes('"He said ""hi"", ok"')); assert.ok(csv.includes('Tools and DIY'));
});
t('JSON backup round-trip preserves data', () => {
  const s = S(); const p = mk({ name: 'Keep', price: 12.5, images: ['data:image/jpeg;base64,AAA'], tags: ['x'] }); A.addObservation(s, p, 12.5, 'manual', 1); s.products.push(p);
  const back = JSON.parse(JSON.stringify({ data: s })).data; const q = A.normalizeProduct(back.products[0]);
  assert.deepEqual(q, p);
});
t('watch.json only includes automatic, linked, unpurchased monitored items', () => {
  const s = S(); s.products = [
    mk({ name: 'ok', store: 'BestBuy.ca', url: 'https://www.bestbuy.ca/a', monitor: { enabled: true, mode: 'auto' } }),
    mk({ name: 'amazon', store: 'Amazon.ca', url: 'https://www.amazon.ca/dp/1', monitor: { enabled: true, mode: 'manual' } }),
    mk({ name: 'off', url: 'https://x.ca/a', monitor: { enabled: false } }), mk({ name: 'bought', url: 'https://x.ca/b', purchased: true, monitor: { enabled: true, mode: 'auto' } })];
  assert.deepEqual(A.watchFile(s).products.map(p => p.name), ['ok']);
});
t('retailer detection and name guess from URL', () => {
  assert.equal(A.detectStore('https://www.canadiantire.ca/en/pdp/x.html'), 'CanadianTire.ca'); assert.equal(A.detectStore('https://www.example.ca/a'), 'example.ca');
  assert.equal(A.guessName('https://www.homedepot.ca/product/dewalt-20v-max-cordless-drill/1001'), 'Dewalt 20v Max Cordless Drill');
  assert.equal(A.guessName('https://www.amazon.ca/dp/B0ABCDEFGH'), '');
});

(async () => {
  const { extractPrice } = await import('../checker/check.mjs');
  t('checker: reads CAD price from JSON-LD', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"129.99","priceCurrency":"CAD"}}</script>`;
    assert.deepEqual(extractPrice(html), { price: 129.99 });
  });
  t('checker: ignores non-CAD, missing and invalid prices (never invents)', () => {
    assert.equal(extractPrice(`<script type="application/ld+json">{"@type":"Offer","price":"10","priceCurrency":"USD"}</script>`), null);
    assert.equal(extractPrice('<html>no data</html>'), null);
    assert.equal(extractPrice(`<script type="application/ld+json">{bad json</script>`), null);
  });
  t('checker: handles @graph and AggregateOffer', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","offers":{"@type":"AggregateOffer","lowPrice":49.5,"priceCurrency":"CAD"}}]}</script>`;
    assert.deepEqual(extractPrice(html), { price: 49.5 });
  });
  console.log(`\n${n} tests passed`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
