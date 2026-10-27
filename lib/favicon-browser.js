import { ICON_CACHE_KEY, createFaviconService, iconUrl } from './favicon.js?v=1.3.0';

const MAX_SOURCE_LENGTH = 128 * 1024;
const CACHE_LIMIT = 4 * 1024 * 1024;
const extension = Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
let helperAvailable;

function previewEndpoint(path, url) {
  const endpoint = new URL(`/__perch/${path}`, location.origin);
  if (url) endpoint.searchParams.set('url', url);
  return endpoint.href;
}

async function hasPreviewHelper() {
  if (extension) return false;
  if (!helperAvailable) helperAvailable = fetch(previewEndpoint('status'), {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(1500),
  }).then(async response => response.ok && (await response.json()).service === 'perch-icon-preview').catch(() => false);
  return helperAvailable;
}

async function fetchWebsitePage(url) {
  if (extension || new URL(url).origin === location.origin) return fetchIconResource(url, new URL(url).origin, 'html');
  if (!await hasPreviewHelper()) throw new Error('Icon discovery requires the preview helper or Chrome extension');
  const response = await fetch(previewEndpoint('metadata', url), {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6500),
  });
  if (!response.ok) throw new Error('Website metadata unavailable');
  const page = await response.json();
  if (typeof page.html !== 'string' || page.html.length > 512 * 1024 || !iconUrl(page.url, url, new URL(url).origin)) throw new Error('Invalid website metadata');
  return page;
}

function validCachedIcon(icon, key) {
  if (!icon || typeof icon.src !== 'string' || icon.src.length > MAX_SOURCE_LENGTH) return false;
  let origin;
  try { origin = new URL(key).origin; } catch { return false; }
  if (!['apple-touch-icon', 'favicon', 'custom'].includes(icon.kind) || !iconUrl(icon.url, `${origin}/`, origin)) return false;
  if (icon.kind === 'custom' && icon.url !== key) return false;
  return /^data:image\/png;base64,[a-z\d+/=]+$/i.test(icon.src) || (!extension && Boolean(iconUrl(icon.src, `${origin}/`, origin)));
}

export function createIconCache(environment = globalThis) {
  const useChrome = Boolean(environment.chrome?.runtime?.id && environment.chrome?.storage?.local);
  let entries;
  let queue = Promise.resolve();
  async function all() {
    if (!entries) entries = (async () => {
      try {
        if (useChrome) await environment.chrome.storage.local.remove?.('qipage.icons.v1');
        else environment.localStorage.removeItem?.('qipage.icons.v1');
        const raw = useChrome ? (await environment.chrome.storage.local.get(ICON_CACHE_KEY))[ICON_CACHE_KEY]
          : JSON.parse(environment.localStorage.getItem(ICON_CACHE_KEY) || '{}');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      } catch { return {}; }
    })();
    return entries;
  }
  return {
    async get(origin) {
      const entry = (await all())[origin];
      if (!entry || !Number.isFinite(entry.updatedAt) || entry.updatedAt > Date.now() + 60000) return null;
      return entry.icon === null || validCachedIcon(entry.icon, origin) ? entry : null;
    },
    put(origin, entry) {
      queue = queue.catch(() => {}).then(async () => {
        const current = await all();
        current[origin] = entry;
        const ordered = Object.keys(current).sort((a, b) => (current[b]?.updatedAt || 0) - (current[a]?.updatedAt || 0));
        let length = 0;
        ordered.forEach((key, index) => {
          length += JSON.stringify(current[key]).length + key.length;
          if (index >= 64 || length > CACHE_LIMIT) delete current[key];
        });
        if (useChrome) await environment.chrome.storage.local.set({ [ICON_CACHE_KEY]: current });
        else environment.localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(current));
      });
      return queue;
    },
  };
}

