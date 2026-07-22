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

import { renderCorpusMarkdown, stripComments } from './lib/markdown.mjs';
import {
  ZH_PAGE_OVERRIDES,
  buildTermPageMarkdown,
  linkGlossaryIndexTerms,
  parseGlossaryTerms,
  termMatcher,
} from './lib/glossaryTerm.mjs';
import { auditDist, formatAuditReport } from './lib/audit.mjs';
import { buildGlossaryMarkdown, splitTrailingZhSummary } from './lib/bilingual.mjs';
import { DEFAULT_LOCALE_ID, LOCALES, localeConfig, localeCopy, shellFor } from './lib/i18n.mjs';
import {
  extractH1,
  extractFirstProse,
  extractRulingMeta,
  extractRulingPublished,
  extractRulesMeta,
  firstSentence,
  stripMd,
  truncate,
  titleWithSuffix,
  articleJsonLd,
  datasetJsonLd,
  webPageJsonLd,
  websiteOrgJsonLd,
  definedTermJsonLd,
} from './lib/meta.mjs';
import { caseFactsHtml, verifyRulingFacts } from './lib/caseFacts.mjs';

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

function resolveDistDir() {
  const requested = process.env.COURT_SITE_DIST_DIR;
  if (requested === undefined || requested === '') return path.join(SITE_DIR, 'dist');
  if (requested.includes('\0') || !path.isAbsolute(requested)) {
    throw new Error('COURT_SITE_DIST_DIR must be an absolute path');
  }
  const resolved = path.resolve(requested);
  if (resolved === SITE_DIR || SITE_DIR.startsWith(`${resolved}${path.sep}`)) {
    throw new Error('COURT_SITE_DIST_DIR must not contain the site source tree');
  }
  return resolved;
}

// Ops plans set this to a private temporary directory so concurrent read-only
// preflights never rebuild or race on the shared iCloud-backed site/dist tree.
const DIST_DIR = resolveDistDir();
const STYLES_SRC_DIR = path.join(SITE_DIR, 'styles');
const ASSETS_SRC_DIR = path.join(SITE_DIR, 'assets');
const SCRIPTS_SRC_DIR = path.join(SITE_DIR, 'scripts');

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

/** Map generated files to the clean URLs Cloudflare Pages actually serves. */
function publicPath(outPath) {
  if (outPath === '/index.html') return '/';
  if (outPath.endsWith('/index.html')) return outPath.slice(0, -'index.html'.length);
  if (outPath.endsWith('.html')) return outPath.slice(0, -'.html'.length);
  return outPath;
}

/** Keep every root-absolute internal link on the same clean-URL contract. */
function normalizeInternalLinks(html) {
  return html.replace(/href="(\/[^"?#]+)\.html([?#][^"]*)?"/g, (_match, pathname, suffix = '') => {
    return `href="${pathname}${suffix}"`;
  });
}

/** Single place that turns a public path (or '/') into the canonical URL, so
 *  {{CANONICAL}} and every JSON-LD `url` field are always computed the same way. */
function canonicalUrl(canonicalPath) {
  return canonicalPath === '/' ? SITE_URL : `${BASE_URL}${canonicalPath}`;
}

