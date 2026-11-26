# Neperi Search — sample client

The Records and Data stores pages of the Neperi console, over the public API: plain HTML and JavaScript for the page, a
small Node.js server that keeps your API key. Type a few letters, a word with a typo or without its accents: the results
come back as you type, each with the words it matched marked in three colours; narrow them by category, by the store's
filter fields, by the days and by tags. Started with `NEPERI_WRITE=1`, the same page manages your data too: data stores,
records, Excel / CSV imports, categories, filter fields, bulk actions.

## Run it

You need Node.js 18 or later (no packages to install) and an API key from the Neperi console: **Account → My keys**.

```bash
git clone https://github.com/neperisearch/neperi-search-client.git && cd neperi-search-client
NEPERI_API_KEY=your-key node server.mjs                    # a search page
NEPERI_API_KEY=your-key NEPERI_WRITE=1 node server.mjs     # a small console, on this machine only
```

On Windows (PowerShell): `$env:NEPERI_API_KEY="your-key"; node server.mjs`. With a `.env` file
(`NEPERI_API_KEY=your-key`), Node.js 20.6 or later reads it: `node --env-file=.env server.mjs`.

Open <http://localhost:8080>. A new account comes with sample data: an outdoor shop's products (`demo_products`, a
table), its help articles (`demo_support`) and codes, numbers and symbols in many languages (`demo_code`).

| Variable | What it sets | Default |
|---|---|---|
| `NEPERI_API_KEY` | your API key (required) | — |
| `NEPERI_WRITE` | `1`: the page also writes — a key with write access; filter fields need an admin key | off: search only |
| `NEPERI_COLLECTIONS` | the data stores the page may use, comma separated, or `*` for all of the account's | `*` with `NEPERI_WRITE=1`, else the sample stores |
| `NEPERI_URL` | the API's address | `https://app.neperi.com` |
| `PORT` | the port of the sample server | `8080` |
| `HOST` | the address it listens on | `127.0.0.1` with `NEPERI_WRITE=1`, else all |
| `FACETS_TTL` | seconds a store's categories, filter fields and tags are kept before they are asked again (a write through the page asks again at once) | `60` |

**On a public site:** a key with read access, `NEPERI_WRITE` off and the stores listed in `NEPERI_COLLECTIONS`. Visitors
then search and read the records of the stores you named only — a short query, up to 50 results a search.

## What the page does

**Records**
- **Search as you type**, the words read as the console reads them (a question, keywords or only their first letters:
  `no ri 30` finds «Norvik Ridge 30 L»), with the matches marked: teal the keyword itself, amber a similar word the search
  chose (a typo, a missing letter, a longer word that starts with it), violet only the typed letters close together
  inside another word. The score is the record's own match score (lower is closer); **R** beside it: the ranking step
  put that record above one that matched more closely.
- **The filters**, as the console lays them out: the data store; its categories, each with how many records it has;
  the filter fields — a list of values (each with its count, any of the ones ticked, a box to find a value in a long
  list), a number or a date from – to, yes / no; **Time**: the days records were created or changed. Pick a category and
  only the fields its records carry show, with their values and counts. A click on a record's tag filters by it. The
  conditions in use show as chips, each with its ×.
- **Nothing typed**: the store's records, a page at a time (the API lists them in id order; filters wait for words).
- **A table** (a store imported from an Excel / CSV file): its rows as a grid — the row's number, the columns, the
  matches marked in each cell.
- **A click on a record** opens it whole, every match of the search marked.
- With `NEPERI_WRITE=1`: **+ New** (a record of text: its store, category, the store's filter fields, title, tags, text;
  in a table, a row), **Edit** and **Delete** from a record, **Import Excel / CSV** (into a new store named after the
  file, or a table updated with it), **⚙ Categories & filter fields** (declare a store's categories, rename or take one
  off its records; pick the columns or metadata keys it is filtered by, each with its type), **Select all** and **Bulk
  action** on the records picked (set or remove a category, add, remove or rename tags, move them, delete them).

**Data stores**: each store with its kind, how many records, when it changed; with `NEPERI_WRITE=1`, **+ New data
store**, ⚙ and **Delete** (its name typed to confirm).

