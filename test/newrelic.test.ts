import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, NewRelicClient, nrqlQueries, parseEntity, parsePoll, parseSeries, parseSeverity } from '../src/newrelic.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const BUCKET_START = 1761060000;

describe('response parsing', () => {
  it('parses the entity', () => {
    expect(parseEntity(fixture('entity.json'), 'US')).toEqual({
      guid: 'MTIzNDU2N3xBUE18QVBQTElDQVRJT058OTg3NjU0MzI',
      name: 'checkout-service',
      accountId: 1234567,
      domain: 'APM',
      type: 'APPLICATION',
      region: 'US',
    });
    expect(parseEntity(fixture('entity-not-found.json'), 'US')).toBeUndefined();
  });

  it('parses severity, series and the latest complete bucket', () => {
    const now = BUCKET_START + 330; // inside the last (incomplete) bucket
    const snap = parsePoll(fixture('poll.json'), now);
    expect(snap.severity).toBe('WARNING');
    expect(snap.responseTimeMs.values).toEqual([210.5, 198.25, null, 245, 260.75, 300.1]);
    expect(snap.responseTimeMs.current).toBe(260.75);
    expect(snap.errorRatePct.values).toEqual([0, 0.42, null, 1.5, 12.345, 0]);
    expect(snap.errorRatePct.current).toBe(12.345);
  });

  it('falls back to the newest value when no bucket has ended, and null when empty', () => {
    expect(parseSeries([{ endTimeSeconds: 200, value: 5 }], 100)).toEqual({ values: [5], current: 5 });
    expect(parseSeries([{ value: null }], 100)).toEqual({ values: [null], current: null });
    expect(parseSeries(undefined, 100)).toEqual({ values: [], current: null });
  });

  it('maps unknown severities to NOT_CONFIGURED', () => {
    expect(parseSeverity('CRITICAL')).toBe('CRITICAL');
    expect(parseSeverity(undefined)).toBe('NOT_CONFIGURED');
    expect(parseSeverity('NOT_CONFIGURED')).toBe('NOT_CONFIGURED');
  });

  it('rejects a response without account data', () => {
    expect(() => parsePoll({ data: { actor: { account: null } } }, 0)).toThrow(/no account/);
  });
});

describe('nrqlQueries', () => {
  it('builds Web transaction timeseries queries for the entity', () => {
    const q = nrqlQueries('ABC123==');
    expect(q.rt).toBe(
      "SELECT average(duration) * 1000 AS 'value' FROM Transaction WHERE entityGuid = 'ABC123==' AND transactionType = 'Web' TIMESERIES 1 minute SINCE 60 minutes ago",
    );
    expect(q.err).toMatch(/^SELECT percentage\(count\(\*\), WHERE error IS true\) AS 'value' FROM Transaction/);
  });

  it('refuses GUIDs that could break out of the NRQL string', () => {
    expect(() => nrqlQueries("x' OR 1=1")).toThrow(/Invalid entity GUID/);
  });
});

describe('NewRelicClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const guid = 'MTIzNDU2N3xBUE18QVBQTElDQVRJT058OTg3NjU0MzI';

  it('falls back to the EU endpoint when the US one rejects the key', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url) === ENDPOINTS.US ? json({ errors: [{ message: 'Invalid API key' }] }, 401) : json(fixture('entity.json')),
    );
    const client = new NewRelicClient({ apiKey: 'NRAK-TEST', entityGuid: guid }, fetchFn as typeof fetch);
    const entity = await client.resolve();
    expect(entity.region).toBe('EU');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('sends the API key and the poll variables, and parses the result', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return json(body.query.includes('account(id') ? fixture('poll.json') : fixture('entity.json'));
    });
    const client = new NewRelicClient({ apiKey: 'NRAK-TEST', entityGuid: guid, region: 'US' }, fetchFn as typeof fetch);
    const snap = await client.poll((BUCKET_START + 330) * 1000);
    expect(snap.responseTimeMs.current).toBe(260.75);

    const [url, init] = fetchFn.mock.calls[1]!;
    expect(url).toBe(ENDPOINTS.US);
    expect((init!.headers as Record<string, string>)['API-Key']).toBe('NRAK-TEST');
    const vars = JSON.parse(String(init!.body)).variables;
    expect(vars).toMatchObject({ guid, accountId: 1234567, ...nrqlQueries(guid) });
  });

  it('surfaces GraphQL errors', async () => {
    const fetchFn = vi.fn(async () => json(fixture('graphql-error.json')));
    const client = new NewRelicClient({ apiKey: 'NRAK-TEST', entityGuid: guid, region: 'EU' }, fetchFn as typeof fetch);
    await expect(client.resolve()).rejects.toThrow(/access denied/);
  });

  it('reports an entity that exists in neither region', async () => {
    const fetchFn = vi.fn(async () => json(fixture('entity-not-found.json')));
    const client = new NewRelicClient({ apiKey: 'NRAK-TEST', entityGuid: guid }, fetchFn as typeof fetch);
    await expect(client.resolve()).rejects.toThrow(/not found in EU/);
  });
});