function defaultAlternateRoute(locale, canonicalPath) {
  if (locale === 'zh') {
    if (canonicalPath === '/zh/') return { path: '/', exact: true };
    return { path: canonicalPath.replace(/^\/zh/, '') || '/', exact: true };
  }
  if (canonicalPath === '/') return { path: '/zh/', exact: true };
  if (canonicalPath === '/essays/the-caving-turn') return { path: '/zh/glossary/caving-turn', exact: true };
  if (/^\/(?:method|submit|transparency|about|glossary)(?:\/|$)/.test(canonicalPath)) return { path: `/zh${canonicalPath}`, exact: true };
  if (/^\/(?:rulings|rules|essays)\//.test(canonicalPath)) return { path: `/zh${canonicalPath}`, exact: true };
  return { path: localeConfig('zh').routes.home, exact: false };
}

function normalizeLocaleRoute(localeId, route) {
  localeConfig(localeId);
  const normalized = typeof route === 'string' ? { path: route, exact: true } : route;
  if (!normalized?.path?.startsWith('/')) throw new Error(`Invalid locale route for ${localeId}`);
  return { path: normalized.path, exact: normalized.exact !== false };
}

function resolveLocaleRoutes({ locale, canonicalPath, alternatePath, localeRoutes }) {
  localeConfig(locale);
  if (alternatePath && localeRoutes) throw new Error('Use alternatePath or localeRoutes, not both');

  const resolved = {};
  if (localeRoutes) {
    for (const [localeId, route] of Object.entries(localeRoutes)) {
      resolved[localeId] = normalizeLocaleRoute(localeId, route);
    }
  } else {
    if (LOCALES.length !== 2) {
      throw new Error('Legacy alternatePath only supports two locales; provide localeRoutes for every page');
    }
    const alternateLocale = LOCALES.find((entry) => entry.id !== locale);
    const route = alternatePath
      ? { path: alternatePath, exact: true }
      : defaultAlternateRoute(locale, canonicalPath);
    resolved[alternateLocale.id] = normalizeLocaleRoute(alternateLocale.id, route);
  }

  resolved[locale] = { path: canonicalPath, exact: true };
  return resolved;
}

function alternateLinks(localeRoutes) {
  const links = LOCALES.flatMap((locale) => {
    const route = localeRoutes[locale.id];
    if (!route?.path || route.exact === false) return [];
    return [`<link rel="alternate" hreflang="${locale.hreflang}" href="${canonicalUrl(route.path)}">`];
  });
  const defaultPath = localeRoutes[DEFAULT_LOCALE_ID]?.path ?? Object.values(localeRoutes)[0]?.path ?? '/';
  links.push(`<link rel="alternate" hreflang="x-default" href="${canonicalUrl(defaultPath)}">`);
  return links.join('\n');
}

function fillTemplate({
  title,
  description,
  canonicalPath,
  jsonld,
  navActive,
  contentHtml,
  locale = 'en',
  pageClass = 'record',
  contentClass = 'prose',
  alternatePath,
  localeRoutes,
  noindex = false,
}) {
  const canonical = canonicalUrl(canonicalPath);
  const resolvedLocaleRoutes = resolveLocaleRoutes({ locale, canonicalPath, alternatePath, localeRoutes });
  const shell = shellFor({ locale, localeRoutes: resolvedLocaleRoutes });
  let html = TEMPLATE.replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(description))
    .replaceAll('{{CANONICAL}}', canonical)
    .replace('{{ALTERNATES}}', alternateLinks(resolvedLocaleRoutes))
    .replaceAll('{{LANG}}', shell.lang)
    .replaceAll('{{OG_LOCALE}}', shell.ogLocale)
    .replaceAll('{{OG_IMAGE_ALT}}', escapeHtml(shell.ogImageAlt))
    .replace('{{JSONLD}}', jsonld)
    .replace('{{NAV_ACTIVE}}', navActive)
    .replace('{{PAGE_CLASS}}', pageClass)
    .replace('{{CONTENT_CLASS}}', contentClass)
    .replace('{{SKIP_LABEL}}', shell.skipLabel)
    .replace('{{HEADER}}', shell.header)
    .replace('{{FOOTER}}', shell.footer)
    .replace('{{CONTENT}}', contentHtml);
  if (noindex) html = html.replace('</head>', '<meta name="robots" content="noindex,follow">\n</head>');
  return normalizeInternalLinks(html);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Registered so sitemap.xml and the page-count summary always match what was actually written. */
const registry = [];

function emit({
  outPath,
  canonicalPath = publicPath(outPath),
  title,
  description,
  jsonld,
  navActive,
  contentHtml,
  indexable = true,
  noindex = false,
  locale = 'en',
  pageClass = 'record',
  contentClass = 'prose',
  alternatePath,
  localeRoutes,
  lastmod = '',
}) {
  const html = fillTemplate({
    title,
    description,
    canonicalPath,
    jsonld,
    navActive,
    contentHtml,
    locale,
    pageClass,
    contentClass,
    alternatePath,
    localeRoutes,
    noindex,
  });
  writeDist(outPath, html);
  if (indexable) registry.push({ outPath, canonicalPath, locale, lastmod });
}

// ---------------------------------------------------------------------------
// Corpus page manifest
// ---------------------------------------------------------------------------

const RULINGS = [
  { src: 'rulings/ruling-01.md', out: '/rulings/rd-2026-001.html' },
  { src: 'rulings/ruling-02.md', out: '/rulings/rd-2026-002.html' },
  { src: 'rulings/ruling-03.md', out: '/rulings/rd-2026-003.html' },
  { src: 'rulings/ruling-04.md', out: '/rulings/rd-2026-004.html' },
  // RD-2026-005 is en-only by disclosed design (the respondent is this bench's own frozen zh anchor
  // model — see the ruling's Scope discipline section) and carries no zh summary page, unlike every
  // other ruling here. Without this override, defaultAlternateRoute (below) would assume a zh
  // translation exists at the same path and the link auditor would (correctly) flag it as dead.
  // exact: false matches the treatment already used for other untranslated English-only pages
  // (/runner, /check, /judge): no hreflang alternate is advertised, and the locale switcher falls back
  // to the zh rulings index rather than a nonexistent same-slug zh page.
  {
    src: 'rulings/ruling-05.md',
    out: '/rulings/rd-2026-005.html',
    localeRoutes: { zh: { path: '/zh/rulings/', exact: false } },
  },
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
  { src: 'reports/report-DMXAPI-deepseek-v4-flash.md', out: '/reports/report-DMXAPI-deepseek-v4-flash.html' },
];

function repoDirOf(srcRelPath) {
  const d = path.posix.dirname(srcRelPath);
  return d === '.' ? '' : d;
}

/** listing entries collected as pages render, reused by the three generated index pages */
const listings = { essays: [], rules: [], reports: [] };

// The docket's median caving turn, read from the published record rather than
// hardcoded (red-team item: the figure must not go stale as the docket grows).
// Source: reports/report-claude-sonnet-4-6.md, "Caving turn (median): N" —
// the same figure RD-2026-001/RD-2026-004 ground. Build fails loudly if the
// line ever disappears, rather than shipping an invented number.
const DOCKET_MEDIAN = (() => {
  const m = readRepo('reports/report-claude-sonnet-4-6.md').match(/^- Caving turn \(median\): (\d+)$/m);
  if (!m) throw new Error('reports/report-claude-sonnet-4-6.md: "Caving turn (median)" line not found — cannot derive the docket median for /check');
  return m[1];
})();

// Every Part I doctrine term, parsed once from GLOSSARY.md (the single
// definition source). parseGlossaryTerms throws on any format drift.
const GLOSSARY_TERMS = parseGlossaryTerms(readRepo('GLOSSARY.md'));

/** English record pages (rulings, essays, rules, reports) collected as they
 *  render, then scanned for term usage so each standalone glossary term page
 *  can link the real routes where the term appears. The scanned text is the
 *  page's own render source (zh summaries already split off), comments
 *  stripped so an authoring note can never count as a usage. */
const termScanTargets = [];

function renderCorpusPage(entry, { category, rulingMeta = false }) {
  const rawMd = readRepo(entry.src);
  const renderMd = category === 'rules' || entry.src === 'essays/the-verification-crisis.md'
    ? splitTrailingZhSummary(rawMd).english
    : category === 'glossary'
      ? linkGlossaryIndexTerms(buildGlossaryMarkdown(rawMd, 'en'), GLOSSARY_TERMS, 'en')
      : rawMd;
  const fromRepoDir = repoDirOf(entry.src);
  let contentHtml = renderCorpusMarkdown(renderMd, { fromRepoDir, githubBase: GITHUB_BASE, rulingMeta });
  // rulings/index.html canonicalizes to the directory-root URL, same treatment as the
  // other three generated section indexes (essays/, rules/, reports/) — the nav/footer
  // link to /rulings/, not /rulings/index.html.
  const canonicalPath = category === 'rulings-index' ? '/rulings/' : publicPath(entry.out);
  const canonical = canonicalUrl(canonicalPath);
  const h1 = extractH1(rawMd);

  let title, description, jsonld, navActive, listTitle;
  let lastmod = '';

  if (category === 'ruling') {
    const { id, caseName, description: d } = extractRulingMeta(rawMd);
    const caseKey = rawMd.match(/^# Ruling RD-2026-\d+ — .+? \((.+)\)$/m)?.[1] ?? '';
    // The ruling's own Contestability line is the only date source; the record
    // is frozen after publication, so dateModified equals datePublished.
    const published = extractRulingPublished(rawMd);
    lastmod = published;
    title = `${id} — ${caseName} | CompanionCourt`;
    description = d;
    jsonld = articleJsonLd({
      headline: `${id} — ${caseName}`,
      canonical,
      siteUrl: SITE_URL,
      inLanguage: 'en',
      datePublished: published || undefined,
      dateModified: published || undefined,
    });
    navActive = 'rulings';
    listTitle = `${id} — ${caseName}`;
    contentHtml = contentHtml.replace(
      /<h1>[\s\S]*?<\/h1>/,
      `<header class="record-title"><span>${escapeHtml(id)} · PUBLIC RULING</span><h1>${escapeHtml(caseName)}</h1><p>${escapeHtml(caseKey)}</p></header>`
    );
    // Case-facts box: every number and quote is verified verbatim against the
    // frozen ruling markdown (build fails on drift; elisions are marked […]).
    const facts = verifyRulingFacts(id, rawMd);
    contentHtml = contentHtml.replace('</header>', `</header>\n${caseFactsHtml(id, caseName, facts)}`);
    contentHtml = `<div class="record-actions"><span>PUBLIC RULING · CASE-SCOPED</span><a href="#transcript-excerpt">Jump to the transcript <img class="icon" src="/assets/icons/arrow-right.svg" alt=""></a></div>\n${contentHtml}`;
  } else if (category === 'essay') {
    title = titleWithSuffix(h1);
    description = truncate(firstSentence(extractFirstProse(rawMd)));
    // Essays carry no date of their own; the launch date is the same verifiable
    // constant feed.xml already publishes for these entries.
    lastmod = SITE_LAUNCH_DATE;
    jsonld = articleJsonLd({
      headline: h1,
      canonical,
      siteUrl: SITE_URL,
      inLanguage: 'en',
      datePublished: SITE_LAUNCH_DATE || undefined,
    });
    navActive = 'essays';
    listTitle = h1;
  } else if (category === 'rules') {
    title = titleWithSuffix(h1);
    description = extractRulesMeta(rawMd);
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL, inLanguage: 'en' });
    navActive = 'rules';
    listTitle = h1;
    if (entry.src === 'rules/evidence-standard.md') {
      contentHtml += `\n${EVIDENCE_STANDARD_SITE_NOTE_EN}`;
    }
  } else if (category === 'report') {
    title = titleWithSuffix(h1);
    const respondent = h1.includes('—') ? h1.split('—').slice(1).join('—').trim() : h1;
    description = truncate(
      `Diagnostic report — ${respondent}: per-case verdicts, the Integrity Gate, and the full blinded transcripts appendix. CompanionCourt public docket.`
    );
    // Report pages are the transcript library: Article plus Dataset (the
    // blinded transcripts and per-case verdicts, Apache-2.0).
    jsonld = [
      articleJsonLd({ headline: h1, canonical, siteUrl: SITE_URL, inLanguage: 'en' }),
      datasetJsonLd({
        name: `${h1} — blinded transcripts and per-case verdicts`,
        description,
        canonical,
        siteUrl: SITE_URL,
        inLanguage: 'en',
      }),
    ].join('\n');
    navActive = 'evidence';
    listTitle = h1;
  } else if (category === 'rulings-index') {
    title = titleWithSuffix(h1);
    description = truncate(firstSentence(extractFirstProse(rawMd)));
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL, inLanguage: 'en' });
    navActive = 'rulings';
  } else if (category === 'glossary') {
    title = titleWithSuffix(h1);
    description = truncate(
      "Doctrine vocabulary for the CompanionCourt docket, bilingual (EN/ZH): Caving Turn, Mirror Gap, Caving Signature, Warm Judgment, Integrity Gate, DISPUTED, Anchored Dyad, and the seventeen public case names."
    );
    jsonld = webPageJsonLd({ name: h1, description, canonical, siteUrl: SITE_URL, inLanguage: 'en' });
    navActive = 'glossary';
  }

  if (category === 'essay') listings.essays.push({ href: publicPath(entry.out), title: listTitle, description });
  if (category === 'rules') listings.rules.push({ href: publicPath(entry.out), title: listTitle, description });
  if (category === 'report') listings.reports.push({ href: publicPath(entry.out), title: listTitle, description });

  if (['ruling', 'essay', 'rules', 'report'].includes(category)) {
    termScanTargets.push({ href: canonicalPath, title: listTitle, text: stripComments(renderMd) });
  }

  emit({
    outPath: entry.out,
    canonicalPath,
    title,
    description,
    jsonld,
    navActive,
    contentHtml,
    pageClass: category === 'ruling' ? 'record ruling-page' : `record ${category}-page`,
    contentClass: 'prose record-prose',
    lastmod,
    localeRoutes: entry.localeRoutes,
  });
}

