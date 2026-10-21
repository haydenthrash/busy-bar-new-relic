/**
 * Demo mode: synthetic data through the real render + device path, no New Relic needed.
 * Alert severity cycles NOT_ALERTING -> WARNING -> CRITICAL on every poll.
 */
import { Display } from './busybar.js';
import { deviceConfig, loadDotEnv } from './config.js';
import { exitOnSignal, startLoop } from './loop.js';
import type { Snapshot } from './newrelic.js';
import type { Severity } from './render.js';

const SEVERITIES: Severity[] = ['NOT_ALERTING', 'WARNING', 'CRITICAL'];
const POLL_SECONDS = 7;
const BUCKETS = 61;

/** Plausible-looking response time (ms) and error rate (%) for minute `t`. */
function syntheticPoint(t: number): { rt: number | null; err: number } {
  const wave = Math.sin(t / 6) + 0.5 * Math.sin(t / 2.3);
  const spike = t % 23 === 0 ? 350 : 0;
  return {
    rt: t % 37 === 5 ? null : Math.max(20, 220 + 70 * wave + spike), // occasional gap
    err: Math.max(0, 0.35 + 0.25 * Math.sin(t / 4) + (t % 17 === 0 ? 1.2 : 0)),
  };
}

function syntheticSnapshot(tick: number): Snapshot {
  const points = Array.from({ length: BUCKETS }, (_, i) => syntheticPoint(tick * 3 + i));
  const rt = points.map((p) => p.rt);
  const err = points.map((p) => p.err);
  return {
    severity: SEVERITIES[tick % SEVERITIES.length]!,
    responseTimeMs: { values: rt, current: rt.at(-2) ?? null },
    errorRatePct: { values: err, current: err.at(-2) ?? null },
  };
}

loadDotEnv();
const device = deviceConfig();
const display = new Display(device);
let tick = 0;

console.log(`Demo: drawing synthetic data to BUSY Bar at ${device.addr}; severity changes every ${POLL_SECONDS}s, screens flip every ${device.flipSeconds}s. Ctrl-C to stop.`);
const loop = startLoop({
  display,
  poll: async () => {
    const snapshot = syntheticSnapshot(tick++);
    console.log(`tick ${tick}: severity ${snapshot.severity}`);
    return snapshot;
  },
  pollSeconds: POLL_SECONDS,
  flipSeconds: device.flipSeconds,
});
exitOnSignal(loop, display);
