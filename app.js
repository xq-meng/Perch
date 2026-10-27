import { COLORS, MAX_SHORTCUTS, defaultState, normalizeUrl, searchDestination, moveShortcut } from './lib/model.js?v=1.3.0';
import { createStorage } from './lib/storage.js?v=1.3.0';
import { icons } from './lib/icons.js?v=1.3.0';
import { createWebsiteFavicons } from './lib/favicon-browser.js?v=1.3.0';

const $ = (selector) => document.querySelector(selector);
const storage = createStorage();
const favicons = createWebsiteFavicons();
let previewTimer;
let state = defaultState();
let ready = false;
let editing = false;
let editingId = null;
let draggedId = null;
let saveQueue = Promise.resolve();
let toastTimer;
let undoAction = null;
const systemTheme = matchMedia('(prefers-color-scheme: dark)');

document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = icons[element.dataset.icon] || ''; });

function showToast(message, undo = null) {
  clearTimeout(toastTimer);
  $('#toast-text').textContent = message;
  $('#toast-undo').hidden = !undo;
  undoAction = undo;
  $('#toast').hidden = false;
  toastTimer = setTimeout(hideToast, undo ? 10000 : 5000);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
  undoAction = null;
}
$('#toast-close').addEventListener('click', hideToast);
$('#toast-undo').addEventListener('click', async () => {
  const action = undoAction;
  hideToast();
  if (action) {
    try { await action(); showToast('已恢复快捷方式'); }
    catch (error) { showToast(error.message); }
  }
});

function commit(update) {
  const result = saveQueue.catch(() => {}).then(async () => {
    if (!ready) throw new Error('设置暂时无法读取，请刷新页面后重试');
    const next = update(state);
    try { await storage.write(next); }
    catch { throw new Error('保存失败，请检查浏览器存储空间后重试'); }
    state = next;
    render();
  });
  saveQueue = result;
  return result;
}

function applyAppearance() {
  const { theme } = state.settings;
  document.documentElement.dataset.theme = theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
  $('meta[name="theme-color"]').content = document.documentElement.dataset.theme === 'dark' ? '#0d1117' : '#f6f8fa';
}
systemTheme.addEventListener('change', applyAppearance);

function makeIcon(shortcut, loadRemote = true, onError = null) {
  const icon = document.createElement('span');
  icon.className = 'shortcut-icon';
  icon.dataset.color = shortcut.color;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = [...shortcut.name.trim()][0]?.toUpperCase() || '↗';
  if (loadRemote && (shortcut.iconUrl || shortcut.url)) void (shortcut.iconUrl ? favicons.getCustom(shortcut.iconUrl) : favicons.get(shortcut.url)).then((found) => {
    if (!icon.isConnected) return;
    if (!found) { onError?.(); return; }
    const image = new Image(32, 32);
    image.className = 'website-favicon';
    image.alt = '';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (!icon.isConnected) return;
      if (!shortcut.iconUrl) {
        image.style.maxWidth = `${image.naturalWidth}px`;
        image.style.maxHeight = `${image.naturalHeight}px`;
      }
      icon.replaceChildren(image);
      icon.dataset.iconType = found.kind;
      icon.dataset.iconUrl = found.url;
    };
    image.onerror = () => { if (icon.isConnected) onError?.(); };
    image.src = found.src;
  }).catch(() => {});
  return icon;
}