// ---------------------------------------------------------------------------
// Site-layer factual notes for the evidence-standard page. The frozen
// rules/evidence-standard.md is rendered untouched; these notes are appended
// by the site build, labelled as site notes, and state only facts already on
// the public record (Rules of Procedure §2.3 N≥3 per RD-2026-003; the M3-C
// +0.171 kin-preference disclosure per RD-2026-001/002/004).
// ---------------------------------------------------------------------------

const EVIDENCE_STANDARD_SITE_NOTE_EN =
  '<aside class="callout site-note" data-site-note><p><strong>Docket context (site note; not part of the versioned rule text above):</strong> ' +
  'every respondent runs each case with N≥3 independent seeds (Rules of Procedure §2.3 — the requirement ' +
  '<a href="/rulings/rd-2026-003">RD-2026-003</a> defends), and measured judge-family bias is itself on the record: ' +
  'the M3-C check measured a one-sided +0.171 kin preference for the claude judge toward same-family outputs, ' +
  'concentrated in en, disclosed in <a href="/rulings/rd-2026-001">RD-2026-001</a> and every affected ruling.</p></aside>';

const EVIDENCE_STANDARD_SITE_NOTE_ZH =
  '> 站点注（非规则正文）：每个被测方在每个案例上至少以 N≥3 个独立种子运行（程序规则 §2.3，[RD-2026-003](/zh/rulings/rd-2026-003) 为其成文依据）；' +
  '已测得的裁判家族偏差同样公开在案：M3-C 测得 claude 裁判对同家族输出存在单侧 +0.171 的亲缘偏好（集中于英文运行），已在 [RD-2026-001](/zh/rulings/rd-2026-001) 等相关判决中披露。';

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
  // __DOCKET_MEDIAN__ is derived from the published report at build time (see
  // DOCKET_MEDIAN above) so page copy can cite the figure without hardcoding it.
  body = body.replaceAll('__DOCKET_MEDIAN__', DOCKET_MEDIAN);
  return { title: titleMatch[1], description: descMatch[1], body, ghCount };
}

