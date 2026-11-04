'use strict';

// UK-style day dot colours (Mon blue … Sun black). Index = Date.getDay() (0 = Sunday).
const DAY_DOTS = [
  { day: 'Sun', color: '#111111', text: '#fff' },
  { day: 'Mon', color: '#1e63d6', text: '#fff' },
  { day: 'Tue', color: '#f5d000', text: '#111' },
  { day: 'Wed', color: '#d62828', text: '#fff' },
  { day: 'Thu', color: '#7b4a21', text: '#fff' },
  { day: 'Fri', color: '#2a9d4b', text: '#fff' },
  { day: 'Sat', color: '#f07f13', text: '#111' },
];
const CAT_ICON = { cake: '🍰', fruit: '🍌', other: '📦' };

const state = {
  items: [],
  presets: [],
  history: [],
  cat: 'all',
  search: '',
  editingId: null,
  expiryTouched: false,
  photoData: undefined, // undefined = unchanged, null = removed, string = new data URL
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- storage (wrapped: private mode can throw) ----------
const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Cafe-Pin': store.get('pin'), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    askPin();
    throw new Error('PIN needed');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}

// ---------- date helpers ----------
function toLocalInput(d) {
  if (!d) return '';
  d = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Day it starts counts as day 1; bin at the end of the last day.
function computeExpiry(start, days) {
  const d = new Date(start);
  d.setDate(d.getDate() + Math.max(1, days) - 1);
  d.setHours(23, 59, 0, 0);
  return d;
}
function fmtDay(d) {
  d = new Date(d);
  const now = new Date();
  const diff = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const label = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${label} ${time === '23:59' ? '(end of day)' : time}`;
}
function relative(exp) {
  const now = new Date();
  const ms = exp - now;
  if (ms <= 0) {
    const h = Math.floor(-ms / 3600000);
    return h < 1 ? 'Past its time – bin it' : h < 48 ? `Overdue by ${h}h – bin it` : `Overdue by ${Math.floor(h / 24)} days – bin it`;
  }
  if (sameDay(exp, now)) return 'Last day – bin at close';
  const days = Math.round((startOfDay(exp) - startOfDay(now)) / 86400000);
  return days === 1 ? 'Bin tomorrow at close' : `Good for ${days} more days`;
}
function statusOf(item) {
  const exp = new Date(item.expiresAt);
  const now = new Date();
  if (now >= exp) return 'expired';
  if (sameDay(exp, now)) return 'today';
  return 'ok';
}
function dot(date, label) {
  const d = new Date(date);
  const s = DAY_DOTS[d.getDay()];
  return `<span class="dot" style="background:${s.color};color:${s.text}" title="${label}: ${s.day}">${s.day}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function photoUrl(file) {
  const pin = store.get('pin');
  return `/photos/${encodeURIComponent(file)}${pin ? `?pin=${encodeURIComponent(pin)}` : ''}`;
}

// ---------- rendering ----------
function itemCard(item, { history = false } = {}) {
  const st = history ? item.status : statusOf(item);
  const lines = [];
  if (item.deliveredAt) lines.push(`<div>${dot(item.deliveredAt, 'Delivered')} <span>Delivered ${fmtDay(item.deliveredAt)}</span></div>`);
  if (item.openedAt) lines.push(`<div>${dot(item.openedAt, 'Out')} <span>Put out ${fmtDay(item.openedAt)}</span></div>`);
  lines.push(`<div>${dot(item.expiresAt, 'Bin')} <strong>Bin ${fmtDay(item.expiresAt)}</strong></div>`);

  const badge = history
    ? `<span class="badge ${item.status}">${item.status === 'binned' ? '🗑 Binned' : '✓ Used up'} ${fmtDay(item.closedAt)}${item.closedBy ? ` by ${esc(item.closedBy)}` : ''}</span>`
    : `<span class="badge ${st}">${relative(new Date(item.expiresAt))}</span>`;

  const actions = history
    ? `<button class="btn small" data-act="restore">Put back</button>
       <button class="btn small ghost" data-act="delete">Delete</button>`
    : `${!item.openedAt ? '<button class="btn small" data-act="putout">Put out now</button>' : ''}
       <button class="btn small danger" data-act="bin">🗑 Binned</button>
       <button class="btn small ok" data-act="used">✓ Used up</button>
       <button class="btn small ghost" data-act="edit">Edit</button>`;

  return `<article class="card item ${st}" data-id="${item.id}">
    ${item.photo ? `<img class="thumb" src="${photoUrl(item.photo)}" alt="Photo of ${esc(item.name)}" loading="lazy" data-act="photo" />` : `<div class="thumb icon">${CAT_ICON[item.category] || '📦'}</div>`}
    <div class="body">
      <h3>${esc(item.name)}</h3>
      ${badge}
      <div class="times">${lines.join('')}</div>
      ${item.notes ? `<p class="notes">${esc(item.notes)}</p>` : ''}
      <p class="meta">${item.loggedBy ? `Logged by ${esc(item.loggedBy)}` : ''}</p>
      <div class="item-actions">${actions}</div>
    </div>
  </article>`;
}

function renderBoard() {
  const q = state.search.trim().toLowerCase();
  const items = state.items
    .filter((i) => state.cat === 'all' || i.category === state.cat)
    .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.notes || '').toLowerCase().includes(q))
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));

  const groups = { expired: [], today: [], ok: [] };
  items.forEach((i) => groups[statusOf(i)].push(i));

  const all = state.items.map(statusOf);
  const count = (s) => all.filter((x) => x === s).length;
  $('#summary').innerHTML = `
    <div class="stat expired"><b>${count('expired')}</b> bin now</div>
    <div class="stat today"><b>${count('today')}</b> last day</div>
    <div class="stat ok"><b>${count('ok')}</b> in date</div>`;

  const section = (title, list, cls) => list.length
    ? `<h2 class="group ${cls}">${title}</h2>${list.map((i) => itemCard(i)).join('')}` : '';

  $('#board').innerHTML = items.length
    ? section('🚨 Bin now', groups.expired, 'expired') + section('⏰ Last day today', groups.today, 'today') + section('✅ In date', groups.ok, 'ok')
    : `<div class="empty">${q || state.cat !== 'all' ? 'Nothing matches.' : 'Nothing logged yet. Tap <b>＋ Log</b> when you open a cake or a fruit delivery arrives.'}</div>`;
}