export function parseIconLinks(html, pageUrl, origin) {
  // Template contents remain inert and are never attached to the document.
  // Remote scripts, images, iframes, and event handlers are not executed.
  const template = document.createElement('template');
  template.innerHTML = html;
  const base = iconUrl(template.content.querySelector('base[href]')?.getAttribute('href'), pageUrl, origin) || pageUrl;
  return [...template.content.querySelectorAll('link[rel][href]')].map((link) => ({
    rel: link.getAttribute('rel'),
    sizes: link.getAttribute('sizes'),
    href: iconUrl(link.getAttribute('href'), base, origin),
  }));
}

export async function fetchIconResource(url, origin, type, fetchImpl = fetch, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const limit = type === 'html' ? 512 * 1024 : 256 * 1024;
  try {
    const response = await fetchImpl(url, {
      credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
      headers: { Accept: type === 'html' ? 'text/html,application/xhtml+xml' : 'image/*' },
    });
    if (!response.ok || !iconUrl(response.url || url, url, origin)) throw new Error('Icon request failed');
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase().trim();
    if (type === 'html' && !['text/html', 'application/xhtml+xml'].includes(mime)) throw new Error('Expected HTML');
    if (type === 'image' && !mime.startsWith('image/') && mime !== 'application/octet-stream') throw new Error('Expected image');
    if (type === 'image' && Number(response.headers.get('content-length')) > limit) throw new Error('Resource too large');
    const reader = response.body.getReader();
    const chunks = [];
    const decoder = new TextDecoder();
    let html = '';
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (type === 'html') {
        const part = value.subarray(0, limit - length);
        length += part.byteLength;
        html += decoder.decode(part, { stream: true });
        const headEnd = /<\/head\s*>/i.exec(html);
        if (headEnd || length >= limit) {
          await reader.cancel();
          return { html: headEnd ? html.slice(0, headEnd.index + headEnd[0].length) : html + decoder.decode(), url: response.url || url };
        }
      } else {
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); throw new Error('Resource too large'); }
        chunks.push(value);
      }
    }
    if (type === 'html') return { html: html + decoder.decode(), url: response.url || url };
    const blob = new Blob(chunks, { type: mime });
    return blob;
  } catch (error) { controller.abort(); throw error; }
  finally { clearTimeout(timer); }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('Icon timed out')); }, 2500);
    function cleanup() { clearTimeout(timer); image.onload = null; image.onerror = null; }
    image.onload = () => {
      cleanup();
      if (image.naturalWidth < 8 || image.naturalHeight < 8 || image.naturalWidth > 8192 || image.naturalHeight > 8192) reject(new Error('Invalid icon size'));
      else resolve(image);
    };
    image.onerror = () => { cleanup(); reject(new Error('Icon unavailable')); };
    image.src = src;
  });
}

function rasterize(image) {
  const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const source = canvas.toDataURL('image/png');
  if (source.length > MAX_SOURCE_LENGTH) throw new Error('Icon too large to cache');
  return { src: source, width: canvas.width, height: canvas.height };
}

async function loadWebsiteIcon(url, origin) {
  if (!extension) {
    if (new URL(url).origin === location.origin) return rasterize(await loadImage(url));
    if (await hasPreviewHelper()) {
      const blob = await fetchIconResource(previewEndpoint('image', url), location.origin, 'image', fetch, 6500);
      const objectUrl = URL.createObjectURL(blob);
      try { return rasterize(await loadImage(objectUrl)); }
      finally { URL.revokeObjectURL(objectUrl); }
    }
    // Plain static servers can only display conventional image URLs.
    const image = await loadImage(url);
    return { src: url, width: image.naturalWidth, height: image.naturalHeight };
  }
  const blob = await fetchIconResource(url, origin, 'image');
  const objectUrl = URL.createObjectURL(blob);
  try { return rasterize(await loadImage(objectUrl)); }
  finally { URL.revokeObjectURL(objectUrl); }
}

export function createWebsiteFavicons() {
  return createFaviconService({
    cache: createIconCache(),
    fetchPage: fetchWebsitePage,
    parseLinks: parseIconLinks,
    loadIcon: loadWebsiteIcon,
  });
}