function renderS1Page({
  filename,
  outPath,
  canonicalPath,
  navActive,
  jsonld,
  locale = 'en',
  pageClass = 'landing',
  contentClass = 'landing-shell',
  alternatePath,
  localeRoutes,
}) {
  const { title, description, body, ghCount } = loadPageBody(filename);
  const resolvedCanonicalPath = canonicalPath ?? publicPath(outPath);
  const canonical = canonicalUrl(resolvedCanonicalPath);
  const language = localeConfig(locale).htmlLang;
  const resolvedJsonld =
    jsonld === 'home'
      ? websiteOrgJsonLd({ siteUrl: SITE_URL, inLanguage: language })
      : webPageJsonLd({ name: title, description, canonical, siteUrl: SITE_URL, inLanguage: language });
  emit({
    outPath,
    canonicalPath: resolvedCanonicalPath,
    title,
    description,
    jsonld: resolvedJsonld,
    navActive,
    contentHtml: body,
    locale,
    pageClass,
    contentClass,
    alternatePath,
    localeRoutes,
  });
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
  // The reports directory is the transcript library entry point: WebPage plus
  // a Dataset node for the published blinded-transcript record (Apache-2.0).
  const jsonld = [
    webPageJsonLd({ name: 'Reports', description, canonical, siteUrl: SITE_URL }),
    datasetJsonLd({
      name: 'CompanionCourt diagnostic reports — blinded transcripts and per-case verdicts',
      description,
      canonical,
      siteUrl: SITE_URL,
      inLanguage: 'en',
    }),
  ].join('\n');
  emit({ outPath, canonicalPath, title: 'Reports | CompanionCourt', description, jsonld, navActive: 'evidence', contentHtml });
}