A shareable address: `?store=…&q=…&category=…&tag=…#/records` opens the same view.

## How it works

```
browser (public/)  --/api/v1/...-->  server.mjs  --Bearer key-->  Neperi API (/v1/...)
```

- **The key stays on the server.** A key in a web page can be read by anyone and spent by anyone; the API also takes no
  calls from web pages of other sites. The page calls `/api/` + the API's own path (`/api/v1/neperi/collections/products/search`
  → `/v1/neperi/collections/products/search`); `server.mjs` lets through only the calls in its `ROUTES` list, only for
  the stores of `NEPERI_COLLECTIONS`, writing only with `NEPERI_WRITE=1`.
- **What the page calls** (the API reference: `https://app.neperi.com/llms-full.txt`):

  | What | Call |
  |---|---|
  | the stores | `GET /v1/neperi/collections`, `POST /v1/neperi/collections` `{"name", "title"}`, `DELETE /v1/neperi/collections/{name}` |
  | search | `POST /v1/neperi/collections/{name}/search` `{"query", "top_k", "category", "fields", "tags", "created_from"…}` |
  | the filters | `GET /v1/neperi/categories?collection=`, `GET /v1/neperi/fields?values=1&collection=&category=`, `GET /v1/neperi/collections/{name}/tags` |
  | records | `GET …/items` (a page, id order), `GET …/items/{id}`, `POST …/items/get`, `PUT …/items`, `PATCH …/items/{id}`, `POST …/items/delete`, `POST …/items/move` |
  | a file | `POST /v1/neperi/collections/{name}/import` (multipart: `file`, `override`, `sheet`, `id_column`) |
  | categories | `PUT /v1/neperi/collections/{name}/categories`, `POST /v1/neperi/categories/rename`, `POST /v1/neperi/categories/delete` |
  | filter fields | `GET /v1/neperi/collections/{name}/fields/suggest`, `PUT /v1/neperi/fields/{key}`, `DELETE /v1/neperi/fields/{key}` (admin key) |
  | bulk | `POST /v1/neperi/items/bulk` (`dry_run` first, then again with its `op` until `done`), `POST /v1/neperi/ops/{op}/stop` |

- **Filters** go in the search's body: `category`, `tags` (the records carrying every one of them, as written), `fields`
  (`{"brand": ["Norvik"]}`, `{"price_usd": {"to": 150}}`, `{"in_stock": true}`, `{"released": {"from": "2026-01-01"}}`),
  `created_from` / `created_to` / `updated_from` / `updated_to`.
- **Marking the matches** (`public/app.js`, `marked()`): `snippet_highlights` are `[start, end)` ranges in `snippet`,
  `title_highlights` in `title`, `highlights` in the whole `text`, `cell_highlights` in a table's cells — counted in UTF-16
  code units, what JavaScript strings count, so `text.slice(start, end)` is the matched word. Each mark is one of three
  kinds:

  | Colour | Kind | How to tell |
  |---|---|---|
  | teal | exact keyword | the marked word is not in `fuzzy` |
  | amber | similar word chosen by the search | `fuzzy[fold(word)]` gives the word typed |
  | violet | letter match | `letter_match: true` |

  `fold()` lowercases and takes accents off, as the keys of `fuzzy` are written; a digit above or below the line (`²`)
  stays itself — `m²` is a word similar to `m2`. A result's `tag_matches` names the tags the search matched;
  `match_score` is the record's own score and `reranked: true` its «R».
- **Tokens and requests:** each search counts its query and the snippets it sends back (about 240 characters a result);
  reading the categories, fields and tags counts too, hence `FACETS_TTL`. Every call is one of the plan's requests a
  minute: on 429, wait the seconds the error says.

## Files

- `server.mjs` — serves `public/` and forwards the page's calls (Node.js built-ins only)
- `public/index.html` — the frame: the sidebar, the top bar, the page
- `public/app.js` — the Records and Data stores pages, the forms and dialogs, rendering the results and their marks with
  DOM nodes (no `innerHTML`)
- `public/style.css` — the console's look, light and dark (◐ in the top bar: the system's, light or dark)

## License

MIT — see [LICENSE](LICENSE).
