import { describe, expect, it } from 'vitest';
import { deviceConfig, newRelicConfig } from '../src/config.js';

describe('config', () => {
  it('applies defaults', () => {
    expect(deviceConfig({})).toEqual({ addr: '192.168.254.207', token: undefined, priority: 50, flipSeconds: 10 });
  });

  it('validates New Relic settings', () => {
    expect(() => newRelicConfig({})).toThrow(/NEW_RELIC_API_KEY/);
    const env = { NEW_RELIC_API_KEY: 'NRAK-X', NEW_RELIC_ENTITY_GUID: 'G', NEW_RELIC_REGION: 'eu', POLL_SECONDS: '30' };
    expect(newRelicConfig(env)).toEqual({ apiKey: 'NRAK-X', entityGuid: 'G', region: 'EU', pollSeconds: 30 });
    expect(() => newRelicConfig({ ...env, NEW_RELIC_REGION: 'APAC' })).toThrow(/US or EU/);
    expect(() => deviceConfig({ PRIORITY: '101' })).toThrow(/PRIORITY/);
  });
});
