// Neperi Search sample client: a search box over a data store with the filters the Neperi console has -- its categories
// (with how many records each), the filter fields of the category picked (a list of values with their counts, a number or
// a date from - to, yes / no) and the tags (a click on a result's tag filters by it) -- each result with its matches marked
// as the console marks them: an exact keyword, a similar word, a letter match; «R» when the ranking step put it above a
// closer match. It asks this sample's server (/api/...), which holds the API key. DOM nodes only (no innerHTML): the
// texts come from your data.

const $ = (sel) => document.querySelector(sel);
const form = $("#search"), input = $("#query"), store = $("#store");
const filtersEl = $("#filters"), chipsEl = $("#chips"), info = $("#info"), list = $("#results");

// what is searched: the store, the category, the tags picked on the results, the filter fields {key: condition}
const state = { collection: null, category: null, tags: [], fields: {}, top: 10 };
let facets = { categories: [], fields: [], tags: [] };   // the store's categories; the category's fields and tags
let tagCount = new Map();                               // tag -> how many records carry it (in the category picked)

// an element: attributes (on* are listeners, class, the rest properties or attributes) and children
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "class") node.className = v;
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.flat().filter((x) => x != null && x !== false));
  return node;
}
const num = (n) => Number(n).toLocaleString();
const count = (n) => (n > 10000 ? `${num(10000)}+` : num(n || 0));   // as the console counts: 10,000+ past it

// a word as the API's `fuzzy` names it: lowercase, accents and other marks off, a few letters Unicode keeps whole folded
const fold = (s) => (s || "").normalize("NFKC").toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/ı/g, "i").replace(/ł/g, "l");

// text with each [start, end) range in a <mark>. The API counts in UTF-16 code units -- what JavaScript strings count -- so
// text.slice(start, end) is the matched word. Its kind: a letter match (letter_match: true), a similar word (in `fuzzy`:
// the word as found -> the word typed), else the keyword itself.
function marked(text, ranges, fuzzy, letters) {
  const out = document.createDocumentFragment();
  let at = 0;
  for (const [s, e] of ranges || []) {
    if (e <= at || s >= text.length) continue;
    const a = Math.max(s, at), b = Math.min(e, text.length);
    if (a > at) out.append(text.slice(at, a));
    const word = text.slice(a, b);
    const typed = letters ? null : fuzzy?.[fold(word)];
    out.append(h("mark", { class: letters ? "letters" : typed ? "similar" : "exact", title: typed ? `≈ ${typed}` : null }, word));
    at = b;
  }
  if (at < text.length) out.append(text.slice(at));
  return out;
}

// -- the filters ---------------------------------------------------------------------------------------------------------
// the store's categories and filter fields, of the category picked: only the fields its records carry, their values and
// counts; a category picked drops a filter on a field it lacks, a value of a list it lacks and a tag it lacks
async function pickCategory(cat) {
  state.category = cat || null;
  try {
    const p = new URLSearchParams({ collection: state.collection, ...(state.category ? { category: state.category } : {}) });
    const r = await fetch(`/api/facets?${p}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Error ${r.status}`);
    facets = data;
  } catch (e) {
    info.textContent = String(e.message || e);
    return;
  }
  const byKey = new Map(facets.fields.map((f) => [f.key, f]));
  for (const [k, v] of Object.entries(state.fields)) {
    const f = byKey.get(k);
    if (!f) { delete state.fields[k]; continue; }
    if (f.type === "list") {
      const have = new Set((f.values || []).map((x) => x.value));
      const kept = v.filter((x) => have.has(x));
      if (kept.length) state.fields[k] = kept;
      else delete state.fields[k];
    }
  }
  tagCount = new Map(facets.tags.map((x) => [x.tag, x.count]));
  if (state.category) state.tags = state.tags.filter((g) => tagCount.has(g));
  drawFilters();
  drawChips();
  run();
}

const cell = (label, ...controls) => h("div", { class: "cell" }, h("span", { title: label }, label), ...controls);
const changed = () => { state.top = 10; drawChips(); run(); };

function drawFilters() {
  const cells = [];
  if (facets.categories.length) {
    const sel = h("select", { onchange: () => pickCategory(sel.value) }, h("option", { value: "" }, "All"),
      facets.categories.map((c) => h("option", { value: c.value }, `${c.value} (${count(c.count)})`)));
    sel.value = state.category || "";
    sel.classList.toggle("on", !!state.category);
    cells.push(cell("Category", sel));
  }
  for (const f of facets.fields) cells.push(fieldCell(f));
  filtersEl.replaceChildren(...cells);
}

