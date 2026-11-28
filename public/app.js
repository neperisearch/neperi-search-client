// Neperi Search sample client: the Records and Data stores pages of the Neperi console, over the public API. Records: a
// data store picked, its records searched as you type with the filters the console has -- the store's categories (with how
// many records each), the filter fields of the category picked (a list of values with their counts, a number or a date from
// – to, yes / no), the days created or changed, the tags (a click on a record's tag) -- each match marked as the console
// marks it: the keyword typed, a similar word, a letter match; the score, «R» when the ranking step moved a record up. With
// NEPERI_WRITE=1 (see server.mjs) also: + New record, Import Excel / CSV, a record's form, ⚙ Categories & filter fields, the
// records picked with their boxes and a bulk action on them; Data stores: make one, delete one. It calls this sample's
// server (/api/<the API's path>), which holds the API key. DOM nodes only (no innerHTML): the texts come from your data.

const $ = (sel) => document.querySelector(sel);
const enc = encodeURIComponent;
const PAGE = 30;            // records a page, as the console lists them
const MAX_PICK = 1000;      // records a bulk action takes at once (the API's limit)
const STORE_KEY = "neperi.sample.store", THEME_KEY = "neperi.sample.theme";
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: this visit only */ } };
const recall = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// an element: attributes (on* are listeners, class, style, data-* / aria-* / list as attributes, the rest properties) and
// children (null and false left out)
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("data-") || k.startsWith("aria-") || k === "list" || k === "role" || !(k in node)) node.setAttribute(k, v);
    else node[k] = v;
  }
  node.append(...kids.flat(Infinity).filter((x) => x != null && x !== false));
  return node;
}
// a node's children replaced (null and false left out: replaceChildren would write them as text)
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false));
const NUM = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
const num = (n) => NUM.format(Number(n) || 0);
const countOf = (n) => (n > 10000 ? `${num(10000)}+` : num(n || 0));   // as the console counts: 10,000+ past it
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const REL = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const t = Date.parse(iso);
  if (!t) return "";
  let v = (t - Date.now()) / 1000;
  for (const [n, unit] of [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]]) {
    if (Math.abs(v) < n) return unit === "second" ? "just now" : REL.format(Math.round(v), unit);
    v /= n;
  }
  return "";
}
const scoreText = (v) => Number(v).toFixed(3);        // three decimals, always: 6.905 and 6.912 read apart
const newId = () => `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const listOf = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || "[]"); } catch { return []; } };

// a word as the API's `fuzzy` names it: lowercase, accents and other marks off, a few letters Unicode keeps whole folded; a
// digit written above or below the line («²», «₂») stays itself -- «m²» is a word similar to «m2», not the same one
const SUPSUB = "⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉";
const fold = (s) => (s || "").replace(/[⁰¹²³⁴-⁹₀-₉]/g, (c) => String.fromCharCode(0xE000 + SUPSUB.indexOf(c)))
  .normalize("NFKC").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/ı/g, "i").replace(/ł/g, "l")
  .replace(/[-]/g, (c) => SUPSUB[c.charCodeAt(0) - 0xE000]);

// a number as people write it -- «1.200.000», «12,5», «$1,200» -- read as the API reads a field's values: of «.» and «,»
// together the last is the decimal point; alone, groups of three are thousands
function parseNum(text) {
  let v = String(text ?? "").trim().toLowerCase().replace(/^(us\$|usd|vnd|eur|gbp|[$€£¥₫₩₹฿])\s*/, "").replace(/[^\d]{0,10}$/, "");
  v = v.replace(/[\s'’]/g, "");
  if (!/^[+-]?\d[\d.,]*$/.test(v)) return null;
  if (v.includes(",") && v.includes(".")) {
    const dec = v.lastIndexOf(",") > v.lastIndexOf(".") ? "," : ".";
    v = v.split(dec === "," ? "." : ",").join("").replace(dec, ".");
  } else if (v.includes(",") || v.includes(".")) {
    const mark = v.includes(",") ? "," : ".";
    const parts = v.replace(/^[+-]/, "").split(mark);
    v = parts.length > 2 || (parts[parts.length - 1].length === 3 && !["", "0"].includes(parts[0])) ? v.split(mark).join("") : v.replace(mark, ".");
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// a day as a date box wants it (YYYY-MM-DD): from the API's YYYYMMDD number or a text that reads as a day; "" when none
function dayOf(v) {
  if (typeof v === "number" && v > 10000101) {
    const n = Math.floor(v);
    return `${String(Math.floor(n / 10000)).padStart(4, "0")}-${String(Math.floor(n / 100) % 100).padStart(2, "0")}-${String(n % 100).padStart(2, "0")}`;
  }
  const t = String(v ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

// text with each [start, end) range in a <mark>. The API counts in UTF-16 code units -- what JavaScript strings count -- so
// text.slice(start, end) is the matched word. Its kind: a letter match (letters: the tooltip), a similar word (in `fuzzy`:
// the word as found -> the word typed), else the keyword itself.
function marked(text, ranges, fuzzy, letters = null) {
  const out = [];
  let at = 0;
  for (const [s0, e0] of ranges || []) {
    if (e0 <= at || s0 >= text.length) continue;
    const a = Math.max(s0, at), b = Math.min(e0, text.length);
    if (a > at) out.push(text.slice(at, a));
    const word = text.slice(a, b), typed = letters ? null : fuzzy?.[fold(word)];
    out.push(h("mark", letters ? { class: "lm", title: letters } : typed ? { class: "fz", title: `≈ ${typed}` } : {}, word));
    at = b;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// -- the API, through server.mjs ------------------------------------------------------------------------------------
async function api(method, path, body) {
  const init = { method, headers: { Accept: "application/json" } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const r = await fetch(`/api${path}`, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = d.error || {};
    throw Object.assign(new Error(e.message || `Error ${r.status}`), { code: e.code, hint: e.hint, status: r.status });
  }
  return d;
}

// -- toasts and dialogs ----------------------------------------------------------------------------------------------
function toast(text, kind = "") {
  const t = h("div", { class: `toast ${kind}` }, text);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3500);
}
const errText = (e) => (e.hint ? `${e.message} ${e.hint}` : e.message);
const errToast = (e) => toast(errText(e), "err");
const field = (label, ...controls) => h("div", { class: "field" }, h("label", {}, label), ...controls);

// a dialog: its title, its body, its buttons (made with its close); a click outside or Esc closes it -- asking first when
// dirty() says the form was changed
let openSheets = 0;
function sheet(title, body, buttons, { dirty = () => false, wide = false } = {}) {
  const bg = h("div", { class: "modal-bg" });
  const close = () => {
    bg.remove();
    document.removeEventListener("keydown", onKey, true);
    openSheets -= 1;
  };
  const leave = async () => { if (!dirty() || (await confirmDialog("Discard the changes?", { ok: "Discard", danger: true }))) close(); };
  const onKey = (ev) => {
    if (ev.key === "Escape" && bg === [...document.querySelectorAll(".modal-bg")].pop()) { ev.stopPropagation(); leave(); }
  };
  bg.append(h("div", { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true" }, h("h3", {}, title), body,
    h("div", { class: "actions" }, buttons(leave, close))));
  bg.addEventListener("mousedown", (ev) => { if (ev.target === bg) leave(); });
  document.body.append(bg);
  document.addEventListener("keydown", onKey, true);
  openSheets += 1;
  return { close, leave, el: bg };
}
function confirmDialog(text, { ok = "OK", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const end = (v, close) => { if (!done) { done = true; close(); resolve(v); } };
    const ui = sheet("Confirm", h("p", { class: "nw-q-text" }, text), (_leave, close) => [h("span", { class: "spacer" }),
      h("button", { onclick: () => end(false, close) }, "Cancel"),
      h("button", { class: danger ? "danger" : "primary", onclick: () => end(true, close) }, ok)]);
    // Esc or a click outside: no
    new MutationObserver((_m, obs) => { if (!ui.el.isConnected) { obs.disconnect(); if (!done) { done = true; resolve(false); } } })
      .observe(document.body, { childList: true });
  });
}

// -- theme: the system's, light or dark (◐ in the top bar), remembered in this browser ----------------------------
const THEMES = { auto: "◐ System", light: "☀ Light", dark: "☾ Dark" };
function applyTheme(next) {
  const theme = next || recall(THEME_KEY) || "auto";
  document.documentElement.dataset.theme = THEMES[theme] ? theme : "auto";
  $("#theme").textContent = THEMES[document.documentElement.dataset.theme];
}
$("#theme").addEventListener("click", () => {
  const order = Object.keys(THEMES), now = document.documentElement.dataset.theme;
  const next = order[(order.indexOf(now) + 1) % order.length];
  remember(THEME_KEY, next);
  applyTheme(next);
});

// -- the data stores -------------------------------------------------------------------------------------------------
let cfg = { write: false, admin: false, stores: [] };   // what this page may do (GET /api/config)
let stores = [];                                         // GET /v1/neperi/collections: name, title, items, kind, columns…
const tables = new Map();                                // the stores that hold the rows of a sheet -> their columns
async function loadStores() {
  try {
    stores = (await api("GET", "/v1/neperi/collections?limit=200")).items || [];
  } catch (e) {
    stores = [];
    errToast(e);
  }
  stores.sort((a, b) => a.name.localeCompare(b.name));
  tables.clear();
  for (const c of stores) if (c.kind === "table") tables.set(c.name, { columns: listOf(c.columns) });
}
const isTable = (name) => tables.has(name);
const storeOf = (name) => stores.find((c) => c.name === name);

// -- pages: #/records (default) and #/stores ------------------------------------------------------------------------
const page = $("#page");
function setTitle(t) {
  $("#title").textContent = `Neperi Search · ${t}`;
  document.title = `${t} · Neperi Search`;
}
function route() {
  const name = location.hash.replace(/^#\/?/, "") || "records";
  for (const a of document.querySelectorAll(".nav a")) a.classList.toggle("active", a.dataset.page === name);
  closePop();
  if (name === "stores") storesPage();
  else recordsPage();
}
addEventListener("hashchange", route);
const go = (name) => { if (location.hash === `#/${name}`) route(); else location.hash = `#/${name}`; };

// =====================================================================================================================
// Records
// =====================================================================================================================
// what is shown: the store, the words typed, its category, its filter fields {key: condition}, the days, the tags picked
const s = { collection: null, query: "", category: null, fields: {}, dates: {}, tags: [], domains: {}, order: null, top: PAGE };
let res = null, seq = 0, timer = null;
let storeFields = [], storeCats = [], catFields = null, tagCounts = new Map(), filtersSeq = 0;
// the store's named domains (GET …/domains) and its records within the domains in force («All (N)»). A domain «always
// applied» narrows every search and count without a box; a «Show on UI» one is a box (its conditions or All); an admin key
// has every domain as a box. s.domains: what differs from that, {name: "on" | "off"}, sent with every search and count
let storeDomains = [], storeTotal = null;
// the store's sort options (GET …/sort): the Sort box offers those of the first domain picked that has some, else those of no
// domain (none: no box); s.order -- the one picked (null: the best match while searching, else the default option)
let storeOrders = [];
const orderScope = () => {
  for (const d of storeDomains) {
    if (d.always || s.domains[d.name] !== "on") continue;
    const mine = storeOrders.filter((o) => o.domain && o.domain.toLowerCase() === d.name.toLowerCase());
    if (mine.length) return mine;
  }
  return storeOrders.filter((o) => !o.domain);
};
const orderNow = () => s.order ?? (s.query ? "score" : (orderScope().find((o) => o.default) || orderScope()[0])?.name ?? "");
const domainOn = (d) => (s.domains[d.name] ?? (d.always ? "on" : "off")) === "on";
const domainsShown = () => storeDomains.filter((d) => cfg.admin || d.show);
const domainWant = () => (Object.keys(s.domains).length ? { domains: { ...s.domains } } : {});
const domainQS = () => (Object.keys(s.domains).length ? `&domains=${enc(JSON.stringify(s.domains))}` : "");
const picked = new Set();     // the records picked with their boxes (ids in the store picked)
let R = null;                 // the elements of the Records page while it is shown
const fieldsInView = () => (s.category && catFields ? catFields : storeFields);
const fieldOn = (v) => v != null && (Array.isArray(v) ? v.length > 0 : typeof v === "object" ? v.from != null || v.to != null : true);
const fieldFilters = () => Object.fromEntries(Object.entries(s.fields).filter(([, v]) => fieldOn(v)));
const dateFilters = () => Object.fromEntries(Object.entries(s.dates).filter(([, v]) => v));
const filtered = () => !!(s.category || Object.keys(fieldFilters()).length || Object.keys(dateFilters()).length || s.tags.length
  || Object.values(s.domains).includes("on"));
