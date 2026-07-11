#!/usr/bin/env node
// build.mjs — CompanionCourt public-site build.
//
// Single source of truth: the markdown already in court-repo/ (rulings,
// essays, rules, reports, GLOSSARY). This script renders it, deterministically,
// into court-repo/site/dist/ against the template contract owned by track S1
// (site/templates/base.html, site/styles/court.css, site/pages/*.html).
//
// Usage:
//   node build.mjs            build the site into dist/
//   node build.mjs --check    build, then run the internal-link audit and
//                             exit non-zero if any dead internal href is found
//
// Read-only on all court-repo/** content markdown and on site/templates,
// site/styles, site/pages (owned by track S1). Everything this script writes
// lives under site/ (package.json, robots.txt, .gitignore, lib/**, dist/**).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderCorpusMarkdown } from './lib/markdown.mjs';
import { buildCavingTurnPageMarkdown } from './lib/glossaryTerm.mjs';
import { auditDist, formatAuditReport } from './lib/audit.mjs';
import {
  extractH1,
  extractFirstProse,
  extractRulingMeta,
  extractRulesMeta,
  firstSentence,
  truncate,
  titleWithSuffix,
  articleJsonLd,
  webPageJsonLd,
  websiteOrgJsonLd,
  definedTermJsonLd,
} from './lib/meta.mjs';

// ---------------------------------------------------------------------------
// Launch-time constants. Each has exactly one line to change at launch.
// ---------------------------------------------------------------------------

// LAUNCH: set to the production origin, no trailing slash (e.g. "https://companioncourt.org").
const BASE_URL = 'https://companioncourt.ai';

// Stable GitHub base for repo files with no generated page (for example NAMING-DECISION.md) and for
// backfilling the literal `href="#gh"` placeholders in hand-written page bodies.
const GITHUB_BASE = 'https://github.com/holdenhale/companioncourt';

// LAUNCH: set to the launch date, YYYY-MM-DD, together with BASE_URL (one line each). Drives the
// Atom feed's <published>/<updated> timestamps so feed.xml stays deterministic — never Date.now().
// While empty, feed.xml is still written (well-formed, empty timestamps) with a placeholder comment,
// same degenerate-preview convention as the empty BASE_URL above.
const SITE_LAUNCH_DATE = '2026-07-11';

const SITE_URL = `${BASE_URL}/`;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SITE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(SITE_DIR, '..');
const DIST_DIR = path.join(SITE_DIR, 'dist');
const STYLES_SRC_DIR = path.join(SITE_DIR, 'styles');

// Overridable so this script can be exercised against a scratchpad stub
// before track S1's template/pages exist — never against a path under S1's
// own site/ directories, and defaulting to exactly those paths otherwise.
const TEMPLATE_PATH = process.env.COURT_SITE_TEMPLATE || path.join(SITE_DIR, 'templates', 'base.html');
const PAGES_DIR = process.env.COURT_SITE_PAGES_DIR || path.join(SITE_DIR, 'pages');

// ---------------------------------------------------------------------------
// Small IO helpers
// ---------------------------------------------------------------------------

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO_DIR, relPath), 'utf8');
}

