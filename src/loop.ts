import type { Display } from './busybar.js';
import type { Snapshot } from './newrelic.js';
import {
  ERROR_STYLE,
  RESPONSE_STYLE,
  formatDuration,
  formatErrorRate,
  renderMessage,
  renderScreen,
  type Element,
} from './render.js';

/** Screen A (response time) and screen B (error rate) for one snapshot. */
export function screens(s: Snapshot, stale = false): Element[][] {
  const rt = s.responseTimeMs.current;
  const err = s.errorRatePct.current;
  return [
    renderScreen({
      series: s.responseTimeMs.values,
      label: rt === null ? '--ms' : formatDuration(rt),
      severity: s.severity,
      style: RESPONSE_STYLE,
      stale,
    }),
    renderScreen({
      series: s.errorRatePct.values,
      label: err === null ? 'ERR --%' : formatErrorRate(err),
      severity: s.severity,
      style: ERROR_STYLE,
      stale,
    }),
  ];
}

export interface LoopOptions {
  display: Display;
  poll: () => Promise<Snapshot>;
  pollSeconds: number;
  flipSeconds: number;
}

export interface Loop {
  stop(): Promise<void>;
}

/** Polls on one timer, flips screens on another, and serializes all draws. */
export function startLoop({ display, poll, pollSeconds, flipSeconds }: LoopOptions): Loop {
  let snapshot: Snapshot | undefined;
  let stale = false;
  let screen = 0;
  let busy = false;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  const draw = () => {
    queue = queue.then(async () => {
      if (stopped) return;
      const elements = snapshot ? screens(snapshot, stale)[screen]! : renderMessage('NR: no data', 'NOT_CONFIGURED');
      try {
        const result = await display.draw(elements);
        if (result === 'busy' && !busy) console.log('BUSY Bar: higher-priority session active (409); will keep retrying');
        if (result === 'ok' && busy) console.log('BUSY Bar: display available again');
        busy = result === 'busy';
      } catch (err) {
        console.error(`BUSY Bar draw failed: ${message(err)}`);
      }
    });
    return queue;
  };

  const refresh = async () => {
    try {
      snapshot = await poll();
      stale = false;
    } catch (err) {
      stale = snapshot !== undefined;
      console.error(`New Relic poll failed: ${message(err)}`);
    }
    await draw();
  };

  void refresh();
  const pollTimer = setInterval(refresh, pollSeconds * 1000);
  const flipTimer = setInterval(() => {
    screen = (screen + 1) % 2;
    void draw();
  }, flipSeconds * 1000);

  return {
    async stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(flipTimer);
      await queue;
    },
  };
}

/** SIGINT/SIGTERM: stop the loop, clear our elements from the display, exit. */
export function exitOnSignal(loop: Loop, display: Display): void {
  let exiting = false;
  const shutdown = async (signal: string) => {
    if (exiting) process.exit(1); // second Ctrl-C: give up immediately
    exiting = true;
    console.log(`\n${signal}: clearing display`);
    await loop.stop();
    try {
      await display.clear();
      process.exit(0);
    } catch (err) {
      console.error(`Failed to clear display: ${message(err)}`);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