const maxTop = () => (cfg.write ? 100 : 50);   // a search page's server gives at most 50 results

function recordsPage() {
  setTitle("Records");
  const info = h("span", { class: "nw-info" });
  const chips = h("div", { class: "nw-chips" });
  const input = h("input", { type: "search", placeholder: "Enter keywords to search the records…", autocomplete: "off", "aria-label": "Search" });
  input.value = s.query;
  const setupBtn = h("button", { hidden: true, onclick: () => s.collection && setupDialog(s.collection) }, "⚙ Store setup");
  const allBox = cfg.write ? h("input", { type: "checkbox", disabled: true }) : null;
  const selInfo = h("span", { class: "nw-selinfo" });
  const bulkBtn = cfg.write ? h("button", { class: "small", disabled: true, onclick: () => bulkDialog() }, "Bulk action") : null;
  const builder = h("div", { class: "nw-qb" });
  sortSel = h("select", { "aria-label": "Sort" });
  sortSel.addEventListener("change", () => changed({ order: sortSel.value }, true));
  const sortBar = h("div", { class: "nw-sortbar", hidden: true }, h("span", { class: "nw-ql" }, "Sort"), sortSel);
  const list = h("div", { class: "nw-results" });
  R = { info, chips, input, setupBtn, allBox, selInfo, bulkBtn, builder, sortBar, list };
  allBox?.addEventListener("change", () => {
    if (allBox.checked) for (const it of res?.items || []) { if (picked.size < MAX_PICK) picked.add(it.id); }
    else picked.clear();
    drawPicks();
  });
  fill(page,
    h("h2", {}, "Records"),
    // row 1: create, import, store setup, how many or how fast, the conditions in use as chips
    h("div", { class: "nw-top" },
      cfg.write ? h("button", { class: "primary", onclick: () => newRecord() }, "+ New") : null,
      cfg.write ? h("button", { onclick: () => importDialog() }, "Import Excel / CSV") : null,
      setupBtn, info, chips),
    // row 2, on the right: the records picked and what acts on them
    cfg.write ? h("div", { class: "nw-tools" }, h("span", { class: "nw-selbar" },
      h("label", { class: "nw-selall", title: "Select every record shown" }, allBox, "Select all"), selInfo), bulkBtn) : null,
    h("div", { class: "nw-search" }, h("span", { class: "ico" }, "⌕"), input,
      h("button", { type: "button", class: "clear", title: "Clear the search",
        onclick: () => { input.value = ""; changed({ query: "", order: null }, true); input.focus(); } }, "×")),
    builder, sortBar, list);
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => changed({ query: input.value.trim(), order: null }, true), 250);   // each search: the best match first
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { clearTimeout(timer); changed({ query: input.value.trim(), order: null }, true); }
  });
  // a click into the box selects its words (typing starts another search); a click while the caret is in it places it
  let hadFocus = false;
  input.addEventListener("pointerdown", () => { hadFocus = document.activeElement === input; });
  input.addEventListener("click", () => { if (!hadFocus && input.selectionStart === input.selectionEnd) input.select(); });
  drawBuilder();
  if (!s.collection || !storeOf(s.collection)) pickStore(s.collection);
  else load();
  input.focus();
}

// another view (words, a filter, a store): back to the first page, nothing picked; keep: the builder stays as it is
function changed(patch, keep = false) {
  Object.assign(s, patch, { top: PAGE });
  picked.clear();
  if (!keep && R) drawBuilder();
  load();
}

// the store picked: its filter fields, categories and tags come with it; another store starts its conditions afresh (the
// days stay: every store has them). One is always picked: the one asked for, else the last one, else the first
async function pickStore(name, keep = {}) {
  name = [name, recall(STORE_KEY)].find((n) => n && storeOf(n)) || stores[0]?.name || null;
  Object.assign(s, { collection: name, category: keep.category || null, fields: {}, tags: keep.tags || [], domains: {}, order: null });
  if (name) remember(STORE_KEY, name);
  storeFields = [];
  storeCats = [];
  storeDomains = [];
  storeTotal = null;
  storeOrders = [];
  catFields = null;
  tagCounts = new Map();
  changed({});
  if (name) await loadStoreFilters(name);
}
const catFieldsOf = (name, cat) => api("GET", `/v1/neperi/fields?values=1&collection=${enc(name)}&category=${enc(cat)}${domainQS()}`)
  .then((r) => r.fields || []).catch(() => null);
const tagCountsOf = (name, cat) => api("GET", `/v1/neperi/collections/${enc(name)}/tags?limit=300${cat ? `&category=${enc(cat)}` : ""}${domainQS()}`)
  .then((r) => new Map((r.tags || []).map((x) => [x.tag, x.count]))).catch(() => null);
async function loadStoreFilters(name) {
  const my = ++filtersSeq;
  const [fr, cr, cf, tc, dr, sr] = await Promise.all([
    api("GET", `/v1/neperi/fields?values=1&collection=${enc(name)}${domainQS()}`).catch(() => ({ fields: [] })),
    isTable(name) ? { categories: [] } : api("GET", `/v1/neperi/categories?collection=${enc(name)}${domainQS()}`).catch(() => ({ categories: [] })),
    s.category ? catFieldsOf(name, s.category) : null, tagCountsOf(name, s.category),
    api("GET", `/v1/neperi/collections/${enc(name)}/domains`).catch(() => ({ domains: [] })),
    api("GET", `/v1/neperi/collections/${enc(name)}/sort`).catch(() => ({ sort: [] }))]);
  if (my !== filtersSeq || s.collection !== name) return;     // another store picked meanwhile
  storeFields = fr.fields || [];
  storeCats = cr.categories || [];
  storeTotal = cr.total ?? null;
  storeDomains = dr.domains || [];
  storeOrders = sr.sort || [];
  catFields = cf;
  tagCounts = tc || new Map();
  if (R) { drawBuilder(); drawChips(); }
}
// a category picked shows only the fields its records carry, each with their values and range; a filter on a field it hides
// goes, and so does a ticked value or a tag it lacks
async function pickCategory(cat) {
  const name = s.collection, my = ++filtersSeq;
  const [next, counts] = await Promise.all([cat ? catFieldsOf(name, cat) : null, tagCountsOf(name, cat)]);
  if (my !== filtersSeq || s.collection !== name) return;
  catFields = next;
  if (counts) tagCounts = counts;
  const tags = cat && counts ? s.tags.filter((g) => counts.has(g)) : s.tags;
  const fields = { ...s.fields };
  if (cat && next) {
    const shown = new Map(next.map((fd) => [fd.key, fd]));
    for (const [k, v] of Object.entries(fields)) {
      const fd = shown.get(k);
      if (!fd) { delete fields[k]; continue; }
      if (fd.type === "list" && Array.isArray(v)) {
        const have = new Set((fd.values || []).map((x) => x.value));
        const kept = v.filter((x) => have.has(x));
        if (kept.length) fields[k] = kept;
        else delete fields[k];
      }
      if (fd.type === "status" && !(fd.values || []).some((x) => x.value === v)) delete fields[k];
    }
  }
  changed({ category: cat, fields, tags });
}

// the view: words typed -> a search with the filters (POST …/search); nothing typed -> the store's records in id order (GET
// …/items; a table's rows with their cells, POST …/items/get). The public API lists records with words only: filters with
// no words wait for them
async function load(more = false) {
  if (!R) return;
  const my = ++seq;
  syncUrl();
  if (!s.collection) { res = { items: [], total: 0 }; draw(); return; }
  const name = s.collection;
  try {
    let next;
    if (s.query) {
      const body = { query: s.query, top_k: s.top, ...(s.category ? { category: s.category } : {}), ...dateFilters(),
        ...(Object.keys(fieldFilters()).length ? { fields: fieldFilters() } : {}), ...(s.tags.length ? { tags: s.tags } : {}),
        ...domainWant(), ...(s.order && s.order !== "score" ? { order: s.order } : {}) };
      const d = await api("POST", `/v1/neperi/collections/${enc(name)}/search`, body);
      const items = d.results || [];
      next = { items, total: d.total, took_ms: d.took_ms, columns: d.columns, search: true, more: items.length >= s.top && s.top < maxTop() };
    } else if (filtered()) {
      next = { items: [], total: 0, wait: true };
    } else {
      // in the sort option picked (else the default one) a page at an offset; no option: by id, after the last one
      const ord = orderScope().length ? orderNow() : "";
      const page = ord ? `&order=${enc(ord)}${more && res?.next_offset ? `&offset=${res.next_offset}` : ""}`
        : more && res?.next_after ? `&after=${enc(res.next_after)}` : "";
      const d = await api("GET", `/v1/neperi/collections/${enc(name)}/items?limit=${PAGE}${page}`);
      let items = d.items || [];
      if (isTable(name) && items.length) {
        const g = await api("POST", `/v1/neperi/collections/${enc(name)}/items/get`, { ids: items.map((x) => x.id) });
        const byId = new Map((g.items || []).map((x) => [x.id, x]));
        items = items.map((x) => ({ ...x, cells: byId.get(x.id)?.cells || {} }));
      }
      next = { items: more && res?.items ? res.items.concat(items) : items, total: d.total, next_after: d.next_after,
        next_offset: d.next_offset, more: !!(d.next_after || d.next_offset) };
    }
    if (my !== seq) return;          // a newer view is on its way
    res = next;
    draw();
    if (!more && R) R.list.scrollTop = 0;
  } catch (e) {
    if (my === seq) { res = { items: [], total: 0, error: e }; draw(); }
  }
}
let loadingMore = false;
async function loadMore() {
  if (loadingMore || !res?.more) return;
  loadingMore = true;
  try {
    if (res.search) { s.top = Math.min(maxTop(), s.top + PAGE); await load(); }
    else await load(true);
  } finally {
    loadingMore = false;
  }
}