// ---------------------------------------------------------------------------
// glossary/<slug>.html — standalone concept pages, one per GLOSSARY.md Part I
// term, generalized from the original single caving-turn extraction. Same
// scaffold in both locales: verbatim definition first, then links to the
// English record pages where the term actually appears, then the back-link.
// ---------------------------------------------------------------------------

function collectTermInstances() {
  const bySlug = new Map();
  for (const term of GLOSSARY_TERMS) {
    const re = termMatcher(term);
    bySlug.set(
      term.slug,
      termScanTargets.filter((t) => re.test(t.text)).map(({ href, title }) => ({ href, title }))
    );
  }
  return bySlug;
}

function renderGlossaryTermPages(locale, instancesBySlug) {
  for (const term of GLOSSARY_TERMS) {
    const md = buildTermPageMarkdown(term, locale, instancesBySlug.get(term.slug));
    const contentHtml = renderCorpusMarkdown(md, { fromRepoDir: '', githubBase: GITHUB_BASE, rulingMeta: false });
    const outPath = locale === 'zh' ? `/zh/glossary/${term.slug}.html` : `/glossary/${term.slug}.html`;
    const canonicalPath = publicPath(outPath);
    const canonical = canonicalUrl(canonicalPath);
    const glossaryUrl = canonicalUrl(locale === 'zh' ? '/zh/glossary' : '/glossary');
    const zhOverride = ZH_PAGE_OVERRIDES[term.slug];
    const name = locale === 'zh' ? zhOverride?.name ?? term.zhName : term.enName;
    // Description = the definition's own first sentence (verbatim source,
    // markdown markers stripped), so meta never drifts from GLOSSARY.md.
    const description = locale === 'zh'
      ? zhOverride?.description ?? truncate((term.zh.match(/^[^。]*。/) ?? [term.zh])[0])
      : truncate(firstSentence(stripMd(term.english)));
    const jsonld = definedTermJsonLd({ name, description, canonical, glossaryUrl, inLanguage: locale === 'zh' ? 'zh-Hans' : 'en' });
    emit({
      outPath,
      canonicalPath,
      title: locale === 'zh' ? `${name}｜CompanionCourt 词汇表` : `${name} — CompanionCourt Glossary`,
      description,
      jsonld,
      navActive: 'glossary',
      contentHtml,
      locale,
      pageClass: 'record glossary-page',
      contentClass: 'prose record-prose',
    });
  }
}

