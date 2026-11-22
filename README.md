# Neperi Search — sample client

A search page over your Neperi Search data, with the filters of the Neperi console: plain HTML and JavaScript for the
page, a small Node.js server that keeps your API key. Type a few letters, a word with a typo or without its accents: the
results come back as you type, each with the words it matched marked in three colours; narrow them by category, by the
store's filter fields and by tags.

## Run it

You need Node.js 18 or later (no packages to install) and an API key from the Neperi console: **Account → My keys** (a key
with read access is enough).

```bash
git clone https://github.com/neperisearch/neperi-search-client.git && cd neperi-search-client
NEPERI_API_KEY=your-key node server.mjs
```

On Windows (PowerShell): `$env:NEPERI_API_KEY="your-key"; node server.mjs`. With a `.env` file
(`NEPERI_API_KEY=your-key`), Node.js 20.6 or later reads it: `node --env-file=.env server.mjs`.

Open <http://localhost:8080>. A new account comes with sample data: the products of an outdoor shop (`demo_products`) and
its help articles (`demo_support`) — the page searches those until you name your own stores:

| Variable | What it sets | Default |
|---|---|---|
| `NEPERI_API_KEY` | your API key (required) | — |
| `NEPERI_COLLECTIONS` | the data stores the page may search, comma separated | `demo_support,demo_products` |
| `NEPERI_URL` | the API's address | `https://app.neperi.com` |
| `PORT` | the port of the sample server | `8080` |
| `FACETS_TTL` | seconds a store's categories, filter fields and tags are kept before they are asked again | `60` |

## What the page does

- **Search as you type**, with the matches marked: teal the keyword itself, amber a similar word the search chose (a
  typo, a missing letter, a longer word that starts with it), violet only the typed letters close together inside another
  word. **R** beside the score: the ranking step put that result above one that matched more closely.
- **Category**: the store's categories, each with how many records it has.
- **Filter fields** — the ones declared in the console (Records → ⚙ Categories & filter fields): a list of values (each
  with how many records have it; any of the ones ticked), a number or a date from – to, yes / no. Pick a category and only
  the fields its records carry show, with their values, counts and ranges; a filter the new category cannot meet goes.
- **Tags**: a click on a result's tag keeps the results carrying it (again: off); each tag says on hover how many records
  carry it. The tags picked and the fields set show as chips above the results, each with its ×.
- **Tables** (a store imported from an Excel / CSV file): a row shows its name cell as the title and its other cells as
  `column: value`, the matches marked in each cell (`cell_highlights`).
- **A shareable address**: `?q=…&category=…&tag=…` opens the same search.

The public API searches with words: a page of the newest records of a category, with no words typed, is not offered yet.

## How it works

```
browser (public/)  --/api/...-->  server.mjs  --Bearer key-->  Neperi API
```

- **The key stays on the server.** A key in a web page can be read by anyone and spent by anyone; the API also does not take
  calls from browsers on other sites. `server.mjs` forwards only what the page needs, only for the stores you list:
  - `POST /api/search` → `POST /v1/neperi/collections/{name}/search` with `{"query", "top_k", "category", "tags",
    "fields"}` (a short query, at most 20 results);
  - `GET /api/facets?collection=&category=` → `GET /v1/neperi/categories?collection=`, `GET
    /v1/neperi/fields?values=1&collection=&category=` and `GET /v1/neperi/collections/{name}/tags?category=`, kept
    `FACETS_TTL` seconds.
- **Filters** go in the search's body: `category`, `tags` (the records carrying every one of them, as written), `fields`
  (`{"brand": ["Norvik"]}`, `{"price_usd": {"to": 150}}`, `{"in_stock": true}`, `{"released": {"from": "2026-01-01"}}`)
  — see the API reference at `https://app.neperi.com/llms.txt`.
- **Marking the matches** (`public/app.js`, `marked()`): `snippet_highlights` are `[start, end)` ranges in `snippet`,
  `title_highlights` in `title`, counted in UTF-16 code units — what JavaScript strings count — so `text.slice(start, end)`
  is the matched word. Each mark is one of three kinds:

  | Colour | Kind | How to tell |
  |---|---|---|
  | teal | exact keyword | the marked word is not in `fuzzy` |
  | amber | similar word chosen by the search | `fuzzy[fold(word)]` gives the word typed |
  | violet | letter match | `letter_match: true` |

  `fold()` lowercases and takes accents off, as the keys of `fuzzy` are written. A result's `tag_matches` names the tags
  the search matched; `match_score` is the record's own score (lower is closer) and `reranked: true` its «R».
- **Tokens:** each search counts its query and the snippets it sends back (about 240 characters a result); reading the
  categories, fields and tags counts too, hence `FACETS_TTL`. The page asks for no whole texts (`include_text`).

## Files

- `server.mjs` — serves `public/` and forwards searches and facets (Node.js built-ins only)
- `public/index.html` — the page: a store, a search box, the filters, the chips, the legend, the results
- `public/app.js` — searching as you type, the filters, rendering the results and their marks with DOM nodes (no
  `innerHTML`)
- `public/style.css` — the filters' grid, the three colours, light and dark

## License

MIT — see [LICENSE](LICENSE).