// one filter field: yes / no a list of three, a number or a date two boxes (from, to), a list of values a box that opens
// with a check box each (any of them ticked) and how many records have it
function fieldCell(f) {
  const set = (v) => {
    if (v == null) delete state.fields[f.key];
    else state.fields[f.key] = v;
    changed();
  };
  const cur = state.fields[f.key];
  if (f.type === "bool") {
    const sel = h("select", { onchange: () => set(sel.value === "" ? null : sel.value === "true") },
      h("option", { value: "" }, "All"), h("option", { value: "true" }, "Yes"), h("option", { value: "false" }, "No"));
    sel.value = cur === true ? "true" : cur === false ? "false" : "";
    sel.classList.toggle("on", cur != null);
    return cell(f.label, sel);
  }
  if (f.type === "number" || f.type === "date") {
    const box = (end) => {
      const isDate = f.type === "date";
      const inp = h("input", isDate ? { type: "date", value: cur?.[end] || "", min: f.min || null, max: f.max || null }
        : { type: "text", inputMode: "decimal", value: cur?.[end] ?? "",
          placeholder: end === "from" ? (f.min != null ? `from ${num(f.min)}` : "from") : (f.max != null ? `to ${num(f.max)}` : "to") });
      if (cur?.[end] != null) inp.classList.add("on");
      inp.addEventListener("change", () => {
        const raw = inp.value.trim();
        const v = !raw ? null : isDate ? raw : Number(raw.replace(/[\s,]/g, ""));
        if (v !== null && !isDate && Number.isNaN(v)) { inp.value = cur?.[end] ?? ""; return; }   // not a number
        const next = { ...(state.fields[f.key] || {}), [end]: v };
        if (next[end] == null) delete next[end];
        set(next.from == null && next.to == null ? null : next);
      });
      return inp;
    };
    const c = cell(f.label, box("from"), h("span", {}, "–"), box("to"));
    c.classList.add("range");
    return c;
  }
  const values = f.values || [];
  const picked = () => state.fields[f.key] || [];
  const summary = h("summary");
  const det = h("details", {}, summary);
  const relabel = () => {
    summary.textContent = picked().length ? picked().join(", ") : "All";
    summary.title = summary.textContent;
    det.classList.toggle("on", picked().length > 0);
  };
  const boxes = values.map((v) => h("label", {},
    h("input", { type: "checkbox", checked: picked().includes(v.value), onchange: (ev) => {
      const next = new Set(picked());
      if (ev.target.checked) next.add(v.value);
      else next.delete(v.value);
      if (next.size) state.fields[f.key] = [...next];
      else delete state.fields[f.key];
      relabel();
      changed();
    } }),
    h("span", {}, v.value), h("span", { class: "n" }, count(v.count))));
  det.append(h("div", { class: "pop" }, boxes.length ? boxes : h("span", { class: "n" }, "No values"),
    h("button", { type: "button", onclick: () => { delete state.fields[f.key]; for (const b of det.querySelectorAll("input")) b.checked = false; relabel(); changed(); } },
      "Clear")));
  relabel();
  return cell(f.label, det);
}
// a list's box closes on a click elsewhere
document.addEventListener("click", (ev) => {
  for (const d of document.querySelectorAll("details[open]")) if (!d.contains(ev.target)) d.open = false;
});

const fieldText = (f, v) => {
  if (f.type === "bool") return v ? "Yes" : "No";
  if (f.type === "list") return v.join(", ");
  const show = (x) => (f.type === "date" ? x : num(x));
  return v.from != null && v.to != null ? `${show(v.from)} – ${show(v.to)}` : v.from != null ? `≥ ${show(v.from)}` : `≤ ${show(v.to)}`;
};

// the conditions in use: the tags picked (each with how many records carry it) and the fields set, each with its x
function drawChips() {
  const chip = (label, off) => h("span", { class: "chip", title: label }, label, h("button", { type: "button", title: "Remove", onclick: off }, "×"));
  const out = [];
  for (const g of state.tags) {
    out.push(chip(`Tag: ${g}${tagCount.has(g) ? ` (${count(tagCount.get(g))})` : ""}`, () => {
      state.tags = state.tags.filter((x) => x !== g);
      changed();
    }));
  }
  for (const f of facets.fields) {
    const v = state.fields[f.key];
    if (v != null) out.push(chip(`${f.label}: ${fieldText(f, v)}`, () => { delete state.fields[f.key]; drawFilters(); changed(); }));
  }
  if (out.length > 1) {
    out.push(h("button", { type: "button", onclick: () => { state.tags = []; state.fields = {}; drawFilters(); changed(); } }, "Clear all"));
  }
  chipsEl.replaceChildren(...out);
}

