import { BusyBar } from '@busy-app/busy-lib';
import type { DeviceConfig } from './config.js';
import type { Element } from './render.js';

export const APP_NAME = 'new_relic';

export type DrawResult = 'ok' | 'busy';

/**
 * Thin wrapper around the BUSY Bar SDK. Draws merge by element id on the
 * device, so ids that disappear between draws (e.g. the alert border) are
 * cleared explicitly.
 */
export class Display {
  private readonly bar: BusyBar;
  private shown = new Set<string>();

  constructor(private readonly config: Pick<DeviceConfig, 'addr' | 'token' | 'priority'>) {
    this.bar = new BusyBar({ addr: config.addr, HTTPAccessPassword: config.token });
  }

  /** Returns 'busy' when a higher-priority app (an active BUSY session) owns the screen. */
  async draw(elements: Element[]): Promise<DrawResult> {
    const ids = new Set(elements.map((e) => e.id));
    const removed = [...this.shown].filter((id) => !ids.has(id));
    try {
      if (removed.length > 0) {
        await this.bar.DisplayClear({ application_name: APP_NAME, element_ids: removed });
        for (const id of removed) this.shown.delete(id);
      }
      await this.bar.DisplayDraw({ application_name: APP_NAME, priority: this.config.priority, elements });
    } catch (err) {
      if (statusOf(err) === 409) return 'busy';
      throw err;
    }
    this.shown = ids;
    return 'ok';
  }

  async clear(): Promise<void> {
    await this.bar.DisplayClear({ application_name: APP_NAME });
    this.shown.clear();
  }
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : undefined;
}