function writeDist(outPath, content) {
  const full = path.join(DIST_DIR, outPath.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Template assembly
// ---------------------------------------------------------------------------

const TEMPLATE = fs.readFileSync(TEMPLATE_PATH, 'utf8');

/** Single place that turns a root-absolute path (or '/') into the canonical URL, so
 *  {{CANONICAL}} and every JSON-LD `url` field are always computed the same way. */
function canonicalUrl(canonicalPath) {
  return canonicalPath === '/' ? SITE_URL : `${BASE_URL}${canonicalPath}`;
}

function fillTemplate({ title, description, canonicalPath, jsonld, navActive, contentHtml }) {
  const canonical = canonicalUrl(canonicalPath);
  return TEMPLATE.replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(description))
    .replaceAll('{{CANONICAL}}', canonical)
    .replace('{{JSONLD}}', jsonld)
    .replace('{{NAV_ACTIVE}}', navActive)
    .replace('{{CONTENT}}', contentHtml);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Registered so sitemap.xml and the page-count summary always match what was actually written. */
const registry = [];

function emit({ outPath, canonicalPath = outPath, title, description, jsonld, navActive, contentHtml }) {
  const html = fillTemplate({ title, description, canonicalPath, jsonld, navActive, contentHtml });
  writeDist(outPath, html);
  registry.push({ outPath, canonicalPath });
}

// ---------------------------------------------------------------------------
// Corpus page manifest
// ---------------------------------------------------------------------------

const RULINGS = [
  { src: 'rulings/ruling-01.md', out: '/rulings/rd-2026-001.html' },
  { src: 'rulings/ruling-02.md', out: '/rulings/rd-2026-002.html' },
  { src: 'rulings/ruling-03.md', out: '/rulings/rd-2026-003.html' },
  { src: 'rulings/ruling-04.md', out: '/rulings/rd-2026-004.html' },
];

const ESSAYS = [
  { src: 'essays/the-caving-turn.md', out: '/essays/the-caving-turn.html' },
  { src: 'essays/the-verification-crisis.md', out: '/essays/the-verification-crisis.html' },
];

const RULES = [
  { src: 'rules/case-lifecycle-policy.md', out: '/rules/case-lifecycle-policy.html' },
  { src: 'rules/evidence-standard.md', out: '/rules/evidence-standard.html' },
  { src: 'rules/leakage-certification-policy.md', out: '/rules/leakage-certification-policy.html' },
  { src: 'rules/model-rerun-policy.md', out: '/rules/model-rerun-policy.html' },
  { src: 'rules/rules-of-procedure.md', out: '/rules/rules-of-procedure.html' },
  { src: 'rules/verdict-template.md', out: '/rules/verdict-template.html' },
];

const REPORTS = [
  { src: 'reports/report-hb-companion-product.md', out: '/reports/report-hb-companion-product.html' },
  { src: 'reports/report-claude-sonnet-4-6.md', out: '/reports/report-claude-sonnet-4-6.html' },
  { src: 'reports/sample-diagnostic-report-qwen-max.md', out: '/reports/sample-diagnostic-report-qwen-max.html' },
];

function repoDirOf(srcRelPath) {
  const d = path.posix.dirname(srcRelPath);
  return d === '.' ? '' : d;
}

/** listing entries collected as pages render, reused by the three generated index pages */
const listings = { essays: [], rules: [], reports: [] };

function renderCorpusPage(entry, { category, rulingMeta = false }) {
  const rawMd = readRepo(entry.src);
  const fromRepoDir = repoDirOf(entry.src);
  const contentHtml = renderCorpusMarkdown(rawMd, { fromRepoDir, githubBase: GITHUB_BASE, rulingMeta });
  // rulings/index.html canonicalizes to the directory-root URL, same treatment as the
  // other three generated section indexes (essays/, rules/, reports/) — the nav/footer
  // link to /rulings/, not /rulings/index.html.
  const canonicalPath = category === 'rulings-index' ? '/rulings/' : entry.out;
  const canonical = canonicalUrl(canonicalPath);
  const h1 = extractH1(rawMd);

  let title, description, jsonld, navActive, listTitle;

  if (category === 'ruling') {
    const { id, caseName, description: d } = extractRulingMeta(rawMd);
    title = `${id} — ${caseName} | CompanionCourt`;
    description = d;
    jsonld = articleJsonLd({ headline: `${id} — ${caseName}`, canonical, siteUrl: SITE_URL });
    navActive = 'rulings';
    listTitle = `${id} — ${caseName}`;
  } else if (category === 'essay') {
    title = titleWithSuffix(h1);
    description = truncate(firstSentence(extractFirstProse(rawMd)));
    jsonld = articleJsonLd({ headline: h1, canonical, siteUrl: SITE_URL });
    navActive = 'essays';
    listTitle = h1;
  } else if (category === 'rules') {
    title = titleWithSuffix(h1);
    description = extractRulesMeta(rawMd);
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL });
    navActive = 'rules';
    listTitle = h1;
  } else if (category === 'report') {
    title = titleWithSuffix(h1);
    const respondent = h1.includes('—') ? h1.split('—').slice(1).join('—').trim() : h1;
    description = truncate(
      `Diagnostic report — ${respondent}: per-case verdicts, the Integrity Gate, and the full blinded transcripts appendix. CompanionCourt public docket.`
    );
    jsonld = articleJsonLd({ headline: h1, canonical, siteUrl: SITE_URL });
    navActive = 'evidence';
    listTitle = h1;
  } else if (category === 'rulings-index') {
    title = titleWithSuffix(h1);
    description = truncate(firstSentence(extractFirstProse(rawMd)));
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL });
    navActive = 'rulings';
  } else if (category === 'glossary') {
    title = titleWithSuffix(h1);
    description = truncate(
      "Doctrine vocabulary for the CompanionCourt docket, bilingual (EN/ZH): Caving Turn, Mirror Gap, Caving Signature, Warm Judgment, Integrity Gate, DISPUTED, Anchored Dyad, and the seventeen public case names."
    );
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL });
    navActive = 'glossary';
  }

  if (category === 'essay') listings.essays.push({ href: entry.out, title: listTitle, description });
  if (category === 'rules') listings.rules.push({ href: entry.out, title: listTitle, description });
  if (category === 'report') listings.reports.push({ href: entry.out, title: listTitle, description });

  emit({ outPath: entry.out, canonicalPath, title, description, jsonld, navActive, contentHtml });
}