// the address carries the view -- the store, the words, the category, the tags -- so it can be shared or bookmarked
function syncUrl() {
  const p = new URLSearchParams();
  if (s.collection) p.set("store", s.collection);
  if (s.query) p.set("q", s.query);
  if (s.category) p.set("category", s.category);
  for (const g of s.tags) p.append("tag", g);
  history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}${location.hash}`);
}

function draw() {
  if (!R || !res) return;
  R.info.textContent = res.search ? `Searched in ${num(res.took_ms)} ms` : res.wait || res.error ? "" : plural(res.total || 0, "record", "records");
  drawChips();
  drawSel();
  fillSort();
  drawList();
}

// -- the conditions in use: a chip each, × takes it off -------------------------------------------------------------
const dayText = (a, b) => (a && b ? `${a} – ${b}` : a ? `≥ ${a}` : `≤ ${b}`);
const rangeText = (v) => (v.from != null && v.to != null ? `${num(v.from)} – ${num(v.to)}` : v.from != null ? `≥ ${num(v.from)}` : `≤ ${num(v.to)}`);
const valueText = (fd, v) => (fd.type === "number" ? rangeText(v) : fd.type === "date" ? dayText(v.from, v.to)
  : fd.type === "bool" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v));
function drawChips() {
  if (!R) return;
  const chip = (label, off) => h("span", { class: "nw-chip", title: label }, label,
    h("button", { type: "button", title: "Remove the filter", onclick: off }, "×"));
  const on = [];
  if (s.category) on.push(chip(`Category: ${s.category}`, () => changed({ category: null })));
  for (const fd of storeFields) {
    const v = s.fields[fd.key];
    if (fieldOn(v)) on.push(chip(`${fd.label}: ${valueText(fd, v)}`, () => changed({ fields: { ...s.fields, [fd.key]: null } })));
  }
  for (const g of s.tags) {
    const n = tagCounts.get(g);
    on.push(chip(`Tag: ${g}${n != null ? ` (${countOf(n)})` : ""}`, () => changed({ tags: s.tags.filter((x) => x !== g) })));
  }
  const d = s.dates;
  if (d.created_from || d.created_to) {
    on.push(chip(`Created: ${dayText(d.created_from, d.created_to)}`, () => changed({ dates: { ...s.dates, created_from: null, created_to: null } })));
  }
  if (d.updated_from || d.updated_to) {
    on.push(chip(`Changed: ${dayText(d.updated_from, d.updated_to)}`, () => changed({ dates: { ...s.dates, updated_from: null, updated_to: null } })));
  }
  if (on.length > 1) on.push(h("button", { class: "small", onclick: () => changed({ category: null, fields: {}, dates: {}, tags: [] }) }, "Clear all filters"));
  R.chips.replaceChildren(...on);
}

// -- the query builder: the data store, its category and fields, the days -------------------------------------------
// a list that opens under its button (the values of a field, the days): one at a time; a click elsewhere or Esc closes it
let openPop = null;
const onDown = (ev) => { if (openPop && !openPop.el.contains(ev.target) && !openPop.anchor.contains(ev.target)) closePop(); };
const onEsc = (ev) => { if (ev.key === "Escape" && openPop) { ev.stopPropagation(); closePop(); } };
function pop(wrap, anchor, body) {
  closePop();
  const box = h("div", { class: "nw-pop" }, body);
  wrap.append(box);
  openPop = { el: box, anchor };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onEsc, true);
}
function closePop() {
  if (!openPop) return;
  openPop.el.remove();
  openPop = null;
  document.removeEventListener("mousedown", onDown, true);
  document.removeEventListener("keydown", onEsc, true);
}
// a cell of the builder's grid: its label (cut with «…», whole on hover) and its controls; a range takes two cells
const q = (label, ...controls) => h("div", { class: "nw-q" }, h("span", { class: "nw-ql", title: label }, label), ...controls);
const qRange = (label, ...controls) => { const c = q(label, ...controls); c.classList.add("range"); return c; };

function drawBuilder() {
  if (!R) return;
  closePop();
  const parts = [];
  const store = h("select", { title: "Data store", disabled: !stores.length }, stores.map((c) => h("option", { value: c.name }, c.name)));
  store.value = s.collection || "";
  store.addEventListener("change", () => pickStore(store.value));
  parts.push(q("Data store", store));
  if (s.collection) for (const d of domainsShown()) parts.push(domainControl(d));
  // the store's own categories, each with how many records have it (a table has none: its columns filter it)
  if (s.collection && !isTable(s.collection) && (storeCats.length || s.category)) {
    const total = storeTotal ?? storeOf(s.collection)?.items;
    const cat = h("select", {}, h("option", { value: "" }, total != null ? `All (${countOf(total)})` : "All"),
      storeCats.map((c) => h("option", { value: c.value }, `${c.value} (${countOf(c.count)})`)));
    if (s.category && !storeCats.some((c) => c.value === s.category)) cat.append(h("option", { value: s.category }, s.category));
    cat.value = s.category || "";
    cat.classList.toggle("on", !!s.category);
    cat.addEventListener("change", () => pickCategory(cat.value || null));
    parts.push(q("Category", cat));
  }
  if (s.collection) for (const fd of fieldsInView()) parts.push(fieldControl(fd));
  // no common Time box: the record's own days are attributes (Created / Changed), shown when the store declares them
  const table = isTable(s.collection);
  const canSetup = Boolean(s.collection && (cfg.admin || (cfg.write && !table)));
  if (R.setupBtn) {
    R.setupBtn.hidden = !canSetup;
    if (canSetup) R.setupBtn.textContent = cfg.admin ? "⚙ Store setup" : "⚙ Categories";
  }
  R.builder.replaceChildren(...parts);
  fillSort();
}

// the Sort bar below the filters, aligned right: the options offered, «Best match» first while searching
let sortSel = null;
function fillSort() {
  if (!sortSel || !R?.sortBar) return;
  const opts = orderScope();
  R.sortBar.hidden = !s.collection || !opts.length;
  if (R.sortBar.hidden) return;
  sortSel.replaceChildren(...(s.query ? [h("option", { value: "score" }, "Best match")] : []), ...opts.map((o) => h("option", { value: o.name }, o.name)));
  sortSel.value = orderNow();
  sortSel.classList.toggle("on", !!s.order && s.order !== "score");
}

// one filter field: yes / no a list of three, a number or a date two boxes (from, to), a list of values a button that
// opens them with a box each (any of the values ticked) and how many records have it
// a domain's conditions in words («Category: A, B · Stage: Published»): its box in the builder, its conditions or All
const domainText = (d) => {
  const w = d.where || {}, parts = [];
  if (w.category) parts.push(`Category: ${[].concat(w.category).join(", ")}`);
  for (const [k, v] of Object.entries(w.fields || {})) {
    const fd = storeFields.find((x) => x.key === k) || { key: k, label: k, type: "list" };
    parts.push(`${fd.label}: ${valueText(fd, v)}`);
  }
  return parts.join(" · ") || d.name;
};
function domainControl(d) {
  const on = domainOn(d);
  const sel = h("select", { title: domainText(d) }, h("option", { value: "on" }, domainText(d)), h("option", { value: "off" }, "All"));
  sel.value = on ? "on" : "off";
  sel.classList.toggle("on", on);
  sel.addEventListener("change", async () => {
    const next = { ...s.domains };
    if (sel.value === (d.always ? "on" : "off")) delete next[d.name];
    else next[d.name] = sel.value;
    s.domains = next;
    s.order = null;   // the domain's own sort options, its default
    changed({});
    await loadStoreFilters(s.collection);   // the counts within the domains in force
  });
  return q(d.name, sel);
}

function fieldControl(fd) {
  const cur = s.fields[fd.key];
  const set = (v, keep = false) => changed({ fields: { ...s.fields, [fd.key]: v } }, keep);
  if (fd.type === "status") {   // one of its options, in their order, each with how many records have it
    const counts = new Map((fd.values || []).map((x) => [x.value, x.count]));
    const sel = h("select", {}, h("option", { value: "" }, "All"),
      (fd.choices || []).map((c) => h("option", { value: c }, counts.has(c) ? `${c} (${countOf(counts.get(c))})` : c)));
    const v = Array.isArray(cur) ? cur[0] : cur;
    if (v && !(fd.choices || []).includes(v)) sel.append(h("option", { value: v }, v));
    sel.value = v || "";
    sel.classList.toggle("on", !!v);
    sel.addEventListener("change", () => set(sel.value || null));
    return q(fd.label, sel);
  }
  if (fd.type === "bool") {
    const sel = h("select", {}, [["", "All"], ["1", "Yes"], ["0", "No"]].map(([v, l]) => h("option", { value: v }, l)));
    sel.value = cur === true ? "1" : cur === false ? "0" : "";
    sel.classList.toggle("on", cur === true || cur === false);
    sel.addEventListener("change", () => set(sel.value === "" ? null : sel.value === "1"));
    return q(fd.label, sel);
  }
  if (fd.type === "date") {
    const lo = dayOf(fd.min), hi = dayOf(fd.max);
    const day = (end) => {
      const inp = h("input", { type: "date", class: cur?.[end] ? "on" : null, value: cur?.[end] || "", ...(lo ? { min: lo } : {}), ...(hi ? { max: hi } : {}) });
      inp.addEventListener("change", () => {
        const next = { ...(s.fields[fd.key] || {}), [end]: inp.value || null };
        set(next.from == null && next.to == null ? null : next);
      });
      return inp;
    };
    return qRange(fd.label, day("from"), h("span", { class: "nw-ql" }, "–"), day("to"));
  }
  if (fd.type === "number") {
    // the smallest and largest number of the store's records as the hint of each box
    const box = (end, hint) => {
      const shown = () => (s.fields[fd.key]?.[end] != null ? num(s.fields[fd.key][end]) : "");
      const inp = h("input", { type: "text", inputMode: "decimal", class: `nw-num${cur?.[end] != null ? " on" : ""}`, placeholder: hint,
        value: shown(), autocomplete: "off" });
      inp.addEventListener("change", () => {
        const typed = inp.value.trim(), n = typed ? parseNum(typed) : null;
        if (typed && n == null) { inp.value = shown(); return; }      // not a number: back to what it was
        const next = { ...(s.fields[fd.key] || {}), [end]: n };
        set(next.from == null && next.to == null ? null : next);
      });
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") inp.blur(); });
      return inp;
    };
    return qRange(fd.label, box("from", fd.min != null ? `from ${num(fd.min)}` : "from"), h("span", { class: "nw-ql" }, "–"),
      box("to", fd.max != null ? `to ${num(fd.max)}` : "to"));
  }
  const btn = h("button", { type: "button", class: "nw-pick" });
  const relabel = () => {
    const v = s.fields[fd.key] || [];
    btn.textContent = v.length ? v.join(", ") : "All";
    btn.title = btn.textContent;
    btn.classList.toggle("on", v.length > 0);
  };
  relabel();
  const wrap = q(fd.label, btn);
  btn.addEventListener("click", () => {
    if (openPop?.anchor === btn) { closePop(); return; }
    // the values the records carry (of the category picked), each with how many have it, then those offered that none has yet
    const used = new Map((fd.values || []).map((x) => [x.value, x.count]));
    const all = [...used.keys(), ...(s.category ? [] : (fd.choices || []).filter((c) => !used.has(c)))];
    const boxes = h("div", { class: "nw-checks" });
    const find = all.length > 8 ? h("input", { type: "text", placeholder: "Filter the values…", autocomplete: "off" }) : null;
    const drawBoxes = () => {
      const typed = fold(find ? find.value.trim() : ""), now = new Set(s.fields[fd.key] || []);
      const rows = all.filter((v) => !typed || fold(v).includes(typed));
      boxes.replaceChildren(...(rows.length ? rows.map((v) => {
        const cb = h("input", { type: "checkbox", checked: now.has(v) });
        cb.addEventListener("change", () => {
          const next = new Set(s.fields[fd.key] || []);
          if (cb.checked) next.add(v);
          else next.delete(v);
          set(next.size ? [...next] : null, true);
          relabel();
        });
        return h("label", { class: "nw-check" }, cb, h("span", {}, v), used.has(v) ? h("span", { class: "nw-n" }, countOf(used.get(v))) : null);
      }) : [h("p", { class: "nw-none" }, "No data")]));
    };
    if (find) find.addEventListener("input", drawBoxes);
    drawBoxes();
    const none = h("button", { type: "button", class: "small", onclick: () => { set(null, true); relabel(); drawBoxes(); } }, "Clear");
    pop(wrap, btn, h("div", { class: "nw-popbody" }, find, boxes, h("div", { class: "nw-popfoot" }, none)));
    find?.focus();
  });
  return wrap;
}

// the days created and changed, for every store: four day boxes under one button
function timeControl() {
  const btn = h("button", { type: "button", class: "nw-pick" });
  const relabel = () => {
    const d = s.dates, parts = [];
    if (d.created_from || d.created_to) parts.push(`Created ${dayText(d.created_from, d.created_to)}`);
    if (d.updated_from || d.updated_to) parts.push(`Changed ${dayText(d.updated_from, d.updated_to)}`);
    btn.textContent = parts.length ? parts.join(" · ") : "All";
    btn.title = btn.textContent;
    btn.classList.toggle("on", parts.length > 0);
  };
  relabel();
  const wrap = q("Time", btn);
  btn.addEventListener("click", () => {
    if (openPop?.anchor === btn) { closePop(); return; }
    const day = (key) => {
      const inp = h("input", { type: "date", value: s.dates[key] || "" });
      inp.addEventListener("change", () => { changed({ dates: { ...s.dates, [key]: inp.value || null } }, true); relabel(); });
      return inp;
    };
    pop(wrap, btn, h("div", { class: "nw-days" },
      h("span", {}, "Created"), day("created_from"), h("span", {}, "–"), day("created_to"),
      h("span", {}, "Changed"), day("updated_from"), h("span", {}, "–"), day("updated_to")));
  });
  return wrap;
}

// -- the results ---------------------------------------------------------------------------------------------------
// the record's own match score (lower is closer) and «R» when the ranking step put it above a record that matched closer
const scoreValue = (it) => it.match_score ?? it.score;
const rerankMark = (it) => (it.reranked ? h("span", { class: "nw-rr",
  title: "Reranked: the ranking step put this record above one that matched more closely" }, "R") : null);
// how much of the query the record holds -- `quality` 0..1, by how rare each word is, comparable between queries:
// 0.7 and up a full match, 0.3 to 0.7 a partial one, under 0.3 a weak one (show those apart, or drop them)
const QBAND = [[0.7, "ok", "Full match"], [0.3, "part", "Partial match"], [-1, "weak", "Weak match"]];
const qualityOf = (it) => {
  if (it.quality == null) return null;
  const [, cls, label] = QBAND.find(([lo]) => it.quality >= lo);
  return h("span", { class: `nw-q ${cls}`,
    title: `Match ${Number(it.quality).toFixed(2)}: how much of the query the record holds, by how rare its words are (0–1)` }, label);
};
const scoreOf = (it) => (scoreValue(it) != null ? [h("span", { class: "nw-score", title: "Match score (lower = closer)" },
  scoreText(scoreValue(it))), rerankMark(it), qualityOf(it)] : null);
const weakOf = (it) => (it.letter_match ? `Letter match of «${s.query}»: the letters typed close together, in order` : null);
const onOpen = (fn) => ({ tabindex: "0", onclick: fn, onkeydown: (ev) => { if (ev.key === "Enter") fn(); } });

// picking records for a bulk action
function drawPicks() {
  if (!R) return;
  for (const cb of R.list.querySelectorAll("input[data-pick]")) {
    cb.checked = picked.has(cb.dataset.pick);
    cb.closest(".nw-card, tr")?.classList.toggle("picked", cb.checked);
  }
  drawSel();
}
function pickBox(it) {
  if (!cfg.write) return null;
  const cb = h("input", { type: "checkbox", class: "nw-sel", "data-pick": it.id, title: "Select this record", checked: picked.has(it.id) });
  cb.addEventListener("click", (ev) => ev.stopPropagation());
  cb.addEventListener("keydown", (ev) => ev.stopPropagation());
  cb.addEventListener("change", () => {
    if (cb.checked && picked.size >= MAX_PICK) { cb.checked = false; toast(`At most ${num(MAX_PICK)} records at once.`, "err"); return; }
    if (cb.checked) picked.add(it.id);
    else picked.delete(it.id);
    drawPicks();
  });
  return cb;
}
function drawSel() {
  if (!R || !cfg.write) return;
  const shown = res?.items || [], n = picked.size;
  const all = shown.length > 0 && shown.every((it) => picked.has(it.id));
  R.allBox.disabled = !shown.length;
  R.allBox.checked = all;
  R.allBox.indeterminate = !all && shown.some((it) => picked.has(it.id));
  R.selInfo.replaceChildren(...(n ? [`${num(n)} selected · `, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); picked.clear(); drawPicks(); } }, "Clear")] : []));
  R.bulkBtn.disabled = !n;
  R.bulkBtn.textContent = n ? `Act on ${plural(n, "selected item", "selected items")}…` : "Bulk action";
}

// a record's tags: the ones the search matched coloured as words are; a click filters by the tag (again: off)
function tagChips(it, pick = true) {
  return h("div", { class: "nw-tagrow" }, (it.tags || []).map((g) => {
    const hit = (it.tag_matches || []).includes(g);
    const typed = hit ? it.fuzzy?.[fold(g)] || g.split(/\s+/).map((w) => it.fuzzy?.[fold(w)]).find(Boolean) : null;
    const on = s.tags.includes(g), n = tagCounts.get(g);
    const tip = !pick ? null : on ? "Click to stop filtering by this tag"
      : `${n != null ? `${plural(n, "record has", "records have")} this tag · ` : ""}click to filter`;
    const chip = h("span", { class: `nw-tag${hit ? " hit" : ""}${typed ? " fz" : ""}${pick ? " pick" : ""}${on ? " on" : ""}`,
      title: [typed ? `≈ ${typed}` : null, tip].filter(Boolean).join(" · ") || null }, g);
    if (pick) chip.addEventListener("click", (ev) => { ev.stopPropagation(); changed({ tags: on ? s.tags.filter((x) => x !== g) : [...s.tags, g] }); });
    return chip;
  }));
}

// a record as a card: its box, score and title, the store and category on the right, the snippet with its matches (a
// search) or the start of its text, its tags, when it was edited
function card(it) {
  const lm = weakOf(it);
  const text = it.snippet != null ? it.snippet : it.preview != null ? `${it.preview}${it.preview.length >= 200 ? " …" : ""}` : "";
  const title = it.title ? marked(it.title, it.title_highlights, it.fuzzy, lm) : [text.split("\n")[0].slice(0, 120) || it.id];
  return h("div", { class: `nw-card${picked.has(it.id) ? " picked" : ""}`, ...onOpen(() => preview(it)) },
    h("div", { class: "nw-head" }, pickBox(it), scoreOf(it), h("span", { class: "nw-title" }, title),
      h("span", { class: "nw-where" }, [s.collection, it.category].filter(Boolean).join(" · "))),
    text ? h("div", { class: "nw-text" }, it.snippet != null ? marked(it.snippet, it.snippet_highlights, it.fuzzy, lm) : text) : null,
    it.tags?.length ? tagChips(it) : null,
    it.updated_at ? h("div", { class: "nw-foot" }, `Edited ${ago(it.updated_at)}`) : null);
}

// a table's rows as a grid, like the sheet they came from: the row's number, the columns, the matches marked in each cell
// (cell_highlights: column -> [start, end) ranges in that cell's value), the score last with its «R»
function tableGrid(items) {
  const cols = res.columns?.length ? res.columns : tables.get(s.collection)?.columns || [...new Set(items.flatMap((r) => Object.keys(r.cells || {})))];
  const first = items[0]?.metadata || {};
  const cap = [first.file, first.sheet].filter(Boolean).join(" · ");
  return h("div", { class: "nw-tablewrap" }, cap ? h("div", { class: "nw-tablecap" }, cap) : null,
    h("table", { class: "nw-table" },
      h("thead", {}, h("tr", {}, cfg.write ? h("th", { class: "nw-selcol" }) : null, h("th", { class: "nw-rowno" }, "#"),
        cols.map((c) => h("th", {}, c)), res.search ? h("th", { class: "nw-num", title: "Match score (lower = closer)" }, "Score") : null)),
      h("tbody", {}, items.map((it) => h("tr", { ...onOpen(() => preview(it)), class: picked.has(it.id) ? "picked" : null },
        cfg.write ? h("td", { class: "nw-selcol" }, pickBox(it)) : null,
        h("td", { class: "nw-rowno" }, String(it.metadata?.row ?? it.id)),
        cols.map((c) => {
          const v = String(it.cells?.[c] ?? "");
          // one word of a few characters (a code, a number, a date) on one line; a long text with some width
          const kind = !/\s/.test(v) && v.length <= 24 ? "one" : v.length > 40 ? "long" : null;
          return h("td", { class: kind }, marked(v, it.cell_highlights?.[c], it.fuzzy, weakOf(it)));
        }),
        res.search ? h("td", { class: "nw-num" }, scoreValue(it) != null
          ? [rerankMark(it), scoreText(scoreValue(it)), it.quality != null ? h("div", { class: "nw-qcell" }, qualityOf(it)) : null] : "")
          : null)))));
}

function drawList() {
  if (!R) return;
  if (res.error) { R.list.replaceChildren(h("p", { class: "nw-err" }, errText(res.error))); return; }
  if (res.wait) { R.list.replaceChildren(h("p", { class: "muted" }, "Type a few words to search with these filters.")); return; }
  if (!res.items.length) {
    const none = h("p", { class: "muted" }, "No data");
    R.list.replaceChildren(!stores.length && cfg.write
      ? h("div", { class: "nw-empty" }, none, h("button", { class: "primary", onclick: () => newStoreDialog() }, "+ New data store")) : none);
    return;
  }
  // the three kinds of match, while searching: each as the results mark it, what it means on hover
  const legend = res.search ? h("div", { class: "nw-legend" },
    h("mark", { title: "The word as typed (case and accents aside)" }, "Exact keyword"),
    h("mark", { class: "fz", title: "A word close to the one typed, chosen by the search: a typo, a missing letter, part of a word" }, "Similar word"),
    h("mark", { class: "lm", title: "The typed letters close together and in order, inside another word" }, "Letter match")) : null;
  // every result a letter match: said above them -- no word like what was typed
  const note = res.search && res.items.every((it) => it.letter_match) ? h("p", { class: "nw-weaknote" }, `Only letter matches for «${s.query}»:`) : null;
  const more = res.more ? h("div", { class: "nw-more" }, h("button", { onclick: loadMore },
    res.search ? "Show more" : `Show more (${num(Math.max(0, (res.total || 0) - res.items.length))})`)) : null;
  fill(R.list, legend, note, isTable(s.collection) || res.items.some((it) => it.cells) ? tableGrid(res.items) : res.items.map(card), more);
  if (more && "IntersectionObserver" in window) {
    // scrolled near the end: the next page comes by itself
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) { io.disconnect(); loadMore(); } },
      { root: R.list.scrollHeight > R.list.clientHeight ? R.list : null, rootMargin: "240px" });
    io.observe(more);
  }
}

// -- a record's preview: the whole text with every match of the search marked (highlights: ranges in the text), its
// category, the store's fields it has, its tags; Edit opens the form -----------------------------------------------
async function preview(it) {
  const name = s.collection;
  let item;
  try {
    item = (await api("GET", `/v1/neperi/collections/${enc(name)}/items/${enc(it.id)}`)).item;
  } catch (e) {
    errToast(e);
    return;
  }
  const lm = weakOf(it);
  const meta = item.metadata || {};
  const shown = storeFields.filter((fd) => !fd.column && !fd.builtin && meta[fd.key] != null && meta[fd.key] !== "");
  const fieldsBox = shown.length ? h("div", { class: "nw-cells nw-pfields" }, shown.map((fd) => {
    const v = meta[fd.key];
    return [h("span", { class: "k", title: fd.label }, fd.label), h("span", { class: "v" },
      fd.type === "bool" ? (v === true || v === "true" || v === 1 ? "Yes" : "No") : Array.isArray(v) ? v.join(", ") : String(v))];
  })) : null;
  const body = item.cells
    ? h("div", { class: "nw-cells nw-rowcells" }, Object.entries(item.cells).map(([k, v]) => [h("span", { class: "k", title: k }, k),
      h("span", { class: "v" }, marked(String(v ?? ""), it.cell_highlights?.[k], it.fuzzy, lm))]))
    : h("div", { class: "nw-full" }, marked(item.text || "", it.highlights, it.fuzzy, lm));
  const ui = sheet(item.title ? marked(item.title, it.title_highlights, it.fuzzy, lm) : item.cells ? `Row ${item.metadata?.row ?? item.id}` : item.id,
    h("div", {}, h("div", { class: "nw-pmeta" }, scoreOf(it), h("span", {}, [name, item.category].filter(Boolean).join(" · ")),
      item.created_at ? h("span", {}, `Created ${ago(item.created_at)}`) : null, item.updated_at ? h("span", {}, `Edited ${ago(item.updated_at)}`) : null),
    fieldsBox, body, item.tags?.length ? h("div", { class: "nw-ptags" }, tagChips({ ...item, tag_matches: it.tag_matches, fuzzy: it.fuzzy }, false)) : null),
    (leave, close) => [h("span", { class: "spacer" }), h("button", { onclick: leave }, "Close"),
      cfg.write ? h("button", { class: "primary", onclick: () => { close(); if (item.cells) rowForm(item); else recordForm(item); } }, "Edit") : null],
    { wide: true });
  ui.el.querySelector("mark")?.scrollIntoView({ block: "center" });
}

// =====================================================================================================================
// Forms (NEPERI_WRITE=1)
// =====================================================================================================================
function newRecord() {
  if (!stores.length) return newStoreDialog();
  if (isTable(s.collection)) return rowForm(null);
  return recordForm(null);
}

// a box offering a list as you type (<datalist>): the categories of a store, the values of a field, the tags
let listSeq = 0;
function offering(input, values) {
  const id = `nw-list-${++listSeq}`;
  input.setAttribute("list", id);
  const dl = h("datalist", { id }, values.map((v) => h("option", { value: v })));
  return [input, dl];
}
// the tags of a record: chips, the box after them (Enter or a comma adds one, Backspace in an empty box takes the last off)
function tagInput(initial, suggest = []) {
  const tags = [...initial];
  const box = h("input", { type: "text", placeholder: "Add a tag…", autocomplete: "off", maxLength: 64 });
  const wrap = h("div", { class: "nw-tagin", onclick: () => box.focus() });
  const add = () => {
    for (const t of box.value.split(",").map((x) => x.trim()).filter(Boolean)) if (!tags.includes(t) && tags.length < 20) tags.push(t);
    box.value = "";
    draw();
  };
  const draw = () => fill(wrap, tags.map((t) => h("span", { class: "nw-chip" }, t,
    h("button", { type: "button", title: "Remove", onclick: (ev) => { ev.stopPropagation(); tags.splice(tags.indexOf(t), 1); draw(); } }, "×"))),
  offering(box, suggest.filter((x) => !tags.includes(x))));
  box.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); add(); box.focus(); }
    else if (ev.key === "Backspace" && !box.value && tags.length) { tags.pop(); draw(); box.focus(); }
  });
  box.addEventListener("change", () => { if (box.value.includes(",") || suggest.includes(box.value.trim())) { add(); box.focus(); } });
  draw();
  // the tags, with what is still typed in the box
  const typedTags = () => box.value.split(",").map((x) => x.trim()).filter((t) => t && !tags.includes(t));
  return { el: wrap, value: () => [...tags, ...typedTags()].slice(0, 20) };
}
// a filter field's box in a record's form (the value goes in the record's metadata, under the field's key)
const asText = (v) => (Array.isArray(v) ? v.join("; ") : v == null || typeof v === "object" ? "" : String(v));
function metaInput(d, value, onChange) {
  if (d.type === "status") {   // one of its options (case aside: shown as declared)
    const cur = Array.isArray(value) ? value[0] : value;
    const opts = d.choices || [];
    const hit = cur == null || cur === "" ? null : opts.find((c) => fold(String(c)) === fold(String(cur)));
    const sel = h("select", {}, h("option", { value: "" }, "—"), opts.map((c) => h("option", { value: c }, c)));
    if (cur != null && cur !== "" && hit == null) sel.append(h("option", { value: String(cur) }, String(cur)));
    sel.value = hit ?? (cur == null ? "" : String(cur));
    sel.addEventListener("change", () => onChange(sel.value || null));
    return sel;
  }
  if (d.type === "date") {
    const inp = h("input", { type: "date", value: dayOf(value) });
    inp.addEventListener("change", () => onChange(inp.value || null));
    return inp;
  }
  if (d.type === "bool") {
    const sel = h("select", {}, [["", "—"], ["1", "Yes"], ["0", "No"]].map(([v, l]) => h("option", { value: v }, l)));
    sel.value = value === true || value === "true" ? "1" : value === false || value === "false" ? "0"
      : value == null || value === "" ? "" : parseNum(value) === 1 ? "1" : parseNum(value) === 0 ? "0" : "";
    sel.addEventListener("change", () => onChange(sel.value === "" ? null : sel.value === "1"));
    return sel;
  }
  const inp = h("input", { type: "text", value: asText(value), maxLength: 300, autocomplete: "off",
    placeholder: d.type === "number" ? "A number" : "Pick or type a value (several: a; b)", ...(d.type === "number" ? { inputMode: "decimal" } : {}) });
  const read = () => {
    if (d.type === "number") { const n = parseNum(inp.value); return inp.value.trim() ? (n ?? inp.value.trim()) : null; }
    const vals = inp.value.split(";").map((x) => x.trim()).filter(Boolean);
    return !vals.length ? null : vals.length > 1 ? vals : vals[0];
  };
  inp.addEventListener("input", () => onChange(read()));
  if (d.type === "number") return inp;
  const used = (d.values || []).map((x) => x.value);
  return h("div", {}, offering(inp, [...used, ...(d.choices || []).filter((c) => !used.includes(c))]));
}
const fieldsOf = (name) => api("GET", `/v1/neperi/fields?values=1&collection=${enc(name)}`).then((r) => r.fields || []).catch(() => []);
const catsOf = (name) => api("GET", `/v1/neperi/categories?collection=${enc(name)}`).then((r) => (r.categories || []).map((c) => c.value)).catch(() => []);
const tagsOf = (name) => api("GET", `/v1/neperi/collections/${enc(name)}/tags?limit=300`).then((r) => (r.tags || []).map((x) => x.tag)).catch(() => []);

// a record of text: its data store (another one moves it there), category, the store's filter fields, title, tags, text.
// Written at the revision it was opened at: changed elsewhere meanwhile, the save says so
async function recordForm(item) {
  const from = item ? s.collection : null;
  const textStores = stores.filter((c) => !isTable(c.name));
  if (!textStores.length) return newStoreDialog();
  const storeSel = h("select", {}, textStores.map((c) => h("option", { value: c.name }, c.name)));
  storeSel.value = from || (s.collection && !isTable(s.collection) ? s.collection : textStores[0].name);
  const title = h("input", { type: "text", value: item?.title || "", maxLength: 300 });
  const text = h("textarea", { rows: 10 });
  text.value = item?.text || "";
  const category = h("input", { type: "text", value: item?.category || "", maxLength: 100, autocomplete: "off", placeholder: "Pick one or type a new category" });
  const catWrap = h("div", {});
  const tagWrap = h("div", {});
  const fwrap = h("div", { class: "nw-row2" });
  const err = h("div", { class: "nw-err" });
  const meta = { ...(item?.metadata || {}) }, typed = {};
  let tags = tagInput(item?.tags || []), defs = [];
  // what the store typed in the box offers: its categories, its filter fields (from a metadata key), its tags
  const offerStore = async () => {
    const name = storeSel.value;
    const [cats, fds, tg] = await Promise.all([catsOf(name), fieldsOf(name), tagsOf(name)]);
    if (storeSel.value !== name) return;
    fill(catWrap, offering(category, cats));
    defs = fds.filter((d) => !d.column && !d.builtin);
    fwrap.replaceChildren(...defs.map((d) => {
      if (!(d.key in typed)) typed[d.key] = meta[d.key] ?? null;
      return field(d.label, metaInput(d, typed[d.key], (v) => { typed[d.key] = v; }));
    }));
    const now = tags.value();
    tags = tagInput(now, tg);
    tagWrap.replaceChildren(tags.el);
  };
  storeSel.addEventListener("change", offerStore);
  tagWrap.append(tags.el);
  await offerStore();
  const state = () => JSON.stringify([storeSel.value, title.value, text.value, category.value, tags.value(), typed]);
  const start = state();
  const save = async (btn, force = false) => {
    const name = storeSel.value;
    if (!text.value.trim()) { err.textContent = "The text cannot be empty."; return; }
    for (const d of defs) {
      const v = typed[d.key];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) delete meta[d.key];
      else meta[d.key] = v;
    }
    btn.disabled = true;
    const moving = !!item && name !== from;
    try {
      if (moving) await api("POST", `/v1/neperi/collections/${enc(from)}/items/move`, { ids: [item.id], to: name });
      const row = { id: item ? item.id : newId(), text: text.value, tags: tags.value(), metadata: meta,
        ...(item && !force && !moving ? { rev: item.rev } : {}),
        ...(title.value.trim() ? { title: title.value.trim() } : {}), ...(category.value.trim() ? { category: category.value.trim() } : {}) };
      await api("PUT", `/v1/neperi/collections/${enc(name)}/items`, { items: [row] });
      ui.close();
      toast(moving ? `Moved to ${name}` : item ? "Saved" : "Created", "ok");
      await afterWrite(name);
    } catch (e) {
      btn.disabled = false;
      if (e.code === "item_changed") {
        err.replaceChildren(h("span", { class: "nw-conflict" }, "This record was changed elsewhere.",
          h("button", { class: "small", onclick: async () => {
            try {
              const fresh = (await api("GET", `/v1/neperi/collections/${enc(from)}/items/${enc(item.id)}`)).item;
              ui.close();
              recordForm(fresh);
            } catch (e2) {
              err.textContent = errText(e2);
            }
          } }, "Load the new version"),
          h("button", { class: "small danger", onclick: () => save(btn, true) }, "Save anyway")));
        return;
      }
      err.textContent = errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => save(ok) }, "Save");
  const ui = sheet(item ? "Edit the record" : "New record", h("div", { class: "nw-form" },
    h("div", { class: "nw-row2" }, field("Data store", storeSel), field("Category", catWrap)),
    fwrap, field("Title", title), field("Tags", tagWrap), field("Text", text), err),
  (leave) => [item ? h("button", { class: "danger", onclick: () => removeRecords(from, [item.id], ui) }, "Delete") : null,
    h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), ok], { dirty: () => state() !== start, wide: true });
  (item ? text : title).focus();
}

// a row of a table: a box a column; written by its cells (a new row: PUT with cells, a row changed: PATCH its cells)
async function rowForm(item) {
  const name = s.collection, cols = tables.get(name)?.columns || Object.keys(item?.cells || {});
  const boxes = cols.map((c) => {
    const v = String(item?.cells?.[c] ?? "");
    const box = v.length > 60 ? h("textarea", { rows: 3 }) : h("input", { type: "text" });
    box.value = v;
    return [c, box];
  });
  const err = h("div", { class: "nw-err" });
  const cells = () => Object.fromEntries(boxes.map(([c, b]) => [c, b.value]));
  const start = JSON.stringify(cells());
  const save = async (btn, force = false) => {
    btn.disabled = true;
    try {
      if (item) {
        const was = item.cells || {}, now = cells();
        const changes = Object.fromEntries(Object.entries(now).filter(([c, v]) => String(was[c] ?? "") !== v).map(([c, v]) => [c, v === "" ? null : v]));
        if (Object.keys(changes).length) {
          await api("PATCH", `/v1/neperi/collections/${enc(name)}/items/${enc(item.id)}`, { cells: changes, ...(force ? {} : { rev: item.rev }) });
        }
      } else {
        await api("PUT", `/v1/neperi/collections/${enc(name)}/items`, { items: [{ id: newId(), cells: cells() }] });
      }
      ui.close();
      toast(item ? "Saved" : "Created", "ok");
      await afterWrite(name);
    } catch (e) {
      btn.disabled = false;
      if (e.code === "item_changed") {
        err.replaceChildren(h("span", { class: "nw-conflict" }, "This row was changed elsewhere.",
          h("button", { class: "small danger", onclick: () => save(btn, true) }, "Save anyway")));
        return;
      }
      err.textContent = errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => save(ok) }, "Save");
  const ui = sheet(item ? `Row ${item.metadata?.row ?? item.id}` : `New row · ${name}`,
    h("div", { class: "nw-form" }, h("div", { class: "nw-row2" }, boxes.map(([c, b]) => field(c, b))), err),
    (leave) => [item ? h("button", { class: "danger", onclick: () => removeRecords(name, [item.id], ui) }, "Delete") : null,
      h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), ok], { dirty: () => JSON.stringify(cells()) !== start, wide: true });
  boxes[0]?.[1].focus();
}

async function removeRecords(name, ids, ui) {
  if (!(await confirmDialog(`Delete ${ids.length === 1 ? "this record" : plural(ids.length, "record", "records")}? This cannot be undone.`, { ok: "Delete", danger: true }))) return;
  try {
    await api("POST", `/v1/neperi/collections/${enc(name)}/items/delete`, { ids });
    ui?.close();
    toast("Deleted", "ok");
    await afterWrite(name);
  } catch (e) {
    errToast(e);
  }
}

// after a write: the stores (one may be new or gone), the store's filters, the view
async function afterWrite(name) {
  await loadStores();
  if (!storeOf(s.collection)) { await pickStore(null); return; }
  if (s.collection === name) await loadStoreFilters(name);
  if (R) changed({});
  else if (location.hash === "#/stores") storesPage();
}

// -- Import Excel / CSV: the file into a new data store (named after it), or a table updated with it -------------------
const NAME_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const slug = (name) => fold(name.replace(/\.[^.]+$/, "")).replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z]+/, "").replace(/[-.]+$/, "").slice(0, 64);
function importDialog() {
  const file = h("input", { type: "file", accept: ".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const tableNames = stores.filter((c) => isTable(c.name)).map((c) => c.name);
  const asNew = h("input", { type: "radio", name: "nw-into", value: "new", checked: true });
  const asUpd = h("input", { type: "radio", name: "nw-into", value: "update", disabled: !tableNames.length });
  const name = h("input", { type: "text", maxLength: 64, autocomplete: "off", placeholder: "store name, e.g. customers" });
  const target = h("select", {}, tableNames.map((n) => h("option", { value: n }, n)));
  if (isTable(s.collection)) target.value = s.collection;
  const sheetName = h("input", { type: "text", autocomplete: "off", placeholder: "the first sheet" });
  const idCol = h("input", { type: "text", autocomplete: "off", placeholder: "none: rows are numbered" });
  const err = h("div", { class: "nw-err" });
  const nameField = field("New data store", name), targetField = field("Table to update", target);
  const show = () => { nameField.hidden = asUpd.checked; targetField.hidden = !asUpd.checked; };
  for (const r of [asNew, asUpd]) r.addEventListener("change", show);
  file.addEventListener("change", () => {
    const f = file.files[0];
    if (!f) return;
    // a file named as a table it updates: that table, else a new store named after the file (a free name)
    const base = slug(f.name) || "table", taken = new Set(stores.map((c) => c.name));
    if (tableNames.includes(base)) { asUpd.checked = true; target.value = base; } else {
      let n = base, i = 2;
      while (taken.has(n)) n = `${base.slice(0, 60)}-${i++}`;
      if (!name.value.trim() || name.dataset.auto) { name.value = n; name.dataset.auto = "1"; }
    }
    show();
  });
  name.addEventListener("input", () => { delete name.dataset.auto; });
  const run = async (btn) => {
    const f = file.files[0], into = asUpd.checked ? target.value : name.value.trim();
    if (!f) { err.textContent = "Pick an .xlsx or .csv file."; return; }
    if (!NAME_RE.test(into)) { err.textContent = "A store's name: lowercase letters, digits, _ . -, starting with a letter."; return; }
    const fd = new FormData();
    fd.append("file", f);
    if (asUpd.checked) fd.append("override", "yes");
    if (sheetName.value.trim()) fd.append("sheet", sheetName.value.trim());
    if (idCol.value.trim()) fd.append("id_column", idCol.value.trim());
    btn.disabled = true;
    err.textContent = "Importing…";
    try {
      const r = await api("POST", `/v1/neperi/collections/${enc(into)}/import`, fd);
      ui.close();
      toast(`${into}: ${plural(r.upserted, "row", "rows")} written${r.deleted ? `, ${num(r.deleted)} deleted` : ""}${r.skipped ? `, ${num(r.skipped)} skipped` : ""}`, "ok");
      await loadStores();
      await pickStore(into);
      go2records();
      // a new table: what it is filtered by is picked next, from its columns (admin keys)
      if (!asUpd.checked && cfg.admin) setupDialog(into, "fields");
    } catch (e) {
      btn.disabled = false;
      err.textContent = errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => run(ok) }, "Import");
  const ui = sheet("Import Excel / CSV", h("div", { class: "nw-form" },
    field("File (.xlsx, .csv)", file),
    h("div", { class: "nw-into" }, h("label", { class: "nw-radio" }, asNew, "A new data store"),
      h("label", { class: `nw-radio${tableNames.length ? "" : " off"}` }, asUpd, "Update a table")),
    nameField, targetField, h("div", { class: "nw-row2" }, field("Sheet", sheetName), field("ID column", idCol)), err),
  (leave) => [h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), ok]);
  show();
}
const go2records = () => { if (location.hash !== "#/records") location.hash = "#/records"; else if (R) changed({}); };

// -- ⚙ Store setup of a data store ----------------------------------------------------------------------------------
// Categories (a store of text): declared ahead so the forms offer them before a record has one; one renamed or taken off
// goes so on its records too (asked first). Attributes -- the filter fields (admin keys: they are the account's): a table's
// columns or the metadata keys of the records, each on or off, its label and type (a status: its options). Domains (admin
// keys): named sets of conditions on the category and the fields, all of them holding
const FIELD_TYPES = [["list", "List"], ["status", "Status (one of)"], ["number", "Number (from – to)"], ["bool", "Yes / No"],
  ["date", "Date (from – to)"]];
// the record's own days, offered as attributes: a date, read from the record (not its metadata)
const BUILTIN_DATES = [["created_at", "Created"], ["updated_at", "Changed"]];
const BUILTIN_KEYS = new Set(BUILTIN_DATES.map(([k]) => k));
async function setupDialog(name, tab = null) {
  const table = isTable(name), withCats = !table && cfg.write, withFields = cfg.admin;
  if (!withCats && !withFields) return;
  let sug, cats, doms, defs, sorts;
  try {
    [sug, cats, doms, defs, sorts] = await Promise.all([withFields ? api("GET", `/v1/neperi/collections/${enc(name)}/fields/suggest`) : null,
      withCats ? api("GET", `/v1/neperi/categories?collection=${enc(name)}`).then((r) => r.categories || []) : [],
      withFields ? api("GET", `/v1/neperi/collections/${enc(name)}/domains`).then((r) => r.domains || []) : [],
      withFields ? api("GET", `/v1/neperi/fields?values=1&collection=${enc(name)}`).then((r) => r.fields || []) : [],
      withFields ? api("GET", `/v1/neperi/collections/${enc(name)}/sort`).then((r) => r.sort || []) : []]);
  } catch (e) {
    errToast(e);
    return;
  }
  const fdOf = new Map(defs.map((d) => [d.key, d]));
  const crows = cats.map((c) => ({ from: c.value, name: c.value, count: c.count || 0, gone: false }));
  const frows = withFields ? sug.suggestions.map((x) => ({ ...x, on: x.field, was: x.field, type: x.type === "text" ? "list" : x.type,
    options: x.type === "status" ? [...(fdOf.get(x.key)?.choices || [])] : [] })) : [];
  // the record's own days: two rows suggested, ticked when the store has them
  if (withFields) {
    for (const [k, l] of BUILTIN_DATES) {
      if (!frows.some((r) => r.key === k)) frows.push({ key: k, label: l, column: null, type: "date", on: false, was: false, values: [], options: [] });
    }
  }
  let start = "";
  const err = h("div", { class: "nw-err" });
  // categories: a row each (its name, how many records, ×), + Add
  const catList = h("div", { class: "nw-cats" });
  const drawCats = () => fill(catList, crows.map((c) => {
    const inp = h("input", { type: "text", value: c.name, maxLength: 100, placeholder: "Category", disabled: c.gone });
    inp.addEventListener("input", () => { c.name = inp.value; });
    return h("div", { class: `nw-crow${c.gone ? " gone" : ""}` }, inp, h("span", { class: "nw-n" }, c.from ? plural(c.count, "record", "records") : "new"),
      h("button", { type: "button", class: "small", title: c.gone ? "Keep it" : "Take it off", onclick: () => {
        if (!c.from) crows.splice(crows.indexOf(c), 1);
        else c.gone = !c.gone;
        drawCats();
      } }, c.gone ? "↺" : "×"));
  }), crows.length ? null : h("p", { class: "nw-none" }, "No data"));
  drawCats();
  const catPane = withCats ? h("div", { class: "nw-pane" }, catList,
    h("div", {}, h("button", { type: "button", class: "small", onclick: () => { crows.push({ from: null, name: "", count: 0, gone: false }); drawCats(); catList.querySelector(".nw-crow:last-child input")?.focus(); } }, "+ Add a category"))) : null;
  // filter fields: a row each -- on, its label, its type, where its values come from (and a few of them)
  const fieldPane = withFields ? h("div", { class: "nw-pane" },
    frows.length ? h("div", { class: "nw-fhead" }, h("span", {}), h("span", {}, "Label"), h("span", {}, "Type"), h("span", {}, table ? "Column" : "Metadata key")) : null,
    h("div", { class: "nw-fields" }, frows.length ? frows.map((r) => {
      const on = h("input", { type: "checkbox", checked: r.on, title: "Filter by it" });
      const label = h("input", { type: "text", value: r.label, maxLength: 60 });
      const type = h("select", { disabled: BUILTIN_KEYS.has(r.key) }, FIELD_TYPES.map(([v, l]) => h("option", { value: v }, l)));
      type.value = r.type;
      // a status: its options on a line under the row, «;» between them (filled from the values its records carry)
      const opts = h("input", { type: "text", value: (r.options || []).join("; "), maxLength: 3000,
        placeholder: "Options, «;» between them — e.g. Draft; Published; Archived" });
      opts.addEventListener("input", () => { r.options = opts.value.split(";").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean); });
      const optRow = h("div", { class: "nw-fopts" }, h("span", { class: "nw-fsrc" }, "Options"), opts);
      const showOpts = () => { optRow.hidden = r.type !== "status"; };
      const row = h("div", { class: `nw-frow${r.on ? "" : " off"}` }, on, label, type,
        h("span", { class: "nw-fsrc", title: (r.values || []).join(" · ") }, BUILTIN_KEYS.has(r.key) ? `${r.key} — the record's own day` : table ? r.column : r.key,
          r.values?.length ? h("span", { class: "muted" }, ` — ${r.values.slice(0, 3).join(" · ")}`) : null), optRow);
      on.addEventListener("change", () => { r.on = on.checked; row.classList.toggle("off", !r.on); });
      label.addEventListener("input", () => { r.label = label.value; });
      type.addEventListener("change", () => {
        r.type = type.value;
        if (r.type === "status" && !(r.options || []).length) { r.options = [...(r.values || [])]; opts.value = r.options.join("; "); }
        showOpts();
      });
      showOpts();
      return row;
    }) : h("p", { class: "nw-none" }, "No data"))) : null;
  // domains: a card each -- its name, «Show on UI» (a box in the filters, All by default) or «Always applied» (no box: every
  // search and count keeps to it), its conditions, one a row (a category or a field, and its values), all of them holding
  const condsOf = (dom) => [
    ...(dom.where?.category ? [{ what: "category", value: [].concat(dom.where.category) }] : []),
    ...Object.entries(dom.where?.fields || {}).map(([k, v]) => ({ what: k, value: v }))];
  const drows = doms.map((d) => ({ name: d.name, show: !!d.show, always: !!d.always, conds: condsOf(d) }));
  const domBox = h("div", { class: "nw-doms" });
  const whatOptions = () => [...(table ? [] : [["category", "Category"]]), ...defs.map((d) => [d.key, d.label])];
  const valuesOf = (what) => (what === "category" ? crows.filter((c) => !c.gone && c.name.trim()).map((c) => c.name.trim())
    : [...new Set([...(fdOf.get(what)?.values || []).map((x) => x.value), ...(fdOf.get(what)?.choices || [])])]);
  function multiPick(cond, box) {   // any of the values ticked: a list under the row (one that pops up is cut by the cards' box)
    const btn = h("button", { type: "button", class: "nw-pick" });
    const relabel = () => { const v = [].concat(cond.value || []); btn.textContent = v.length ? v.join(", ") : "Pick values"; btn.title = btn.textContent; };
    relabel();
    btn.addEventListener("click", () => {
      if (!box.hidden) { box.hidden = true; return; }
      const all = valuesOf(cond.what), now = new Set([].concat(cond.value || []));
      const list = h("div", { class: "nw-checks" }, ...(all.length ? all.map((v) => {
        const cb = h("input", { type: "checkbox", checked: now.has(v) });
        cb.addEventListener("change", () => { if (cb.checked) now.add(v); else now.delete(v); cond.value = [...now]; relabel(); });
        return h("label", { class: "nw-check" }, cb, h("span", {}, v));
      }) : [h("p", { class: "nw-none" }, "No data")]));
      box.replaceChildren(list, h("div", { class: "nw-popfoot" }, h("button", { type: "button", class: "small",
        onclick: () => { box.hidden = true; btn.focus(); } }, "‹ Back")));
      box.hidden = false;
    });
    return btn;
  }
  function condValue(cond, box) {   // a condition's values, by the type of what it is on
    const fd = cond.what === "category" ? { type: "list" } : fdOf.get(cond.what) || { type: "list" };
    if (fd.type === "status") {
      const sel = h("select", {}, h("option", { value: "" }, "—"), (fd.choices || []).map((c) => h("option", { value: c }, c)));
      sel.value = typeof cond.value === "string" ? cond.value : "";
      sel.addEventListener("change", () => { cond.value = sel.value || null; });
      return sel;
    }
    if (fd.type === "bool") {
      if (typeof cond.value !== "boolean") cond.value = true;
      const sel = h("select", {}, [["1", "Yes"], ["0", "No"]].map(([v, l]) => h("option", { value: v }, l)));
      sel.value = cond.value ? "1" : "0";
      sel.addEventListener("change", () => { cond.value = sel.value === "1"; });
      return sel;
    }
    if (fd.type === "number" || fd.type === "date") {
      const was = cond.value && typeof cond.value === "object" && !Array.isArray(cond.value) ? cond.value : {};
      cond.value = { from: was.from ?? null, to: was.to ?? null };
      const end = (k, hint) => {
        const inp = fd.type === "date" ? h("input", { type: "date", value: cond.value[k] || "" })
          : h("input", { type: "text", inputMode: "decimal", placeholder: hint, value: cond.value[k] != null ? num(cond.value[k]) : "" });
        inp.addEventListener("change", () => {
          const typed = inp.value.trim();
          cond.value = { ...cond.value, [k]: !typed ? null : fd.type === "date" ? typed : parseNum(typed) };
        });
        return inp;
      };
      return h("div", { class: "nw-dval" }, end("from", "from"), h("span", { class: "nw-ql" }, "–"), end("to", "to"));
    }
    return multiPick(cond, box);
  }
  function condRow(dom, cond) {
    const what = h("select", {}, whatOptions().map(([v, l]) => h("option", { value: v }, l)));
    what.value = cond.what;
    const el = h("div", { class: "nw-dcond" }), slot = h("div", { class: "nw-dval" });
    const pickBox = h("div", { class: "nw-dpick" });   // a list field's -- or the category's -- values, under the row
    const drawValue = () => { pickBox.hidden = true; pickBox.replaceChildren(); slot.replaceChildren(condValue(cond, pickBox)); };
    what.addEventListener("change", () => { cond.what = what.value; cond.value = null; drawValue(); });
    drawValue();
    el.append(what, slot, h("button", { type: "button", class: "small", title: "Remove", onclick: () => { dom.conds = dom.conds.filter((x) => x !== cond); drawDoms(); } }, "×"), pickBox);
    return el;
  }
  function domCard(dom) {
    const nameIn = h("input", { type: "text", value: dom.name, maxLength: 60, placeholder: "Domain name" });
    nameIn.addEventListener("input", () => { dom.name = nameIn.value; });
    const show = h("input", { type: "checkbox", checked: dom.show }), always = h("input", { type: "checkbox", checked: dom.always });
    show.addEventListener("change", () => { dom.show = show.checked; if (dom.show) { dom.always = false; always.checked = false; } });
    always.addEventListener("change", () => { dom.always = always.checked; if (dom.always) { dom.show = false; show.checked = false; } });
    const addCond = () => {
      const used = new Set(dom.conds.map((c) => c.what));
      const free = whatOptions().find(([v]) => !used.has(v)) || whatOptions()[0];
      if (!free) return;
      dom.conds.push({ what: free[0], value: null });
      drawDoms();
    };
    return h("div", { class: "nw-dcard" },
      h("div", { class: "nw-dhead" }, nameIn,
        h("label", { title: "Visitors pick this domain in the filters (All by default)" }, show, "Show on UI"),
        h("label", { title: "Always applied, with no box to pick it" }, always, "Always applied"),
        h("button", { type: "button", class: "small", title: "Delete domain", onclick: () => { drows.splice(drows.indexOf(dom), 1); drawDoms(); } }, "×")),
      ...dom.conds.map((c) => condRow(dom, c)),
      h("div", {}, h("button", { type: "button", class: "small", disabled: !whatOptions().length, onclick: addCond }, "+ Add condition")));
  }
  function drawDoms() {
    closePop();
    domBox.replaceChildren(...drows.map(domCard), h("div", {}, h("button", { type: "button", class: "small", onclick: () => {
      drows.push({ name: "", show: false, always: false, conds: [] });
      drawDoms();
      domBox.querySelectorAll(".nw-dhead input[type=text]")[drows.length - 1]?.focus();
    } }, "+ Add domain")));
  }
  drawDoms();
  const domPane = withFields ? h("div", { class: "nw-pane" }, domBox) : null;
  // sort: the options of the Sort box, as a shop has one -- «Applies when»: no domain picked, or a domain (one applied always is
  // never picked); a card an option: its name, its pairs (what, up or down; the first decides), «Default» (one a group)
  const sopts = sorts.map((x) => ({ dom: x.domain ? drows.find((d) => d.name.toLowerCase() === x.domain.toLowerCase()) || null : null,
    name: x.name, keys: (x.keys || []).map((k) => ({ by: k.by, dir: k.dir || "asc" })), def: !!x.default }));
  let sortScope = null;
  const sortBox = h("div", { class: "nw-sorts" });
  const byOptions = () => [...(table ? [] : [["category", "Category"]]), ...defs.filter((d) => !BUILTIN_KEYS.has(d.key)).map((d) => [d.key, d.label]),
    ...BUILTIN_DATES];
  function keyRow(o, k) {
    const by = h("select", {}, byOptions().map(([v, l]) => h("option", { value: v }, l)));
    by.value = k.by;
    by.addEventListener("change", () => { k.by = by.value; });
    const dir = h("select", {}, h("option", { value: "asc" }, "↑ Ascending"), h("option", { value: "desc" }, "↓ Descending"));
    dir.value = k.dir;
    dir.addEventListener("change", () => { k.dir = dir.value; });
    return h("div", { class: "nw-skey" }, by, dir, h("button", { type: "button", class: "small", title: "Remove", disabled: o.keys.length < 2,
      onclick: () => { o.keys.splice(o.keys.indexOf(k), 1); drawSorts(); } }, "×"));
  }
  function optCard(o) {
    const nm = h("input", { type: "text", value: o.name, maxLength: 60, placeholder: "Option name — e.g. Price: low to high" });
    nm.addEventListener("input", () => { o.name = nm.value; });
    const def = h("input", { type: "checkbox", checked: o.def });
    def.addEventListener("change", () => { for (const x of sopts) if (x.dom === o.dom) x.def = false; o.def = def.checked; drawSorts(); });
    return h("div", { class: "nw-dcard" },
      h("div", { class: "nw-dhead" }, nm, h("label", { title: "Picked in the Sort box before a search" }, def, "Default"), h("span", {}),
        h("button", { type: "button", class: "small", title: "Delete option", onclick: () => { sopts.splice(sopts.indexOf(o), 1); drawSorts(); } }, "×")),
      h("div", { class: "nw-spairs" }, ...o.keys.map((k) => keyRow(o, k)),   // the pairs, indented under the option's name
        h("div", {}, h("button", { type: "button", class: "small", disabled: o.keys.length >= 3 || !byOptions().length, onclick: () => {
          const used = new Set(o.keys.map((k) => k.by));
          o.keys.push({ by: (byOptions().find(([v]) => !used.has(v)) || byOptions()[0])[0], dir: "asc" });
          drawSorts();
        } }, "+ Add pair"))));
  }
  function drawSorts() {
    const pickable = drows.filter((d) => !d.always && d.name.trim());
    if (sortScope && !pickable.includes(sortScope)) sortScope = null;
    const scopeSel = h("select", {}, h("option", { value: "" }, "(No domain picked)"), pickable.map((d, i) => h("option", { value: String(i) }, d.name.trim())));
    scopeSel.value = sortScope ? String(pickable.indexOf(sortScope)) : "";
    scopeSel.addEventListener("change", () => { sortScope = scopeSel.value === "" ? null : pickable[Number(scopeSel.value)]; drawSorts(); });
    const mine = sopts.filter((o) => o.dom === sortScope);
    sortBox.replaceChildren(h("div", { class: "nw-sscope" }, h("span", { class: "nw-fsrc" }, "Applies when"), scopeSel), ...mine.map(optCard),
      h("div", {}, h("button", { type: "button", class: "small", disabled: !byOptions().length || mine.length >= 10, onclick: () => {
        sopts.push({ dom: sortScope, name: "", keys: [{ by: byOptions()[0][0], dir: "asc" }], def: !mine.length });
        drawSorts();
        sortBox.querySelectorAll(".nw-dhead input[type=text]")[mine.length]?.focus();
      } }, "+ Add option")));
  }
  drawSorts();
  const sortPane = withFields ? h("div", { class: "nw-pane" }, sortBox) : null;
  const sortSig = () => sopts.map((x) => [x.dom ? drows.indexOf(x.dom) : -1, x.name, x.keys, x.def]);
  start = JSON.stringify([crows, frows, drows, sortSig()]);
  // a tab each
  const panes = [withCats ? ["cats", "Categories", catPane] : null, withFields ? ["fields", "Attributes", fieldPane] : null,
    withFields ? ["domains", "Domains", domPane] : null, withFields ? ["sort", "Sort", sortPane] : null].filter(Boolean);
  const tabs = h("div", { class: "nw-tabs" });
  const showTab = (id) => {
    if (id === "sort") drawSorts();   // the domains as the Domains tab has them now
    tabs.replaceChildren(...panes.map(([k, label]) => h("button", { type: "button", class: `nw-tab${k === id ? " on" : ""}`, onclick: () => showTab(k) }, label)));
    for (const [k, , pane] of panes) pane.hidden = k !== id;
  };
  showTab(panes.some(([k]) => k === tab) ? tab : panes[0][0]);
  const save = async (btn) => {
    err.textContent = "";
    // categories: renamed (on their records), taken off (from their records), then the list in its order
    const renames = crows.filter((c) => c.from && !c.gone && c.name.trim() && c.name.trim() !== c.from);
    const drops = crows.filter((c) => c.from && c.gone && c.count > 0);
    const affected = [...renames, ...drops].reduce((n, c) => n + c.count, 0);
    if (affected && !(await confirmDialog(`${[...renames.map((c) => `Rename «${c.from}» to «${c.name.trim()}»`), ...drops.map((c) => `take «${c.from}» off`)].join("; ")}: ${plural(affected, "record", "records")} change. This cannot be undone.`, { ok: "Save" }))) return;
    const domOut = [], sortOut = [];
    if (withFields) {
      const bad = frows.find((r) => r.on && !r.label.trim());
      if (bad) { err.textContent = "A field needs a label."; showTab("fields"); return; }
      const noOpts = frows.find((r) => r.on && r.type === "status" && !(r.options || []).length);
      if (noOpts) { err.textContent = `«${noOpts.label}» is a status: give its options.`; showTab("fields"); return; }
      // the domains: each named once, a condition at least (a field once), a value each
      const names = new Set();
      for (const dom of drows) {
        const nm = dom.name.trim().replace(/\s+/g, " ");
        if (!nm) { err.textContent = "A domain needs a name."; showTab("domains"); return; }
        if (names.has(nm.toLowerCase())) { err.textContent = `Two domains are named «${nm}».`; showTab("domains"); return; }
        names.add(nm.toLowerCase());
        const where = {}, seen = new Set();
        for (const c of dom.conds) {
          const v = c.value;
          if (v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && v.from == null && v.to == null)) continue;
          if (seen.has(c.what)) { err.textContent = `Domain «${nm}»: «${c.what === "category" ? "Category" : fdOf.get(c.what)?.label || c.what}» has two conditions.`; showTab("domains"); return; }
          seen.add(c.what);
          if (c.what === "category") where.category = [].concat(v);
          else (where.fields ??= {})[c.what] = v;
        }
        if (!Object.keys(where).length) { err.textContent = `Domain «${nm}»: give it one condition at least.`; showTab("domains"); return; }
        domOut.push({ name: nm, show: dom.show, always: dom.always, where });
      }
      // the sort options: named once a group (not «score»), a field once an option; those of a domain gone (or now applied always)
      // go, so does a pair on an attribute let go (an option left with none too)
      const snames = new Set(), perScope = new Map();
      for (const o of sopts) {
        if (o.dom && (!drows.includes(o.dom) || o.dom.always)) continue;
        const dn = o.dom ? o.dom.name.trim().replace(/\s+/g, " ") : null, nm = o.name.trim().replace(/\s+/g, " ");
        const fail = (msg) => { sortScope = o.dom; err.textContent = msg; showTab("sort"); };
        if (!nm) { fail("A sort option needs a name."); return; }
        if (nm.toLowerCase() === "score") { fail("«score» is the name of «Best match»."); return; }
        const sk = `${(dn || "").toLowerCase()}|${nm.toLowerCase()}`;
        if (snames.has(sk)) { fail(`Two sort options are named «${nm}».`); return; }
        snames.add(sk);
        const keys = o.keys.filter((k) => k.by === "category" || BUILTIN_KEYS.has(k.by) || frows.some((r) => r.on && r.key === k.by));
        if (new Set(keys.map((k) => k.by)).size !== keys.length) { fail(`Option «${nm}»: an attribute twice.`); return; }
        if (!keys.length) continue;
        perScope.set(dn, (perScope.get(dn) || 0) + 1);
        if (perScope.get(dn) > 10) { fail("At most 10 sort options a group."); return; }
        sortOut.push({ domain: dn, name: nm, keys: keys.map((k) => ({ by: k.by, dir: k.dir })), default: o.def });
      }
      const kept = frows.find((r) => r.was && !r.on && domOut.some((d) => d.where.fields && r.key in d.where.fields));
      if (kept) { err.textContent = `«${kept.label}» is a condition of a domain: it stays while one names it.`; showTab("domains"); return; }
    }
    btn.disabled = true;
    try {
      for (const c of renames) await runOp("/v1/neperi/categories/rename", { collection: name, from: c.from, to: c.name.trim() });
      for (const c of drops) await runOp("/v1/neperi/categories/delete", { collection: name, category: c.from });
      if (withCats) {
        const list = [...new Set(crows.filter((c) => !c.gone).map((c) => c.name.trim()).filter(Boolean))];
        await api("PUT", `/v1/neperi/collections/${enc(name)}/categories`, { categories: list });
      }
      if (withFields) await api("PUT", `/v1/neperi/collections/${enc(name)}/domains`, { domains: domOut });   // before a field it no longer names goes
      if (withFields) await saveFields(name, frows, table);
      if (withFields) await api("PUT", `/v1/neperi/collections/${enc(name)}/sort`, { sort: sortOut });   // after its fields
      s.domains = {};
      s.order = null;
      ui.close();
      toast("Saved", "ok");
      await afterWrite(name);
    } catch (e) {
      btn.disabled = false;
      err.textContent = errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => save(ok) }, "Save");
  const ui = sheet(`${withFields ? "Store setup" : "Categories"} · ${name}`,
    h("div", { class: "nw-form nw-setup" }, panes.length > 1 ? tabs : null, panes.map(([, , p]) => p), err),
    (leave) => [h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), ok],
    { dirty: () => JSON.stringify([crows, frows, drows, sortSig()]) !== start, wide: true });
}
// a store's filter fields as ticked. A field is the account's, read from a metadata key (or a table's column) in the
// stores it names (none named: every store): one unticked goes when it was this store's only, else this store leaves its
// list; one ticked is declared or changed -- a key another store uses too: this store joins its list
async function saveFields(name, rows, table) {
  const all = new Map(((await api("GET", "/v1/neperi/fields")).fields || []).map((d) => [d.key, d]));
  for (const r of rows.filter((x) => x.was && !x.on)) {
    const d = all.get(r.key);
    const others = (d?.collections.length ? d.collections : stores.map((c) => c.name)).filter((n) => n !== name);
    if (!d || !others.length) await api("DELETE", `/v1/neperi/fields/${enc(r.key)}`);
    else await api("PUT", `/v1/neperi/fields/${enc(r.key)}`, { collections: others });
  }
  let pos = 0;
  for (const r of rows.filter((x) => x.on)) {
    const d = all.get(r.key);
    const cols = d ? (d.collections.length ? [...new Set([...d.collections, name])] : []) : [name];
    await api("PUT", `/v1/neperi/fields/${enc(r.key)}`, { label: r.label.trim(), type: r.type, collections: cols, position: pos++,
      ...(table && r.column && !BUILTIN_KEYS.has(r.key) ? { column: r.column } : {}), ...(r.type === "status" ? { choices: r.options || [] } : {}) });
  }
}

