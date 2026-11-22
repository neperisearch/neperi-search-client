# Neperi Search — sample client

A search box over your Neperi Search data: plain HTML and JavaScript for the page, a small Node.js server that keeps your
API key. Type a few letters, a word with a typo or without its accents: the results come back as you type, each with the
words it matched marked in three colours.

## Run it

You need Node.js 18 or later (no packages to install) and an API key from the Neperi console: **Account → My keys** (a key
with read access is enough).

```bash
git clone <this repository> && cd neperi-search-client
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

## How it works

```
browser (public/)  --POST /api/search {collection, query}-->  server.mjs  --Bearer key-->  Neperi API
```

- **The key stays on the server.** A key in a web page can be read by anyone and spent by anyone; the API also does not take
  calls from browsers on other sites. `server.mjs` forwards only searches, only in the stores you list, with a short query
  and at most 20 results.
- **One call per search:** `POST /v1/neperi/collections/{name}/search` with `{"query", "top_k"}`. Filters (a category, a
  filter field, a range of days) go in the same body — see the API reference at `https://app.neperi.com/llms.txt`.
- **Marking the matches** (`public/app.js`, `marked()`): `snippet_highlights` are `[start, end)` ranges in `snippet`,
  `title_highlights` in `title`, counted in UTF-16 code units — what JavaScript strings count — so `text.slice(start, end)`
  is the matched word. Each mark is one of three kinds:

  | Colour | Kind | How to tell |
  |---|---|---|
  | teal | exact keyword | the marked word is not in `fuzzy` |
  | amber | similar word chosen by the search (a typo, a missing letter, part of a word) | `fuzzy[fold(word)]` gives the word typed |
  | violet | letter match: the typed letters close together and in order, inside another word | `letter_match: true` |

  `fold()` lowercases and takes accents off, as the keys of `fuzzy` are written.
- **Tokens:** each search counts its query and the snippets it sends back (about 240 characters a result). The page asks
  for no whole texts (`include_text`).

## Files

- `server.mjs` — serves `public/` and forwards searches (Node.js built-ins only)
- `public/index.html` — the page: a store, a search box, the legend, the results
- `public/app.js` — searching as you type, rendering the results and their marks with DOM nodes (no `innerHTML`)
- `public/style.css` — the three colours, light and dark

## License

MIT — see [LICENSE](LICENSE).
