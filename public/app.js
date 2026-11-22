// Neperi Search sample client: a search box over one data store, each result with its matches marked as the Neperi console
// marks them -- an exact keyword, a similar word the search chose, a letter match. It asks this sample's server (/api/search),
// which holds the API key. Built with DOM nodes only (no innerHTML): the texts come from your data.

const $ = (sel) => document.querySelector(sel);
const form = $("#search"), input = $("#query"), store = $("#store"), info = $("#info"), list = $("#results");

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
    const mark = document.createElement("mark");
    mark.className = letters ? "letters" : typed ? "similar" : "exact";
    if (typed) mark.title = `≈ ${typed}`;
    mark.textContent = word;
    out.append(mark);
    at = b;
  }
  if (at < text.length) out.append(text.slice(at));
  return out;
}

function el(tag, cls, ...kids) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.append(...kids.filter((k) => k != null));
  return node;
}

function render(data) {
  const results = data.results || [];
  info.textContent = input.value.trim() ? `${results.length} result${results.length === 1 ? "" : "s"}` +
    (data.took_ms != null ? ` · ${data.took_ms} ms` : "") : "";
  list.replaceChildren(...results.map((r) => {
    const title = r.title ? marked(r.title, r.title_highlights, r.fuzzy, r.letter_match) : (r.id || "");
    // the snippet (about 240 characters around the best match) with its own ranges: the whole text is not needed
    const snippet = r.snippet ? marked(r.snippet, r.snippet_highlights, r.fuzzy, r.letter_match) : null;
    const meta = [r.category, `score ${Number(r.score).toFixed(3)}`, r.letter_match ? "letter match" : null].filter(Boolean).join(" · ");
    return el("li", "result", el("div", "title", title), snippet && el("p", "snippet", snippet), el("div", "meta", meta));
  }));
}

let seq = 0, timer = null;
async function run() {
  const query = input.value.trim(), my = ++seq;
  if (!query) { render({ results: [] }); return; }
  try {
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection: store.value, query, top_k: 10 }),
    });
    const data = await r.json();
    if (my !== seq) return;                       // a newer query is on its way
    if (!r.ok) { info.textContent = data?.error?.message || `Error ${r.status}`; list.replaceChildren(); return; }
    render(data);
  } catch (e) {
    if (my === seq) info.textContent = String(e.message || e);
  }
}

input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 200); });
form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
store.addEventListener("change", run);

// the stores this page may search (the server's NEPERI_COLLECTIONS)
fetch("/api/config").then((r) => r.json()).then((cfg) => {
  store.replaceChildren(...(cfg.collections || []).map((name) => el("option", null, name)));
  input.focus();
});
