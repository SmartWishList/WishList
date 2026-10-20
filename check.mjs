// Scheduled price checker. Runs on GitHub Actions (free). Node 20+, no dependencies.
// Reads ../watch.json, writes ../prices.json. Never invents a price: on any problem it records an error instead.
import { readFile, writeFile } from 'node:fs/promises';

const FREQ_MS = { '12h': 11 * 3600e3, daily: 22 * 3600e3, weekly: 6.5 * 864e5 };
const UA = 'SmartWishlistCanada/1.0 (personal price tracker; contact: repo owner)';
const NTFY_TOPIC = process.env.NTFY_TOPIC || ''; // optional GitHub secret
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

// Stores that do not permit automated access (Amazon) or are known to block bots are never fetched.
const BLOCKED = ['amazon.ca', 'amazon.com', 'costco.ca', 'shein.com'];
const blocked = u => BLOCKED.some(d => new URL(u).hostname.endsWith(d));

const read = async (f, fallback) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return fallback; } };

// ---- extract price from schema.org JSON-LD (the standard, publisher-provided data) ----
export function extractPrice(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const offersOf = node => {
    const out = [];
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) return n.forEach(walk);
      const t = [].concat(n['@type'] || []);
      if (t.some(x => /Offer|AggregateOffer/.test(x))) out.push(n);
      Object.values(n).forEach(walk);
    };
    walk(node); return out;
  };
  for (const b of blocks) {
    let j; try { j = JSON.parse(b.trim()); } catch { continue; }
    for (const o of offersOf(j)) {
      const cur = o.priceCurrency || (o.priceSpecification && o.priceSpecification.priceCurrency);
      const raw = o.price ?? o.lowPrice ?? (o.priceSpecification && o.priceSpecification.price);
      const price = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
      if (!isFinite(price) || price <= 0) continue;
      if (cur && cur !== 'CAD') continue; // only Canadian dollars
      return { price: Math.round(price * 100) / 100 };
    }
  }
  return null;
}

async function fetchOne(url) {
  if (blocked(url)) return { ok: false, error: 'Automatic checking is not supported for this store (manual or external alert only).' };
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-CA' }, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(to);
    if (res.status === 403 || res.status === 429 || res.status === 503) return { ok: false, error: `Store refused automated access (HTTP ${res.status}). Not bypassed.` };
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const html = await res.text();
    if (/captcha|are you a robot|access denied/i.test(html.slice(0, 5000)) && !/ld\+json/.test(html)) return { ok: false, error: 'Store showed a bot check. Not bypassed.' };
    const r = extractPrice(html);
    return r ? { ok: true, price: r.price } : { ok: false, error: 'No price found in page data (store may load prices with scripts).' };
  } catch (e) { return { ok: false, error: 'Request failed: ' + (e.name === 'AbortError' ? 'timeout' : e.message) }; }
}

async function notify(title, body, click) {
  if (!NTFY_TOPIC) return;
  try { await fetch(`${NTFY_SERVER}/${encodeURIComponent(NTFY_TOPIC)}`, { method: 'POST', body, headers: { Title: title, ...(click ? { Click: click } : {}), Tags: 'moneybag' } }); }
  catch (e) { console.warn('ntfy failed:', e.message); }
}

async function main() {
  const watch = await read(new URL('../watch.json', import.meta.url), { products: [] });
  const prev = await read(new URL('../prices.json', import.meta.url), { results: {} });
  const out = { generated: new Date().toISOString(), results: { ...prev.results } };
  const now = Date.now();
  let checked = 0;
  for (const p of watch.products || []) {
    const last = prev.results[p.id];
    const lastT = last ? Date.parse(last.checkedAt) : 0;
    if (now - lastT < (FREQ_MS[p.freq] || FREQ_MS.daily)) continue; // not due yet
    const targets = [{ store: p.store, url: p.url }, ...(p.extra || [])].filter(t => t.url);
    const offers = [];
    for (const t of targets) { offers.push({ store: t.store, url: t.url, ...(await fetchOne(t.url)) }); await new Promise(r => setTimeout(r, 2500)); }
    const good = offers.filter(o => o.ok).sort((a, b) => a.price - b.price);
    checked++;
    if (good.length) {
      const best = good[0]; const prevPrice = last && last.ok ? last.price : null;
      out.results[p.id] = { ok: true, price: best.price, store: best.store, url: best.url, checkedAt: new Date().toISOString(), offers };
      const reasons = [];
      if (p.notifyTarget && p.desired != null && best.price <= p.desired && (prevPrice == null || prevPrice > p.desired)) reasons.push(`reached your target of $${p.desired}`);
      if (p.notifyAnyDrop && prevPrice != null && prevPrice - best.price > (p.dropThreshold || 0)) reasons.push(`dropped from $${prevPrice} to $${best.price}`);
      if (p.notifyDiscountPct && p.regularPrice && best.price <= p.regularPrice * (1 - p.notifyDiscountPct / 100) && !(prevPrice != null && prevPrice <= p.regularPrice * (1 - p.notifyDiscountPct / 100))) reasons.push(`is ${p.notifyDiscountPct}%+ below the advertised regular price`);
      if (reasons.length) await notify(`Price alert: ${p.name}`, `${best.store}: $${best.price} ${reasons.join('; ')}`, best.url);
    } else {
      // Keep the last known good price record for history, but mark this check as failed. No price is invented.
      out.results[p.id] = { ok: false, error: offers.map(o => `${o.store}: ${o.error}`).join(' | ').slice(0, 400), checkedAt: new Date().toISOString(), offers };
    }
  }
  await writeFile(new URL('../prices.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
  console.log(`Checked ${checked} product(s); ${(watch.products || []).length} in watch list.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
