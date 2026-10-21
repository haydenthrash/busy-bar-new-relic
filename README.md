# busy-bar-new-relic

Shows one New Relic APM application on a [BUSY Bar](https://busy.app) front display (72×16):

| Screen | Shows |
|---|---|
| A | Web transaction time over the last 60 minutes, current value top-left (`245ms`, `1.2s`) |
| B | Web error rate over the last 60 minutes, current value top-left (`ERR 0.42%`) |

The screens alternate every 10 s. Both get a 1 px **yellow** border while the app's alert severity is `WARNING` and a **red** border when `CRITICAL`. New Relic is polled every 60 s.

It runs in a terminal on your Mac (`npm start`) and talks to the BUSY Bar over its local HTTP API using [`@busy-app/busy-lib`](https://www.npmjs.com/package/@busy-app/busy-lib).

## Requirements

- Node.js 20.12 or newer
- A BUSY Bar on the same network as your Mac, with its HTTP API reachable (e.g. `http://192.168.254.207`)
- A New Relic **User API key** (`NRAK-…`) and the **Entity GUID** of the APM application

## Setup

```sh
npm install
cp .env.example .env
# edit .env: NEW_RELIC_API_KEY, NEW_RELIC_ENTITY_GUID, BUSY_BAR_ADDR
npm start
```

Press **Ctrl-C** to stop; the app clears its elements from the display on exit.

### Create a New Relic User API key (`NRAK-…`)

1. Sign in to New Relic ([one.newrelic.com](https://one.newrelic.com), or [one.eu.newrelic.com](https://one.eu.newrelic.com) for EU accounts).
2. Click your name in the bottom-left corner, then choose **API Keys** (or go straight to `https://one.newrelic.com/api-keys`).
3. Click **Create a key**.
4. Set **Key type** to **User**, pick the account that owns the APM app, and give it a name such as `busy-bar`.
5. Click **Create a key**, then use the **…** menu on the new row → **Copy key**. It starts with `NRAK-`.
6. Paste it into `.env` as `NEW_RELIC_API_KEY=NRAK-…`.

A User key acts with your own permissions, so your user needs read access to the app's account. Do not use an ingest/license key: those can't query NerdGraph.

### Find the Entity GUID

1. In New Relic, go to **APM & Services** and click your application.
2. Click the ⓘ icon next to the application name at the top (**See metadata & tags**).
3. Copy the **Entity GUID** (a long base64 string such as `MTIzNDU2N3xBUE18QVBQTElDQVRJT058OTg3NjU0MzI`).
4. Paste it into `.env` as `NEW_RELIC_ENTITY_GUID=…`.

Alternatively, run this in the [NerdGraph API explorer](https://api.newrelic.com/graphiql) and copy the `guid`:

```graphql
{
  actor {
    entitySearch(query: "name = 'My App' AND domain = 'APM'") {
      results { entities { guid name accountId } }
    }
  }
}
```

The account ID and app name are looked up from the GUID at startup.

## Configuration (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `NEW_RELIC_API_KEY` | required | User API key, `NRAK-…` |
| `NEW_RELIC_ENTITY_GUID` | required | APM application entity GUID |
| `NEW_RELIC_REGION` | auto | `US` or `EU`. Unset: try US, then EU |
| `BUSY_BAR_ADDR` | `192.168.254.207` | IP, hostname or URL of the BUSY Bar |
| `BUSY_BAR_TOKEN` | unset | Device HTTP API password, sent as `X-API-Token` |
| `POLL_SECONDS` | `60` | New Relic poll interval |
| `FLIP_SECONDS` | `10` | Screen flip interval |
| `PRIORITY` | `50` | Draw priority (1–100). Built-in apps run at 10; an active BUSY session at 90 |

Real environment variables override `.env`.

## Demo mode (no New Relic needed)

```sh
npm run demo
```

Draws synthetic data through the same render and device code. The alert severity cycles `NOT_ALERTING` → `WARNING` → `CRITICAL` every 7 s and the screens flip every `FLIP_SECONDS`, so you can check the display, both screens and both border colors in under a minute.

## How it works

Each poll is a single NerdGraph request containing the entity's `alertSeverity` and two NRQL queries:

```sql
SELECT average(duration) * 1000 AS 'value' FROM Transaction
  WHERE entityGuid = '<guid>' AND transactionType = 'Web' TIMESERIES 1 minute SINCE 60 minutes ago
SELECT percentage(count(*), WHERE error IS true) AS 'value' FROM Transaction
  WHERE entityGuid = '<guid>' AND transactionType = 'Web' TIMESERIES 1 minute SINCE 60 minutes ago
```

- **Graph:** the 1-minute buckets are stretched across the display width (72 px, or 70 px inside a border). The Y axis runs from 0 to 110% of the largest value, with a floor of 1 ms / 0.1% so a quiet app doesn't fill the screen with noise. A bright top pixel sits on a dim filled area. Empty buckets leave gaps. Zero shows as a 1 px line.
- **Current value:** the value of the **most recent complete 1-minute bucket**. The newest bucket is still filling up and its value jumps around. Using the last complete bucket keeps the label equal to the right-hand end of the graph without a third query. It can differ slightly from the APM summary page, which averages over the selected time window.
- **Display:** elements are drawn with `application_name: "new_relic"` at priority 50. The device merges draws by element id, so an element that is no longer needed (e.g. the border once an alert clears) is deleted explicitly.

## Development

```sh
npm test          # vitest (formatting, XPM, rendering, NerdGraph parsing with fixtures)
npm run typecheck
npm run dev       # npm start with reload on file changes
npm run build     # compile to dist/ (not needed to run)
```

| File | Purpose |
|---|---|
| `src/config.ts` | `.env` loading and validation |
| `src/newrelic.ts` | NerdGraph client: region detection, entity lookup, poll + response parsing |
| `src/xpm.ts` | XPM2 bitmap builder |
| `src/render.ts` | Number formatting, graph pixels, screen → display elements |
| `src/busybar.ts` | Wrapper around `BusyBar` (draw, clear, 409 handling) |
| `src/loop.ts` | Poll/flip timers, draw queue, Ctrl-C handling (shared by `main` and `demo`) |
| `src/main.ts` | `npm start` entry point |
| `src/demo.ts` | `npm run demo` entry point |

## Troubleshooting

- **`BUSY Bar: higher-priority session active (409)`**: a BUSY or CUSTOM work session (priority 90) is running on the device. The app keeps retrying every flip and resumes on its own when the session ends.
- **`NerdGraph … HTTP 401` / `authentication required`**: the API key is wrong, revoked, or not a User key (`NRAK-`).
- **`Entity … not found in US/EU region`**: check the GUID, and that your user can see that account. Set `NEW_RELIC_REGION` if auto-detection picks the wrong region.
- **`NR: no data` on the display**: the first New Relic poll failed; see the terminal for the error. If a later poll fails, the last data stays up with a grey label and a trailing `?`.
- **Empty graphs / `--ms`**: the app has no `Transaction` events with `transactionType = 'Web'` in the last hour. That happens with no web traffic, with a non-web app, or with an agent that reports metrics only. The metric-based fallback (`apm.service.transaction.duration`) from the plan is not implemented yet.
- **Draw fails with a connection error**: check `BUSY_BAR_ADDR` and that `http://<addr>/api/version` responds from your Mac. If you set an HTTP API password on the device, put it in `BUSY_BAR_TOKEN`.
