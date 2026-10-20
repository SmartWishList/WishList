'use strict';
/* Smart Wishlist Canada — local-first PWA. No external services required. */

// ---------- Retailers ----------
// auto: 'best' = automatic check is attempted (reads schema.org price data on the product page; may fail if the store blocks bots)
//       'manual' = no authorized automatic method; manual updates or an external alert only
const RETAILERS = [
  { name: 'Amazon.ca', domain: 'amazon.ca', search: 'https://www.amazon.ca/s?k=', auto: 'manual', note: 'Amazon does not allow automated price scraping. Use manual updates or a free Amazon price-alert site (for example CamelCamelCamel supports Amazon.ca).' },
  { name: 'BestBuy.ca', domain: 'bestbuy.ca', search: 'https://www.bestbuy.ca/en-ca/search?search=', auto: 'best' },
  { name: 'Costco.ca', domain: 'costco.ca', search: 'https://www.costco.ca/CatalogSearch?keyword=', auto: 'manual', note: 'Costco.ca pages are bot-protected and some prices need a member login. Manual updates only.' },
  { name: 'CanadianTire.ca', domain: 'canadiantire.ca', search: 'https://www.canadiantire.ca/en/search-results.html?q=', auto: 'best' },
  { name: 'SHEIN Canada', domain: 'shein.com', search: 'https://ca.shein.com/pdsearch/', auto: 'manual', note: 'SHEIN loads prices with scripts and blocks bots. Manual updates only.' },
  { name: 'Walmart.ca', domain: 'walmart.ca', search: 'https://www.walmart.ca/en/search?q=', auto: 'best' },
  { name: 'HomeDepot.ca', domain: 'homedepot.ca', search: 'https://www.homedepot.ca/search?q=', auto: 'best' },
  { name: 'RONA.ca', domain: 'rona.ca', search: 'https://www.rona.ca/en/search?q=', auto: 'best' },
  { name: 'Google Shopping (Canada)', domain: '', search: 'https://www.google.ca/search?tbm=shop&q=', auto: 'manual', note: 'Compares many stores; opens in Google.' },
];
const DEFAULT_CATS = ['Tools and DIY', 'Electronics', 'Home and Garden', 'Clothing', 'Health and Fitness', 'Hobbies', 'Gifts', 'Other'];
const PRIORITY_LABELS = ['', 'Low priority', 'Nice to have', 'Would like to purchase', 'High priority', 'Top priority'];
const FREQS = { '12h': { label: 'Every 12 hours', ms: 11 * 3600e3 }, daily: { label: 'Daily', ms: 22 * 3600e3 }, weekly: { label: 'Weekly', ms: 6.5 * 864e5 } };

// ---------- Pure helpers (also used by tests) ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const money = n => (n == null || n === '' || isNaN(n)) ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);
const fmtDT = t => t ? new Date(t).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtD = t => t ? new Date(t).toLocaleDateString('en-CA', { dateStyle: 'medium' }) : '—';
const numOrNull = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const isHttp = u => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } };

