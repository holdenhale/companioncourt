# CompanionCourt public site

The public CompanionCourt website is a deterministic, zero-tracking static build. Its discovery layer is modern and interactive; its evidence remains readable without JavaScript. The site makes no client-side network calls, sets no cookies, loads no CDN assets, and uses no analytics.

## Source layout

- `templates/base.html` — localized document shell, metadata, compact navigation, and footer.
- `styles/court.css` — the full responsive design system for landing pages and long-form records.
- `scripts/court.mjs` — progressive enhancement for the mobile menu, pressure timeline, reveal motion, and ruling outline.
- `assets/` — self-hosted OFL fonts, selected ISC-licensed Lucide icons, and generated visual assets.
- `pages/*.html` — hand-authored English discovery pages.
- `pages/zh/*.html` — independently authored Simplified Chinese discovery pages and ruling summaries.
- `lib/` — Markdown rendering, metadata, bilingual splitting, routing, and build audit helpers.
- `build.mjs` — renders the Markdown corpus and hand-authored pages into `dist/`.
- `tests/site.test.mjs` — locale, asset, evidence-copy, motion, and route regression checks.

`dist/` is generated and must not be edited or committed.

## Language model

- `/` is the English default.
- `/zh/` is the Simplified Chinese discovery layer.
- Core pages have reciprocal `hreflang` and exact-route switching.
- Rulings have Chinese summaries that link to the complete English public record.
- Original transcript evidence stays in its source language and is labelled as source evidence.
- Trailing Chinese summaries in English rules and essays are split into their own `/zh/` pages at build time.
- The bilingual source glossary is rendered as separate English and Chinese pages.

No locale is selected by geolocation, and the site does not redirect visitors automatically.

## Design and interaction contract

- Deep-indigo evidence interface with a generated spectral pressure-ring asset.
- League Gothic for Latin display headlines; Geist for UI and reading; system CJK fonts for Chinese.
- The ring, timeline, and transcript panel explain a real published Caving Turn; they are not a simulated chat product.
- All primary navigation, CTAs, language switching, transcript details, and ruling anchors work without animation.
- JavaScript adds keyboard-accessible turn selection, mobile navigation, and optional motion only.
- `prefers-reduced-motion` removes transitions and reveal animation.
- Long-form Markdown pages keep calm reading widths, scrollable tables, source-language transcripts, and printable output.

## Build, test, and preview

```sh
cd court-repo/site
npm ci
npm run build
npm run check
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

The local server resolves the same extensionless clean URLs used by Cloudflare Pages.

`npm run check` rebuilds the site, audits internal links and first-party assets, then runs Node tests. A passing build currently emits 47 indexable pages plus the 404 page.

## Claim discipline

The site describes CompanionCourt as a public docket and pressure-testing procedure. It publishes case-scoped diagnostic rulings that are publicly contestable. It does not claim jurisdiction, ranking authority, certification, validation, comprehensive coverage, or byte-identical model reruns across gateways.