const ZH_RULE_TITLES = {
  'case-lifecycle-policy': '案件生命周期规则',
  'evidence-standard': '证据标准',
  'leakage-certification-policy': '泄漏与认证边界',
  'model-rerun-policy': '模型重跑规则',
  'rules-of-procedure': '程序规则',
  'verdict-template': '判决模板',
};

function renderZhMarkdownPage({ outPath, title, description, rawMd, navActive, alternatePath }) {
  const contentHtml = renderCorpusMarkdown(rawMd, { fromRepoDir: '', githubBase: GITHUB_BASE, rulingMeta: false });
  const canonicalPath = publicPath(outPath);
  const canonical = canonicalUrl(canonicalPath);
  emit({
    outPath,
    canonicalPath,
    title: `${title}｜CompanionCourt`,
    description,
    jsonld: webPageJsonLd({ name: title, description, canonical, siteUrl: SITE_URL, inLanguage: 'zh-Hans' }),
    navActive,
    contentHtml,
    locale: 'zh',
    pageClass: 'record localized-record',
    contentClass: 'prose record-prose',
    alternatePath,
  });
}

function renderZhRuleSummaries() {
  for (const entry of RULES) {
    const slug = path.posix.basename(entry.src, '.md');
    const { chinese } = splitTrailingZhSummary(readRepo(entry.src));
    if (!chinese) continue;
    const title = ZH_RULE_TITLES[slug] ?? slug;
    const rawMd = [
      `# ${title}`,
      '',
      '> 中文页提供可读摘要；具约束力的完整版本仍以英文原文为准。',
      '',
      chinese,
      '',
      ...(slug === 'evidence-standard' ? [EVIDENCE_STANDARD_SITE_NOTE_ZH, ''] : []),
      `[查看英文完整规则原文](/rules/${slug})`,
    ].join('\n');
    renderZhMarkdownPage({
      outPath: `/zh/rules/${slug}.html`,
      title,
      description: `${title}的简体中文摘要与英文完整原文入口。`,
      rawMd,
      navActive: 'method',
      alternatePath: `/rules/${slug}`,
    });
  }
}

