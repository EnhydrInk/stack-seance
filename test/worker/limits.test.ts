import '../compiler/helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import { clientKey, readLimits, take, type Limits } from '../../worker/src/limits';
import { json, notFound, statusOf } from '../../worker/src/http';
import type { CompileResponse } from '../../src/compiler/index';
import { MemoryStore } from './helpers/memoryStore';

const LIMITS: Limits = { perIp: 20, perSite: 200 };
const NOON = Date.UTC(2026, 11, 5, 12, 0, 0);

describe('Requirement 10.2 to 10.4 take', () => {
  it('lets 20 requests of one client through and gives the 21st scope ip', () => {
    const store = new MemoryStore();
    for (let i = 1; i <= 20; i++) expect(take(store, '203.0.113.7', NOON, LIMITS), `request ${i}`).toEqual({ ok: true });
    expect(take(store, '203.0.113.7', NOON, LIMITS)).toEqual({ ok: false, scope: 'ip' });
    expect(store.snapshot()).toEqual({ day: '2026-12-05', 'ip:203.0.113.7': 20, site: 20 });
  });

  it('lets other clients through until the site count is 200, then gives scope site', () => {
    const store = new MemoryStore();
    for (let c = 0; c < 10; c++) {
      for (let i = 0; i < 20; i++) expect(take(store, `198.51.100.${c}`, NOON, LIMITS)).toEqual({ ok: true });
    }
    expect(store.get('site')).toBe(200);
    expect(take(store, '198.51.100.99', NOON, LIMITS)).toEqual({ ok: false, scope: 'site' });
    expect(store.get('ip:198.51.100.99')).toBeUndefined();
    expect(store.get('site')).toBe(200);
  });

  it('gives scope ip when both limits are reached', () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 200, 'ip:203.0.113.7': 20 });
    expect(take(store, '203.0.113.7', NOON, LIMITS)).toEqual({ ok: false, scope: 'ip' });
  });

  it('rejects at once with a limit of 0', () => {
    expect(take(new MemoryStore(), '203.0.113.7', NOON, { perIp: 0, perSite: 200 })).toEqual({ ok: false, scope: 'ip' });
    expect(take(new MemoryStore(), '203.0.113.7', NOON, { perIp: 20, perSite: 0 })).toEqual({ ok: false, scope: 'site' });
  });

  it('writes nothing when it rejects a request on the same day', () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 200, 'ip:203.0.113.7': 3 });
    const before = store.snapshot();
    expect(take(store, '203.0.113.7', NOON, LIMITS)).toEqual({ ok: false, scope: 'site' });
    expect(store.snapshot()).toEqual(before);
  });
});

describe('Requirement 10.5, 10.9 a new UTC_Day', () => {
  const lastMoment = Date.UTC(2026, 11, 5, 23, 59, 59, 999);
  const midnight = Date.UTC(2026, 11, 6, 0, 0, 0, 0);

  it('keeps counting until 23:59:59.999 UTC and starts again from 0 at 00:00:00.000 UTC', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 20; i++) take(store, '203.0.113.7', NOON, LIMITS);
    for (let i = 0; i < 5; i++) take(store, '2001:db8::1', NOON, LIMITS);
    expect(take(store, '203.0.113.7', lastMoment, LIMITS)).toEqual({ ok: false, scope: 'ip' });
    expect(store.get('day')).toBe('2026-12-05');

    expect(take(store, '203.0.113.7', midnight, LIMITS)).toEqual({ ok: true });
    expect(store.snapshot()).toEqual({ day: '2026-12-06', 'ip:203.0.113.7': 1, site: 1 });
  });

  it('drops the old Client_Keys at the first check of the day, even when that check is rejected', () => {
    const store = new MemoryStore({ day: '2026-12-05', site: 150, 'ip:a': 20, 'ip:b': 3, 'ip:c': 7 });
    expect(take(store, 'd', midnight, { perIp: 0, perSite: 200 })).toEqual({ ok: false, scope: 'ip' });
    expect(store.snapshot()).toEqual({ day: '2026-12-06', site: 0 });
  });

  it('starts a day on an empty store', () => {
    const store = new MemoryStore();
    expect(take(store, 'unknown', midnight, LIMITS)).toEqual({ ok: true });
    expect(store.snapshot()).toEqual({ day: '2026-12-06', 'ip:unknown': 1, site: 1 });
  });
});

describe('Requirement 10.6 readLimits', () => {
  it('takes whole numbers of 0 or more', () => {
    expect(readLimits({ LIMIT_PER_IP: '0', LIMIT_PER_SITE: '35' })).toEqual({ perIp: 0, perSite: 35 });
    expect(readLimits({ LIMIT_PER_IP: '35', LIMIT_PER_SITE: '0' })).toEqual({ perIp: 35, perSite: 0 });
  });

  it('uses 20 and 200 for a missing value and for anything that is not a whole number', () => {
    expect(readLimits({})).toEqual({ perIp: 20, perSite: 200 });
    for (const value of ['', 'abc', '-1', '2.5', ' 20', '1e3', '20 ', '+5', '0x10']) {
      expect(readLimits({ LIMIT_PER_IP: value, LIMIT_PER_SITE: value }), JSON.stringify(value)).toEqual({ perIp: 20, perSite: 200 });
    }
  });
});

describe('Requirement 10.7 clientKey', () => {
  it('uses an IPv4 address as written', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv6 address by its first 64 bits, lowercase and without leading zeros', () => {
    expect(clientKey('2001:0DB8:85A3:0000:0000:8A2E:0370:7334')).toBe('2001:db8:85a3:0::/64');
    expect(clientKey('2001:db8::abcd')).toBe('2001:db8:0:0::/64');
    expect(clientKey('2001:DB8:0:0:1::5')).toBe('2001:db8:0:0::/64');
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
    expect(clientKey('fe80::')).toBe('fe80:0:0:0::/64');
  });

  it('gives two addresses in one /64 the same key, and two /64s different keys', () => {
    expect(clientKey('2001:db8:aa:bb::1')).toBe(clientKey('2001:db8:aa:bb:ffff:ffff:ffff:ffff'));
    expect(clientKey('2001:db8:aa:bb::1')).not.toBe(clientKey('2001:db8:aa:bc::1'));
  });

  it('gives unknown without the header', () => {
    expect(clientKey(null)).toBe('unknown');
  });
});

describe('Requirement 1.3, 1.4 the HTTP answers', () => {
  it('gives each answer its status and the two headers', async () => {
    const cases: [CompileResponse, number][] = [
      [{ ok: true, label: 'Go', script: 'on mouseUp\n  howl\nend mouseUp', newCards: [], skipped: [] }, 200],
      [{ ok: false, error: 'nothing', skipped: ['send an email'] }, 422],
      [{ ok: false, error: 'limit', scope: 'ip' }, 429],
      [{ ok: false, error: 'bad-request' }, 400],
      [{ ok: false, error: 'unauthorized' }, 401],
      [{ ok: false, error: 'model' }, 502],
    ];
    for (const [body, status] of cases) {
      const response = json(body);
      expect(statusOf(body)).toBe(status);
      expect(response.status).toBe(status);
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(await response.json()).toEqual(body);
    }
  });

  it('gives a plain-text 404', async () => {
    const response = notFound();
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(await response.text()).toBe('Not found');
  });
});
