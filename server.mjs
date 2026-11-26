// Neperi Search sample client -- the small server. It serves the page (public/) and forwards the page's calls to the
// Neperi API with your API key, which stays here: the browser never sees it. Node.js 18 or later, no packages to install.
//
//   NEPERI_API_KEY=...  node server.mjs                     a search page over the sample data, at http://localhost:8080
//   NEPERI_API_KEY=...  NEPERI_WRITE=1  node server.mjs     the same page as a small console: data stores, records,
//                                                           Excel / CSV imports, categories and filter fields
// Settings (environment variables):
//   NEPERI_API_KEY      required: a key from the console, Account -> My keys (read access is enough to search; writing
//                       needs write access, declaring filter fields an admin key)
//   NEPERI_WRITE        1: the page also writes (makes data stores, records, imports, categories, filter fields, bulk
//                       actions). Off (default): a search page only -- what a public site wants
//   NEPERI_COLLECTIONS  the data stores the page may use, comma separated, or * for every store of the account
//                       (default: * with NEPERI_WRITE=1, else the sample stores of a new account)
//   NEPERI_URL          the API's address (default https://app.neperi.com)
//   PORT                the port of this server (default 8080)
//   HOST                the address it listens on (default: 127.0.0.1 -- this machine only -- with NEPERI_WRITE=1, else all)
//   FACETS_TTL          seconds the server keeps a store's categories, filter fields and tags before it asks again
//                       (default 60; a write through this page asks again at once). Reads count tokens and requests
//                       a minute, as searches do
//
// The page calls /api/<the API's own path> -- /api/v1/neperi/collections/handbook/search -> {NEPERI_URL}/v1/neperi/...
// -- and only the calls of ROUTES below go through: in the stores the page may use, writing only with NEPERI_WRITE=1.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.NEPERI_URL || "https://app.neperi.com").replace(/\/+$/, "");
const KEY = process.env.NEPERI_API_KEY || "";
const WRITE = /^(1|yes|true|on)$/i.test(process.env.NEPERI_WRITE || "");
const STORES = (process.env.NEPERI_COLLECTIONS || (WRITE ? "*" : "demo_support,demo_products,demo_code"))
  .split(",").map((s) => s.trim()).filter(Boolean);
const ANY = STORES.includes("*");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || (WRITE ? "127.0.0.1" : "");
const FACETS_TTL = 1000 * Number(process.env.FACETS_TTL ?? 60);
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml" };
// a search page (no NEPERI_WRITE): a short query, a page of results, no whole texts -- what a visitor may spend of your plan
const PUBLIC = { query: 200, results: 50, list: 50 };
const JSON_LIMIT = 512 * 1024;           // a record of 20,000 characters and its fields, a few of them at once
const FILE_LIMIT = 11 * 1024 * 1024;     // an Excel / CSV file: the API takes 10 MB, the form around it a little more

if (!KEY) {
  console.error("Set NEPERI_API_KEY: a key from the Neperi console, Account -> My keys.");
  process.exit(1);
}

const api = (path, init = {}) => fetch(`${API}${path}`, {
  ...init, headers: { Authorization: `Bearer ${KEY}`, ...(init.body && !init.headers ? { "Content-Type": "application/json" } : {}),
    ...(init.headers || {}) } });