// an operation on many records (a category renamed or taken off, a bulk action): a batch a call, called again with its
// `op` until `done`; progress(answer) after each batch; stop() true: it stops there (what it changed stays changed)
async function runOp(path, body, progress = null, stop = () => false) {
  let op = null, last = null;
  try {
    do {
      last = await api("POST", path, { ...body, ...(op ? { op } : {}) });
      op = last.op;
      progress?.(last);
    } while (!last.done && !stop());
  } finally {
    if (op && last && !last.done) await api("POST", `/v1/neperi/ops/${enc(op)}/stop`).catch(() => {});
  }
  return last;
}

// -- a bulk action on the records picked ----------------------------------------------------------------------------
function bulkDialog() {
  const ids = [...picked], name = s.collection;
  if (!ids.length) return;
  const table = isTable(name);
  const ACTS = table ? [["delete", "Delete items"]] : [["set_category", "Set category"], ["clear_category", "Remove category"],
    ["add_tags", "Add tags"], ["remove_tags", "Remove tags"], ["rename_tag", "Rename a tag"], ["move", "Move to another data store"],
    ["delete", "Delete items"]];
  const act = h("select", {}, ACTS.map(([v, l]) => h("option", { value: v }, l)));
  const cat = h("input", { type: "text", maxLength: 100, autocomplete: "off", placeholder: "Pick one or type a new category" });
  const tagBox = tagInput([], [...tagCounts.keys()]);
  const fromTag = h("input", { type: "text", maxLength: 64, autocomplete: "off" }), toTag = h("input", { type: "text", maxLength: 64, autocomplete: "off" });
  const others = stores.filter((c) => c.name !== name && !isTable(c.name)).map((c) => c.name);
  const to = h("select", {}, others.map((n) => h("option", { value: n }, n)));
  const fCat = field("Category", offering(cat, storeCats.map((c) => c.value))), fTags = field("Tags", tagBox.el);
  const fFrom = field("Tag", ...offering(fromTag, [...tagCounts.keys()])), fTo = field("New name", toTag), fTo2 = field("Target data store", to);
  const show = () => {
    const v = act.value;
    fCat.hidden = v !== "set_category";
    fTags.hidden = v !== "add_tags" && v !== "remove_tags";
    fFrom.hidden = fTo.hidden = v !== "rename_tag";
    fTo2.hidden = v !== "move";
  };
  act.addEventListener("change", show);
  const err = h("div", { class: "nw-err" });
  const bar = h("i", { style: { width: "0%" } }), line = h("div", { class: "muted" });
  const prog = h("div", { class: "nw-prog", hidden: true }, h("div", { class: "meter" }, bar), line);
  let stop = false, running = false;
  const go = async (btn) => {
    const v = act.value, label = ACTS.find(([k]) => k === v)[1];
    const body = { where: { collection: name }, ids, action: v === "clear_category" ? "set_category" : v };
    if (v === "set_category") { if (!cat.value.trim()) { err.textContent = "Type a category."; return; } body.category = cat.value.trim(); }
    if (v === "clear_category") body.category = null;
    if (v === "add_tags" || v === "remove_tags") { const tags = tagBox.value(); if (!tags.length) { err.textContent = "Pick or type a tag."; return; } body.tags = tags; }
    if (v === "rename_tag") {
      if (!fromTag.value.trim() || !toTag.value.trim() || fromTag.value.trim() === toTag.value.trim()) { err.textContent = "Pick the tag and a new name for it."; return; }
      Object.assign(body, { from_tag: fromTag.value.trim(), to_tag: toTag.value.trim() });
    }
    if (v === "move") { if (!to.value) { err.textContent = "Pick the data store."; return; } body.to = to.value; }
    err.textContent = "";
    try {
      const probe = await api("POST", "/v1/neperi/items/bulk", { ...body, dry_run: true });
      if (!probe.matched) { err.textContent = "Nothing to change."; return; }
      if (!(await confirmDialog(`${label}: ${plural(probe.matched, "selected record", "selected records")}. This cannot be undone.`, { ok: label, danger: v === "delete" }))) return;
      btn.disabled = true;
      running = true;
      prog.hidden = false;
      const last = await runOp("/v1/neperi/items/bulk", body, (a) => {
        const done = Math.max(0, (a.total || 0) - (a.left || 0));
        bar.style.width = `${a.total ? Math.round((100 * done) / a.total) : 100}%`;
        line.textContent = `${num(a.changed_total || 0)} changed · ${num(a.left || 0)} left`;
      }, () => stop);
      ui.close();
      picked.clear();
      toast(last.done ? `Done: ${plural(last.changed_total || 0, "record", "records")}` : `Stopped: ${num(last.left)} left`, "ok");
      await afterWrite(name);
      if (v === "move") await afterWrite(body.to);
    } catch (e) {
      btn.disabled = false;
      running = false;
      err.textContent = e.code === "bulk_op_running" ? "Another bulk action of this account is running: try again in a moment." : errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => go(ok) }, "Continue");
  const ui = sheet("Bulk action", h("div", { class: "nw-form" },
    h("p", { class: "nw-scope" }, `${plural(ids.length, "selected record", "selected records")} in ${name}.`),
    field("Action", act), fCat, fTags, fFrom, fTo, fTo2, prog, err),
  (leave) => [h("span", { class: "spacer" }), h("button", { onclick: () => { if (running) stop = true; else leave(); } }, "Cancel"), ok]);
  show();
}

