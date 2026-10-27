import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteOrigin, iconUrl, iconCandidates, createFaviconService, ICON_TTL, ICON_MISS_TTL, ICON_CACHE_KEY } from '../lib/favicon.js';
import { createIconCache, fetchIconResource } from '../lib/favicon-browser.js';

const src = 'data:image/png;base64,aGVsbG8=';
const savedIcon = { src, url: 'https://example.com/apple-touch-icon.png', kind: 'apple-touch-icon' };
function memoryCache(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return { entries, get: async key => entries.get(key), put: async (key, value) => { entries.set(key, value); } };
}
const defaults = () => ({ cache: memoryCache(), fetchPage: async url => ({ url, html: '' }), parseLinks: () => [], loadIcon: async () => src });

test('website discovery uses only an HTTP origin, stripping private paths and tokens', () => {
  assert.equal(websiteOrigin('https://example.com/private/page?token=secret#part'), 'https://example.com');
  assert.equal(websiteOrigin('http://localhost:5173/app'), 'http://localhost:5173');
  for (const url of ['javascript:alert(1)', 'file:///test', 'https://name:password@example.com']) assert.throws(() => websiteOrigin(url));
});

test('icon links resolve relative paths and CDN URLs while rejecting unsafe destinations', () => {
  assert.equal(iconUrl('../logo.png?v=1#x', 'https://example.com/assets/', 'https://example.com'), 'https://example.com/logo.png?v=1');
  assert.equal(iconUrl('//cdn.example.net/icon.png', 'https://example.com/', 'https://example.com'), 'https://cdn.example.net/icon.png');
  assert.equal(iconUrl('/icon.png', 'http://localhost:5173/', 'http://localhost:5173'), 'http://localhost:5173/icon.png');
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'file:///test', 'https://user:pass@example.com/a', 'http://cdn.example.net/a', 'https://127.0.0.1/a', 'https://192.168.1.1/a', 'https://service.local/a']) {
    assert.equal(iconUrl(url, 'https://example.com/', 'https://example.com'), null, url);
  }
});

test('Apple declarations precede root paths and ordinary favicons, selecting the closest larger size', () => {
  const result = iconCandidates('https://example.com', [
    { rel: 'icon', href: '/favicon.svg', sizes: 'any' },
    { rel: 'apple-touch-icon', href: '/small.png', sizes: '152x152' },
    { rel: 'APPLE-TOUCH-ICON', href: '/best.png', sizes: '180x180' },
    { rel: 'apple-touch-icon-precomposed', href: 'https://cdn.example.net/large.png', sizes: '192x192' },
  ]);
  assert.deepEqual(result.slice(0, 3).map(item => item.url), ['https://example.com/best.png', 'https://cdn.example.net/large.png', 'https://example.com/small.png']);
  assert.equal(result[3].url, 'https://example.com/apple-touch-icon.png');
  assert.ok(result.findIndex(item => item.url.endsWith('/favicon.svg')) > 3);
  assert.equal(result.at(-1).url, 'https://example.com/favicon.ico');
});

test('duplicate icon URLs preserve Apple priority and invalid icon links are omitted', () => {
  const result = iconCandidates('https://example.com', [
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'icon', href: '/apple-touch-icon.png' },
    { rel: 'apple-touch-icon', href: 'javascript:alert(1)' },
  ]);
  assert.equal(result.filter(item => item.url.endsWith('/apple-touch-icon.png')).length, 1);
  assert.equal(result[0].kind, 'apple-touch-icon');
  assert.ok(result.every(item => item.url.startsWith('https:')));
});

test('parallel requests for the same website share discovery and persist the successful icon', async () => {
  let fetches = 0;
  const options = defaults();
  options.fetchPage = async url => { fetches++; assert.equal(url, 'https://example.com/'); return { url, html: 'metadata' }; };
  options.parseLinks = () => [{ rel: 'apple-touch-icon', href: '/declared.png', sizes: '180x180' }];
  const service = createFaviconService(options);
  const first = service.get('https://example.com/a?token=secret');
  const second = service.get('https://example.com/b');
  assert.equal(first, second);
  const icon = await first;
  assert.equal(icon.url, 'https://example.com/declared.png');
  assert.equal(icon.kind, 'apple-touch-icon');
  assert.equal(fetches, 1);
  assert.deepEqual(options.cache.entries.get('https://example.com').icon, icon);
});

test('blocked HTML and missing Apple icons fall back to the actual favicon', async () => {
  const attempted = [];
  const service = createFaviconService({ ...defaults(),
    fetchPage: async () => { throw new Error('offline metadata'); },
    loadIcon: async url => { attempted.push(url); if (!url.endsWith('/favicon.ico')) throw new Error('404'); return src; },
  });
  const icon = await service.get('https://example.com');
  assert.equal(attempted[0], 'https://example.com/apple-touch-icon.png');
  assert.equal(icon.kind, 'favicon');
  assert.equal(icon.url, 'https://example.com/favicon.ico');
});

