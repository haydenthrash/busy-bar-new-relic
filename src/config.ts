import { existsSync } from 'node:fs';

export type Region = 'US' | 'EU';

export interface DeviceConfig {
  addr: string;
  token?: string;
  priority: number;
  flipSeconds: number;
}

export interface NewRelicConfig {
  apiKey: string;
  entityGuid: string;
  region?: Region;
  pollSeconds: number;
}

/** Loads `.env` from the working directory if present (real env vars win). */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

type Env = Record<string, string | undefined>;

function str(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function required(env: Env, name: string): string {
  const v = str(env, name);
  if (!v) throw new Error(`Missing ${name} (see .env.example)`);
  return v;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return n;
}

export function deviceConfig(env: Env = process.env): DeviceConfig {
  return {
    addr: str(env, 'BUSY_BAR_ADDR') ?? '192.168.254.207',
    token: str(env, 'BUSY_BAR_TOKEN'),
    priority: int(env, 'PRIORITY', 50, 1, 100),
    flipSeconds: int(env, 'FLIP_SECONDS', 10, 1, 3600),
  };
}

export function newRelicConfig(env: Env = process.env): NewRelicConfig {
  const region = str(env, 'NEW_RELIC_REGION')?.toUpperCase();
  if (region !== undefined && region !== 'US' && region !== 'EU') {
    throw new Error(`NEW_RELIC_REGION must be US or EU, got "${region}"`);
  }
  return {
    apiKey: required(env, 'NEW_RELIC_API_KEY'),
    entityGuid: required(env, 'NEW_RELIC_ENTITY_GUID'),
    region,
    pollSeconds: int(env, 'POLL_SECONDS', 60, 10, 3600),
  };
}