function render() {
  applyAppearance();
  $('#engine-select').value = state.settings.engine;
  $('#engine-icon').innerHTML = icons[state.settings.engine];
  $('#add-shortcut').hidden = state.shortcuts.length >= MAX_SHORTCUTS;
  $('#edit-toggle').setAttribute('aria-pressed', String(editing));
  $('#edit-toggle').setAttribute('aria-label', editing ? '完成整理' : '整理快捷方式');
  $('#edit-toggle').title = editing ? '完成整理' : '整理快捷方式';
  $('#edit-icon').innerHTML = editing ? icons.check : icons.edit;
  $('#edit-hint').hidden = !editing;
  const grid = $('#shortcuts');
  grid.classList.toggle('is-editing', editing);
  grid.replaceChildren();
  if (!state.shortcuts.length) {
    const note = document.createElement('p');
    note.className = 'empty-note';
    note.textContent = '暂无快捷方式';
    grid.append(note);
  }
  state.shortcuts.forEach((shortcut) => {
    const card = document.createElement('article');
    card.className = 'shortcut-card';
    card.dataset.id = shortcut.id;
    card.draggable = editing;
    const link = document.createElement('a');
    link.className = 'shortcut-link';
    link.draggable = false;
    link.href = shortcut.url;
    link.title = `${shortcut.name}\n${shortcut.url}`;
    if (state.settings.newTab) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    link.append(makeIcon(shortcut));
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = shortcut.name;
    link.append(label);
    link.addEventListener('click', (event) => {
      if (!editing) return;
      event.preventDefault();
      openShortcut(shortcut.id);
    });
    card.append(link);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'shortcut-edit';
    edit.setAttribute('aria-label', `编辑 ${shortcut.name}`);
    edit.title = `编辑 ${shortcut.name}`;
    edit.innerHTML = icons.more;
    edit.addEventListener('click', () => openShortcut(shortcut.id));
    card.append(edit);
    card.addEventListener('dragstart', (event) => {
      if (!editing) { event.preventDefault(); return; }
      draggedId = shortcut.id;
      event.dataTransfer.setData('text/plain', shortcut.id);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      draggedId = null;
      grid.querySelectorAll('.is-dragging, .drag-over').forEach((item) => item.classList.remove('is-dragging', 'drag-over'));
    });
    card.addEventListener('dragover', (event) => {
      if (!editing || !draggedId || draggedId === shortcut.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', (event) => { if (!card.contains(event.relatedTarget)) card.classList.remove('drag-over'); });
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      card.classList.remove('drag-over');
      const id = draggedId;
      draggedId = null;
      if (!editing || !id || id === shortcut.id) return;
      try {
        await commit((current) => ({ ...current, shortcuts: moveShortcut(current.shortcuts, id, current.shortcuts.findIndex((item) => item.id === shortcut.id)) }));
        showToast('顺序已保存');
      } catch (error) { showToast(error.message); }
    });
    grid.append(card);
  });
}

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = searchDestination($('#search-input').value, state.settings.engine);
  if (!url) { $('#search-input').focus(); return; }
  if (state.settings.newTab) window.open(url, '_blank', 'noopener,noreferrer');
  else window.location.assign(url);
});
$('#engine-select').addEventListener('change', async (event) => {
  const engine = event.target.value;
  try { await commit((current) => ({ ...current, settings: { ...current.settings, engine } })); }
  catch (error) { $('#engine-select').value = state.settings.engine; showToast(error.message); }
});
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  if (event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  $('#search-input').focus();
});
$('#edit-toggle').addEventListener('click', () => { editing = !editing; render(); });
$('#add-shortcut').addEventListener('click', () => openShortcut());

// Native dialogs supply focus trapping, Escape handling, and focus restoration.
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
});

Object.entries(COLORS).forEach(([value, name]) => {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'color';
  input.value = value;
  input.setAttribute('aria-label', name);
  const swatch = document.createElement('span');
  swatch.className = 'color-swatch';
  swatch.dataset.color = value;
  swatch.title = name;
  label.append(input, swatch);
  $('#shortcut-colors').append(label);
});

function updatePreview() {
  clearTimeout(previewTimer);
  const value = $('#shortcut-url').value;
  let url = '';
  try { url = normalizeUrl(value); } catch { /* Show a letter while typing an incomplete URL. */ }
  let iconUrl = '';
  try { if ($('#shortcut-icon-url').value.trim()) iconUrl = normalizeUrl($('#shortcut-icon-url').value); } catch { /* Validate incomplete icon URLs on save. */ }
  $('#shortcut-icon-error').textContent = '';
  const shortcut = { name: $('#shortcut-name').value || '↗', url, iconUrl, color: $('#shortcut-form').elements.color.value || 'sage' };
  $('#shortcut-preview').replaceChildren(makeIcon(shortcut, false));
  if (url || iconUrl) previewTimer = setTimeout(() => $('#shortcut-preview').replaceChildren(makeIcon(shortcut, true, () => {
    if (iconUrl) $('#shortcut-icon-error').textContent = '无法加载图标，请检查图片 URL';
  })), 350);
}
$('#shortcut-name').addEventListener('input', updatePreview);
$('#shortcut-url').addEventListener('input', () => { $('#shortcut-url').removeAttribute('aria-invalid'); $('#shortcut-error').textContent = ''; updatePreview(); });
$('#shortcut-icon-url').addEventListener('input', () => { $('#shortcut-icon-url').removeAttribute('aria-invalid'); updatePreview(); });
$('#shortcut-colors').addEventListener('change', updatePreview);
$('#shortcut-dialog').addEventListener('close', () => clearTimeout(previewTimer));

function openShortcut(id = null) {
  if (!id && state.shortcuts.length >= MAX_SHORTCUTS) { showToast(`最多可添加 ${MAX_SHORTCUTS} 个快捷方式`); return; }
  const shortcut = id ? state.shortcuts.find((item) => item.id === id) : null;
  if (id && !shortcut) return;
  editingId = id;
  $('#shortcut-form').reset();
  $('#shortcut-name').removeAttribute('aria-invalid');
  $('#shortcut-url').removeAttribute('aria-invalid');
  $('#shortcut-icon-url').removeAttribute('aria-invalid');
  $('#shortcut-error').textContent = '';
  $('#shortcut-dialog-title').textContent = id ? '编辑快捷方式' : '添加快捷方式';
  $('#save-shortcut').textContent = id ? '保存' : '添加';
  $('#delete-shortcut').hidden = !id;
  $('#shortcut-name').value = shortcut?.name || '';
  $('#shortcut-url').value = shortcut?.url || '';
  $('#shortcut-icon-url').value = shortcut?.iconUrl || '';
  $('#shortcut-form').elements.color.value = shortcut?.color || 'sage';
  $('#position-field').hidden = !id;
  $('#shortcut-position').replaceChildren();
  state.shortcuts.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `第 ${index + 1} 位`;
    option.selected = item.id === id;
    $('#shortcut-position').append(option);
  });
  updatePreview();
  $('#shortcut-dialog').showModal();
  $('#shortcut-name').focus();
}