// ---------------------------------------------------------------------------
// S1 hand-written pages (site/pages/*.html): body-only, TITLE/DESC header
// comments, root-absolute internal hrefs already, `href="#gh"` placeholder
// for the still-undecided GitHub target.
// ---------------------------------------------------------------------------

function loadPageBody(filename) {
  const raw = fs.readFileSync(path.join(PAGES_DIR, filename), 'utf8');
  const titleMatch = raw.match(/<!--\s*TITLE:\s*(.*?)\s*-->/);
  const descMatch = raw.match(/<!--\s*DESC:\s*(.*?)\s*-->/);
  if (!titleMatch || !descMatch) {
    throw new Error(`${filename}: missing required <!-- TITLE --> / <!-- DESC --> header comment`);
  }
  let body = raw
    .replace(/<!--\s*TITLE:.*?-->\n?/, '')
    .replace(/<!--\s*DESC:.*?-->\n?/, '')
    .replace(/^\s*\n/, '');
  const ghCount = (body.match(/href="#gh"/g) || []).length;
  body = body.replaceAll('href="#gh"', `href="${GITHUB_BASE}"`);
  return { title: titleMatch[1], description: descMatch[1], body, ghCount };
}

function renderS1Page({ filename, outPath, canonicalPath = outPath, navActive, jsonld }) {
  const { title, description, body, ghCount } = loadPageBody(filename);
  const canonical = canonicalUrl(canonicalPath);
  const resolvedJsonld =
    jsonld === 'home'
      ? websiteOrgJsonLd({ siteUrl: SITE_URL })
      : webPageJsonLd({ name: title, description, canonical, siteUrl: SITE_URL });
  emit({ outPath, canonicalPath, title, description, jsonld: resolvedJsonld, navActive, contentHtml: body });
  return ghCount;
}

// ---------------------------------------------------------------------------
// Generated index pages (essays/, rules/, reports/) — added so the nav's
// directory-root links (/essays/, /rules/, /reports/) resolve to something,
// per the coordinator's ruling on the S1<->S2 contract gap. reports/ has a
// README.md (real corpus content) rendered above its listing; essays/ and
// rules/ have none, so those get a neutral listing only — no new doctrine
// prose.
// ---------------------------------------------------------------------------

function listingHtml(items) {
  const lis = items
    .map((it) => `  <li><a href="${it.href}">${escapeHtml(it.title)}</a> — ${escapeHtml(it.description)}</li>`)
    .join('\n');
  return `<ul>\n${lis}\n</ul>\n`;
}

function renderNeutralIndex({ outPath, h1, intro, navActive, items }) {
  const contentHtml = `<h1>${escapeHtml(h1)}</h1>\n\n<p>${escapeHtml(intro)}</p>\n\n${listingHtml(items)}`;
  const canonical = canonicalUrl(outPath.replace(/index\.html$/, ''));
  const jsonld = webPageJsonLd({ name: h1, description: intro, canonical, siteUrl: SITE_URL });
  emit({
    outPath,
    canonicalPath: outPath.replace(/index\.html$/, ''),
    title: `${h1} | CompanionCourt`,
    description: truncate(intro),
    jsonld,
    navActive,
    contentHtml,
  });
}