// =====================================================================================================================
// Data stores
// =====================================================================================================================
async function storesPage() {
  setTitle("Data stores");
  R = null;
  const info = h("span", { class: "nw-info" });
  const box = h("div", { class: "table-wrap" });
  page.replaceChildren(h("h2", {}, "Data stores"),
    h("div", { class: "nw-top" }, cfg.write ? h("button", { class: "primary", onclick: () => newStoreDialog() }, "+ New data store") : null,
      cfg.write ? h("button", { onclick: () => importDialog() }, "Import Excel / CSV") : null, info), box);
  await loadStores();
  if (location.hash !== "#/stores") return;           // another page meanwhile
  info.textContent = plural(stores.length, "data store", "data stores");
  if (!stores.length) { box.replaceChildren(h("p", { class: "muted" }, "No data")); return; }
  const open = (c) => { pickStore(c.name); go("records"); };
  box.replaceChildren(h("table", { class: "t" },
    h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Description"), h("th", {}, "Kind"), h("th", { class: "num" }, "Records"),
      h("th", {}, "Changed"), cfg.write ? h("th", {}) : null)),
    h("tbody", {}, stores.map((c) => h("tr", { class: "click", ...onOpen(() => open(c)) },
      h("td", {}, h("b", {}, c.name)), h("td", { class: "muted" }, c.title || ""),
      h("td", {}, isTable(c.name) ? `Table · ${plural(tables.get(c.name).columns.length, "column", "columns")}` : "Text"),
      h("td", { class: "num" }, num(c.items)), h("td", { class: "muted" }, ago(c.updated_at)),
      cfg.write ? h("td", { class: "nw-acts" },
        cfg.admin || !isTable(c.name) ? h("button", { class: "small", title: "Store setup", onclick: (ev) => { ev.stopPropagation(); setupDialog(c.name); } }, "⚙") : null,
        h("button", { class: "small danger", onclick: (ev) => { ev.stopPropagation(); deleteStoreDialog(c); } }, "Delete")) : null)))));
}