// -- the results ---------------------------------------------------------------------------------------------------------
// a result's tag: coloured as the words are when the search matched it; a click filters by it (again: off)
function tagChip(r, g) {
  const hit = (r.tag_matches || []).includes(g), typed = hit ? r.fuzzy?.[fold(g)] : null, on = state.tags.includes(g);
  const n = tagCount.get(g);
  const tip = on ? "Click to stop filtering by this tag"
    : `${n != null ? `${count(n)} record${n === 1 ? " has" : "s have"} this tag · ` : ""}click to filter`;
  return h("button", { type: "button", class: `tag${hit ? (typed ? " similar" : " exact") : ""}${on ? " on" : ""}`,
    title: typed ? `≈ ${typed} · ${tip}` : tip, onclick: () => {
      state.tags = on ? state.tags.filter((x) => x !== g) : [...state.tags, g];
      changed();
    } }, g);
}

function render(data) {
  const results = data.results || [];
  info.textContent = `${results.length} result${results.length === 1 ? "" : "s"}` + (data.took_ms != null ? ` · ${data.took_ms} ms` : "");
  list.replaceChildren(...results.map((r) => {
    const title = r.title ? marked(r.title, r.title_highlights, r.fuzzy, r.letter_match) : (r.id || "");
    // the snippet (about 240 characters around the best match) with its own ranges: the whole text is not needed
    const snippet = r.snippet ? marked(r.snippet, r.snippet_highlights, r.fuzzy, r.letter_match) : null;
    const score = Number(r.match_score ?? r.score);
    return h("li", { class: "result" },
      h("div", { class: "head" }, h("div", { class: "title" }, title), r.category ? h("span", { class: "where" }, r.category) : null),
      snippet && h("p", { class: "snippet" }, snippet),
      (r.tags || []).length ? h("div", { class: "tags" }, r.tags.map((g) => tagChip(r, g))) : null,
      h("div", { class: "meta" },
        h("span", { title: "The record's own match score: lower is closer" }, `score ${score.toFixed(3)}`),
        r.reranked ? h("span", { class: "r", title: "Reranked: the ranking step put this record above one that matched more closely" }, "R") : null,
        r.letter_match ? h("span", {}, "letter match") : null));
  }));
  if (results.length >= state.top && state.top < 20) {
    list.append(h("li", {}, h("button", { type: "button", onclick: () => { state.top = 20; run(); } }, "More results")));
  }
}

// the address carries the search -- the store, the words, the category, the tags -- so it can be shared or bookmarked
function syncUrl() {
  const p = new URLSearchParams();
  if (store.options.length > 1) p.set("store", state.collection);
  if (input.value.trim()) p.set("q", input.value.trim());
  if (state.category) p.set("category", state.category);
  for (const g of state.tags) p.append("tag", g);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
}

let seq = 0, timer = null;
async function run() {
  const query = input.value.trim(), my = ++seq;
  syncUrl();
  if (!query) {
    list.replaceChildren();
    info.textContent = "Type a few words to search.";
    return;
  }
  const body = { collection: state.collection, query, top_k: state.top, ...(state.category ? { category: state.category } : {}),
    ...(state.tags.length ? { tags: state.tags } : {}), ...(Object.keys(state.fields).length ? { fields: state.fields } : {}) };
  try {
    const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (my !== seq) return;                       // a newer search is on its way
    if (!r.ok) { info.textContent = data?.error?.message || `Error ${r.status}`; list.replaceChildren(); return; }
    render(data);
  } catch (e) {
    if (my === seq) info.textContent = String(e.message || e);
  }
}

input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.top = 10; run(); }, 200); });
form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
// a click into the box selects its words (typing starts another search); a click while the caret is in it places it
let hadFocus = false;
input.addEventListener("pointerdown", () => { hadFocus = document.activeElement === input; });
input.addEventListener("click", () => { if (!hadFocus && input.selectionStart === input.selectionEnd) input.select(); });
store.addEventListener("change", () => {
  Object.assign(state, { collection: store.value, tags: [], fields: {}, top: 10 });
  pickCategory(null);
});

// the stores this page may search (the server's NEPERI_COLLECTIONS); the address may carry a search to open
fetch("/api/config").then((r) => r.json()).then((cfg) => {
  const names = cfg.collections || [];
  store.replaceChildren(...names.map((name) => h("option", { value: name }, name)));
  store.hidden = names.length < 2;
  const p = new URLSearchParams(location.search);
  state.collection = names.includes(p.get("store")) ? p.get("store") : names[0];
  store.value = state.collection;
  input.value = p.get("q") || "";
  state.tags = p.getAll("tag");
  pickCategory(p.get("category") || null);
  input.focus();
});
