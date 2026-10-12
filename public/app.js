// Keep in sync with lib/validate.mjs and db/schema.sql.
const OPTIONS = {
  status: ['Not started', 'In progress', 'Done'],
  category: ['Travel', 'Adventure', 'Food', 'Learning', 'Experience', 'Other'],
};
const FIELDS = ['name', 'item', 'target_date', 'status', 'category', 'notes'];
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const STORE = 'bucket-lists'; // lists opened on this device: [{ code, title }]

const $ = (sel) => document.querySelector(sel);
const home = $('#home');
const board = $('#board');
const createForm = $('#create-form');
const joinForm = $('#join-form');
const copyBtn = $('#copy-btn');
const form = $('#item-form');
// namedItem, because form.elements.item is the collection's item() method, not the "item" input.
const field = (name) => form.elements.namedItem(name);
const formTitle = $('#form-title');
const submitBtn = $('#submit-btn');
const cancelBtn = $('#cancel-btn');
const message = $('#message');
const list = $('#list');
const rowTpl = $('#row-tpl');
const filters = { name: $('#f-name'), status: $('#f-status'), category: $('#f-category'), sort: $('#sort') };

let currentCode = null;
let items = [];
let editingId = null;

// ---- helpers ----

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error('Too many requests, wait a minute and try again');
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

const itemsUrl = (suffix = '') => `/lists/${currentCode}/items${suffix}`;