function renderHistory() {
  const list = state.history
    .filter((i) => i.status !== 'active')
    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
    .slice(0, 200);
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = list.filter((i) => new Date(i.closedAt) >= weekAgo);
  const binned = recent.filter((i) => i.status === 'binned').length;
  const used = recent.filter((i) => i.status === 'used').length;
  $('#wasteStats').innerHTML = `
    <div class="stat expired"><b>${binned}</b> binned (7 days)</div>
    <div class="stat ok"><b>${used}</b> used up (7 days)</div>`;
  $('#history').innerHTML = list.length ? list.map((i) => itemCard(i, { history: true })).join('') : '<div class="empty">No history yet.</div>';
}

function renderPresets() {
  const byCat = (c) => state.presets.filter((p) => p.category === c).sort((a, b) => a.name.localeCompare(b.name));
  $('#presets').innerHTML = ['cake', 'fruit', 'other'].map((c) => {
    const list = byCat(c);
    if (!list.length) return '';
    return `<div class="card"><h3>${CAT_ICON[c]} ${c[0].toUpperCase() + c.slice(1)}</h3>
      ${list.map((p) => `<div class="preset" data-id="${p.id}">
        <span>${esc(p.name)}</span>
        <label><input type="number" min="1" max="60" value="${p.days}" data-preset-days /> days</label>
        <button class="btn small ghost" data-preset-del title="Remove">✕</button>
      </div>`).join('')}</div>`;
  }).join('');
  $('#presetList').innerHTML = state.presets.map((p) => `<option value="${esc(p.name)}">${p.days} day${p.days > 1 ? 's' : ''}</option>`).join('');
  $('#dotLegend').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((i) => `<span class="dot" style="background:${DAY_DOTS[i].color};color:${DAY_DOTS[i].text}">${DAY_DOTS[i].day}</span>`).join('');
}

// ---------- data loading ----------
async function loadActive() {
  state.items = await api('/api/items?status=active');
  renderBoard();
}
async function loadHistory() {
  state.history = await api('/api/items?status=all');
  renderHistory();
}
async function loadPresets() {
  state.presets = await api('/api/presets');
  renderPresets();
}
async function refresh() {
  try {
    await Promise.all([loadActive(), loadPresets()]);
    if (!$('#view-history').hidden) await loadHistory();
  } catch (e) {
    if (e.message !== 'PIN needed') toast(e.message);
  }
}

// ---------- add / edit form ----------
const form = $('#itemForm');

