export const ICON_CACHE_KEY = 'qipage.icons.v2';
export const ICON_TTL = 7 * 24 * 60 * 60 * 1000;
export const ICON_MISS_TTL = 15 * 60 * 1000;

export function websiteOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid website');
  return url.origin;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (!host.includes('.') || host.includes(':') || host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// A site may use its own origin or a public HTTPS CDN. Do not follow metadata
// to scripts, credential-bearing URLs, or unrelated local network services.
export function iconUrl(value, base, origin) {
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.origin !== origin && (url.protocol !== 'https:' || isPrivateHost(url.hostname))) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

function sizeRank(sizes, target) {
  const values = String(sizes || '').toLowerCase().split(/\s+/).flatMap((size) => {
    if (size === 'any') return [target];
    const match = /^(\d+)x(\d+)$/.exec(size);
    return match ? [Math.min(Number(match[1]), Number(match[2]))] : [];
  }).filter((size) => size > 0);
  if (!values.length) return 100000;
  const larger = values.filter((size) => size >= target);
  return larger.length ? Math.min(...larger) - target : 10000 - Math.max(...values);
}

export function iconCandidates(origin, links = []) {
  origin = websiteOrigin(origin);
  const apple = [];
  const regular = [];
  for (const link of links) {
    const rel = String(link.rel || '').toLowerCase().split(/\s+/);
    const url = iconUrl(link.href, `${origin}/`, origin);
    if (!url) continue;
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      apple.push({ url, kind: 'apple-touch-icon', rank: sizeRank(link.sizes, 180) });
    } else if (rel.includes('icon')) {
      regular.push({ url, kind: 'favicon', rank: sizeRank(link.sizes, 80) });
    }
  }
  const bySize = (a, b) => a.rank - b.rank;
  const candidates = [
    ...apple.sort(bySize).slice(0, 3),
    { url: `${origin}/apple-touch-icon.png`, kind: 'apple-touch-icon' },
    { url: `${origin}/apple-touch-icon-180x180.png`, kind: 'apple-touch-icon' },
    { url: `${origin}/apple-touch-icon-precomposed.png`, kind: 'apple-touch-icon' },
    ...regular.sort(bySize).slice(0, 3),
    { url: `${origin}/favicon.ico`, kind: 'favicon' },
  ];
  const seen = new Set();
  return candidates.filter(({ url }) => !seen.has(url) && seen.add(url)).map(({ url, kind }) => ({ url, kind }));
}

export function createFaviconService({ cache, fetchPage, parseLinks, loadIcon, canDiscover = () => true, now = Date.now, concurrency = 3 }) {
  const pending = new Map();
  const waiting = [];
  let active = 0;
  async function limited(task) {
    if (active >= concurrency) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try { return await task(); }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  }
  async function resolve(origin, stale) {
    let links = [];
    let lowResolution = null;
    if (canDiscover(origin)) {
      try {
        // Deliberately request only the origin's homepage, without a shortcut's
        // private path, query string, fragment, or login credentials.
        const page = await fetchPage(`${origin}/`);
        if (iconUrl(page.url, `${origin}/`, origin)) links = parseLinks(page.html, page.url, origin);
      } catch { /* Conventional Apple icon paths still work without HTML. */ }
    }
    for (const candidate of iconCandidates(origin, links)) {
      try {
        const loaded = await loadIcon(candidate.url, origin);
        if (!loaded) continue;
        const image = typeof loaded === 'string' ? { src: loaded } : loaded;
        const icon = { ...image, url: candidate.url, kind: candidate.kind };
        if (Number.isFinite(icon.width) && Math.max(icon.width, icon.height) < 64) {
          if (!lowResolution || icon.width > lowResolution.width) lowResolution = icon;
          continue;
        }
        await cache.put(origin, { icon, updatedAt: now() }).catch(() => {});
        return icon;
      } catch { /* Try the next website-provided icon, keeping the letter visible. */ }
    }
    if (stale?.icon) return stale.icon;
    if (lowResolution) {
      await cache.put(origin, { icon: lowResolution, updatedAt: now() }).catch(() => {});
      return lowResolution;
    }
    await cache.put(origin, { icon: null, updatedAt: now() }).catch(() => {});
    return null;
  }
  return {
    get(value) {
      let origin;
      try { origin = websiteOrigin(value); } catch { return Promise.resolve(null); }
      if (!pending.has(origin)) pending.set(origin, (async () => {
        const cached = await cache.get(origin).catch(() => null);
        const lowResolution = Number.isFinite(cached?.icon?.width) && Math.max(cached.icon.width, cached.icon.height) < 64;
        const ttl = cached?.icon && !lowResolution ? ICON_TTL : ICON_MISS_TTL;
        if (cached && now() - cached.updatedAt < ttl) return cached.icon;
        if (cached?.icon && !lowResolution) {
          void limited(() => resolve(origin, cached)).catch(() => {});
          return cached.icon;
        }
        return limited(() => resolve(origin, cached));
      })().catch(() => null));
      return pending.get(origin);
    },
  };
}