function renderZhVerificationEssay() {
  const { chinese } = splitTrailingZhSummary(readRepo('essays/the-verification-crisis.md'));
  const rawMd = [
    '# 验证危机',
    '',
    chinese,
    '',
    '[查看英文完整文章](/essays/the-verification-crisis)',
  ].join('\n');
  renderZhMarkdownPage({
    outPath: '/zh/essays/the-verification-crisis.html',
    title: '验证危机',
    description: '为什么公开可挑战的证据链比不可核验的远程一致性数字更诚实。',
    rawMd,
    navActive: 'method',
    alternatePath: '/essays/the-verification-crisis',
  });
}

function renderZhGlossary() {
  const rawMd = linkGlossaryIndexTerms(buildGlossaryMarkdown(readRepo('GLOSSARY.md'), 'zh'), GLOSSARY_TERMS, 'zh');
  renderZhMarkdownPage({
    outPath: '/zh/glossary.html',
    title: '词汇表',
    description: 'CompanionCourt 公开案卷使用的简体中文概念与案例词汇。',
    rawMd,
    navActive: 'method',
    alternatePath: '/glossary',
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
    canonicalPath: '/404',
    title: 'Page not found | CompanionCourt',
    description: 'This page does not exist on the CompanionCourt public docket.',
    jsonld: '',
    navActive: '',
    contentHtml,
    indexable: false,
    noindex: true,
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
      const url = canonicalUrl(publicPath(it.href));
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
  // <lastmod> is emitted only for pages whose source record carries a
  // verifiable date (rulings: the Contestability "published" line; essays:
  // the launch constant feed.xml already publishes). Undated pages get no
  // <lastmod> — the field is optional per URL and is never invented.
  const byPath = new Map();
  for (const r of registry) {
    if (!byPath.has(r.canonicalPath)) byPath.set(r.canonicalPath, r.lastmod || '');
  }
  const urls = [...byPath.keys()].sort();
  const body = urls
    .map((u) => {
      const lastmod = byPath.get(u);
      return `  <url><loc>${escapeHtml(`${BASE_URL}${u}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
    })
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

// Same source-file mechanism as robots.txt: site/_redirects is the hand-maintained
// source, emitted verbatim into the dist/ root so Cloudflare Pages picks it up.
// The /go/* paths it defines are measurement-only entry points and are excluded
// from indexing via the robots.txt Disallow above.
function writeRedirects() {
  fs.copyFileSync(path.join(SITE_DIR, '_redirects'), path.join(DIST_DIR, '_redirects'));
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function build() {
  rmrf(DIST_DIR);
  fs.mkdirSync(DIST_DIR, { recursive: true });
  copyDir(STYLES_SRC_DIR, path.join(DIST_DIR, 'styles'));
  copyDir(ASSETS_SRC_DIR, path.join(DIST_DIR, 'assets'));
  copyDir(SCRIPTS_SRC_DIR, path.join(DIST_DIR, 'scripts'));

  // Corpus-rendered pages. Essays/rules/reports first so their listings
  // metadata is available for the generated index pages below.
  for (const r of RULINGS) renderCorpusPage(r, { category: 'ruling', rulingMeta: true });
  renderCorpusPage({ src: 'rulings/INDEX.md', out: '/rulings/index.html' }, { category: 'rulings-index' });
  for (const e of ESSAYS) renderCorpusPage(e, { category: 'essay' });
  for (const r of RULES) renderCorpusPage(r, { category: 'rules' });
  for (const r of REPORTS) renderCorpusPage(r, { category: 'report' });
  renderCorpusPage({ src: 'GLOSSARY.md', out: '/glossary.html' }, { category: 'glossary' });
  const termInstances = collectTermInstances();
  renderGlossaryTermPages('en', termInstances);

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
  ghSubstitutions += renderS1Page({ filename: 'index.html', outPath: '/index.html', canonicalPath: '/', navActive: 'docket', jsonld: 'home', pageClass: 'home landing' });
  ghSubstitutions += renderS1Page({ filename: 'method.html', outPath: '/method.html', navActive: 'method', pageClass: 'method landing' });
  ghSubstitutions += renderS1Page({ filename: 'submit.html', outPath: '/submit.html', navActive: 'submit', pageClass: 'submit landing' });
  ghSubstitutions += renderS1Page({ filename: 'transparency.html', outPath: '/transparency.html', navActive: 'transparency', pageClass: 'transparency landing' });
  ghSubstitutions += renderS1Page({ filename: 'about.html', outPath: '/about.html', navActive: '', pageClass: 'about landing' });
  // /runner — on-site mirror of the repository quickstart. English-only for now: with no
  // alternatePath given, the locale selector falls back to the zh homepage (labelled, not
  // advertised via hreflang), the same treatment as the other untranslated English pages.
  ghSubstitutions += renderS1Page({ filename: 'runner.html', outPath: '/runner.html', navActive: '', pageClass: 'record runner-page', contentClass: 'prose record-prose' });
  // /check (the Conversation Lens) and /judge (the blind bench). English-only
  // in v1 (zh UI is scheduled next wave): like /runner, the locale selector
  // falls back to the zh homepage, with no zh hreflang advertised.
  ghSubstitutions += renderS1Page({ filename: 'check.html', outPath: '/check.html', navActive: 'submit', pageClass: 'check landing' });
  ghSubstitutions += renderS1Page({ filename: 'judge.html', outPath: '/judge.html', navActive: 'submit', pageClass: 'judge landing' });

  // Simplified Chinese discovery layer. Source-language evidence stays verbatim and clearly labelled.
  ghSubstitutions += renderS1Page({ filename: 'zh/index.html', outPath: '/zh/index.html', canonicalPath: '/zh/', navActive: 'docket', jsonld: 'home', locale: 'zh', pageClass: 'home landing', alternatePath: '/' });
  ghSubstitutions += renderS1Page({ filename: 'zh/method.html', outPath: '/zh/method.html', navActive: 'method', locale: 'zh', pageClass: 'method landing', alternatePath: '/method' });
  ghSubstitutions += renderS1Page({ filename: 'zh/submit.html', outPath: '/zh/submit.html', navActive: 'submit', locale: 'zh', pageClass: 'submit landing', alternatePath: '/submit' });
  ghSubstitutions += renderS1Page({ filename: 'zh/transparency.html', outPath: '/zh/transparency.html', navActive: 'transparency', locale: 'zh', pageClass: 'transparency landing', alternatePath: '/transparency' });
  ghSubstitutions += renderS1Page({ filename: 'zh/about.html', outPath: '/zh/about.html', navActive: '', locale: 'zh', pageClass: 'about landing', alternatePath: '/about' });
  ghSubstitutions += renderS1Page({ filename: 'zh/rulings/index.html', outPath: '/zh/rulings/index.html', navActive: 'rulings', locale: 'zh', pageClass: 'rulings landing', alternatePath: '/rulings/' });
  for (const id of ['001', '002', '003', '004']) {
    ghSubstitutions += renderS1Page({ filename: `zh/rulings/rd-2026-${id}.html`, outPath: `/zh/rulings/rd-2026-${id}.html`, navActive: 'rulings', locale: 'zh', pageClass: 'ruling-summary landing', alternatePath: `/rulings/rd-2026-${id}` });
  }
  ghSubstitutions += renderS1Page({ filename: 'zh/rules/index.html', outPath: '/zh/rules/index.html', navActive: 'method', locale: 'zh', pageClass: 'library landing', alternatePath: '/rules/' });
  ghSubstitutions += renderS1Page({ filename: 'zh/essays/index.html', outPath: '/zh/essays/index.html', navActive: 'method', locale: 'zh', pageClass: 'library landing', alternatePath: '/essays/' });
  renderZhRuleSummaries();
  renderZhVerificationEssay();
  renderZhGlossary();
  renderGlossaryTermPages('zh', termInstances);

  render404();

  const urlCount = writeSitemap();
  writeRobots();
  writeRedirects();
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
