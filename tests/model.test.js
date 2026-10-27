import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { normalizeUrl, searchDestination, normalizeState, defaultState, moveShortcut, MAX_SHORTCUTS, STORAGE_KEY } from '../lib/model.js';
import { createStorage } from '../lib/storage.js';

test('web addresses are normalized without losing paths, queries, or fragments', () => {
  assert.equal(normalizeUrl(' example.com/path?a=1#section '), 'https://example.com/path?a=1#section');
  assert.equal(normalizeUrl('http://localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(normalizeUrl('127.0.0.1:5173'), 'https://127.0.0.1:5173/');
  assert.equal(normalizeUrl('https://例子.中国/'), 'https://xn--fsqu00a.xn--fiqs8s/');
});

test('shortcut URLs cannot execute scripts or smuggle credentials', () => {
  for (const value of ['', 'hello world', 'javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'chrome://settings', 'ftp://example.com', 'https://user:pass@example.com', 'https://', 'something']) {
    assert.throws(() => normalizeUrl(value), undefined, value);
  }
});

test('search routes addresses directly, encodes text, and handles empty input', () => {
  assert.equal(searchDestination('   '), null);
  assert.equal(searchDestination('example.com/a?q=1'), 'https://example.com/a?q=1');
  assert.equal(searchDestination('http://localhost:3000/'), 'http://localhost:3000/');
  assert.equal(searchDestination('中文 & a/b?', 'baidu'), 'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%26%20a%2Fb%3F');
  assert.equal(searchDestination('hello', 'bing'), 'https://www.bing.com/search?q=hello');
  assert.equal(searchDestination('hello', 'duckduckgo'), 'https://duckduckgo.com/?q=hello');
  assert.equal(searchDestination('hello', 'missing'), 'https://www.google.com/search?q=hello');
  assert.equal(searchDestination('javascript:alert(1)'), 'https://www.google.com/search?q=javascript%3Aalert(1)');
});

test('invalid settings fall back safely while intentionally empty lists stay empty', () => {
  assert.deepEqual(normalizeState(null), defaultState());
  assert.deepEqual(normalizeState([]), defaultState());
  const state = normalizeState({ settings: { theme: 'invalid', accent: 'invalid', engine: '__proto__', clock: 'yes', newTab: 1, name: '  Hi  ' }, shortcuts: [] });
  assert.deepEqual(state.settings, { name: 'Hi', theme: 'light', engine: 'google', newTab: false });
  assert.deepEqual(state.shortcuts, []);
});

test('stored shortcuts discard bad URLs and duplicate IDs, and enforce the limit', () => {
  const shortcut = { id: 'a', name: ' A ', url: 'example.com', color: 'invalid' };
  const state = normalizeState({ shortcuts: [shortcut, shortcut, { ...shortcut, id: 'b', url: 'javascript:alert(1)' }, null] });
  assert.deepEqual(state.shortcuts, [{ id: 'a', name: 'A', url: 'https://example.com/', color: 'sage' }]);
  assert.equal(normalizeState({ shortcuts: Array.from({ length: 60 }, (_, i) => ({ ...shortcut, id: String(i) })) }).shortcuts.length, MAX_SHORTCUTS);
});

test('reordering supports both directions without mutating the original', () => {
  const list = ['a', 'b', 'c'].map(id => ({ id }));
  assert.deepEqual(moveShortcut(list, 'a', 2).map(item => item.id), ['b', 'c', 'a']);
  assert.deepEqual(moveShortcut(list, 'c', 0).map(item => item.id), ['c', 'a', 'b']);
  assert.deepEqual(moveShortcut(list, 'b', 100).map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(moveShortcut(list, 'missing', 0), list);
  assert.deepEqual(list.map(item => item.id), ['a', 'b', 'c']);
});

test('browser preview persists data and receives storage events', async () => {
  const values = new Map();
  const listeners = new Map();
  const env = {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  };
  const storage = createStorage(env);
  assert.deepEqual(await storage.read(), defaultState());
  const saved = { ...defaultState(), shortcuts: [] };
  await storage.write(saved);
  assert.deepEqual(await storage.read(), saved);
  let received;
  const unsubscribe = storage.subscribe(state => { received = state; });
  listeners.get('storage')({ key: STORAGE_KEY, newValue: JSON.stringify(saved) });
  assert.deepEqual(received, saved);
  listeners.get('storage')({ key: STORAGE_KEY, newValue: '{' });
  assert.deepEqual(received, saved);
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test('extension uses chrome.storage.local and synchronizes only its own key', async () => {
  const values = {};
  let listener;
  const env = { chrome: { runtime: { id: 'test-extension' }, storage: {
    local: { get: async key => ({ [key]: values[key] }), set: async object => Object.assign(values, object) },
    onChanged: { addListener: fn => { listener = fn; }, removeListener: () => { listener = null; } },
  } } };
  const storage = createStorage(env);
  const saved = defaultState();
  saved.settings.theme = 'dark';
  await storage.write(saved);
  assert.deepEqual(await storage.read(), saved);
  let received;
  const unsubscribe = storage.subscribe(state => { received = state; });
  listener({ other: { newValue: {} } }, 'local');
  listener({ [STORAGE_KEY]: { newValue: saved } }, 'sync');
  assert.equal(received, undefined);
  listener({ [STORAGE_KEY]: { newValue: saved } }, 'local');
  assert.deepEqual(received, saved);
  listener({ [STORAGE_KEY]: {} }, 'local');
  assert.deepEqual(received, defaultState());
  unsubscribe();
  assert.equal(listener, null);
});

test('storage failures remain visible to callers', async () => {
  const env = { localStorage: { getItem: () => { throw new Error('unavailable'); }, setItem: () => { throw new Error('quota'); } } };
  const storage = createStorage(env);
  await assert.rejects(storage.read(), /unavailable/);
  await assert.rejects(storage.write(defaultState()), /quota/);
});

test('manifest is loadable and every extension asset exists', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://*/*', 'http://*/*']);
  await access(new URL(manifest.chrome_url_overrides.newtab, root));
  for (const [size, path] of Object.entries(manifest.icons)) {
    const data = await readFile(new URL(path, root));
    assert.equal(data.subarray(1, 4).toString(), 'PNG');
    assert.equal(data.readUInt32BE(16), Number(size));
    assert.equal(data.readUInt32BE(20), Number(size));
  }
});