function newStoreDialog() {
  const name = h("input", { type: "text", maxLength: 64, autocomplete: "off", placeholder: "e.g. handbook" });
  const title = h("input", { type: "text", maxLength: 200, autocomplete: "off", placeholder: "What it holds (optional)" });
  const err = h("div", { class: "nw-err" });
  const save = async (btn) => {
    const n = name.value.trim();
    if (!NAME_RE.test(n)) { err.textContent = "Lowercase letters, digits, _ . -, starting with a letter (up to 64)."; return; }
    btn.disabled = true;
    try {
      await api("POST", "/v1/neperi/collections", { name: n, ...(title.value.trim() ? { title: title.value.trim() } : {}) });
      ui.close();
      toast(`Data store ${n} made`, "ok");
      await loadStores();
      await pickStore(n);
      go2records();
    } catch (e) {
      btn.disabled = false;
      err.textContent = errText(e);
    }
  };
  const ok = h("button", { class: "primary", onclick: () => save(ok) }, "Create");
  const ui = sheet("New data store", h("div", { class: "nw-form" }, field("Name", name), field("Description", title), err),
  (leave) => [h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), ok], { dirty: () => !!(name.value || title.value) });
  name.focus();
}

function deleteStoreDialog(c) {
  const typed = h("input", { type: "text", autocomplete: "off", placeholder: c.name });
  const err = h("div", { class: "nw-err" });
  const del = h("button", { class: "danger", disabled: true, onclick: async () => {
    del.disabled = true;
    try {
      await api("DELETE", `/v1/neperi/collections/${enc(c.name)}`);
      ui.close();
      toast(`Data store ${c.name} deleted`, "ok");
      await loadStores();
      if (s.collection === c.name) s.collection = null;
      storesPage();
    } catch (e) {
      del.disabled = false;
      err.textContent = errText(e);
    }
  } }, "Delete");
  typed.addEventListener("input", () => { del.disabled = typed.value.trim() !== c.name; });
  const ui = sheet(`Delete ${c.name}?`, h("div", { class: "nw-form" },
    h("p", {}, `The data store and its ${plural(c.items, "record", "records")} are deleted. This cannot be undone. Type its name to go on:`),
    typed, err), (leave) => [h("span", { class: "spacer" }), h("button", { onclick: leave }, "Cancel"), del]);
  typed.focus();
}

// =====================================================================================================================
// start: what this page may do, the stores, the view the address asks for
// =====================================================================================================================
async function start() {
  applyTheme();
  try {
    cfg = await api("GET", "/config");
  } catch (e) {
    page.replaceChildren(h("p", { class: "nw-err" }, errText(e)));
    return;
  }
  $("#mode").replaceChildren(h("span", { class: "badge", title: cfg.write ? "NEPERI_WRITE=1: this page writes with the server's key" : "This page searches only (see server.mjs: NEPERI_WRITE)" },
    cfg.write ? (cfg.admin ? "Admin key" : "Write key") : "Search only"));
  await loadStores();
  const p = new URLSearchParams(location.search);
  s.query = p.get("q") || "";
  s.collection = [p.get("store"), recall(STORE_KEY)].find((n) => n && storeOf(n)) || stores[0]?.name || null;
  if (s.collection) {
    remember(STORE_KEY, s.collection);
    if (!isTable(s.collection)) s.category = p.get("category") || null;
    s.tags = p.getAll("tag");
    loadStoreFilters(s.collection);
  }
  if (!location.hash) history.replaceState(null, "", `${location.pathname}${location.search}#/records`);
  route();
}
start();