function openItemForm(item) {
  state.editingId = item ? item.id : null;
  state.photoData = undefined;
  state.expiryTouched = !!item;
  form.reset();
  $('#formError').hidden = true;
  $('#itemFormTitle').textContent = item ? 'Edit' : 'Log cake / fruit';
  const cat = item ? item.category : 'cake';
  form.category.value = cat;
  form.name.value = item ? item.name : '';
  form.notes.value = item ? item.notes : '';
  if (item) {
    form.deliveredAt.value = toLocalInput(item.deliveredAt);
    form.openedAt.value = toLocalInput(item.openedAt);
    form.expiresAt.value = toLocalInput(item.expiresAt);
  } else {
    applyCategoryDefaults(cat);
  }
  const prev = $('#photoPreview');
  prev.hidden = !(item && item.photo);
  if (item && item.photo) prev.src = photoUrl(item.photo);
  $('#itemDialog').showModal();
  if (!item) setTimeout(() => form.name.focus(), 50);
}

function applyCategoryDefaults(cat) {
  const now = toLocalInput(new Date());
  // Fruit: log the delivery now, "put out" later. Cakes: opened now.
  form.deliveredAt.value = cat === 'fruit' ? now : '';
  form.openedAt.value = cat === 'fruit' ? '' : now;
  form.days.value = cat === 'fruit' ? 5 : 3;
  updateExpiry();
}

function updateExpiry() {
  const startVal = form.category.value === 'fruit'
    ? form.deliveredAt.value || form.openedAt.value
    : form.openedAt.value || form.deliveredAt.value;
  const days = Number(form.days.value) || 1;
  if (startVal && !state.expiryTouched) form.expiresAt.value = toLocalInput(computeExpiry(new Date(startVal), days));
  const exp = form.expiresAt.value ? new Date(form.expiresAt.value) : null;
  $('#expiryHint').textContent = exp ? `${DAY_DOTS[exp.getDay()].day} day dot · ${relative(exp)}` : '';
}

form.addEventListener('change', (e) => {
  const t = e.target;
  if (t.name === 'category' && !state.editingId) applyCategoryDefaults(t.value);
  if (t.name === 'name') {
    const p = state.presets.find((x) => x.name.toLowerCase() === t.value.trim().toLowerCase());
    if (p) {
      form.days.value = p.days;
      if (form.category.value !== p.category) {
        form.category.value = p.category;
        if (!state.editingId) applyCategoryDefaults(p.category);
        form.days.value = p.days;
      }
      state.expiryTouched = false;
    }
  }
  if (t.name === 'days' || t.name === 'deliveredAt' || t.name === 'openedAt' || t.name === 'name') {
    if (t.name !== 'name') state.expiryTouched = false;
    updateExpiry();
  }
  if (t.name === 'expiresAt') {
    state.expiryTouched = true;
    updateExpiry();
  }
});
form.addEventListener('input', (e) => {
  if (e.target.name === 'days') { state.expiryTouched = false; updateExpiry(); }
});

$$('[data-now]').forEach((b) => b.addEventListener('click', () => {
  form[b.dataset.now].value = toLocalInput(new Date());
  state.expiryTouched = false;
  updateExpiry();
}));

form.photoFile.addEventListener('change', async () => {
  const file = form.photoFile.files[0];
  if (!file) return;
  try {
    state.photoData = await resizeImage(file, 1024, 0.75);
    const prev = $('#photoPreview');
    prev.src = state.photoData;
    prev.hidden = false;
  } catch {
    toast("Couldn't read that photo");
  }
});

function resizeImage(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

$('#cancelItem').addEventListener('click', () => $('#itemDialog').close());

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: form.name.value,
    category: form.category.value,
    deliveredAt: fromLocalInput(form.deliveredAt.value),
    openedAt: fromLocalInput(form.openedAt.value),
    expiresAt: fromLocalInput(form.expiresAt.value),
    notes: form.notes.value,
  };
  if (!state.editingId) body.loggedBy = store.get('name');
  if (state.photoData !== undefined) body.photo = state.photoData;
  const btn = $('#saveItem');
  btn.disabled = true;
  try {
    if (state.editingId) await api(`/api/items/${state.editingId}`, { method: 'PATCH', body });
    else await api('/api/items', { method: 'POST', body });
    $('#itemDialog').close();
    toast(state.editingId ? 'Updated' : `Logged ${body.name}`);
    await loadActive();
  } catch (err) {
    $('#formError').textContent = err.message;
    $('#formError').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---------- card actions ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const card = el.closest('[data-id]');
  const id = card && card.dataset.id;
  const item = [...state.items, ...state.history].find((i) => i.id === id);
  if (!item) return;
  const act = el.dataset.act;
  const who = store.get('name');
  try {
    if (act === 'photo') {
      $('#photoBig').src = photoUrl(item.photo);
      $('#photoDialog').showModal();
      return;
    }
    if (act === 'edit') return openItemForm(item);
    if (act === 'putout') {
      await api(`/api/items/${id}`, { method: 'PATCH', body: { openedAt: new Date().toISOString() } });
      toast(`${item.name} put out`);
    }
    if (act === 'bin' || act === 'used') {
      await api(`/api/items/${id}`, { method: 'PATCH', body: { status: act === 'bin' ? 'binned' : 'used', by: who } });
      toast(act === 'bin' ? `🗑 ${item.name} binned` : `✓ ${item.name} used up`);
    }
    if (act === 'restore') {
      await api(`/api/items/${id}`, { method: 'PATCH', body: { status: 'active' } });
      toast(`${item.name} is back on the board`);
    }
    if (act === 'delete') {
      if (!confirm(`Delete ${item.name} permanently?`)) return;
      await api(`/api/items/${id}`, { method: 'DELETE' });
    }
    await loadActive();
    if (!$('#view-history').hidden) await loadHistory();
  } catch (err) {
    if (err.message !== 'PIN needed') toast(err.message);
  }
});