function retailerFor(storeOrUrl) {
  const s = String(storeOrUrl || '').toLowerCase();
  return RETAILERS.find(r => (r.domain && s.includes(r.domain)) || s === r.name.toLowerCase()) || null;
}
function detectStore(url) {
  const r = retailerFor(url); if (r) return r.name;
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
function guessName(url) {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const seg = segs.filter(s => /[a-z]{3,}/i.test(s) && s.length > 6 && !/^[A-Z0-9]{8,}$/.test(s) && !/\.(html?|aspx?)$/i.test(s) || /-/.test(s)).sort((a, b) => b.length - a.length)[0];
    if (!seg) return '';
    return seg.replace(/\.[a-z]+$/i, '').replace(/[-_+]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim();
  } catch { return ''; }
}
function defaultMode(p) { const r = retailerFor(p.store || p.url); return r && r.auto === 'manual' ? 'manual' : (r || p.url ? 'auto' : 'manual'); }

function priceInfo(p) {
  const h = (p.history || []).filter(x => x.price != null).slice().sort((a, b) => a.t - b.t);
  const latest = h.length ? h[h.length - 1] : null;
  const prev = h.length > 1 ? h[h.length - 2] : null;
  const prices = h.map(x => x.price);
  const change = latest && prev ? latest.price - prev.price : null;
  const pct = latest && prev && prev.price ? (change / prev.price) * 100 : null;
  const lastAuto = [...h].reverse().find(x => x.source === 'auto');
  return {
    h, count: h.length, latest: latest ? latest.price : null, latestT: latest ? latest.t : null,
    prev: prev ? prev.price : null, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
    change, pct, lastAutoT: lastAuto ? lastAuto.t : null,
    firstPrice: h.length ? h[0].price : null,
  };
}

function statusOf(p, now = Date.now()) {
  if (p.purchased) return { key: 'purchased', label: 'Purchased', cls: 'info' };
  const m = p.monitor || {};
  if (!m.enabled) return m.everEnabled ? { key: 'paused', label: 'Monitoring paused', cls: '' } : { key: 'none', label: 'Not monitored', cls: '' };
  const i = priceInfo(p);
  const mode = m.mode || defaultMode(p);
  if (p.desired != null && i.latest != null && i.latest <= p.desired) return { key: 'target', label: 'Price target reached', cls: 'ok' };
  if (m.lastError && (m.lastFailAt || 0) >= (m.lastOkAt || 0)) return { key: 'failed', label: 'Check failed', cls: 'bad' };
  if (i.prev != null && i.latest < i.prev && now - i.latestT < 14 * 864e5) return { key: 'dropped', label: 'Price dropped', cls: 'ok' };
  if (mode === 'manual') return { key: 'manual', label: 'Manual checking required', cls: 'warn' };
  if (!m.lastOkAt) return { key: 'waiting', label: 'Waiting for first automatic check', cls: 'warn' };
  const f = FREQS[m.freq || 'daily'];
  if (now - m.lastOkAt > f.ms * 3.5) return { key: 'stale', label: 'Automatic checks overdue', cls: 'warn' };
  return { key: 'active', label: 'Monitoring active', cls: 'info' };
}

// Returns alerts triggered by moving from prevPrice to newPrice.
function evalAlerts(p, prevPrice, newPrice) {
  const m = p.monitor || {}; const out = [];
  if (!m.enabled || p.purchased || newPrice == null) return out;
  if (m.notifyTarget !== false && p.desired != null && newPrice <= p.desired && (prevPrice == null || prevPrice > p.desired))
    out.push({ kind: 'target', msg: `Target price reached (${money(p.desired)})` });
  if (m.notifyAnyDrop && prevPrice != null && prevPrice - newPrice > (m.dropThreshold || 0))
    out.push({ kind: 'drop', msg: `Price dropped by ${money(prevPrice - newPrice)}` });
  if (m.notifyDiscountPct && p.regularPrice) {
    const lim = p.regularPrice * (1 - m.notifyDiscountPct / 100);
    if (newPrice <= lim && (prevPrice == null || prevPrice > lim))
      out.push({ kind: 'discount', msg: `${m.notifyDiscountPct}% or more below the advertised regular price (${money(p.regularPrice)})` });
  }
  return out;
}

function addObservation(state, p, price, source, t = Date.now(), store) {
  const i = priceInfo(p);
  p.history = p.history || [];
  p.history.push({ t, price, source, store: store || p.store || '' });
  p.price = price;
  const alerts = evalAlerts(p, i.latest, price).map(a => ({
    id: uid(), t, productId: p.id, name: p.name, store: store || p.store || '', prev: i.latest, now: price, url: p.url || '', seen: false, simulated: false, ...a,
  }));
  state.alerts.unshift(...alerts);
  return alerts;
}

function defaultFilters() { return { q: '', sort: 'priority', cat: '', store: '', stars: 0, mon: '', purchased: 'no', min: '', max: '', tag: '', urgent: false, dropOnly: false, atTarget: false }; }

function filterProducts(list, F, cats = [], now = Date.now()) {
  const catName = id => (cats.find(c => c.id === id) || {}).name || '';
  const q = F.q.trim().toLowerCase();
  let r = list.filter(p => {
    if (F.purchased === 'no' && p.purchased) return false;
    if (F.purchased === 'yes' && !p.purchased) return false;
    if (q) {
      const hay = [p.name, p.notes, p.store, ...(p.tags || []), ...(p.categoryIds || []).map(catName)].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    if (F.cat && !(p.categoryIds || []).includes(F.cat)) return false;
    if (F.store && (p.store || '') !== F.store) return false;
    if (F.stars && p.priority < F.stars) return false;
    if (F.tag && !(p.tags || []).includes(F.tag)) return false;
    if (F.mon && statusOf(p, now).key !== F.mon) return false;
    const mn = numOrNull(F.min), mx = numOrNull(F.max);
    if (mn != null && (p.price == null || p.price < mn)) return false;
    if (mx != null && (p.price == null || p.price > mx)) return false;
    if (F.urgent && !(p.deadline && new Date(p.deadline + 'T23:59:59') - now < 14 * 864e5)) return false;
    if (F.dropOnly) { const i = priceInfo(p); if (!(i.change != null && i.change < 0)) return false; }
    if (F.atTarget && !(p.desired != null && p.price != null && p.price <= p.desired)) return false;
    return true;
  });
  const val = (p, k) => p[k] == null ? null : p[k];
  const nz = (a, b, dir) => (a == null) - (b == null) || (a - b) * dir; // nulls last
  const sorters = {
    priority: (a, b) => b.priority - a.priority || b.added - a.added,
    priceLow: (a, b) => nz(val(a, 'price'), val(b, 'price'), 1),
    priceHigh: (a, b) => nz(val(a, 'price'), val(b, 'price'), -1),
    drop: (a, b) => nz(priceInfo(a).pct, priceInfo(b).pct, 1),
    newest: (a, b) => b.added - a.added,
    oldest: (a, b) => a.added - b.added,
    desired: (a, b) => nz(val(a, 'desired'), val(b, 'desired'), 1),
    category: (a, b) => catName((a.categoryIds || [])[0]).localeCompare(catName((b.categoryIds || [])[0])),
  };
  return r.sort(sorters[F.sort] || sorters.priority);
}

function dashboardStats(S, now = Date.now()) {
  const open = S.products.filter(p => !p.purchased);
  const priced = open.filter(p => p.price != null);
  let savings = 0;
  open.forEach(p => { const i = priceInfo(p); if (i.count >= 2 && i.firstPrice > i.latest) savings += i.firstPrice - i.latest; });
  return {
    total: open.length,
    cost: priced.reduce((s, p) => s + p.price, 0), unpriced: open.length - priced.length, savings,
    top: [...open].sort((a, b) => b.priority - a.priority || b.added - a.added).slice(0, 4),
    recent: [...open].sort((a, b) => b.added - a.added).slice(0, 4),
    onSale: open.filter(p => { const i = priceInfo(p); return i.count >= 2 && i.latest < i.max && (i.max - i.latest) / i.max >= 0.01; }),
    atTarget: open.filter(p => p.desired != null && p.price != null && p.price <= p.desired),
    drops: open.filter(p => { const i = priceInfo(p); return i.change != null && i.change < 0 && now - i.latestT < 14 * 864e5; }),
  };
}

function toCSV(S) {
  const catName = id => (S.categories.find(c => c.id === id) || {}).name || '';
  const cols = ['name', 'categories', 'tags', 'store', 'url', 'price_cad', 'regular_price_cad', 'desired_price_cad', 'priority', 'added', 'deadline', 'purchased', 'monitoring', 'notes'];
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = S.products.map(p => [p.name, (p.categoryIds || []).map(catName).join('; '), (p.tags || []).join('; '), p.store, p.url, p.price, p.regularPrice, p.desired, p.priority,
    new Date(p.added).toISOString().slice(0, 10), p.deadline, p.purchased ? 'yes' : 'no', statusOf(p).label, p.notes].map(q).join(','));
  return [cols.join(','), ...rows].join('\r\n');
}

function watchFile(S) {
  return {
    version: 1,
    note: 'Generated by Smart Wishlist Canada. Upload this file to your GitHub repository as watch.json.',
    products: S.products.filter(p => !p.purchased && p.monitor && p.monitor.enabled && (p.monitor.mode || defaultMode(p)) === 'auto' && isHttp(p.url)).map(p => ({
      id: p.id, name: p.name, store: p.store || detectStore(p.url), url: p.url, extra: (p.monitor.extra || []).filter(e => isHttp(e.url)),
      freq: p.monitor.freq || 'daily', desired: p.desired, regularPrice: p.regularPrice,
      notifyTarget: p.monitor.notifyTarget !== false, notifyAnyDrop: !!p.monitor.notifyAnyDrop, dropThreshold: p.monitor.dropThreshold || 0, notifyDiscountPct: p.monitor.notifyDiscountPct || null,
    })),
  };
}

function normalizeProduct(p) {
  return {
    id: p.id || uid(), name: String(p.name || '').trim() || 'Untitled', images: Array.isArray(p.images) ? p.images : [], notes: p.notes || '',
    categoryIds: p.categoryIds || [], tags: p.tags || [], store: p.store || '', url: p.url || '', price: numOrNull(p.price), regularPrice: numOrNull(p.regularPrice),
    priority: Math.min(5, Math.max(1, Number(p.priority) || 3)), desired: numOrNull(p.desired), added: p.added || Date.now(), deadline: p.deadline || '',
    purchased: !!p.purchased, purchasedAt: p.purchasedAt || null, history: Array.isArray(p.history) ? p.history : [], monitor: p.monitor || { enabled: false },
  };
}

// ---------- Storage (IndexedDB, falls back to memory) ----------
let S = { products: [], categories: [], alerts: [], savedFilters: [], settings: { theme: 'auto', pricesUrl: 'prices.json', lastSync: null, lastSyncMsg: '' } };
const idb = {
  db: null,
  open() { return new Promise(res => { try { const r = indexedDB.open('swc', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => res(); } catch { res(); } }); },
  get(k) { return new Promise(res => { if (!this.db) return res(null); const q = this.db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
  set(k, v) { return new Promise(res => { if (!this.db) return res(false); const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(true); t.onerror = () => res(false); }); },
};
let saveTimer; function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => idb.set('state', S).then(ok => { if (!ok) toast('⚠️ Could not save to this browser. Export a backup.'); }), 200); }

// ---------- UI (browser only) ----------
if (typeof document !== 'undefined') {
  let F = defaultFilters(); let route = 'home';
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');
  const stars = n => `<span class="stars" aria-label="${n} of 5 stars: ${PRIORITY_LABELS[n]}">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  const chip = st => `<span class="chip ${st.cls}">${esc(st.label)}</span>`;
  const catName = id => (S.categories.find(c => c.id === id) || {}).name || '';
  const PH = `onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'🛍️'}))"`;
  const thumb = p => p.images && p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy" ${PH}>` : `<div class="ph">🛍️</div>`;
  window.toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3200); };
  const toast = window.toast;

  function modal(html) {
    const el = document.createElement('div'); el.className = 'modal'; el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    el.addEventListener('mousedown', e => { if (e.target === el) el.remove(); });
    $('#modal-root').appendChild(el); return el;
  }
  const closeModals = () => { $('#modal-root').innerHTML = ''; };
  function confirmDlg(title, msg, okLabel = 'Confirm', danger = false) {
    return new Promise(res => {
      const el = modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="row"><button class="btn sec grow" data-x="0">Cancel</button><button class="btn ${danger ? 'danger' : ''} grow" data-x="1">${esc(okLabel)}</button></div>`);
      el.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) { el.remove(); res(b.dataset.x === '1'); } });
    });
  }

  // ----- Views -----
  function pcard(p) {
    const i = priceInfo(p), st = statusOf(p);
    const drop = i.change != null && i.change < 0 ? `<span class="chip ok">▼ ${money(-i.change)} (${Math.abs(i.pct).toFixed(1)}%)</span>` : '';
    return `<div class="card pcard" data-act="open" data-id="${p.id}" role="button" tabindex="0">${thumb(p)}<div class="info"><div class="name">${esc(p.name)}</div>${stars(p.priority)}
      <div class="price">${money(p.price)} ${drop}</div><div class="muted">${esc(p.store || 'No store')}${p.desired != null ? ' · target ' + money(p.desired) : ''}</div>${p.monitor && (p.monitor.enabled || p.monitor.everEnabled) || p.purchased ? chip(st) : ''}</div></div>`;
  }
  const section = (title, list, empty) => `<h2>${title}</h2>` + (list.length ? `<div class="grid">${list.slice(0, 4).map(pcard).join('')}</div>` : `<div class="muted">${empty}</div>`);

  function vHome() {
    const d = dashboardStats(S);
    return `<form data-form="homesearch" class="row"><input class="grow" name="q" type="search" placeholder="Search your wishlist…" aria-label="Search"><button class="btn">Search</button></form>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><small>Wishlist items</small><b>${d.total}</b></div>
      <div class="stat"><small>Estimated cost${d.unpriced ? ` (${d.unpriced} without price)` : ''}</small><b>${money(d.cost)}</b></div>
      <div class="stat"><small>At target price</small><b>${d.atTarget.length}</b></div>
      <div class="stat"><small>Observed savings*</small><b>${money(d.savings)}</b></div></div>
    <div class="muted" style="font-size:.8rem">*Only counts items with 2+ recorded prices: first recorded price minus latest.</div>
    <h2>Categories</h2><div>${S.categories.map(c => `<a class="chip info" style="font-size:.9rem;padding:6px 12px;text-decoration:none" href="#/wishlist" data-act="catgo" data-id="${c.id}">${esc(c.name)} (${S.products.filter(p => !p.purchased && (p.categoryIds || []).includes(c.id)).length})</a>`).join('') || '<span class="muted">No categories yet.</span>'}</div>
    ${section('⭐ Highest priority', d.top, 'Add a product to get started.')}
    ${section('🆕 Recently added', d.recent, 'Nothing yet.')}
    ${section('🎯 Reached target price', d.atTarget, 'None yet. Set a desired price on a product.')}
    ${section('🏷️ On sale (from recorded prices)', d.onSale, 'No verified sales. This needs two or more recorded prices.')}
    ${section('📉 Recent price drops (14 days)', d.drops, 'No recent drops recorded.')}`;
  }

  function vWishlist() {
    const stores = [...new Set(S.products.map(p => p.store).filter(Boolean))].sort();
    const tags = [...new Set(S.products.flatMap(p => p.tags || []))].sort();
    const list = filterProducts(S.products, F, S.categories);
    const sel = (name, opts, cur) => `<select name="${name}" aria-label="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    return `<form data-form="filters"><input name="q" type="search" value="${esc(F.q)}" placeholder="Search names, notes, tags, stores…" aria-label="Search">
      <div class="row" style="margin-top:8px"><div class="grow">${sel('sort', [['priority', 'Sort: Priority'], ['priceLow', 'Lowest price'], ['priceHigh', 'Highest price'], ['drop', 'Largest price drop'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['desired', 'Desired price'], ['category', 'Category']], F.sort)}</div>
      <div class="grow">${sel('purchased', [['no', 'Not purchased'], ['yes', 'Purchased'], ['all', 'All']], F.purchased)}</div></div>
      <details style="margin-top:8px"><summary>Filters</summary>
        <label>Category</label>${sel('cat', [['', 'All'], ...S.categories.map(c => [c.id, c.name])], F.cat)}
        <label>Retailer</label>${sel('store', [['', 'All'], ...stores.map(s => [s, s])], F.store)}
        <label>Minimum stars</label>${sel('stars', [[0, 'Any'], [1, '1+'], [2, '2+'], [3, '3+'], [4, '4+'], [5, '5 only']], F.stars)}
        <label>Monitoring status</label>${sel('mon', [['', 'Any'], ['active', 'Monitoring active'], ['target', 'Target reached'], ['dropped', 'Price dropped'], ['failed', 'Check failed'], ['manual', 'Manual checking required'], ['paused', 'Paused'], ['none', 'Not monitored']], F.mon)}
        <label>Tag</label>${sel('tag', [['', 'All'], ...tags.map(t => [t, t])], F.tag)}
        <div class="row"><div class="grow"><label>Min price</label><input name="min" type="number" min="0" step="0.01" value="${esc(F.min)}"></div><div class="grow"><label>Max price</label><input name="max" type="number" min="0" step="0.01" value="${esc(F.max)}"></div></div>
        <label><input type="checkbox" name="urgent" ${F.urgent ? 'checked' : ''} style="width:auto;min-height:0"> Urgent: deadline within 14 days</label>
        <label><input type="checkbox" name="dropOnly" ${F.dropOnly ? 'checked' : ''} style="width:auto;min-height:0"> Price dropped (last two recorded prices)</label>
        <label><input type="checkbox" name="atTarget" ${F.atTarget ? 'checked' : ''} style="width:auto;min-height:0"> At or below desired price</label>
        <div class="row" style="margin-top:10px"><button type="button" class="btn sec sm" data-act="savefilter">Save this filter</button><button type="button" class="btn sec sm" data-act="resetfilter">Reset</button></div>
        ${S.savedFilters.length ? `<label>Saved filters</label><div>${S.savedFilters.map(f => `<span class="chip info"><a href="#" data-act="loadfilter" data-id="${f.id}" style="color:inherit">${esc(f.name)}</a> <a href="#" data-act="delfilter" data-id="${f.id}" aria-label="Delete saved filter" style="color:inherit">✕</a></span>`).join('')}</div>` : ''}
      </details></form>
      <div class="muted" style="margin:10px 0">${list.length} item${list.length === 1 ? '' : 's'}</div>
      ${list.length ? `<div class="grid">${list.map(pcard).join('')}</div>` : `<div class="empty">${S.products.length ? 'No items match these filters.' : 'Your wishlist is empty.<br>Tap ＋ to add your first product.'}</div>`}`;
  }

  function vCategories() {
    return `<form data-form="addcat" class="row"><input class="grow" name="name" placeholder="New category name" maxlength="40" aria-label="New category" required><button class="btn">Add</button></form><div style="margin-top:12px">
      ${S.categories.map((c, i) => `<div class="card row"><div class="grow"><b>${esc(c.name)}</b><div class="muted">${S.products.filter(p => (p.categoryIds || []).includes(c.id)).length} products</div></div>
      <button class="btn sec sm" data-act="catup" data-id="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button><button class="btn sec sm" data-act="catdown" data-id="${c.id}" ${i === S.categories.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
      <button class="btn sec sm" data-act="catren" data-id="${c.id}">Rename</button><button class="btn danger sm" data-act="catdel" data-id="${c.id}">Delete</button></div>`).join('') || '<div class="empty">No categories. Add one above.</div>'}</div>`;
  }

  function vTracker() {
    const mon = S.products.filter(p => !p.purchased && p.monitor && (p.monitor.enabled || p.monitor.everEnabled));
    const un = S.products.filter(p => !p.purchased && !(p.monitor && (p.monitor.enabled || p.monitor.everEnabled)));
    const row = p => { const i = priceInfo(p), st = statusOf(p), m = p.monitor;
      return `<div class="card"><div class="row"><div class="grow" data-act="open" data-id="${p.id}" style="cursor:pointer"><b>${esc(p.name)}</b><div class="muted">${esc(p.store || '')} · ${(m.mode || defaultMode(p)) === 'auto' ? 'Automatic' : 'Manual'} · ${FREQS[m.freq || 'daily'].label}</div>${chip(st)}</div><div class="price">${money(i.latest)}</div></div>
      <div class="muted" style="font-size:.85rem;margin-top:6px">Last successful check: ${fmtDT(m.lastOkAt || (i.latestT))}${m.lastError && st.key === 'failed' ? `<br><span class="err">Last error: ${esc(m.lastError)}</span>` : ''}</div>
      <div class="row" style="margin-top:8px"><button class="btn sec sm" data-act="recprice" data-id="${p.id}">Record price (manual)</button><button class="btn sec sm" data-act="monitor" data-id="${p.id}">Settings</button><button class="btn sec sm" data-act="simalert" data-id="${p.id}">Test alert</button></div></div>`; };
    return `<div class="card"><div class="row"><div class="grow"><b>Automatic price check results</b><div class="muted" style="font-size:.85rem">${S.settings.lastSync ? 'Last loaded: ' + fmtDT(S.settings.lastSync) + '<br>' + esc(S.settings.lastSyncMsg) : 'Not loaded yet. Needs the free GitHub setup (see README).'}</div></div><button class="btn" data-act="sync">Load results</button></div></div>
      <div class="notice">Prices are only recorded when a real check succeeds or you enter one yourself. Failed checks never change the price.</div>
      <h2>Monitored (${mon.length})</h2>${mon.map(row).join('') || '<div class="muted">Nothing monitored yet. Open a product and tap “Price monitoring”.</div>'}
      <h2>Retailer support</h2><div class="card"><table><tr><th>Store</th><th>Method</th></tr>${RETAILERS.filter(r => r.domain).map(r => `<tr><td>${esc(r.name)}</td><td>${r.auto === 'best' ? 'Automatic (best effort, may be blocked)' : 'Manual / external alert'}</td></tr>`).join('')}<tr><td>Other stores</td><td>Automatic if page has standard price data; else manual</td></tr></table></div>
      ${un.length ? `<h2>Not monitored (${un.length})</h2>${un.slice(0, 30).map(p => `<div class="card row"><div class="grow">${esc(p.name)}</div><button class="btn sec sm" data-act="monitor" data-id="${p.id}">Monitor</button></div>`).join('')}` : ''}`;
  }

  function vSettings() {
    const th = S.settings.theme;
    return `<div class="card"><b>Theme</b><select data-act="theme" aria-label="Theme"><option value="auto" ${th === 'auto' ? 'selected' : ''}>Match device</option><option value="light" ${th === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${th === 'dark' ? 'selected' : ''}>Dark</option></select></div>
    <div class="card"><b>Backup & restore</b><p class="muted">Your data is stored on <b>this device and browser only</b>. It does not sync to other devices. Export a backup regularly.</p>
      <div class="row"><button class="btn" data-act="exportjson">Export backup (JSON)</button><button class="btn sec" data-act="exportcsv">Export CSV</button><button class="btn sec" data-act="importjson">Import backup</button></div><input type="file" id="importfile" accept="application/json,.json" hidden></div>
    <div class="card"><b>Notifications</b><p class="muted">Browser notifications work while the app can run in the background. For phone alerts when the app is closed, use the free ntfy setup in the README.</p>
      <p>Status: <b>${'Notification' in window ? Notification.permission : 'not supported'}</b></p><button class="btn sec" data-act="notifperm">Allow browser notifications</button></div>
    <div class="card"><b>Automatic price checks</b><p class="muted">Checks run on GitHub’s free servers, not on your phone. Export the list of products to check, upload it to your repository, then press “Load results” on the Tracker screen.</p>
      <div class="row"><button class="btn sec" data-act="exportwatch">Export watch.json</button></div>
      <label>Results URL</label><input data-act="pricesurl" value="${esc(S.settings.pricesUrl)}" placeholder="prices.json"><p class="muted">Leave as prices.json when the app is hosted in the same repository.</p></div>
    <div class="card"><b>Search stores</b><p class="muted">Opens each store’s own search page. These are links, not in-app search results.</p>
      <form data-form="storesearch"><input name="q" placeholder="Product or keywords" required><div class="row" style="margin-top:8px"><button class="btn grow">Search stores</button></div></form></div>
    <div class="card"><b>Danger zone</b><div class="row"><button class="btn danger" data-act="wipe">Delete all data</button></div></div>
    <p class="muted" style="text-align:center">Smart Wishlist Canada · free, no ads, no accounts</p>`;
  }

  function render() {
    const titles = { home: 'Smart Wishlist Canada', wishlist: 'Wishlist', categories: 'Categories', tracker: 'Price Tracker', settings: 'Settings' };
    $('#title').textContent = titles[route] || '';
    document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === route));
    const un = S.alerts.filter(a => !a.seen).length; const b = $('#alert-badge'); b.hidden = !un; b.textContent = un;
    const keepScroll = window.scrollY;
    view.innerHTML = ({ home: vHome, wishlist: vWishlist, categories: vCategories, tracker: vTracker, settings: vSettings }[route] || vHome)();
    window.scrollTo(0, keepScroll);
  }
  const go = r => { location.hash = '#/' + r; };
  window.addEventListener('hashchange', () => { route = (location.hash.replace('#/', '') || 'home').split('?')[0]; if (!['home', 'wishlist', 'categories', 'tracker', 'settings'].includes(route)) route = 'home'; closeModals(); render(); window.scrollTo(0, 0); });

  // ----- Product form -----
  function productForm(p, prefill = {}) {
    const isNew = !p; p = p || { priority: 3, categoryIds: [], tags: [], images: [], ...prefill };
    const el = modal(`<h2>${isNew ? 'Add product' : 'Edit product'}</h2><form data-form="product" data-id="${p.id || ''}">
      <label>Product name *</label><input name="name" required maxlength="200" value="${esc(p.name || '')}" autofocus>
      <label>Priority</label><div class="star-input" data-stars="${p.priority}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-act="setstar" data-v="${n}" class="${n <= p.priority ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div><div class="muted" id="starlabel">${PRIORITY_LABELS[p.priority]}</div><input type="hidden" name="priority" value="${p.priority}">
      <label>Current price (CAD)</label><input name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${p.price ?? ''}">
      <details ${isNew ? '' : 'open'} style="margin-top:12px"><summary><b>More details</b> (optional)</summary>
      <label>Product page link</label><input name="url" type="url" inputmode="url" placeholder="https://…" value="${esc(p.url || '')}"><div class="muted" style="font-size:.8rem">Paste a link: the store and a name suggestion are filled in. Prices are never guessed.</div>
      <label>Store / retailer</label><input name="store" list="storelist" value="${esc(p.store || '')}"><datalist id="storelist">${RETAILERS.filter(r => r.domain).map(r => `<option value="${esc(r.name)}">`).join('')}</datalist>
      <div class="row"><div class="grow"><label>Regular / list price</label><input name="regularPrice" type="number" step="0.01" min="0" inputmode="decimal" value="${p.regularPrice ?? ''}"></div><div class="grow"><label>Desired price</label><input name="desired" type="number" step="0.01" min="0" inputmode="decimal" value="${p.desired ?? ''}"></div></div>
      <label>Categories</label><div>${S.categories.map(c => `<label style="display:inline-block;margin:2px 10px 2px 0;font-weight:400"><input type="checkbox" name="cat" value="${c.id}" ${(p.categoryIds || []).includes(c.id) ? 'checked' : ''} style="width:auto;min-height:0"> ${esc(c.name)}</label>`).join('') || '<span class="muted">Create categories first.</span>'}</div>
      <label>Tags (comma separated)</label><input name="tags" value="${esc((p.tags || []).join(', '))}">
      <label>Purchase deadline</label><input name="deadline" type="date" value="${esc(p.deadline || '')}">
      <label>Notes / description</label><textarea name="notes">${esc(p.notes || '')}</textarea>
      <label>Photos</label><div class="gallery" id="imgprev">${(p.images || []).map((s, i) => `<div><img src="${esc(s)}" alt="" ${PH}><br><button type="button" class="btn sec sm" data-act="rmimg" data-i="${i}">Remove</button></div>`).join('')}</div>
      <div class="row" style="margin-top:6px"><button type="button" class="btn sec sm" data-act="pickimg">📷 Add from phone</button></div><input type="file" id="imgfile" accept="image/*" multiple hidden>
      <div class="row" style="margin-top:6px"><input class="grow" id="imgurl" type="url" placeholder="…or image URL"><button type="button" class="btn sec sm" data-act="addimgurl">Add</button></div></details>
      <div class="err" id="formerr" role="alert"></div>
      <div class="row" style="margin-top:14px"><button type="button" class="btn sec grow" data-act="closemodal">Cancel</button><button class="btn grow">Save</button></div></form>`);
    el._images = [...(p.images || [])]; return el;
  }
  function refreshImgs(el) { $('#imgprev', el).innerHTML = el._images.map((s, i) => `<div><img src="${esc(s)}" alt="" ${PH}><br><button type="button" class="btn sec sm" data-act="rmimg" data-i="${i}">Remove</button></div>`).join(''); }
  function resizeImage(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => { const im = new Image(); im.onerror = rej; im.onload = () => {
      const k = Math.min(1, 700 / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.8)); }; im.src = r.result; }; r.readAsDataURL(file); });
  }

  function submitProduct(form) {
    const el = form.closest('.modal'); const fd = new FormData(form); const err = m => { $('#formerr', el).textContent = m; };
    const name = String(fd.get('name') || '').trim(); if (!name) return err('Please enter a product name.');
    const url = String(fd.get('url') || '').trim(); if (url && !isHttp(url)) return err('The product link must start with http:// or https://');
    for (const k of ['price', 'regularPrice', 'desired']) { const v = fd.get(k); if (v !== '' && v != null && (isNaN(Number(v)) || Number(v) < 0)) return err('Prices must be zero or more.'); }
    const id = form.dataset.id; const old = id ? S.products.find(p => p.id === id) : null;
    const data = { name, url, store: String(fd.get('store') || '').trim() || (url ? detectStore(url) : ''), priority: Number(fd.get('priority')) || 3, price: numOrNull(fd.get('price')), regularPrice: numOrNull(fd.get('regularPrice')), desired: numOrNull(fd.get('desired')),
      categoryIds: fd.getAll('cat'), tags: String(fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean), deadline: String(fd.get('deadline') || ''), notes: String(fd.get('notes') || ''), images: el._images };
    let p;
    if (old) { p = Object.assign(old, data); } else { p = normalizeProduct({ ...data, added: Date.now(), history: [] }); S.products.push(p); }
    const i = priceInfo(p);
    if (data.price != null && data.price !== i.latest) { const al = addObservation(S, p, data.price, 'manual'); notifyNew(al); }
    save(); el.remove(); render(); toast(old ? 'Saved' : 'Added to wishlist');
  }

  // ----- Detail -----
  function chart(p) {
    const h = priceInfo(p).h; if (h.length < 2) return '<div class="muted">The chart appears after two or more recorded prices.</div>';
    const W = 300, H = 120, pad = 8, ps = h.map(x => x.price), mn = Math.min(...ps), mx = Math.max(...ps), t0 = h[0].t, t1 = h[h.length - 1].t;
    const X = t => pad + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - 2 * pad), Y = v => H - pad - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (H - 2 * pad);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price history"><polyline fill="none" stroke="var(--brand)" stroke-width="2" points="${h.map(x => X(x.t) + ',' + Y(x.price)).join(' ')}"/>${h.map(x => `<circle cx="${X(x.t)}" cy="${Y(x.price)}" r="3.5" fill="${x.source === 'auto' ? 'var(--brand)' : 'var(--accent)'}"/>`).join('')}</svg>
      <div class="muted" style="font-size:.8rem">● green = automatic check, ● orange = entered by you</div>`;
  }
  function detail(id) {
    const p = S.products.find(x => x.id === id); if (!p) return; const i = priceInfo(p), st = statusOf(p);
    const el = modal(`<div class="row"><h2 class="grow" style="margin:0">${esc(p.name)}</h2><button class="icon-btn" data-act="closemodal" aria-label="Close">✕</button></div>
      ${p.images.length ? `<div class="gallery" style="margin:10px 0">${p.images.map(s => `<img src="${esc(s)}" alt="" ${PH}>`).join('')}</div>` : ''}
      ${stars(p.priority)} <span class="muted">${PRIORITY_LABELS[p.priority]}</span>
      <div class="price" style="font-size:1.6rem">${money(p.price)}</div>${chip(st)}${p.purchased ? `<span class="chip info">Bought ${fmtD(p.purchasedAt)}</span>` : ''}
      <div class="muted">${esc(p.store || 'No store')} · Added ${fmtD(p.added)}${p.deadline ? ' · Deadline ' + esc(p.deadline) : ''}</div>
      <div class="card" style="margin-top:10px"><table>
        <tr><td>Desired price</td><td>${money(p.desired)}</td></tr><tr><td>Advertised regular price</td><td>${money(p.regularPrice)} <span class="muted">(as entered)</span></td></tr>
        <tr><td>Latest recorded</td><td>${money(i.latest)} ${i.latestT ? '<span class="muted">' + fmtDT(i.latestT) + '</span>' : ''}</td></tr><tr><td>Previous recorded</td><td>${money(i.prev)}</td></tr>
        <tr><td>Lowest recorded</td><td>${money(i.min)}</td></tr><tr><td>Highest recorded</td><td>${money(i.max)}</td></tr>
        <tr><td>Change</td><td>${i.change == null ? '—' : (i.change > 0 ? '+' : '') + money(i.change) + ' (' + i.pct.toFixed(1) + '%)'}</td></tr>
        <tr><td>Last check</td><td>${fmtDT(p.monitor && p.monitor.lastOkAt || i.latestT)}</td></tr></table>
        <div class="muted" style="font-size:.8rem;margin-top:6px">Based on ${i.count} price${i.count === 1 ? '' : 's'} recorded in this app since you started tracking. This is not a store-wide historical low.</div></div>
      ${p.notes ? `<div class="card"><b>Notes</b><div style="white-space:pre-wrap">${esc(p.notes)}</div></div>` : ''}
      ${(p.tags || []).length ? `<div>${p.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
      ${(p.categoryIds || []).length ? `<div>${p.categoryIds.map(c => `<span class="chip info">${esc(catName(c))}</span>`).join('')}</div>` : ''}
      <h2>Price history</h2>${chart(p)}
      <div class="row" style="margin-top:12px">${isHttp(p.url) ? `<a class="btn grow" style="text-decoration:none;display:flex;align-items:center;justify-content:center" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Open store page</a>` : `<button class="btn sec grow" data-act="editp" data-id="${p.id}">Add store link</button>`}
        <button class="btn sec grow" data-act="recprice" data-id="${p.id}">Record price</button></div>
      <div class="row" style="margin-top:8px"><button class="btn sec grow" data-act="monitor" data-id="${p.id}">Price monitoring</button><button class="btn sec grow" data-act="editp" data-id="${p.id}">Edit</button></div>
      <div class="row" style="margin-top:8px"><button class="btn sec grow" data-act="dup" data-id="${p.id}">Duplicate</button><button class="btn sec grow" data-act="buy" data-id="${p.id}">${p.purchased ? 'Restore to wishlist' : 'Mark purchased'}</button><button class="btn danger grow" data-act="delp" data-id="${p.id}">Delete</button></div>`);
    return el;
  }

  function recordPriceDlg(id) {
    const p = S.products.find(x => x.id === id);
    const el = modal(`<h2>Record price</h2><p class="muted">${esc(p.name)}. This is saved as a manual entry.</p><form data-form="recprice" data-id="${id}"><label>Price seen (CAD)</label><input name="price" type="number" step="0.01" min="0" inputmode="decimal" required autofocus><label>Store (optional)</label><input name="store" value="${esc(p.store || '')}"><div class="err" id="formerr"></div><div class="row" style="margin-top:12px"><button type="button" class="btn sec grow" data-act="closetop">Cancel</button><button class="btn grow">Save</button></div></form>`);
  }

  function monitorDlg(id) {
    const p = S.products.find(x => x.id === id); const m = p.monitor || {}; const r = retailerFor(p.store || p.url);
    const mode = m.mode || defaultMode(p);
    modal(`<h2>Price monitoring</h2><div class="muted">${esc(p.name)}</div>
      ${r && r.auto === 'manual' ? `<div class="notice">${esc(r.name)}: no authorized automatic check. ${esc(r.note || '')}</div>` : ''}
      <form data-form="monitor" data-id="${id}">
      <label><input type="checkbox" name="enabled" ${m.enabled ? 'checked' : ''} style="width:auto;min-height:0"> Monitor this product</label>
      <label>Method</label><select name="mode"><option value="auto" ${mode === 'auto' ? 'selected' : ''}>Automatic (needs free GitHub setup)</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>Manual (I will enter prices)</option></select>
      <label>Check frequency (automatic only)</label><select name="freq">${Object.entries(FREQS).map(([k, v]) => `<option value="${k}" ${(m.freq || 'daily') === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <label>Desired purchase price (CAD)</label><input name="desired" type="number" step="0.01" min="0" value="${p.desired ?? ''}">
      <label><input type="checkbox" name="notifyTarget" ${m.notifyTarget !== false ? 'checked' : ''} style="width:auto;min-height:0"> Alert when target price is reached</label>
      <label><input type="checkbox" name="notifyAnyDrop" ${m.notifyAnyDrop ? 'checked' : ''} style="width:auto;min-height:0"> Alert on any price drop</label>
      <label>…only if the drop is at least (CAD)</label><input name="dropThreshold" type="number" step="0.01" min="0" value="${m.dropThreshold || ''}" placeholder="0">
      <label>Alert when this % below advertised regular price (blank = off)</label><input name="notifyDiscountPct" type="number" min="1" max="95" value="${m.notifyDiscountPct || ''}">
      <label>Additional retailers, one per line: Store | link</label><textarea name="extra" placeholder="Walmart.ca | https://…">${esc((m.extra || []).map(e => e.store + ' | ' + e.url).join('\n'))}</textarea>
      <div class="muted" style="font-size:.8rem">Preferred retailer is the store on the product. Automatic mode uses the lowest successfully read price across all links.</div>
      <div class="err" id="formerr"></div><div class="row" style="margin-top:12px"><button type="button" class="btn sec grow" data-act="closetop">Cancel</button><button class="btn grow">Save</button></div></form>`);
  }

  function notifyNew(alerts) {
    alerts.forEach(a => {
      toast(`🔔 ${a.name}: ${a.msg}`);
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(a.name, { body: `${a.msg}. Now ${money(a.now)}` + (a.prev != null ? ` (was ${money(a.prev)})` : ''), icon: 'icon.svg' }); } catch { /* ignore */ }
    });
  }

  function alertsDlg() {
    S.alerts.forEach(a => a.seen = true); save(); render();
    modal(`<div class="row"><h2 class="grow" style="margin:0">Alerts</h2><button class="icon-btn" data-act="closemodal">✕</button></div>
      ${S.alerts.length ? S.alerts.slice(0, 100).map(a => `<div class="card"><b>${esc(a.name)}</b> ${a.simulated ? '<span class="chip warn">SIMULATED TEST — not real data</span>' : ''}<div>${esc(a.msg)}</div>
      <div class="muted">${esc(a.store || '')} · ${a.prev != null ? 'was ' + money(a.prev) + ' → ' : ''}now ${money(a.now)} · ${fmtDT(a.t)}</div>${isHttp(a.url) ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open product page</a>` : ''}</div>`).join('') : '<div class="empty">No alerts yet.</div>'}
      ${S.alerts.length ? '<button class="btn sec" data-act="clearalerts">Clear all alerts</button>' : ''}`);
  }

  // ----- Sync with automatic results -----
  async function syncPrices() {
    const url = (S.settings.pricesUrl || 'prices.json').trim();
    let data;
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(url + sep + 't=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
    } catch (e) {
      S.settings.lastSync = Date.now(); S.settings.lastSyncMsg = 'Could not load results: ' + e.message + '. Nothing was changed.'; save(); render(); return toast('Could not load automatic results. No prices were changed.');
    }
    let upd = 0, fail = 0, newAlerts = [];
    for (const [id, r] of Object.entries(data.results || {})) {
      const p = S.products.find(x => x.id === id); if (!p || !p.monitor || !p.monitor.enabled) continue;
      const t = Date.parse(r.checkedAt) || Date.now(); const m = p.monitor;
      if (t <= Math.max(m.lastOkAt || 0, m.lastFailAt || 0)) continue;
      if (r.ok && typeof r.price === 'number' && r.price > 0) {
        const al = addObservation(S, p, r.price, 'auto', t, r.store); newAlerts.push(...al);
        if (typeof r.regular === 'number' && r.regular > r.price && !p.regularPrice) p.regularPrice = r.regular;
        m.lastOkAt = t; m.lastError = ''; upd++;
      } else { m.lastError = r.error || 'Unknown error'; m.lastFailAt = t; fail++; }
    }
    S.settings.lastSync = Date.now();
    S.settings.lastSyncMsg = `Results generated ${data.generated ? fmtDT(Date.parse(data.generated)) : '(unknown time)'}. New prices: ${upd}. Failed checks: ${fail}.`;
    save(); render(); notifyNew(newAlerts); toast(`${upd} new price${upd === 1 ? '' : 's'}, ${fail} failed`);
  }

  // ----- Downloads -----
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ----- Events -----
  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) return; const act = a.dataset.act, id = a.dataset.id; const top = e.target.closest('.modal');
    if (a.tagName === 'SELECT' || a.tagName === 'INPUT') return;
    if (a.tagName === 'A' && a.getAttribute('href') === '#') e.preventDefault();
    const P = () => S.products.find(p => p.id === id);
    switch (act) {
      case 'open': detail(id); break;
      case 'closemodal': closeModals(); break;
      case 'closetop': top.remove(); break;
      case 'catgo': F = { ...defaultFilters(), cat: id }; break;
      case 'setstar': { const box = a.parentElement, v = Number(a.dataset.v); box.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i < v)); $('[name=priority]', top).value = v; $('#starlabel', top).textContent = PRIORITY_LABELS[v]; break; }
      case 'pickimg': $('#imgfile', top).click(); break;
      case 'addimgurl': { const u = $('#imgurl', top).value.trim(); if (!isHttp(u)) return toast('Enter a valid image link starting with http(s)://'); top._images.push(u); $('#imgurl', top).value = ''; refreshImgs(top); break; }
      case 'rmimg': top._images.splice(Number(a.dataset.i), 1); refreshImgs(top); break;
      case 'editp': closeModals(); productForm(P()); break;
      case 'dup': { const p = P(); const c = normalizeProduct({ ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + ' (copy)', added: Date.now(), purchased: false, purchasedAt: null, history: [], monitor: { enabled: false } }); if (c.price != null) c.history.push({ t: Date.now(), price: c.price, source: 'manual', store: c.store }); S.products.push(c); save(); closeModals(); render(); toast('Duplicated'); break; }
      case 'buy': { const p = P(); p.purchased = !p.purchased; p.purchasedAt = p.purchased ? Date.now() : null; save(); closeModals(); render(); toast(p.purchased ? 'Marked as purchased' : 'Restored to wishlist'); break; }
      case 'delp': if (await confirmDlg('Delete product?', `“${P().name}” and its price history will be permanently deleted. Export a backup first if unsure.`, 'Delete', true)) { S.products = S.products.filter(p => p.id !== id); save(); closeModals(); render(); toast('Deleted'); } break;
      case 'recprice': recordPriceDlg(id); break;
      case 'monitor': monitorDlg(id); break;
      case 'simalert': { const p = P(); S.alerts.unshift({ id: uid(), t: Date.now(), productId: p.id, name: p.name, store: p.store, prev: null, now: p.price, url: p.url, kind: 'test', msg: 'Simulated alert for testing', seen: false, simulated: true }); save(); render(); toast('🔔 Simulated alert created (test only)'); break; }
      case 'sync': a.disabled = true; await syncPrices(); break;
      case 'savefilter': { const n = prompt('Name this filter:'); if (n && n.trim()) { S.savedFilters.push({ id: uid(), name: n.trim().slice(0, 30), f: { ...F } }); save(); render(); } break; }
      case 'loadfilter': F = { ...defaultFilters(), ...S.savedFilters.find(f => f.id === id).f }; render(); break;
      case 'delfilter': S.savedFilters = S.savedFilters.filter(f => f.id !== id); save(); render(); break;
      case 'resetfilter': F = defaultFilters(); render(); break;
      case 'catren': { const c = S.categories.find(x => x.id === id); const n = prompt('Rename category:', c.name); if (n && n.trim()) { c.name = n.trim().slice(0, 40); save(); render(); toast('Renamed'); } break; }
      case 'catup': case 'catdown': { const i = S.categories.findIndex(c => c.id === id), j = act === 'catup' ? i - 1 : i + 1; if (S.categories[j]) { [S.categories[i], S.categories[j]] = [S.categories[j], S.categories[i]]; save(); render(); } break; }
      case 'catdel': { const c = S.categories.find(x => x.id === id), n = S.products.filter(p => (p.categoryIds || []).includes(id)).length; if (await confirmDlg('Delete category?', `“${c.name}” will be deleted.${n ? ` ${n} product(s) will keep existing but lose this category.` : ''}`, 'Delete', true)) { S.categories = S.categories.filter(x => x.id !== id); S.products.forEach(p => p.categoryIds = (p.categoryIds || []).filter(x => x !== id)); save(); render(); } break; }
      case 'exportjson': download(`wishlist-backup-${stamp()}.json`, JSON.stringify({ app: 'smart-wishlist-canada', version: 1, exported: new Date().toISOString(), data: S }), 'application/json'); toast('Backup downloaded'); break;
      case 'exportcsv': download(`wishlist-${stamp()}.csv`, '\ufeff' + toCSV(S), 'text/csv'); break;
      case 'exportwatch': { const w = watchFile(S); if (!w.products.length) return toast('No products are set to automatic monitoring with a store link.'); download('watch.json', JSON.stringify(w, null, 2), 'application/json'); toast(`watch.json has ${w.products.length} product(s)`); break; }
      case 'importjson': $('#importfile').click(); break;
      case 'notifperm': if (!('Notification' in window)) return toast('Not supported in this browser'); toast('Permission: ' + await Notification.requestPermission()); render(); break;
      case 'wipe': if (await confirmDlg('Delete ALL data?', 'This permanently deletes every product, category, price history and alert on this device. This cannot be undone.', 'Delete everything', true) && await confirmDlg('Are you absolutely sure?', 'Last chance. Have you exported a backup?', 'Yes, delete', true)) { S = freshState(); save(); render(); toast('All data deleted'); } break;
      case 'clearalerts': if (await confirmDlg('Clear alerts?', 'Alert history will be removed (prices are kept).', 'Clear', true)) { S.alerts = []; save(); closeModals(); render(); } break;
    }
    if (act === 'catgo') { /* allow navigation via href */ }
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.act === 'open') { e.preventDefault(); detail(e.target.dataset.id); } });

  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'imgfile') { const el = t.closest('.modal'); for (const f of t.files) { try { el._images.push(await resizeImage(f)); } catch { toast('Could not read ' + f.name); } } t.value = ''; refreshImgs(el); }
    else if (t.id === 'importfile') { const f = t.files[0]; t.value = ''; if (f) importFile(f); }
    else if (t.dataset.act === 'theme') { S.settings.theme = t.value; save(); applyTheme(); }
    else if (t.closest('[data-form=filters]')) { readFilters(t.closest('form')); }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.act === 'pricesurl') { S.settings.pricesUrl = t.value; save(); }
    else if (t.name === 'q' && t.closest('[data-form=filters]')) { readFilters(t.closest('form'), true); }
    else if (t.name === 'url' && t.closest('[data-form=product]')) {
      const f = t.closest('form'); if (isHttp(t.value)) { const s = f.elements.store; if (!s.value) s.value = detectStore(t.value); const n = f.elements.name; if (!n.value) n.value = guessName(t.value); }
    }
  });
  function readFilters(form, keepFocus) {
    const fd = new FormData(form); const q = form.elements.q;
    F = { ...F, q: fd.get('q') || '', sort: fd.get('sort'), purchased: fd.get('purchased'), cat: fd.get('cat') || '', store: fd.get('store') || '', stars: Number(fd.get('stars')) || 0, mon: fd.get('mon') || '', tag: fd.get('tag') || '', min: fd.get('min') || '', max: fd.get('max') || '', urgent: fd.has('urgent'), dropOnly: fd.has('dropOnly'), atTarget: fd.has('atTarget') };
    const open = form.querySelector('details').open; const pos = q.selectionStart; render();
    const nf = $('[data-form=filters]'); if (open) nf.querySelector('details').open = true; if (keepFocus) { const nq = nf.elements.q; nq.focus(); nq.setSelectionRange(pos, pos); }
  }

  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); const k = f.dataset.form, fd = new FormData(f), id = f.dataset.id, top = f.closest('.modal');
    if (k === 'product') submitProduct(f);
    else if (k === 'homesearch') { F = { ...defaultFilters(), q: fd.get('q') || '', purchased: 'all' }; go('wishlist'); render(); }
    else if (k === 'addcat') { const n = String(fd.get('name')).trim(); if (!n) return; if (S.categories.some(c => c.name.toLowerCase() === n.toLowerCase())) return toast('That category already exists'); S.categories.push({ id: uid(), name: n }); save(); render(); toast('Category added'); }
    else if (k === 'recprice') { const v = Number(fd.get('price')); if (!(v >= 0) || fd.get('price') === '') return $('#formerr', top).textContent = 'Enter a valid price.'; const p = S.products.find(x => x.id === id); const al = addObservation(S, p, v, 'manual', Date.now(), String(fd.get('store') || '')); if (p.monitor && p.monitor.enabled) { p.monitor.lastOkAt = Date.now(); p.monitor.lastError = ''; } save(); closeModals(); render(); notifyNew(al); toast('Price recorded (manual)'); }
    else if (k === 'monitor') {
      const p = S.products.find(x => x.id === id); const extra = [];
      for (const line of String(fd.get('extra') || '').split('\n').map(l => l.trim()).filter(Boolean)) { const [s, ...u] = line.split('|'); const url = (u.join('|') || '').trim(); if (!isHttp(url)) return $('#formerr', top).textContent = `Extra retailer line needs “Store | https://link”: ${line}`; extra.push({ store: s.trim() || detectStore(url), url }); }
      const des = numOrNull(fd.get('desired')); if (fd.get('enabled') && fd.get('mode') === 'auto' && !isHttp(p.url)) return $('#formerr', top).textContent = 'Automatic monitoring needs a product page link. Add one in Edit, or choose Manual.';
      const was = p.monitor || {}; p.desired = des;
      p.monitor = { ...was, enabled: !!fd.get('enabled'), everEnabled: was.everEnabled || !!fd.get('enabled'), mode: fd.get('mode'), freq: fd.get('freq'), notifyTarget: fd.has('notifyTarget'), notifyAnyDrop: fd.has('notifyAnyDrop'), dropThreshold: numOrNull(fd.get('dropThreshold')) || 0, notifyDiscountPct: numOrNull(fd.get('notifyDiscountPct')), extra };
      save(); closeModals(); render(); toast(p.monitor.enabled ? (p.monitor.mode === 'auto' ? 'Saved. Export watch.json to start automatic checks.' : 'Saved. Remember to enter prices manually.') : 'Monitoring paused');
    }
    else if (k === 'storesearch') { const q = encodeURIComponent(String(fd.get('q')).trim()); modal(`<div class="row"><h2 class="grow" style="margin:0">Search stores</h2><button class="icon-btn" data-act="closemodal">✕</button></div><p class="muted">These open each store’s own search page in a new tab. They are links, not results shown inside this app. Store links can change.</p>${RETAILERS.map(r => `<a class="btn sec" style="display:flex;margin:8px 0;text-decoration:none;align-items:center;justify-content:center" href="${esc(r.search + q)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`).join('')}<button class="btn grow" style="width:100%" data-act="addfromsearch">Found it? Add a product</button>`); }
  });
  $('#fab').addEventListener('click', () => productForm());
  $('#btn-alerts').addEventListener('click', alertsDlg);
  document.addEventListener('click', e => { if (e.target.dataset && e.target.dataset.act === 'addfromsearch') { closeModals(); productForm(); } });

  async function importFile(file) {
    let obj; try { obj = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON.'); }
    const d = obj && obj.data ? obj.data : obj; if (!d || !Array.isArray(d.products) || !Array.isArray(d.categories)) return toast('This does not look like a Smart Wishlist backup.');
    const el = modal(`<h2>Import backup</h2><p>Found ${d.products.length} products and ${d.categories.length} categories.</p><div class="row"><button class="btn grow" data-x="merge">Merge with current data</button><button class="btn danger grow" data-x="replace">Replace everything</button></div><button class="btn sec" style="width:100%;margin-top:8px" data-x="cancel">Cancel</button>`);
    el.addEventListener('click', async ev => { const x = ev.target.dataset.x; if (!x) return; el.remove(); if (x === 'cancel') return;
      if (x === 'replace' && !(await confirmDlg('Replace all data?', 'Your current wishlist will be overwritten by the backup.', 'Replace', true))) return;
      if (x === 'replace') { S = { ...freshState(), ...d, settings: { ...freshState().settings, ...(d.settings || {}) } }; S.products = d.products.map(normalizeProduct); S.alerts = d.alerts || []; S.savedFilters = d.savedFilters || []; }
      else { d.categories.forEach(c => { if (!S.categories.some(x => x.id === c.id)) S.categories.push(c); }); d.products.map(normalizeProduct).forEach(p => { const i = S.products.findIndex(x => x.id === p.id); if (i >= 0) S.products[i] = p; else S.products.push(p); }); }
      save(); applyTheme(); render(); toast('Backup imported'); });
  }

  function applyTheme() { const t = S.settings.theme; const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; $('meta[name=theme-color]').content = dark ? '#12303a' : '#0f766e'; }

  // ----- Boot -----
  (async function boot() {
    await idb.open(); const saved = await idb.get('state');
    if (saved) { S = { ...freshState(), ...saved }; S.products = (saved.products || []).map(normalizeProduct); S.settings = { ...freshState().settings, ...(saved.settings || {}) }; }
    else { S = freshState(); save(); }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    applyTheme();
    route = (location.hash.replace('#/', '') || 'home').split('?')[0]; if (!['home', 'wishlist', 'categories', 'tracker', 'settings'].includes(route)) route = 'home';
    render();
    const qs = new URLSearchParams(location.search);
    if (qs.has('url') || qs.has('text') || qs.has('title')) { // Android "Share" target
      const text = qs.get('text') || ''; const url = qs.get('url') || (text.match(/https?:\/\/\S+/) || [''])[0];
      productForm(null, { url, name: (qs.get('title') || text.replace(url, '').trim() || guessName(url)).slice(0, 200), store: url ? detectStore(url) : '' });
      history.replaceState(null, '', location.pathname + '#/home');
    }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
}

function freshState() {
  return { products: [], categories: DEFAULT_CATS.map(n => ({ id: uid(), name: n })), alerts: [], savedFilters: [], settings: { theme: 'auto', pricesUrl: 'prices.json', lastSync: null, lastSyncMsg: '' } };
}

if (typeof module !== 'undefined') module.exports = { priceInfo, statusOf, evalAlerts, addObservation, filterProducts, dashboardStats, toCSV, watchFile, normalizeProduct, defaultFilters, detectStore, guessName, retailerFor, defaultMode, FREQS };