test('a 16px fallback cannot win over a later 96px website icon', async () => {
  const service = createFaviconService({ ...defaults(),
    parseLinks: () => [{ rel: 'icon', href: '/desktop/favicon_96x96.png', sizes: '96x96' }],
    loadIcon: async url => ({ src, width: url.endsWith('96x96.png') ? 96 : 16, height: url.endsWith('96x96.png') ? 96 : 16 }),
  });
  const icon = await service.get('https://example.com');
  assert.equal(icon.url, 'https://example.com/desktop/favicon_96x96.png');
  assert.equal(icon.width, 96);
});

test('a stale low-resolution cache upgrades immediately instead of persisting for seven days', async () => {
  const lowIcon = { ...savedIcon, width: 16, height: 16 };
  const cache = memoryCache({ 'https://example.com': { icon: lowIcon, updatedAt: 1000 } });
  const service = createFaviconService({ ...defaults(), cache, now: () => ICON_MISS_TTL + 1001,
    loadIcon: async () => ({ src, width: 96, height: 96 }),
  });
  const icon = await service.get('https://example.com');
  assert.equal(icon.width, 96);
  assert.equal(cache.entries.get('https://example.com').icon.width, 96);
});

test('fresh cached images bypass the network and stale images survive offline refresh', async () => {
  const cache = memoryCache({ 'https://example.com': { icon: savedIcon, updatedAt: 1000 } });
  let attempts = 0;
  const options = { ...defaults(), cache, now: () => 2000, loadIcon: async () => { attempts++; throw new Error('offline'); } };
  assert.deepEqual(await createFaviconService(options).get('https://example.com'), savedIcon);
  assert.equal(attempts, 0);
  options.now = () => ICON_TTL + 2000;
  assert.deepEqual(await createFaviconService(options).get('https://example.com'), savedIcon);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(attempts > 0);
  assert.deepEqual(cache.entries.get('https://example.com').icon, savedIcon);
});

test('missing icons are cached briefly, then retried instead of fetching on every new tab', async () => {
  const cache = memoryCache();
  let attempts = 0;
  let time = 1000;
  const options = { ...defaults(), cache, canDiscover: () => false, now: () => time, loadIcon: async () => { attempts++; throw new Error('missing'); } };
  assert.equal(await createFaviconService(options).get('https://example.com'), null);
  const initial = attempts;
  assert.equal(await createFaviconService(options).get('https://example.com'), null);
  assert.equal(attempts, initial);
  time += ICON_MISS_TTL + 1;
  await createFaviconService(options).get('https://example.com');
  assert.ok(attempts > initial);
});

test('icon requests are limited to three websites at a time', async () => {
  let active = 0;
  let peak = 0;
  const service = createFaviconService({ ...defaults(), canDiscover: () => false, loadIcon: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return src;
  } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => service.get(`https://site${i}.example`)));
  assert.equal(peak, 3);
});

test('metadata fetch omits credentials and referrer and rejects oversized or non-image icon responses', async () => {
  let request;
  const page = await fetchIconResource('https://example.com/', 'https://example.com', 'html', async (url, options) => {
    request = options;
    return new Response('<link rel="apple-touch-icon" href="/icon.png">', { headers: { 'content-type': 'text/html' } });
  });
  assert.ok(page.html.includes('apple-touch-icon'));
  assert.equal(request.credentials, 'omit');
  assert.equal(request.referrerPolicy, 'no-referrer');
  await assert.rejects(fetchIconResource('https://example.com/i', 'https://example.com', 'image', async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })), /Expected image/);
  await assert.rejects(fetchIconResource('https://example.com/i', 'https://example.com', 'image', async () => new Response(new Uint8Array(256 * 1024 + 1), { headers: { 'content-type': 'image/png' } })), /too large/);
});

test('large homepages retain their icon declarations without downloading the body', async () => {
  const head = '<head><link rel="apple-touch-icon" href="/large.png"></head>';
  const page = await fetchIconResource('https://example.com/', 'https://example.com', 'html', async () => new Response(head + 'x'.repeat(600000), {
    headers: { 'content-type': 'text/html', 'content-length': '600100' },
  }));
  assert.equal(page.html, head);
});

test('icon cache serializes writes, persists independently, and rejects malicious cached sources', async () => {
  const values = new Map();
  const env = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
  const cache = createIconCache(env);
  const entry = { icon: savedIcon, updatedAt: Date.now() };
  await Promise.all([cache.put('https://example.com', entry), cache.put('https://second.example', { ...entry, icon: null })]);
  assert.deepEqual(await createIconCache(env).get('https://example.com'), entry);
  assert.ok(Object.hasOwn(JSON.parse(values.get(ICON_CACHE_KEY)), 'https://second.example'));
  await cache.put('https://example.com', { ...entry, icon: { ...savedIcon, src: 'javascript:alert(1)' } });
  assert.equal(await cache.get('https://example.com'), null);
});