// what the key may do (GET /v1/whoami: its scopes) -- the page writes only when NEPERI_WRITE=1 AND the key may write
const can = { write: false, admin: false };
async function whoami() {
  let r;
  try {
    r = await api("/v1/whoami");
  } catch (e) {
    console.error(`Cannot reach ${API}: ${e.message}. The page will search once it can.`);
    return;
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 403) {
    console.error(`The key was refused: ${d?.error?.message || r.status}. Make a key in the console: Account -> My keys.`);
    process.exit(1);
  }
  const scopes = new Set(d.scopes || []);
  can.write = WRITE && (scopes.has("write") || scopes.has("admin"));
  can.admin = WRITE && scopes.has("admin");
  if (WRITE && !can.write) console.warn("NEPERI_WRITE=1, but the key reads only: the page searches only.");
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const refuse = (res, status, code, message, hint) => send(res, status, { error: { code, message, ...(hint ? { hint } : {}) } });

// the request's body, up to `limit` bytes
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("too large"), { tooLarge: true })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// -- what goes through ----------------------------------------------------------------------------------------------
// [method, path, what the key must be allowed, options]: `store` -- the first part of the path in () is a data store's
// name, which must be one this page may use; `query` -- a store named in the query string (?collection=), the same;
// `names(body)` -- stores named in the body. need: read (always), write (NEPERI_WRITE=1 and a key that writes), admin
// (NEPERI_WRITE=1 and an admin key: filter fields are the account's)
const S = "([^/]+)";
const at = (p) => new RegExp(`^/v1/neperi${p}$`);
const ROUTES = [
  ["GET", at("/collections"), "read", { list: true }],
  ["POST", at("/collections"), "write", { names: (b) => [b.name] }],
  ["DELETE", at(`/collections/${S}`), "write", { store: true }],
  ["GET", at(`/collections/${S}/items`), "read", { store: true, items: true }],
  ["PUT", at(`/collections/${S}/items`), "write", { store: true }],
  ["POST", at(`/collections/${S}/items/get`), "read", { store: true, get: true }],
  ["POST", at(`/collections/${S}/items/delete`), "write", { store: true }],
  ["POST", at(`/collections/${S}/items/move`), "write", { store: true, names: (b) => [b.to] }],
  ["GET", at(`/collections/${S}/items/(.+)`), "read", { store: true }],
  ["PATCH", at(`/collections/${S}/items/(.+)`), "write", { store: true }],
  ["POST", at(`/collections/${S}/search`), "read", { store: true, search: true }],
  ["POST", at(`/collections/${S}/import`), "write", { store: true, file: true }],
  ["GET", at(`/collections/${S}/tags`), "read", { store: true, cache: true }],
  ["PUT", at(`/collections/${S}/categories`), "write", { store: true }],
  ["GET", at(`/collections/${S}/fields/suggest`), "admin", { store: true }],
  ["GET", at("/categories"), "read", { query: true, cache: true }],
  // the fields of one store; without ?collection= the account's fields, which only the setup of filter fields reads
  ["GET", at("/fields"), "read", { query: true, cache: true, bare: "admin" }],
  ["PUT", at("/fields/([A-Za-z][A-Za-z0-9_]{0,39})"), "admin", {}],
  ["DELETE", at("/fields/([A-Za-z][A-Za-z0-9_]{0,39})"), "admin", {}],
  ["POST", at("/categories/rename"), "write", { names: (b) => [b.collection], named: true }],
  ["POST", at("/categories/delete"), "write", { names: (b) => [b.collection], named: true }],
  ["POST", at("/items/bulk"), "write", { names: (b) => [b.where?.collection, b.to], named: true }],
  ["POST", at("/ops/([A-Za-z0-9_-]+)/stop"), "write", {}],
];
const allowed = (name) => ANY || STORES.includes(name);
const mayDo = (need) => need === "read" || (need === "write" && can.write) || (need === "admin" && can.admin);
const NOT_HERE = `This page may use ${ANY ? "the account's data stores" : STORES.join(", ")}.`;

// the categories, filter fields and tags read are kept a while (reads count tokens and requests, as searches do); what
// this page writes clears them
const kept = new Map();