function renderReportsIndex() {
  const rawMd = readRepo('reports/README.md');
  const readmeHtml = renderCorpusMarkdown(rawMd, { fromRepoDir: 'reports', githubBase: GITHUB_BASE, rulingMeta: false });
  // README already carries its own "Reports in this directory" section — no appended auto-listing
  const contentHtml = readmeHtml;
  const outPath = '/reports/index.html';
  const canonicalPath = '/reports/';
  const canonical = canonicalUrl(canonicalPath);
  const description = truncate(firstSentence(extractFirstProse(rawMd)));
  const jsonld = webPageJsonLd({ name: 'Reports', description, canonical, siteUrl: SITE_URL });
  emit({ outPath, canonicalPath, title: 'Reports | CompanionCourt', description, jsonld, navActive: 'evidence', contentHtml });
}

// ---------------------------------------------------------------------------
// glossary/caving-turn.html — extracted standalone concept page
// ---------------------------------------------------------------------------

function renderCavingTurnPage() {
  const glossaryRaw = readRepo('GLOSSARY.md');
  const md = buildCavingTurnPageMarkdown(glossaryRaw);
  const contentHtml = renderCorpusMarkdown(md, { fromRepoDir: '', githubBase: GITHUB_BASE, rulingMeta: false });
  const outPath = '/glossary/caving-turn.html';
  const canonical = canonicalUrl(outPath);
  const glossaryUrl = canonicalUrl('/glossary.html');
  const description = truncate(
    "The docket's signature metric: the turn number at which the companion first delivered the pressured thing — however hedged, however warm the wrapper."
  );
  const jsonld = definedTermJsonLd({ name: 'Caving Turn', description, canonical, glossaryUrl });
  emit({
    outPath,
    title: 'Caving Turn — CompanionCourt Glossary',
    description,
    jsonld,
    navActive: 'glossary',
    contentHtml,
  });
}

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------

function render404() {
  const contentHtml = [
    '<h1>404 — not found</h1>',
    '<p>There is no page at this address. The docket is small on purpose.</p>',
    '<p><a href="/">Back to the docket</a> · <a href="/rulings/">Rulings</a> · <a href="/glossary.html">Glossary</a></p>',
  ].join('\n\n');
  emit({
    outPath: '/404.html',
    title: 'Page not found | CompanionCourt',
    description: 'This page does not exist on the CompanionCourt public docket.',
    jsonld: '',
    navActive: '',
    contentHtml,
  });
}

// ---------------------------------------------------------------------------
// feed.xml — deterministic Atom feed (Docket Updates subscription touchpoint).
// Entries: the four rulings + the two essays, in manifest order. Timestamps
// come only from SITE_LAUNCH_DATE (never Date.now()), so the same inputs
// always produce byte-identical output; while the constant is empty the feed
// carries empty timestamps plus a placeholder comment, mirroring how the
// empty BASE_URL renders root-relative preview URLs.
// ---------------------------------------------------------------------------