$('#shortcut-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#shortcut-name').value.trim();
  if (!name) {
    $('#shortcut-error').textContent = '请输入名称';
    $('#shortcut-name').setAttribute('aria-invalid', 'true');
    $('#shortcut-name').focus();
    return;
  }
  let url;
  try { url = normalizeUrl($('#shortcut-url').value); }
  catch (error) {
    $('#shortcut-error').textContent = error instanceof TypeError ? '请输入有效的网址，例如 https://example.com' : error.message;
    $('#shortcut-url').setAttribute('aria-invalid', 'true');
    $('#shortcut-url').focus();
    return;
  }
  const id = editingId;
  let iconUrl = '';
  try { if ($('#shortcut-icon-url').value.trim()) iconUrl = normalizeUrl($('#shortcut-icon-url').value); }
  catch {
    $('#shortcut-icon-error').textContent = '请输入有效的图片 URL，或留空自动获取';
    $('#shortcut-icon-url').setAttribute('aria-invalid', 'true');
    $('#shortcut-icon-url').focus();
    return;
  }
  const shortcut = { id: id || crypto.randomUUID(), name, url, color: $('#shortcut-form').elements.color.value, ...(iconUrl ? { iconUrl } : {}) };
  const position = Number($('#shortcut-position').value);
  $('#save-shortcut').disabled = true;
  try {
    await commit((current) => {
      if (id && !current.shortcuts.some((item) => item.id === id)) throw new Error('这个快捷方式已在其他标签页中删除，请关闭后重试');
      if (!id && current.shortcuts.length >= MAX_SHORTCUTS) throw new Error(`最多可添加 ${MAX_SHORTCUTS} 个快捷方式`);
      const shortcuts = id ? current.shortcuts.map((item) => item.id === id ? shortcut : item) : [...current.shortcuts, shortcut];
      return { ...current, shortcuts: id ? moveShortcut(shortcuts, id, position) : shortcuts };
    });
    $('#shortcut-dialog').close();
    showToast(id ? '快捷方式已更新' : '已添加快捷方式');
    if (!id) ($('#add-shortcut').hidden ? $('#edit-toggle') : $('#add-shortcut')).focus();
  } catch (error) { $('#shortcut-error').textContent = error.message; }
  finally { $('#save-shortcut').disabled = false; }
});
$('#shortcut-name').addEventListener('input', () => $('#shortcut-name').removeAttribute('aria-invalid'));

$('#delete-shortcut').addEventListener('click', async () => {
  const index = state.shortcuts.findIndex((item) => item.id === editingId);
  const removed = state.shortcuts[index];
  if (!removed) { $('#shortcut-dialog').close(); return; }
  $('#delete-shortcut').disabled = true;
  try {
    await commit((current) => ({ ...current, shortcuts: current.shortcuts.filter((item) => item.id !== removed.id) }));
    $('#shortcut-dialog').close();
    $('#edit-toggle').focus();
    showToast(`已移除「${removed.name}」`, () => commit((current) => {
      if (current.shortcuts.some((item) => item.id === removed.id)) return current;
      if (current.shortcuts.length >= MAX_SHORTCUTS) throw new Error('快捷方式数量已满，暂时无法恢复');
      const shortcuts = [...current.shortcuts];
      shortcuts.splice(Math.min(index, shortcuts.length), 0, removed);
      return { ...current, shortcuts };
    }));
  } catch (error) { $('#shortcut-error').textContent = error.message; }
  finally { $('#delete-shortcut').disabled = false; }
});

$('#settings-open').addEventListener('click', () => {
  const form = $('#settings-form');
  form.elements.theme.value = state.settings.theme;
  $('#settings-new-tab').checked = state.settings.newTab;
  $('#settings-error').textContent = '';
  $('#settings-dialog').showModal();
});
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = { theme: form.elements.theme.value, newTab: $('#settings-new-tab').checked };
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await commit((current) => ({ ...current, settings: { ...current.settings, ...values } }));
    $('#settings-dialog').close();
    showToast('设置已保存');
  } catch (error) { $('#settings-error').textContent = error.message; }
  finally { button.disabled = false; }
});

try {
  state = await storage.read();
  ready = true;
} catch { showToast('暂时无法读取设置，请刷新页面后重试'); }
render();
storage.subscribe((next) => { state = next; render(); });