async function forward(req, res, url) {
  const path = url.pathname.slice(4);                 // "/api/v1/..." -> "/v1/..."
  const route = ROUTES.find(([m, re]) => m === req.method && re.test(path));
  if (!route) return refuse(res, 404, "not_offered", "This page does not offer that call.");
  const [, re, need, o] = route;
  if (!mayDo(need) || (o.bare && !url.searchParams.get("collection") && !mayDo(o.bare))) {
    return refuse(res, 403, "not_allowed", need === "admin" || o.bare ? "Filter fields are declared with an admin key."
      : "This page searches only.", "Start the server with NEPERI_WRITE=1 and a key that writes.");
  }
  const m = path.match(re);
  if (o.store && !allowed(decodeURIComponent(m[1]))) return refuse(res, 403, "collection_not_allowed", NOT_HERE);
  if (o.query) {
    const c = url.searchParams.get("collection");
    if (c ? !allowed(c) : !ANY && !o.bare) return refuse(res, 403, "collection_not_allowed", NOT_HERE, "Name the store: ?collection=");
  }
  // the body: JSON (checked), or a file as it came (an import)
  let body;
  if (req.method !== "GET" && req.method !== "DELETE") {
    let raw;
    try {
      raw = await readBody(req, o.file ? FILE_LIMIT : JSON_LIMIT);
    } catch (e) {
      return refuse(res, 413, "too_large", e.tooLarge ? (o.file ? "A file of up to 10 MB." : "The request is too large.") : String(e));
    }
    if (o.file) {
      body = raw;
    } else {
      let b;
      try {
        b = JSON.parse(raw.toString("utf8") || "{}");
      } catch {
        return refuse(res, 400, "bad_request", "The body must be JSON.");
      }
      if (o.names) {
        const names = o.names(b).filter((n) => n != null);
        if ((o.named && !b.collection && !b.where?.collection) || names.some((n) => !allowed(String(n)))) {
          return refuse(res, 403, "collection_not_allowed", NOT_HERE, "Name a data store this page may use.");
        }
      }
      if (o.search && !can.write) {          // a visitor: a short query, a page of results, the search's own fields only
        const { query, top_k, category, tags, fields, columns, created_from, created_to, updated_from, updated_to } = b;
        b = { query: String(query || "").slice(0, PUBLIC.query), top_k: Math.max(1, Math.min(PUBLIC.results, Number(top_k) || 10)),
          category, tags, fields, columns, created_from, created_to, updated_from, updated_to };
      }
      if (o.get && !can.write && Array.isArray(b.ids)) b.ids = b.ids.slice(0, PUBLIC.list);
      body = JSON.stringify(b);
    }
  }
  if (o.items && !can.write) {
    const n = Number(url.searchParams.get("limit") || 50);
    url.searchParams.set("limit", String(Math.max(1, Math.min(PUBLIC.list, n || 50))));
  }
  const target = `${path}${url.search}`;
  if (req.method === "GET" && o.cache && FACETS_TTL > 0) {
    const k = kept.get(target);
    if (k && Date.now() - k.at < FACETS_TTL) return send(res, 200, k.body);
  }
  if (req.method !== "GET") kept.clear();             // what the page reads next is what it just changed
  const r = await api(target, { method: req.method, ...(body != null ? { body } : {}),
    ...(o.file ? { headers: { "Content-Type": req.headers["content-type"] || "application/octet-stream" } } : {}) });
  let text = await r.text();
  if (o.list && r.ok && !ANY) {                     // the stores: only those this page may use
    const d = JSON.parse(text);
    d.items = (d.items || []).filter((c) => allowed(c.name));
    d.total = d.items.length;
    text = JSON.stringify(d);
  }
  if (req.method === "GET" && o.cache && r.ok && FACETS_TTL > 0) kept.set(target, { at: Date.now(), body: text });
  send(res, r.status, text, r.headers.get("content-type") || "application/json; charset=utf-8");
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/config" && req.method === "GET") {
      return send(res, 200, { write: can.write, admin: can.admin, stores: ANY ? "*" : STORES });
    }
    if (url.pathname.startsWith("/api/v1/")) return await forward(req, res, url);
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
}).listen(PORT, ...(HOST ? [HOST] : []), async () => {
  await whoami();
  const where = `http://${HOST && HOST !== "0.0.0.0" ? HOST : "localhost"}:${PORT}`;
  console.log(`Neperi Search sample: ${where}  (${can.write ? "writing" : "search only"}; stores: ${ANY ? "all" : STORES.join(", ")})`);
});
