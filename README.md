# Smart Wishlist Canada

A free, installable wishlist app for your Android phone (also works on tablets and desktop browsers). No ads, no accounts, no paid services.

## What works right away (no setup)
- Add, edit, duplicate, delete (with confirmation), mark purchased and restore products. Only the name is required.
- Photos from your phone or an image link, notes, tags, deadlines, multiple categories.
- Your own categories: add, rename, reorder, delete.
- 1 to 5 star priority on every card, sorting by priority and 7 other sort orders.
- Search (names, notes, tags, stores, categories) and filters (category, store, stars, price range, urgency, monitoring status, purchased, price drop, at target price). Saved filters.
- Dashboard, price history chart, manual price recording, in-app alert history, light/dark theme.
- Backup: export JSON or CSV, import (merge or replace).
- Works offline once installed. Android "Share" menu can send a store link straight into the app.
- Store search: opens each store's own search page (links only; these are **not** in-app search results).

## Storage: read this
Your data lives **on the phone/browser where you use it** (IndexedDB). It does not sync between devices. Clearing browser data deletes it. Use Settings, then Export backup regularly.

## Install on your Android phone (free)
1. Create a free GitHub account (no credit card): https://github.com/signup
2. Create a **public** repository (for example `wishlist`) and upload every file in this folder, keeping the folder structure (including `.github/workflows` and `checker`).
3. In the repository: Settings, then Pages, then deploy from branch `main`, folder `/ (root)`. After a minute your app is at `https://YOUR-NAME.github.io/wishlist/`.
4. Open that address in Chrome on your phone, tap the menu (three dots), then **Install app** / **Add to Home screen**.

You can also try it without installing anything: open `index.html` through any local web server (for example `python3 -m http.server`).

## Automatic price checks (needs setup, limited)
Phones cannot reliably run background price checks, so checks run on GitHub's free servers (GitHub Actions; free for public repositories, no card needed).

1. In the app, open a product, Price monitoring, turn it on, method **Automatic**, set your target and alerts. The product needs a store link.
2. Settings, **Export watch.json**. In your GitHub repository, upload it over the existing `watch.json`.
3. The check runs automatically (about twice a day) and whenever you upload a new `watch.json`. You can also run it from the repository's Actions tab.
4. In the app, Tracker, **Load results**. New prices are added to history and alerts are created.

Honest limits:
- GitHub scheduled runs can be delayed, and GitHub may pause schedules on repositories with no activity for 60 days. The app shows **"Automatic checks overdue"** if results stop arriving. It does not claim monitoring is active.
- A product shows **"Waiting for first automatic check"** until a real result has been loaded.
- A failed check shows **Check failed** with the reason. No price is ever guessed, and the last real price is kept.
- Automatic checking reads the standard price data (schema.org) that a store publishes in its product page, Canadian dollars only. It does not log in, solve CAPTCHAs or bypass blocks.

### Retailer support
| Store | Method |
|---|---|
| BestBuy.ca, CanadianTire.ca, Walmart.ca, HomeDepot.ca, RONA.ca | Automatic, **best effort**. These stores may block bots or load prices with scripts. I could not test against live stores, so treat these as unverified until your first result arrives. |
| Amazon.ca | Manual only (Amazon prohibits automated price scraping). Use a free third-party alert such as CamelCamelCamel, or record prices yourself. |
| Costco.ca, SHEIN Canada | Manual only (bot protection, member pricing, script-loaded prices). |
| Other stores | Automatic if the page has standard price data, otherwise it fails and you get a clear error. |

### Phone alerts when the app is closed (optional, free)
1. Install the free **ntfy** app and subscribe to a long random topic name, for example `wishlist-k8s2h9x4q7`.
2. In your repository: Settings, Secrets and variables, Actions, New secret named `NTFY_TOPIC` with that topic.
3. The checker then pushes a notification when your target, drop or discount rule is met. (ntfy.sh is free; anyone who knows the topic name could read it, so keep it random.)

Inside the app, alerts appear under the bell. Browser notifications are available in Settings but only fire while the app is running.

## Limits that come from the free approach
- No in-app cross-store product search (stores have no free public search APIs). You get search links instead.
- Pasting a link fills in the store and a name suggestion. Title, image and price are not fetched automatically because browsers block reading other sites. Enter them manually or use the Share menu.
- "Lowest/highest observed" only reflects prices recorded in this app. The app never claims an all-time low.
- Savings on the dashboard = first recorded price minus latest, only for items with 2+ recorded prices.

## Testing status
- Passed (`node tests/test.js`, 20 tests): price math, alert rules, status logic including no false "active", filters, search, sorting, dashboard totals, CSV, backup round-trip, watch.json export, URL helpers, and the price extractor (including refusing non-CAD or missing prices).
- **Not yet tested:** the screens in a real browser, camera/photo upload, installing on Android, the GitHub Actions run, and live store pages. Please try the checklist in Settings, Export backup first, and tell me what breaks.
- The "Test alert" button creates a clearly labelled **SIMULATED** alert and never changes prices or history.

## Files
`index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon.svg` (the app) · `checker/check.mjs`, `.github/workflows/price-check.yml`, `watch.json`, `prices.json` (price checks) · `tests/test.js`.
