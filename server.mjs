// Neperi Search sample client -- the small server. It serves the page (public/) and forwards to the Neperi API with your
// API key, which stays here: the browser never sees it. Node.js 18 or later, no packages to install.
//
//   NEPERI_API_KEY=...  node server.mjs        then open http://localhost:8080
//
// Settings (environment variables):
//   NEPERI_API_KEY      required: a key from the console, Account -> My keys (read access is enough)
//   NEPERI_COLLECTIONS  the data stores the page may search, comma separated (default: the sample data of a new account)
//   NEPERI_URL          the API's address (default https://app.neperi.com)
//   PORT                the port of this server (default 8080)
//   FACETS_TTL          seconds the categories / filter fields / tags of a store are kept before asked again (default 60)
//
// What the page may ask (nothing else goes through with the key):
//   GET  /api/config                          the stores it may search
//   GET  /api/facets?collection=&category=    a store's categories, its filter fields and its tags, with their counts
//   POST /api/search                          {collection, query, category?, tags?, fields?, top_k?}
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.NEPERI_URL || "https://app.neperi.com").replace(/\/+$/, "");
const KEY = process.env.NEPERI_API_KEY || "";
const COLLECTIONS = (process.env.NEPERI_COLLECTIONS || "demo_support,demo_products")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8080);
const FACETS_TTL = 1000 * Number(process.env.FACETS_TTL || 60);
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml" };
const MAX_QUERY = 200;     // characters of a query the page may send
const MAX_RESULTS = 20;
const MAX_TAGS = 12;

if (!KEY) {
  console.error("Set NEPERI_API_KEY: a key from the Neperi console, Account -> My keys (read access is enough).");
  process.exit(1);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const refuse = (res, status, code, message) => send(res, status, { error: { code, message } });

// the request's JSON body, up to a few kilobytes (a search with its filters needs no more)
function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const api = (path, init = {}) => fetch(`${API}${path}`, {
  ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const q = encodeURIComponent;

// GET /api/facets: the store's categories (with how many records each), its filter fields and its tags -- of a category
// when one is named: only the fields its records carry, the values, counts and ranges of those records, its tags. Three
// reads, kept FACETS_TTL (reads count tokens, as searches do)
const facetsKept = new Map();
async function facets(res, url) {
  const collection = url.searchParams.get("collection") || COLLECTIONS[0] || "";
  if (!COLLECTIONS.includes(collection)) return refuse(res, 403, "collection_not_allowed", `This page may search ${COLLECTIONS.join(", ")}.`);
  const category = (url.searchParams.get("category") || "").slice(0, 100);
  const key = `${collection}\u0000${category}`, kept = facetsKept.get(key);
  if (kept && Date.now() - kept.at < FACETS_TTL) return send(res, 200, kept.body);
  const cat = category ? `&category=${q(category)}` : "";
  const [cats, fields, tags] = await Promise.all([
    api(`/v1/neperi/categories?collection=${q(collection)}`),
    api(`/v1/neperi/fields?values=1&collection=${q(collection)}${cat}`),
    api(`/v1/neperi/collections/${q(collection)}/tags?limit=300${cat}`)]);
  for (const r of [cats, fields, tags]) if (!r.ok) return send(res, r.status, await r.text());
  const [c, f, t] = await Promise.all([cats.json(), fields.json(), tags.json()]);
  const body = {
    collection, category: category || null,
    categories: (c.categories || []).map((x) => ({ value: x.value, count: x.count })),
    fields: (f.fields || []).map(({ key: k, label, type, values, min, max }) => ({ key: k, label, type, values, min, max })),
    tags: (t.tags || []).map((x) => ({ tag: x.tag, count: x.count })),
  };
  facetsKept.set(key, { at: Date.now(), body });
  send(res, 200, body);
}

// POST /api/search: only the stores of NEPERI_COLLECTIONS, a short query, a few results, the filters a search takes --
// the page cannot use the key for anything else
async function search(req, res) {
  let b;
  try {
    b = await readJson(req);
  } catch {
    return refuse(res, 400, "bad_request", "The body must be JSON.");
  }
  const collection = String(b.collection || COLLECTIONS[0] || "");
  if (!COLLECTIONS.includes(collection)) return refuse(res, 403, "collection_not_allowed", `This page may search ${COLLECTIONS.join(", ")}.`);
  const query = String(b.query || "").trim().slice(0, MAX_QUERY);
  if (!query) return send(res, 200, { results: [] });
  const body = { query, top_k: Math.max(1, Math.min(MAX_RESULTS, Number(b.top_k) || 10)) };
  if (typeof b.category === "string" && b.category.trim()) body.category = b.category.trim().slice(0, 100);
  if (Array.isArray(b.tags)) {
    const tags = b.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 64)).slice(0, MAX_TAGS);
    if (tags.length) body.tags = tags;
  }
  if (b.fields && typeof b.fields === "object" && !Array.isArray(b.fields) && Object.keys(b.fields).length) body.fields = b.fields;
  const r = await api(`/v1/neperi/collections/${q(collection)}/search`, { method: "POST", body: JSON.stringify(body) });
  send(res, r.status, await r.text());
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/search") return await search(req, res);
    if (req.method === "GET" && url.pathname === "/api/facets") return await facets(res, url);
    if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { collections: COLLECTIONS });
    if (req.method !== "GET") return refuse(res, 405, "method_not_allowed", "Not allowed.");
    const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return send(res, 404, "Not found", "text/plain");
    const file = await readFile(path).catch(() => null);
    if (!file) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch (e) {
    refuse(res, 502, "upstream", String(e?.message || e));
  }
}).listen(PORT, () => console.log(`Neperi Search sample: http://localhost:${PORT}  (stores: ${COLLECTIONS.join(", ")})`));