function writeFeed() {
  const items = [];
  for (const r of RULINGS) {
    const rawMd = readRepo(r.src);
    const { id, caseName, description } = extractRulingMeta(rawMd);
    items.push({ title: `${id} — ${caseName}`, href: r.out, summary: description });
  }
  for (const e of ESSAYS) {
    const rawMd = readRepo(e.src);
    items.push({
      title: extractH1(rawMd),
      href: e.out,
      summary: truncate(firstSentence(extractFirstProse(rawMd))),
    });
  }

  const stamp = SITE_LAUNCH_DATE ? `${SITE_LAUNCH_DATE}T00:00:00Z` : '';
  const placeholderComment = SITE_LAUNCH_DATE
    ? ''
    : '\n  <!-- LAUNCH: SITE_LAUNCH_DATE is not set — timestamps are empty placeholders; backfill the constant (with BASE_URL) in build.mjs and rebuild before publishing. -->';

  const entries = items
    .map((it) => {
      const url = `${BASE_URL}${it.href}`;
      return `  <entry>
    <title>${escapeHtml(it.title)}</title>
    <link href="${escapeHtml(url)}"/>
    <id>${escapeHtml(url)}</id>
    <published>${stamp}</published>
    <updated>${stamp}</updated>
    <summary>${escapeHtml(it.summary)}</summary>
  </entry>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${placeholderComment}
  <title>CompanionCourt Docket Updates</title>
  <subtitle>Rulings and essays from the CompanionCourt public docket. Verdicts, not vibes.</subtitle>
  <link href="${escapeHtml(`${BASE_URL}/feed.xml`)}" rel="self" type="application/atom+xml"/>
  <link href="${escapeHtml(SITE_URL)}"/>
  <id>${escapeHtml(SITE_URL)}</id>
  <updated>${stamp}</updated>
  <author><name>Holden Hale</name></author>
${entries}
</feed>
`;
  fs.writeFileSync(path.join(DIST_DIR, 'feed.xml'), xml, 'utf8');
  return items.length;
}

// ---------------------------------------------------------------------------
// sitemap.xml + robots.txt
// ---------------------------------------------------------------------------

function writeSitemap() {
  const urls = [...new Set(registry.map((r) => r.canonicalPath))].sort();
  const body = urls
    .map((u) => `  <url><loc>${escapeHtml(`${BASE_URL}${u}`)}</loc></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), xml, 'utf8');
  return urls.length;
}

function writeRobots() {
  const raw = fs.readFileSync(path.join(SITE_DIR, 'robots.txt'), 'utf8');
  const out = raw.replace('__SITEMAP_URL__', `${BASE_URL}/sitemap.xml`);
  fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), out, 'utf8');
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  rmrf(DIST_DIR);
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyDir(STYLES_SRC_DIR, path.join(DIST_DIR, 'styles'));

  // Corpus-rendered pages. Essays/rules/reports first so their listings
  // metadata is available for the generated index pages below.
  for (const r of RULINGS) renderCorpusPage(r, { category: 'ruling', rulingMeta: true });
  renderCorpusPage({ src: 'rulings/INDEX.md', out: '/rulings/index.html' }, { category: 'rulings-index' });
  for (const e of ESSAYS) renderCorpusPage(e, { category: 'essay' });
  for (const r of RULES) renderCorpusPage(r, { category: 'rules' });
  for (const r of REPORTS) renderCorpusPage(r, { category: 'report' });
  renderCorpusPage({ src: 'GLOSSARY.md', out: '/glossary.html' }, { category: 'glossary' });
  renderCavingTurnPage();

  // Generated directory-index pages (nav points at /essays/, /rules/, /reports/).
  renderNeutralIndex({
    outPath: '/essays/index.html',
    h1: 'Essays',
    intro: 'Concept essays accompanying the CompanionCourt rulings.',
    navActive: 'essays',
    items: listings.essays,
  });
  renderNeutralIndex({
    outPath: '/rules/index.html',
    h1: 'Rules',
    intro: 'Governance rules and procedure documents for the CompanionCourt docket.',
    navActive: 'rules',
    items: listings.rules,
  });
  renderReportsIndex();

  // S1 hand-written pages.
  let ghSubstitutions = 0;
  ghSubstitutions += renderS1Page({ filename: 'index.html', outPath: '/index.html', canonicalPath: '/', navActive: 'docket', jsonld: 'home' });
  ghSubstitutions += renderS1Page({ filename: 'submit.html', outPath: '/submit.html', navActive: 'submit' });
  ghSubstitutions += renderS1Page({ filename: 'transparency.html', outPath: '/transparency.html', navActive: 'transparency' });
  ghSubstitutions += renderS1Page({ filename: 'about.html', outPath: '/about.html', navActive: '' });

  render404();

  const urlCount = writeSitemap();
  writeRobots();
  const feedCount = writeFeed();

  console.log(`build: ${registry.length} pages written to ${path.relative(REPO_DIR, DIST_DIR)}/`);
  console.log(`build: sitemap.xml — ${urlCount} urls`);
  console.log(`build: feed.xml — ${feedCount} entries`);
  if (!SITE_LAUNCH_DATE) {
    console.log('build: NOTE — SITE_LAUNCH_DATE is empty; feed.xml timestamps are placeholders (backfill with BASE_URL at launch, then rebuild)');
  }
  console.log(`build: href="#gh" -> href="${GITHUB_BASE}" substitutions in S1 pages: ${ghSubstitutions}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
build();

if (args.includes('--check')) {
  const result = auditDist(DIST_DIR);
  console.log(formatAuditReport(result));
  if (result.dead.length > 0) {
    console.error(`build --check: FAILED — ${result.dead.length} dead internal href(s)`);
    process.exit(1);
  } else {
    console.log('build --check: OK — 0 dead internal hrefs');
  }
}
