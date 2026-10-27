// Keep the legacy storage identifier so the Perch rename preserves saved data.
export const STORAGE_KEY = 'qipage.v1';
export const MAX_SHORTCUTS = 48;
export const COLORS = { sage: '绿色', sand: '黄色', lavender: '紫色', blue: '蓝色', rose: '红色', slate: '灰色' };
export const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
};
export function defaultState() {
  return {
    settings: { name: '', theme: 'light', engine: 'google', newTab: false },
    shortcuts: [
      { id: 'github', name: 'GitHub', url: 'https://github.com/', color: 'slate' },
      { id: 'notion', name: 'Notion', url: 'https://www.notion.so/', color: 'sand' },
      { id: 'figma', name: 'Figma', url: 'https://www.figma.com/', color: 'lavender' },
      { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', color: 'rose' },
      { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com/', color: 'blue' },
      { id: 'bilibili', name: '哔哩哔哩', url: 'https://www.bilibili.com/', color: 'sage' },
    ],
  };
}

export function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 2048 || /\s/.test(text)) throw new Error('请输入有效的网址，例如 https://example.com');
  // Only web addresses are accepted, including local development addresses.
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^(localhost|[\w.-]+\.\w+|\d{1,3}(?:\.\d{1,3}){3}):\d+(?:[/?#]|$)/i.test(text);
  const url = new URL(hasScheme ? text : `https://${text}`);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('仅支持 http 或 https 网址，请勿填写脚本或其他协议');
  }
  if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.includes(':')) {
    throw new Error('请输入完整域名，例如 example.com');
  }
  return url.href;
}

export function searchDestination(value, engine = 'google') {
  const query = String(value ?? '').trim();
  if (!query) return null;
  // Treat ordinary words as searches, even when they could be host names.
  if (/^https?:\/\//i.test(query) || /^(?:localhost(?::\d+)?|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+(?::\d+)?|\[[a-f\d:]+\](?::\d+)?)(?:[/?#][^\s]*)?$/iu.test(query)) {
    try { return normalizeUrl(query); } catch { /* Invalid addresses become search terms. */ }
  }
  return (ENGINES[engine] || ENGINES.google).url + encodeURIComponent(query);
}

export function normalizeState(raw) {
  const defaults = defaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const input = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = {
    name: typeof input.name === 'string' ? input.name.trim().slice(0, 20) : '',
    theme: ['light', 'dark', 'system'].includes(input.theme) ? input.theme : 'light',
    engine: Object.hasOwn(ENGINES, input.engine) ? input.engine : 'google',
    newTab: typeof input.newTab === 'boolean' ? input.newTab : false,
  };
  const seen = new Set();
  const shortcuts = Array.isArray(raw.shortcuts) ? raw.shortcuts.flatMap((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) return [];
    try {
      const shortcut = { id: item.id, name: item.name.trim().slice(0, 32), url: normalizeUrl(item.url), color: Object.hasOwn(COLORS, item.color) ? item.color : 'sage' };
      seen.add(item.id);
      return [shortcut];
    } catch { return []; }
  }).slice(0, MAX_SHORTCUTS) : defaults.shortcuts;
  return { settings, shortcuts };
}

export function moveShortcut(shortcuts, id, index) {
  const result = [...shortcuts];
  const from = result.findIndex((item) => item.id === id);
  if (from < 0) return result;
  const [item] = result.splice(from, 1);
  result.splice(Math.max(0, Math.min(index, result.length)), 0, item);
  return result;
}
