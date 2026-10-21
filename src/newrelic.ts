import type { NewRelicConfig, Region } from './config.js';
import type { Severity } from './render.js';

export const ENDPOINTS: Record<Region, string> = {
  US: 'https://api.newrelic.com/graphql',
  EU: 'https://api.eu.newrelic.com/graphql',
};

export interface Entity {
  guid: string;
  name: string;
  accountId: number;
  domain: string;
  type: string;
  region: Region;
}

export interface Series {
  /** One value per 1-minute bucket, oldest first; null = no data in that bucket. */
  values: (number | null)[];
  /** Value of the most recent complete bucket (see README for why). */
  current: number | null;
}

export interface Snapshot {
  severity: Severity;
  responseTimeMs: Series;
  errorRatePct: Series;
}

export class NerdGraphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'NerdGraphError';
  }
}

type Json = Record<string, unknown>;

const ENTITY_QUERY = `query($guid: EntityGuid!) {
  actor {
    entity(guid: $guid) {
      guid name accountId domain type
      ... on ApmApplicationEntity { alertSeverity }
    }
  }
}`;

const POLL_QUERY = `query($guid: EntityGuid!, $accountId: Int!, $rt: Nrql!, $err: Nrql!) {
  actor {
    entity(guid: $guid) { ... on ApmApplicationEntity { alertSeverity } }
    account(id: $accountId) {
      rt: nrql(query: $rt) { results }
      err: nrql(query: $err) { results }
    }
  }
}`;

/** NRQL for the two graphs: last 60 minutes in 1-minute buckets. */
export function nrqlQueries(guid: string): { rt: string; err: string } {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(guid)) throw new Error(`Invalid entity GUID: ${guid}`);

  return {
    rt: `SELECT average(newrelic.timeslice.value) * 1000 as 'value' FROM Metric WHERE entity.guid = '${guid}' AND metricTimesliceName = 'HttpDispatcher' TIMESERIES 1 minute SINCE 60 MINUTES AGO LIMIT MAX`,
    err: `SELECT percentage(count(*), WHERE error IS true) AS 'value' FROM Transaction WHERE entityGuid = '${guid}' TIMESERIES 1 minute SINCE 60 minutes ago`,
  };
}

export class NewRelicClient {
  private entity?: Entity;

  constructor(
    private readonly config: Pick<NewRelicConfig, 'apiKey' | 'entityGuid' | 'region'>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Finds the entity, auto-detecting the region (US first, then EU) unless configured. */
  async resolve(): Promise<Entity> {
    if (this.entity) return this.entity;
    const regions: Region[] = this.config.region ? [this.config.region] : ['US', 'EU'];
    const failures: string[] = [];
    for (const region of regions) {
      try {
        const json = await this.request(region, ENTITY_QUERY, { guid: this.config.entityGuid });
        const entity = parseEntity(json, region);
        if (entity) return (this.entity = entity);
        failures.push(`Entity ${this.config.entityGuid} not found in ${region} region`);
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
    throw new NerdGraphError(failures.join('\n'));
  }

  async poll(now = Date.now()): Promise<Snapshot> {
    const entity = await this.resolve();
    const json = await this.request(entity.region, POLL_QUERY, {
      guid: entity.guid,
      accountId: entity.accountId,
      ...nrqlQueries(entity.guid),
    });
    return parsePoll(json, now / 1000);
  }

  private async request(region: Region, query: string, variables: Json): Promise<Json> {
    const res = await this.fetchFn(ENDPOINTS[region], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'API-Key': this.config.apiKey },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new NerdGraphError(`NerdGraph ${region} HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
    const json = JSON.parse(text) as Json;
    const errors = json.errors as { message?: string }[] | undefined;
    if (errors?.length) {
      throw new NerdGraphError(`NerdGraph ${region}: ${errors.map((e) => e.message).join('; ')}`, res.status);
    }
    return json;
  }
}

function get(obj: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), obj);
}

export function parseEntity(json: unknown, region: Region): Entity | undefined {
  const e = get(json, 'data', 'actor', 'entity') as Json | null | undefined;
  if (!e || typeof e.guid !== 'string' || typeof e.accountId !== 'number') return undefined;
  return {
    guid: e.guid,
    name: String(e.name ?? e.guid),
    accountId: e.accountId,
    domain: String(e.domain ?? ''),
    type: String(e.type ?? ''),
    region,
  };
}

export function parseSeverity(value: unknown): Severity {
  return value === 'WARNING' || value === 'CRITICAL' || value === 'NOT_ALERTING' ? value : 'NOT_CONFIGURED';
}

/**
 * Converts NRQL TIMESERIES rows into a series. The newest bucket is usually
 * still filling up, so `current` is the newest bucket that has ended
 * (falling back to the newest non-null value).
 */
export function parseSeries(results: unknown, nowSeconds: number): Series {
  const rows = Array.isArray(results) ? (results as Json[]) : [];
  const values = rows.map((r) => (typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null));
  let current: number | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const end = rows[i]!.endTimeSeconds;
    if (values[i] !== null && (typeof end !== 'number' || end <= nowSeconds)) {
      current = values[i]!;
      break;
    }
  }
  current ??= values.findLast((v) => v !== null) ?? null;
  return { values, current };
}

export function parsePoll(json: unknown, nowSeconds: number): Snapshot {
  const account = get(json, 'data', 'actor', 'account');
  if (!account) throw new NerdGraphError('NerdGraph response has no account data');
  return {
    severity: parseSeverity(get(json, 'data', 'actor', 'entity', 'alertSeverity')),
    responseTimeMs: parseSeries(get(account, 'rt', 'results'), nowSeconds),
    errorRatePct: parseSeries(get(account, 'err', 'results'), nowSeconds),
  };
}
