# CompanionCourt — site

The public CompanionCourt site: a **static, zero-tracking, GitHub-Pages-compatible** web
presentation whose single source of truth is the markdown in `court-repo/`. No JavaScript is
required to read anything; there are no external fonts, no CDNs, no analytics, and no cookies —
zero third-party requests.

This directory is split across two tracks that build to one shared template contract:

- **Design system + hand-written pages (this track, S1):**
  - `templates/base.html` — the page shell, with placeholder tokens.
  - `styles/court.css` — the entire design system, one self-contained file.
  - `pages/*.html` — the hand-written pages (`index`, `submit`, `transparency`, `about`): body
    content only, plus a comment header.
- **Markdown → HTML pipeline (track S2):** `build.mjs` + `lib/` render the `court-repo/` markdown
  (rulings, essays, rules, reports, glossary) into HTML using the same `base.html` and `court.css`.
  Those files are owned by S2 and are not modified here.

## Template contract

`base.html` is a full HTML5 document containing six placeholder tokens, each on its own line, that
the build substitutes per page:

| Token | Filled with |
| --- | --- |
| `{{TITLE}}` | the page `<title>` and Open Graph title |
| `{{DESCRIPTION}}` | the meta description / OG description |
| `{{CANONICAL}}` | the canonical URL |
| `{{JSONLD}}` | a `<script type="application/ld+json">` block, or empty |
| `{{NAV_ACTIVE}}` | the active-section key (see below); sets `<body data-nav="…">` |
| `{{CONTENT}}` | the page body, wrapped by `base.html` in `<main><div class="prose">…` |

**Hand-written pages** (`pages/*.html`) contain only what replaces `{{CONTENT}}`, preceded by a
comment header the build reads for title/description:

```html
<!-- TITLE: … -->
<!-- DESC: … -->
```

**`{{NAV_ACTIVE}}`** is the section key that highlights the current nav item (CSS-only, via
`body[data-nav="…"]`). Expected values, matching the nav `data-nav` attributes in `base.html`:
`docket` · `rulings` · `essays` · `rules` · `evidence` · `glossary` · `submit` · `transparency`.
An empty or unmatched value simply highlights nothing (the `about` page has no nav entry). It is
progressive enhancement — never load-bearing for reading.

**CSS classes the build emits** (all styled in `court.css`): `.banner`, `.contestability`,
`.verdict-red`, `.transcript` (wraps `<details>` transcript blocks), `.sources`, `.ruling-meta`.
The pre-publication banner is rendered once at the top of every page by `base.html` itself.

### Link scheme

All internal links are **root-absolute** (leading `/`) so the shared nav, footer, and
`/styles/court.css` reference resolve identically from any directory depth. This assumes the site
is served at the **domain root** (a user/org GitHub Pages site or a custom domain), which matches
the nav paths in the contract (`/`, `/rulings/`, `/essays/`, `/rules/`, `/reports/`,
`/glossary.html`, `/submit.html`, `/transparency.html`).

### The `#gh` convention

Every link that must point at the project's GitHub repository (runner clone, issue tracker, appeal
filing, license, naming-decision document) is written literally as `href="#gh"`. The repository
org/slug is created by the owner at launch, so no real URL is hard-coded. **The build (S2)
substitutes every `#gh` with a single `GITHUB_BASE` constant at launch** — the anchor is the
contract, not a placeholder to hand-edit. `submit.html` carries one footnote noting the links go
live at launch; no other page repeats it.

## Design constraints

- Court-record aesthetic: readable serif for reading, sans for chrome/labels, a restrained
  paper + ink palette with a single accent red reserved for `RED` verdicts.
- Light and dark themes via `prefers-color-scheme`.
- Reading measure capped near 70ch; wide content (tables, transcripts) scrolls inside its own
  container without the page scrolling horizontally.
- Everything works with CSS disabled (semantic HTML) and with JavaScript disabled (there is none).

## Preview locally

The pages are assembled by the S2 pipeline (`build.mjs`) into a static output directory; run that
build per its own documentation, then serve the generated output from its **root** so the
root-absolute links resolve:

```sh
# from the generated site output directory
python3 -m http.server 8000
# then open http://localhost:8000/
```

To eyeball a single hand-written page's styling in isolation before the pipeline runs, paste its
`pages/*.html` body into the `{{CONTENT}}` slot of `templates/base.html`, replace the other tokens
with placeholder text, and open the file with `styles/court.css` alongside. This is a styling
spot-check only — canonical output always comes from the build.

## Claim-ladder discipline

Every word on these pages traces to the source docs in `court-repo/` (README, `GLOSSARY.md`,
`rulings/`, `rules/`, `NAMING-DECISION.md`) and the approved landing copy.
The only self-description licensed at v0 is *"a public docket for
pressure-testing AI companions."* The pages never claim jurisdiction, an industry standard,
comprehensiveness, certification, compliance-equivalence, or human-validated verdicts, and the
court judges AI companions, never the people who confide in them.