// Same rule as normalizeCode in lib/validate.mjs: bare code or pasted share link.
function normalizeCode(input) {
  const code = input.trim().toLowerCase().split('#').pop();
  return CODE_RE.test(code) ? code : null;
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

const pick = (it) => Object.fromEntries(FIELDS.map((f) => [f, it[f] ?? '']));
const personKey = (name) => name.toLowerCase();

// 'YYYY-MM-DD' -> local date, so no UTC off-by-one.
function localDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const formatDay = (date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Whole days from today to a 'YYYY-MM-DD' date (negative = past).
function daysUntil(ymd) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((localDate(ymd) - today) / 86_400_000);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

// "tomorrow", "in 3 weeks", "2 months ago", ...
function relative(days) {
  const abs = Math.abs(days);
  if (abs < 14) return rtf.format(days, 'day');
  if (abs < 60) return rtf.format(Math.round(days / 7), 'week');
  if (abs < 730) return rtf.format(Math.round(days / 30.44), 'month');
  return rtf.format(Math.round(days / 365.25), 'year');
}

const formatDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function fillOptions(select, values, blank) {
  select.replaceChildren(
    ...(blank === undefined ? [] : [new Option(blank, '')]),
    ...values.map((v) => new Option(v, v)),
  );
}

// ---- lists remembered on this device (convenience only; storage may be unavailable) ----

function remembered() {
  try {
    const lists = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(lists) ? lists : [];
  } catch {
    return [];
  }
}

function saveRemembered(lists) {
  try {
    localStorage.setItem(STORE, JSON.stringify(lists));
  } catch {
    // private mode / blocked storage: the page still works, it just won't remember
  }
}

const remember = (code, title) => saveRemembered([{ code, title }, ...remembered().filter((l) => l.code !== code)]);
const forget = (code) => saveRemembered(remembered().filter((l) => l.code !== code));

// ---- screens ----

function showHome() {
  currentCode = null;
  stopEdit();
  document.title = 'Bucket Lists';
  board.hidden = true;
  home.hidden = false;

  const lists = remembered();
  $('#my-lists-section').hidden = !lists.length;
  $('#my-lists').replaceChildren(
    ...lists.map(({ code, title }) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${code}`;
      link.textContent = title;
      const codeEl = document.createElement('code');
      codeEl.textContent = code;
      const forgetBtn = document.createElement('button');
      forgetBtn.type = 'button';
      forgetBtn.className = 'secondary';
      forgetBtn.textContent = 'Forget';
      forgetBtn.setAttribute('aria-label', `Forget ${title} on this device`);
      forgetBtn.addEventListener('click', () => {
        forget(code);
        showHome();
      });
      li.append(link, codeEl, forgetBtn);
      return li;
    }),
  );
}

function showBoard(code, title) {
  home.hidden = true;
  board.hidden = false;
  $('#list-title').textContent = title;
  $('#list-code').textContent = code;
  document.title = `${title} · Bucket List`;
}

// Leave a list that doesn't exist (wrong code). replaceState avoids a hashchange that would clear the message.
function leave(code, text) {
  forget(code);
  history.replaceState(null, '', location.pathname + location.search);
  showHome();
  showMessage(text);
}

async function route() {
  showMessage('');
  const raw = location.hash.slice(1);
  if (!raw) {
    if (location.href.endsWith('#')) history.replaceState(null, '', location.pathname + location.search); // tidy bare "/#"
    return showHome();
  }
  const code = normalizeCode(raw);
  if (!code) return leave(raw, 'That link has no valid list code');

  if (code !== currentCode) {
    stopEdit();
    currentCode = code;
    items = [];
    list.replaceChildren(emptyRow('Loading…'));
    showBoard(code, remembered().find((l) => l.code === code)?.title ?? 'Loading…');
  }
  await load();
}

// ---- data ----

async function load() {
  const code = currentCode;
  if (!code) return;
  try {
    const data = await api(`/lists/${code}`);
    if (code !== currentCode) return; // navigated away meanwhile
    items = data.items;
    remember(code, data.title);
    showBoard(code, data.title);
  } catch (err) {
    if (err.status === 404) return leave(code, 'No list with that code');
    showMessage(err.message);
  }
  render();
}

function people() {
  const byKey = new Map();
  for (const it of items) {
    const key = personKey(it.name);
    if (!byKey.has(key)) byKey.set(key, { key, name: it.name, total: 0, done: 0 });
    const p = byKey.get(key);
    p.total++;
    if (it.status === 'Done') p.done++;
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- rendering ----

function render() {
  const ppl = people();

  $('#names').replaceChildren(...ppl.map((p) => new Option(p.name)));

  const chosen = filters.name.value;
  fillOptions(filters.name, [], 'Everyone');
  filters.name.append(...ppl.map((p) => new Option(p.name, p.key)));
  filters.name.value = ppl.some((p) => p.key === chosen) ? chosen : '';

  $('#summary').replaceChildren(
    ...(ppl.length ? ppl.map(summaryRow) : [emptyRow('No one yet — add the first item above.')]),
  );

  const visible = items.filter(
    (it) =>
      (!filters.name.value || personKey(it.name) === filters.name.value) &&
      (!filters.status.value || it.status === filters.status.value) &&
      (!filters.category.value || it.category === filters.category.value),
  );
  if (filters.sort.value === 'target') {
    visible.sort((a, b) => (a.target_date ?? '9999-99-99').localeCompare(b.target_date ?? '9999-99-99'));
  }

  list.replaceChildren(
    ...(visible.length ? visible.map(itemRow) : [emptyRow(items.length ? 'Nothing matches these filters.' : 'No items yet.')]),
  );
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

function summaryRow(p) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = `${p.name} — ${p.done}/${p.total} done`;
  const bar = document.createElement('progress');
  bar.max = p.total;
  bar.value = p.done;
  bar.setAttribute('aria-label', `${p.name} progress`);
  li.append(label, bar);
  return li;
}

function itemRow(it) {
  const row = rowTpl.content.firstElementChild.cloneNode(true);
  const q = (sel) => row.querySelector(sel);

  q('.item').textContent = it.item;
  q('.who').textContent = it.name;
  if (it.category) {
    q('.category').textContent = it.category;
    q('.category').hidden = false;
  }
  if (it.notes) {
    q('.notes p').textContent = it.notes;
    q('.notes').hidden = false;
  }

  q('.created').textContent = `Added ${formatDay(new Date(it.created_at))}`;
  q('.created').title = `Added ${formatDateTime(it.created_at)}`;

  const target = q('.target');
  const due = q('.due');
  if (it.target_date) {
    target.textContent = formatDay(localDate(it.target_date));
  } else {
    target.textContent = 'No date';
    target.classList.add('none');
  }
  if (it.status === 'Done') {
    row.classList.add('done');
    due.textContent = it.completed_at ? `Done ${formatDay(new Date(it.completed_at))}` : 'Done';
    due.classList.add('is-done');
    due.hidden = false;
  } else if (it.target_date) {
    const days = daysUntil(it.target_date);
    due.textContent = days < 0 ? `Overdue · ${relative(days)}` : `Due ${relative(days)}`;
    if (days < 0) {
      due.classList.add('is-overdue');
      row.classList.add('overdue');
    } else if (days <= 7) {
      due.classList.add('is-soon');
    }
    due.hidden = false;
  }

  const status = q('.status');
  status.value = it.status;
  status.dataset.status = it.status; // colours the dropdown
  status.setAttribute('aria-label', `Status of ${it.item}`);
  status.addEventListener('change', () => {
    status.dataset.status = status.value;
    saveStatus(it, status);
  });

  q('.edit').setAttribute('aria-label', `Edit ${it.item}`);
  q('.edit').addEventListener('click', () => startEdit(it));
  q('.delete').setAttribute('aria-label', `Delete ${it.item}`);
  q('.delete').addEventListener('click', () => remove(it));
  return row;
}

// ---- actions ----

function replaceItem(updated) {
  items = items.map((x) => (x.id === updated.id ? updated : x));
  render();
}

async function saveStatus(it, select) {
  showMessage('');
  select.disabled = true;
  try {
    replaceItem(await api(itemsUrl(`/${it.id}`), { method: 'PATCH', body: { ...pick(it), status: select.value } }));
  } catch (err) {
    showMessage(err.message);
    await load(); // revert the dropdown to what the server has
  }
}

async function remove(it) {
  if (!confirm(`Delete "${it.item}" (${it.name})?`)) return;
  showMessage('');
  try {
    await api(itemsUrl(`/${it.id}`), { method: 'DELETE' });
    items = items.filter((x) => x.id !== it.id);
    if (editingId === it.id) stopEdit();
    render();
  } catch (err) {
    showMessage(err.message);
    await load();
  }
}

function startEdit(it) {
  editingId = it.id;
  const values = pick(it);
  for (const f of FIELDS) field(f).value = values[f];
  formTitle.textContent = 'Edit item';
  submitBtn.textContent = 'Save';
  cancelBtn.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  field('item').focus({ preventScroll: true });
}

function stopEdit() {
  editingId = null;
  form.reset();
  formTitle.textContent = 'Add an item';
  submitBtn.textContent = 'Add';
  cancelBtn.hidden = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('');
  submitBtn.disabled = true;
  const body = Object.fromEntries(new FormData(form));
  try {
    if (editingId) {
      replaceItem(await api(itemsUrl(`/${editingId}`), { method: 'PATCH', body }));
      stopEdit();
    } else {
      items.unshift(await api(itemsUrl(), { method: 'POST', body }));
      const name = field('name').value;
      form.reset();
      field('name').value = name; // same person often adds several
      render();
    }
  } catch (err) {
    showMessage(err.message);
  } finally {
    submitBtn.disabled = false;
  }
});

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMessage('');
  const btn = createForm.querySelector('button');
  btn.disabled = true;
  try {
    const created = await api('/lists', { method: 'POST', body: { title: createForm.elements.namedItem('title').value } });
    remember(created.code, created.title);
    createForm.reset();
    location.hash = created.code;
  } catch (err) {
    showMessage(err.message);
  } finally {
    btn.disabled = false;
  }
});

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeCode(joinForm.elements.namedItem('code').value);
  if (!code) return showMessage('Enter the 8-character list code or paste the share link');
  joinForm.reset();
  location.hash = code; // route() checks the list exists
});

copyBtn.addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${currentCode}`;
  try {
    await navigator.clipboard.writeText(url);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 2000);
  } catch {
    prompt('Copy this link and send it to your friends:', url);
  }
});

cancelBtn.addEventListener('click', stopEdit);
for (const el of Object.values(filters)) el.addEventListener('change', render);
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') load(); // pick up friends' changes (no-op on home)
});

// ---- start ----

for (const root of [document, rowTpl.content]) {
  for (const select of root.querySelectorAll('[data-options]')) {
    fillOptions(select, OPTIONS[select.dataset.options], select.dataset.blank);
  }
}
route();
