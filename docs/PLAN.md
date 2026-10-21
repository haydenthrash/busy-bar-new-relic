# Busy Bar × New Relic — Implementation Plan

## Goal
A Node/TypeScript CLI, run manually on a Mac (`npm start`), that polls New Relic for a single APM app and pushes a live display to a BUSY Bar on the LAN via its HTTP API.

## Decisions (from requirements Q&A)
| Topic | Decision |
|---|---|
| Runtime | Mac, run manually in a terminal (`npm start`). No service/Docker. |
| SDK | `@busy-app/busy-lib` (npm, ESM, typed `BusyBar` client; `new BusyBar({ addr })`). |
| App identity | **Entity GUID** of the APM app. Account ID + app name are resolved from the GUID via NerdGraph `actor.entity(guid)`. |
| NR region | Auto-detect: try `https://api.newrelic.com/graphql`, fall back to `https://api.eu.newrelic.com/graphql` if the entity isn't found/401. Optional override `NEW_RELIC_REGION=US|EU`. |
| Graph window | Last 60 minutes, ~1 bucket per pixel column. |
| Screens | Two alternating screens, **both graphs** with current value overlaid top-left: A = Web transaction time ("245ms"), B = Error rate ("ERR 0.42%"). |
| Alert indicator | 1px border around the whole 72×16 screen on both screens: **yellow** when entity `alertSeverity == WARNING`, **red** when `CRITICAL`, no border otherwise (`NOT_ALERTING`/`NOT_CONFIGURED`). Scope = this app's entity only. |
| Timing | Poll New Relic every 60s; flip screens every 10s. Both configurable. |
| Priority | Draw at priority **50** (beats built-in apps at 10, yields to an active BUSY session at 90). On HTTP 409, log quietly and keep retrying on the next tick. |
| Busy Bar auth | Device at `192.168.254.207` currently allows unauthenticated Wi-Fi API access. Support optional `BUSY_BAR_TOKEN` (sent as `X-API-Token`). |

## Device facts (verified against device OpenAPI, api_semver 27.5.0)
- Front display is **72×16**.
- `POST /api/display/draw` with `{ application_name, priority, elements[] }`.
- Element types useful here: `xpmbitmap` (inline XPM2 text, ≤32 colors, ≤72×16), `rectangle` (border via `border_width`/`border_color`, `fill: "none"`), `text` (fonts: tiny, small, normal, condensed, bold, large, extra_large; color `#RRGGBBAA`; printable ASCII only).
- `DELETE /api/display/draw?application_name=...` clears our app's elements.
- Prefer SDK methods (e.g. `DisplayDraw…`/`DisplayClear…` — check exact names in `@busy-app/busy-lib` typings). Fall back to raw `fetch` only if the SDK lacks something.

## New Relic queries (NerdGraph, header `API-Key: <NRAK user key>`)
1. **Resolve entity** (once at startup, cached):
   `actor { entity(guid: $guid) { name accountId domain type ... on ApmApplicationEntityOutline { alertSeverity } } }`
2. **Each poll** — one GraphQL request with aliases:
   - `entity(guid) { ... on ApmApplicationEntity { alertSeverity } }`
   - Response time timeseries (ms):
     `SELECT average(duration) * 1000 FROM Transaction WHERE entityGuid = '<guid>' AND transactionType = 'Web' TIMESERIES 1 minute SINCE 60 minutes ago`
   - Error rate timeseries (%):
     `SELECT percentage(count(*), WHERE error IS true) FROM Transaction WHERE entityGuid = '<guid>' AND transactionType = 'Web' TIMESERIES 1 minute SINCE 60 minutes ago`
   - Current values = the most recent *complete* bucket (or a separate `SINCE 5 minutes ago` non-timeseries query — choose whichever matches the NR APM UI better; document the choice).
   Use `actor { account(id) { nrql(query) { results } } }`.
   Note: if the app reports metrics only (no Transaction events), fall back to `FROM Metric` with `apm.service.transaction.duration` / `apm.service.error.count`; implement the Transaction version first.

## Rendering
- Pure function `renderScreen(series: number[], label: string, severity, colors) → DisplayElements[]`.
- Graph: build an XPM2 bitmap (72×16 or inset 70×14 when a border is shown so the border isn't overdrawn). Auto-scale Y from 0 to max(series)×1.1 (min ceiling to avoid flat-line noise, e.g. 1ms / 0.1%). Draw filled area (dim color) + line top (bright color). Null/missing buckets = gaps.
  - Response time: cyan line / dark-cyan fill. Error rate: orange line / dark-orange fill.
- Label: `tiny` or `small` font text at top-left with a dark background feel (rely on z_index above the bitmap; optionally a small filled black rectangle behind the text for legibility).
- Border: `rectangle` x0 y0 72×16, `fill:"none"`, `border_width:1`, yellow `#FFC800FF` / red `#FF0000FF`.
- Number formatting: `245ms`, `1.2s` when ≥1000ms; `ERR 0.42%`, `ERR 12%` (≤3 sig figs).
- Error/stale states: if NR fetch fails, keep last data and show a small `?` marker or dim label; if no data ever, show text "NR: no data". Log errors to console.

## Structure
```
package.json        (type: module, scripts: start, dev, build, test, typecheck)
tsconfig.json
.env.example        NEW_RELIC_API_KEY, NEW_RELIC_ENTITY_GUID, NEW_RELIC_REGION (optional), BUSY_BAR_ADDR=192.168.254.207, BUSY_BAR_TOKEN (optional), POLL_SECONDS=60, FLIP_SECONDS=10, PRIORITY=50
src/config.ts       env loading/validation (dotenv or node --env-file)
src/newrelic.ts     NerdGraph client: region detection, entity resolve, poll()
src/xpm.ts          XPM2 bitmap builder
src/render.ts       screen → DisplayElements
src/busybar.ts      thin wrapper around @busy-app/busy-lib (draw, clear)
src/main.ts         loop: poll timer + flip timer; SIGINT/SIGTERM → clear display and exit
src/demo.ts         --demo mode: synthetic data, cycles NOT_ALERTING→WARNING→CRITICAL, no NR needed
test/*.test.ts      vitest: xpm output, scaling, formatting, render elements, NR response parsing (fixtures)
README.md           setup, how to find the Entity GUID, how to create a User API key (NRAK-…), running, troubleshooting (409 = BUSY session active)
```
Run with `tsx` (no build step needed for `npm start`). Node ≥ 20.

## How to find the Entity GUID (for README)
New Relic → APM & Services → click your app → click the app name / ⓘ "See metadata & tags" → copy **Entity GUID**. Alternatively: NerdGraph explorer `{ actor { entitySearch(query: "name = 'My App' AND domain = 'APM'") { results { entities { guid name } } } } }`.

## Verification
1. `npm run typecheck` and `npm test` pass.
2. `npm run demo` (synthetic data) against the real device at 192.168.254.207: confirm both screens draw, flip, and border colors change; grab `GET /api/screen?display=0` frames to verify visually.
3. Ctrl-C clears the display.
4. Live NR run requires the user's API key + GUID in `.env` (user does this).
