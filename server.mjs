// Neperi Search sample client -- the small server. It serves the page (public/) and forwards each search to the Neperi API
// with your API key, which stays here: the browser never sees it. Node.js 18 or later, no packages to install.
//
//   NEPERI_API_KEY=...  node server.mjs        then open http://localhost:8080
//
// Settings (environment variables):
//   NEPERI_API_KEY      required: a key from the console, Account -> My keys (read access is enough)
//   NEPERI_COLLECTIONS  the data stores the page may search, comma separated (default: the sample data of a new account)
//   NEPERI_URL          the API's address (default https://app.neperi.com)
//   PORT                the port of this server (default 8080)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.NEPERI_URL || "https://app.neperi.com").replace(/\/+$/, "");
const KEY = process.env.NEPERI_API_KEY || "";
const COLLECTIONS = (process.env.NEPERI_COLLECTIONS || "demo_support,demo_products")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8080);
const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml" };
const MAX_QUERY = 200;     // characters of a query the page may send
const MAX_RESULTS = 20;

if (!KEY) {
  console.error("Set NEPERI_API_KEY: a key from the Neperi console, Account -> My keys (read access is enough).");
  process.exit(1);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

// the request's JSON body, up to a few kilobytes (a search needs no more)
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

// POST /api/search {collection, query, top_k?}: only the stores of NEPERI_COLLECTIONS, a short query, a few results -- the
// page cannot use the key for anything else
async function search(req, res) {
  let q;
  try {
    q = await readJson(req);
  } catch {
    return send(res, 400, { error: { code: "bad_request", message: "The body must be JSON." } });
  }
  const collection = String(q.collection || COLLECTIONS[0] || "");
  if (!COLLECTIONS.includes(collection)) {
    return send(res, 403, { error: { code: "collection_not_allowed", message: `This page may search ${COLLECTIONS.join(", ")}.` } });
  }
  const query = String(q.query || "").trim().slice(0, MAX_QUERY);
  if (!query) return send(res, 200, { results: [] });
  const body = { query, top_k: Math.max(1, Math.min(MAX_RESULTS, Number(q.top_k) || 10)) };
  const r = await fetch(`${API}/v1/neperi/collections/${encodeURIComponent(collection)}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  send(res, r.status, await r.text());
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/search") return await search(req, res);
    if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { collections: COLLECTIONS });
    if (req.method !== "GET") return send(res, 405, { error: { code: "method_not_allowed", message: "Not allowed." } });
    const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return send(res, 404, "Not found", "text/plain");
    const file = await readFile(path).catch(() => null);
    if (!file) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch (e) {
    send(res, 502, { error: { code: "upstream", message: String(e?.message || e) } });
  }
}).listen(PORT, () => console.log(`Neperi Search sample: http://localhost:${PORT}  (stores: ${COLLECTIONS.join(", ")})`));