// ---------- presets ----------
$('#presets').addEventListener('change', async (e) => {
  if (!e.target.matches('[data-preset-days]')) return;
  const id = e.target.closest('[data-id]').dataset.id;
  const p = state.presets.find((x) => x.id === id);
  try {
    await api(`/api/presets/${id}`, { method: 'PUT', body: { ...p, days: Number(e.target.value) } });
    toast(`${p.name}: ${e.target.value} days`);
    await loadPresets();
  } catch (err) { toast(err.message); }
});
$('#presets').addEventListener('click', async (e) => {
  if (!e.target.matches('[data-preset-del]')) return;
  const id = e.target.closest('[data-id]').dataset.id;
  const p = state.presets.find((x) => x.id === id);
  if (!confirm(`Remove ${p.name} from the list?`)) return;
  try { await api(`/api/presets/${id}`, { method: 'DELETE' }); await loadPresets(); } catch (err) { toast(err.message); }
});
$('#presetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/presets', { method: 'POST', body: { name: f.name.value, category: f.category.value, days: Number(f.days.value) } });
    f.reset();
    await loadPresets();
  } catch (err) { toast(err.message); }
});

// ---------- tabs, filters, search ----------
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${t.dataset.view}`; });
  $('#addBtn').hidden = t.dataset.view === 'settings';
  if (t.dataset.view === 'history') loadHistory().catch((err) => toast(err.message));
}));
$('#catFilters').addEventListener('click', (e) => {
  const c = e.target.closest('[data-cat]');
  if (!c) return;
  state.cat = c.dataset.cat;
  $$('#catFilters .chip').forEach((x) => x.classList.toggle('active', x === c));
  renderBoard();
});
$('#search').addEventListener('input', (e) => { state.search = e.target.value; renderBoard(); });
$('#addBtn').addEventListener('click', () => {
  if (!store.get('name')) return askName(() => openItemForm());
  openItemForm();
});

// ---------- PIN & name ----------
let pinOpen = false;
function askPin() {
  if (pinOpen) return;
  pinOpen = true;
  $('#pinDialog').showModal();
}
$('#pinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  store.set('pin', e.target.pin.value);
  const res = await fetch('/api/config', { headers: { 'X-Cafe-Pin': e.target.pin.value } });
  if (res.ok) {
    pinOpen = false;
    $('#pinError').hidden = true;
    $('#pinDialog').close();
    e.target.reset();
    refresh();
  } else {
    $('#pinError').hidden = false;
  }
});
$('#pinDialog').addEventListener('cancel', (e) => e.preventDefault());
$('#forgetPin').addEventListener('click', () => { store.del('pin'); toast('PIN forgotten on this device'); });

let afterName = null;
function askName(cb) {
  afterName = cb || null;
  $('#nameForm').name.value = store.get('name');
  $('#nameDialog').showModal();
}
$('#nameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  store.set('name', e.target.name.value.trim());
  $('#nameDialog').close();
  renderWho();
  if (afterName) { const cb = afterName; afterName = null; cb(); }
});
function renderWho() {
  const n = store.get('name');
  $('#whoBtn').textContent = n ? `👤 ${n}` : '👤 Set name';
}
$('#whoBtn').addEventListener('click', () => askName());

// ---------- misc ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

renderWho();
refresh();
setInterval(refresh, 60000); // pick up what colleagues have logged
setInterval(renderBoard, 30000); // keep countdowns fresh
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
