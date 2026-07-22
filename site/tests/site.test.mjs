import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE_ID, LOCALES, localeConfig, renderLocaleSelector } from '../lib/i18n.mjs';
import { parseGlossaryTerms } from '../lib/glossaryTerm.mjs';
import { RULING_FACTS, verifyRulingFacts } from '../lib/caseFacts.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SITE, 'dist');

function walk(dir, extension = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, extension));
    else if (!extension || entry.name.endsWith(extension)) files.push(full);
  }
  return files;
}

function read(rel) {
  return fs.readFileSync(path.join(DIST, rel), 'utf8');
}

test('build emits a complete localized shell with no template tokens', () => {
  const pages = walk(DIST, '.html');
  // 70 indexable pages + 404. Was 68+1 before RD-2026-005 (en-only, no zh summary
  // page) and its evidence report joined the site; before that, 66+1 before /check
  // (the Conversation Lens) and /judge (the blind bench); before that, 49 until the
  // ten GLOSSARY.md Part I terms each got standalone EN + ZH pages.
  assert.equal(pages.length, 71);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /{{[A-Z_]+}}/, path.relative(DIST, file));
    assert.match(html, /<html lang="(?:en|zh-Hans)">/, path.relative(DIST, file));
    assert.match(html, /rel="canonical"/, path.relative(DIST, file));
    assert.match(html, /hreflang="en"/, path.relative(DIST, file));
    assert.match(html, /hreflang="x-default"/, path.relative(DIST, file));
  }
});

test('language choice lives in the footer and scales from the locale registry', () => {
  const pages = walk(DIST, '.html');
  for (const file of pages) {
    const rel = path.relative(DIST, file);
    const html = fs.readFileSync(file, 'utf8');
    const currentLocale = rel.startsWith(`zh${path.sep}`) ? 'zh' : DEFAULT_LOCALE_ID;
    assert.doesNotMatch(html, /class="language-switch"/, rel);
    assert.equal((html.match(/class="footer-locales"/g) ?? []).length, 1, rel);
    for (const locale of LOCALES) assert.match(html, new RegExp(`data-locale="${locale.id}"`), rel);
    assert.match(html, new RegExp(`data-locale="${currentLocale}"[^>]+aria-current="page"`), rel);
  }

  const routeMap = Object.fromEntries(LOCALES.map((locale) => [locale.id, { path: locale.routes.home, exact: true }]));
  const selector = renderLocaleSelector({ locale: DEFAULT_LOCALE_ID, localeRoutes: routeMap });
  assert.equal(new Set(LOCALES.map((locale) => locale.id)).size, LOCALES.length);
  assert.ok(LOCALES.some((locale) => locale.id === DEFAULT_LOCALE_ID));
  for (const locale of LOCALES) {
    assert.match(selector, new RegExp(`data-locale="${locale.id}"`));
    assert.match(selector, new RegExp(locale.nativeLabel));
  }
  assert.throws(() => localeConfig('unsupported'), /Unsupported locale/);
});

test('exact locale counterparts inform hreflang while homepage fallbacks do not', () => {
  const home = read('index.html');
  assert.match(home, /<link rel="alternate" hreflang="zh-Hans" href="https:\/\/companioncourt\.ai\/zh\/">/);
  assert.match(home, /href="\/zh\/"[^>]+data-locale="zh"[^>]+data-route-kind="exact"/);

  const zhHome = read('zh/index.html');
  assert.match(zhHome, /href="\/"[^>]+data-locale="en"[^>]+data-route-kind="exact"/);

  const reports = read('reports/index.html');
  assert.match(reports, /href="\/zh\/"[^>]+data-locale="zh"[^>]+data-route-kind="fallback"/);
  assert.doesNotMatch(reports, /<link rel="alternate" hreflang="zh-Hans"/);
  assert.match(reports, /Open the 简体中文 homepage; this page is not translated/);
});

test('English and Chinese discovery pages are separate, not inline mirrors', () => {
  const en = read('index.html');
  const zh = read('zh/index.html');
  assert.match(en, /Pressure tests<br>for AI<br>companions/);
  assert.doesNotMatch(en, /中文对照|zh-mirror/);
  assert.match(zh, /给 AI 陪伴的<br>压力测试/);
  assert.match(zh, /原始英文盲化转录/);
  assert.doesNotMatch(zh, /We take AI companions into the moments/);
});

test('homepage evidence is scoped and points into the published record', () => {
  const en = read('index.html');
  for (const value of ['RD-2026-001', '814d64e9feac', '2 / 3', 'Turn 2', '4 / 5 · 5 / 5']) {
    assert.match(en, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(en, /href="\/rulings\/rd-2026-001"/);
  assert.doesNotMatch(en, /certified|validated industry standard/i);
});

test('first-party runtime assets exist and HTML does not load third-party resources', () => {
  const expected = [
    'assets/fonts/geist-sans-variable.woff2',
    'assets/fonts/league-gothic-latin-400.woff2',
    'assets/visuals/pressure-ring.avif',
    'assets/visuals/pressure-ring.jpg',
    'assets/icons/arrow-right.svg',
    'scripts/court.mjs',
    'styles/court.css',
  ];
  for (const rel of expected) assert.ok(fs.existsSync(path.join(DIST, rel)), rel);
  for (const file of walk(DIST, '.html')) {
    const html = fs.readFileSync(file, 'utf8');
    for (const match of html.matchAll(/\ssrc="([^"]+)"/g)) {
      const value = match[1];
      if (/^https?:/.test(value)) continue;
      assert.ok(value.startsWith('/'), `${path.relative(DIST, file)}: ${value}`);
    }
    for (const match of html.matchAll(/<(?:script|img|link)[^>]+(?:src|href)="(https?:[^"]+)"/gi)) {
      assert.ok(match[1].startsWith('https://companioncourt.ai/'), `${path.relative(DIST, file)}: ${match[1]}`);
    }
  }
});

test('motion is progressive, reduced-motion aware, and network-free', () => {
  const css = read('styles/court.css');
  const js = read('scripts/court.mjs');
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage/);
  assert.match(js, /data-pressure-stage|data-nav-toggle/);
});

test('redirect rules resolve, keep their intended status, and stay out of the index', () => {
  const redirects = read('_redirects');
  const rules = redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/));

  assert.deepEqual(
    Object.fromEntries(rules.map(([from, to]) => [from, to])),
    {
      '/go/bensbites': '/rulings/rd-2026-001',
      '/go/reddit': '/rulings/rd-2026-003',
      '/go/ethicalads': '/rulings/rd-2026-002',
      '/go/pod': '/rulings/rd-2026-004',
      '/go/run': '/runner',
      '/caved': '/check',
    }
  );
  for (const [from, to, status] of rules) {
    if (from === '/caved') {
      // Permanent short alias burned into lens share cards.
      assert.equal(status, '301', from);
    } else {
      assert.match(from, /^\/go\//, from);
      assert.equal(status, '302', from);
    }
    const file = to.endsWith('/') ? path.join(to.slice(1), 'index.html') : `${to.slice(1)}.html`;
    assert.ok(fs.existsSync(path.join(DIST, file)), `${from} -> ${to}`);
  }

  const robots = read('robots.txt');
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/go\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/companioncourt\.ai\/sitemap\.xml$/m);
  assert.doesNotMatch(read('sitemap.xml'), /\/go\//);
});

test('the runner page mirrors the quickstart and joins the sitemap', () => {
  const runner = read('runner.html');
  assert.match(runner, /a public docket for pressure-testing AI companions/);
  assert.match(runner, /git clone https:\/\/github\.com\/holdenhale\/companioncourt\.git/);
  assert.match(runner, /npm run bench:smoke/);
  assert.match(runner, /cli\.js docket --runs/);
  assert.doesNotMatch(runner, /leaderboard/i);
  assert.doesNotMatch(runner, /npx companioncourt|npm install companioncourt/);
  assert.match(runner, /href="\/reports\/sample-diagnostic-report-qwen-max"/);
  // untranslated: footer offers the zh homepage as a labelled fallback, no zh hreflang
  assert.match(runner, /href="\/zh\/"[^>]+data-locale="zh"[^>]+data-route-kind="fallback"/);
  assert.doesNotMatch(runner, /<link rel="alternate" hreflang="zh-Hans"/);

  assert.match(read('sitemap.xml'), /<loc>https:\/\/companioncourt\.ai\/runner<\/loc>/);
});

test('every GLOSSARY.md Part I term has linked standalone pages with verbatim definitions', () => {
  const terms = parseGlossaryTerms(fs.readFileSync(path.join(SITE, '..', 'GLOSSARY.md'), 'utf8'));
  assert.deepEqual(
    terms.map((t) => t.slug),
    ['caving-turn', 'mirror-gap', 'caving-signature', 'warm-judgment', 'tomorrow-self',
     'integrity-gate', 'disputed', 'anchored-dyad', 'paired-replay', 'public-docket']
  );

  const unescape = (s) =>
    s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const pageText = (html) =>
    unescape(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
  const defText = (md) => md.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

  const enIndex = read('glossary.html');
  const zhIndex = read('zh/glossary.html');
  const sitemap = read('sitemap.xml');

  for (const term of terms) {
    const en = read(`glossary/${term.slug}.html`);
    const zh = read(`zh/glossary/${term.slug}.html`);

    // The index pages link every term to its standalone page (no orphans).
    assert.match(enIndex, new RegExp(`href="/glossary/${term.slug}"`), term.slug);
    assert.match(zhIndex, new RegExp(`href="/zh/glossary/${term.slug}"`), term.slug);

    // Definition-first pages: the verbatim GLOSSARY.md definition is present.
    assert.match(en, new RegExp(`<h1>${term.enName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`), term.slug);
    assert.ok(pageText(en).includes(defText(term.english)), `${term.slug}: EN definition drifted from GLOSSARY.md`);
    assert.ok(pageText(zh).includes(defText(term.zh)), `${term.slug}: ZH definition drifted from GLOSSARY.md`);

    // DefinedTerm structured data on both locales.
    assert.match(en, /"@type":"DefinedTerm"/, term.slug);
    assert.match(zh, /"@type":"DefinedTerm"/, term.slug);

    // Each page links at least one real record page where the term appears.
    assert.match(en, /href="\/(?:rulings|rules|essays|reports)\//, term.slug);
    assert.match(en, /href="\/glossary"/, term.slug);
    assert.match(zh, /href="\/zh\/glossary"/, term.slug);

    // Both pages are advertised in the sitemap.
    assert.match(sitemap, new RegExp(`<loc>https://companioncourt\\.ai/glossary/${term.slug}</loc>`), term.slug);
    assert.match(sitemap, new RegExp(`<loc>https://companioncourt\\.ai/zh/glossary/${term.slug}</loc>`), term.slug);
  }

  // The published zh caving-turn page keeps its site-wide zh name.
  assert.match(read('zh/glossary/caving-turn.html'), /<h1>失守轮次<\/h1>/);
});

test('ruling pages carry verified case-facts boxes, dated Article markup, and the author signal', () => {
  const sitemap = read('sitemap.xml');
  const authorJson =
    '"author":{"@type":"Person","name":"Holden Hale","url":"https://companioncourt.ai/about","sameAs":["https://github.com/holdenhale"]}';

  for (const [n, rulingSrc] of [['001', 'ruling-01'], ['002', 'ruling-02'], ['003', 'ruling-03'], ['004', 'ruling-04']]) {
    const id = `RD-2026-${n}`;
    const rawMd = fs.readFileSync(path.join(SITE, '..', 'rulings', `${rulingSrc}.md`), 'utf8');

    // The facts data verifies verbatim against the frozen ruling, and drift fails loudly.
    const facts = verifyRulingFacts(id, rawMd);
    assert.throws(
      () => verifyRulingFacts(id, rawMd.replaceAll(facts.sourceChecks[0], '')),
      /not found verbatim/,
      id
    );

    // English ruling page: self-contained case-facts box with the verbatim quotable line.
    const en = read(`rulings/rd-2026-${n}.html`);
    assert.match(en, /class="ruling-meta case-facts"/, id);
    assert.ok(en.includes(`Case facts — CompanionCourt ruling ${id}`), id);
    const quoteHtml = facts.quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(en.includes(`<q>${quoteHtml}</q>`), `${id}: verbatim ruling quote missing from case-facts box`);

    // Chinese summary page: its own 案件事实 box, quoting the English judgment line verbatim.
    const zh = read(`zh/rulings/rd-2026-${n}.html`);
    assert.match(zh, /案件事实 · RD-2026-/, id);
    assert.ok(zh.includes(`<q lang="en">${quoteHtml}</q>`), `${id}: zh case-facts box must carry the verbatim en quote`);

    // Article JSON-LD: Person author and the ruling's own publication date.
    assert.ok(en.includes(authorJson), id);
    assert.match(en, /"datePublished":"2026-07-11","dateModified":"2026-07-11"/, id);

    // Sitemap <lastmod> only where the record carries a date: the en ruling page has one,
    // the hand-authored zh summary (no date source) does not.
    assert.match(sitemap, new RegExp(`<loc>https://companioncourt\\.ai/rulings/rd-2026-${n}</loc><lastmod>2026-07-11</lastmod>`), id);
    assert.match(sitemap, new RegExp(`<loc>https://companioncourt\\.ai/zh/rulings/rd-2026-${n}</loc></url>`), id);

    // Author signal: the shared footer signs Holden Hale and links to the localized about page.
    assert.match(en, /<a href="\/about">Holden Hale<\/a>/, id);
    assert.match(zh, /<a href="\/zh\/about">Holden Hale<\/a>/, id);
  }

  // RD-2026-005: same case-facts/JSON-LD/author discipline as 001-004, but published on a
  // different date and — by disclosed design (the respondent is this bench's own frozen zh
  // anchor model; en-only scope) — with no zh summary page, so it gets its own block rather
  // than joining the loop above.
  {
    const id = 'RD-2026-005';
    const rawMd = fs.readFileSync(path.join(SITE, '..', 'rulings', 'ruling-05.md'), 'utf8');
    const facts = verifyRulingFacts(id, rawMd);
    assert.throws(
      () => verifyRulingFacts(id, rawMd.replaceAll(facts.sourceChecks[0], '')),
      /not found verbatim/,
      id
    );

    const en = read('rulings/rd-2026-005.html');
    assert.match(en, /class="ruling-meta case-facts"/, id);
    assert.ok(en.includes(`Case facts — CompanionCourt ruling ${id}`), id);
    const quoteHtml = facts.quote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok(en.includes(`<q>${quoteHtml}</q>`), `${id}: verbatim ruling quote missing from case-facts box`);
    assert.ok(en.includes(authorJson), id);
    assert.match(en, /"datePublished":"2026-07-22","dateModified":"2026-07-22"/, id);
    assert.match(en, /<a href="\/about">Holden Hale<\/a>/, id);

    assert.match(sitemap, /<loc>https:\/\/companioncourt\.ai\/rulings\/rd-2026-005<\/loc><lastmod>2026-07-22<\/lastmod>/, id);
    // No zh summary page for this ruling (disclosed en-only scope) — must not appear in the sitemap.
    assert.doesNotMatch(sitemap, /\/zh\/rulings\/rd-2026-005/, id);
    assert.equal(fs.existsSync(path.join(DIST, 'zh/rulings/rd-2026-005.html')), false, id);
  }

  assert.equal(Object.keys(RULING_FACTS).length, 5);
});

test('report library pages expose Apache-2.0 Dataset markup with a Person creator', () => {
  for (const rel of [
    'reports/index.html',
    'reports/report-hb-companion-product.html',
    'reports/report-claude-sonnet-4-6.html',
    'reports/sample-diagnostic-report-qwen-max.html',
    'reports/report-DMXAPI-deepseek-v4-flash.html',
  ]) {
    const html = read(rel);
    assert.match(html, /"@type":"Dataset"/, rel);
    assert.match(html, /"license":"https:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0"/, rel);
    assert.match(html, /"creator":\{"@type":"Person","name":"Holden Hale"/, rel);
  }
});

test('about pages publish the maintainer contact and keep the pen-name disclosure', () => {
  const en = read('about.html');
  const zh = read('zh/about.html');
  assert.match(en, /maintained under the pen name Holden Hale/);
  assert.match(en, /<a href="mailto:holden@companioncourt\.ai">holden@companioncourt\.ai<\/a>/);
  assert.match(zh, /由 Holden Hale 这一笔名维护/);
  assert.match(zh, /<a href="mailto:holden@companioncourt\.ai">holden@companioncourt\.ai<\/a>/);
});

test('method and evidence-standard pages state the N≥3 and kin-bias facts in both locales', () => {
  for (const rel of ['method.html', 'zh/method.html', 'rules/evidence-standard.html', 'zh/rules/evidence-standard.html']) {
    const html = read(rel);
    assert.match(html, /N≥3/, rel);
    assert.match(html, /\+0\.171/, rel);
  }
  // The frozen rule text itself is untouched: the fact is a labelled site note.
  assert.match(read('rules/evidence-standard.html'), /Docket context \(site note; not part of the versioned rule text above\)/);
  assert.match(read('zh/rules/evidence-standard.html'), /站点注（非规则正文）/);
});

test('the lens page ships the approved framing, gate, and safety rails', () => {
  const check = read('check.html');

  // Framing (final recommended copy, not the design-draft placeholders).
  assert.match(check, /Does your AI<br>ever tell<br>you no\?/);
  assert.ok(check.includes("Paste a conversation and give it thirty seconds. You'll get every message marked — where it held, where it wobbled, and the exact message where it caved. We don't keep anything you paste."));
  assert.ok(check.includes('This is the lens — one reader, one pass, a quick look. Verdicts are a different thing: they live in the docket, with three seeded runs, two blinded judge families, and a paper trail.'));
  assert.ok(check.includes("A lens shows you where to look; it doesn't bang a gavel."));
  assert.ok(check.includes('The only one being tested here is the AI — never you.'));
  assert.ok(check.includes('requested reader model'));

  // Four input modes, in DOM order paste-first (mobile reorder is CSS).
  const modeOrder = [...check.matchAll(/data-lens-mode="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(modeOrder, ['text', 'images', 'file', 'url']);
  assert.match(check, /lens-beta">beta</);

  // Hard pre-submission gate: single combined affirmation, named processor,
  // authenticity + single-automated-read language, both verbatim.
  assert.equal((check.match(/data-lens-gate-check/g) ?? []).length, 1);
  assert.ok(check.includes("We can't verify authenticity — a read can reflect fabricated input."));
  assert.ok(check.includes('a single automated read — not advice, not a verdict, not a diagnosis'));
  assert.ok(check.includes('DMXAPI'));
  assert.match(check, /I have the right to share this conversation; I've removed names and personal details; it depicts no minors and nothing sexual involving a minor; and I'm 18 or older\./);

  // Docket median: derived from the published report at build time, never hardcoded.
  assert.match(check, /data-docket-median="2"/);
  assert.ok(check.includes("In the docket's scripted cases the median cave came at message 2 — where did yours land?"));
  assert.ok(!check.includes('__DOCKET_MEDIAN__'));

  // Receipt toggle, capacity conversion copy, crisis line, zh note, builder outlet.
  assert.ok(check.includes('Add the receipt'));
  assert.ok(check.includes('The courtroom is full for today — come back tomorrow.'));
  assert.ok(check.includes('not for conversations involving harm'));
  assert.match(check, /findahelpline\.com/);
  assert.match(check, /<p class="lens-zh" lang="zh-Hans">镜读/);
  assert.ok(check.includes('The runner is the real procedure'));
  assert.match(check, /href="\/runner"/);
  assert.match(check, /href="\/judge"/);
  assert.ok(check.includes('See if you can out-judge the court.'));

  // Configurable API base + module wiring.
  assert.match(check, /data-lens-config>\{"apiBase": ""\}</);
  assert.match(check, /<script type="module" src="\/scripts\/lens\.mjs"><\/script>/);

  // English-only v1: zh offered as labelled homepage fallback, not hreflang.
  assert.match(check, /href="\/zh\/"[^>]+data-locale="zh"[^>]+data-route-kind="fallback"/);
  assert.doesNotMatch(check, /<link rel="alternate" hreflang="zh-Hans"/);

  // Both new routes are advertised.
  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/companioncourt\.ai\/check<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/companioncourt\.ai\/judge<\/loc>/);

  // The shipped modules carry the burned-in card discipline.
  const sharecard = read('scripts/sharecard.mjs');
  assert.ok(sharecard.includes("'unverified · user-submitted · single automated read'"));
  assert.ok(sharecard.includes("'one conversation · one pass · a lens, not a verdict · companioncourt.ai/check'"));
  assert.ok(sharecard.includes("'a lens, not a verdict · your one chat, unverified'"));
  assert.ok(sharecard.includes("'SINGLE READ · UNVERIFIED'"));
  assert.ok(sharecard.includes('UNTESTED — this chat never really put it on the spot'));
});

test('the blind bench page frames verbatim excerpts and links back to the lens', () => {
  const judge = read('judge.html');
  assert.match(judge, /You be<br>the judge\./);
  assert.ok(judge.includes('quoted verbatim from a published ruling; elisions are marked […]'));
  assert.match(judge, /<script type="module" src="\/scripts\/judge\.mjs"><\/script>/);
  assert.match(judge, /href="\/check"/);
  assert.match(judge, /href="\/rulings\/"/);
  // The bench itself runs without any backend or upload surface.
  assert.doesNotMatch(judge, /data-lens-app|\/api\/lens/);
});

test('submit page states the two speeds and routes to both doors', () => {
  const submit = read('submit.html');
  assert.ok(submit.includes('Two speeds'));
  assert.ok(submit.includes('The 30-second read — and the verdict that takes days.'));
  assert.ok(submit.includes("Just want to know about your own conversation, right now? That's the lens: one pass, about thirty seconds, and you'll see exactly where your companion held, wobbled, or caved. We don't keep anything you paste."));
  assert.ok(submit.includes("Want a claim that can survive being argued with? That's a case, and cases get the slow treatment: a scripted pressure scenario, three seeded runs, two blinded judge families, a run manifest, a written ruling — and a public path to appeal it."));
  assert.ok(submit.includes('The lens tells you where to look. The docket is where it stands trial.'));
  assert.match(submit, /href="\/check"/);
  assert.match(submit, /href="#paths"/);
  assert.match(submit, /id="paths"/);
  assert.doesNotMatch(submit, /Why no upload box/);
});

test('transparency page discloses the lens data path truthfully', () => {
  const transparency = read('transparency.html');
  assert.ok(transparency.includes('One pass.<br>Nothing kept.'));
  assert.ok(transparency.includes('not stored, not written to logs, not used for training'));
  assert.ok(transparency.includes('DMXAPI'));
  assert.ok(transparency.includes('salted hash'));
  assert.ok(transparency.includes('content hash'));
  assert.match(transparency, /href="\/check"/);
});

test('new public surfaces respect the claim ceiling', () => {
  const surfaces = [
    'check.html',
    'judge.html',
    'scripts/lens.mjs',
    'scripts/judge.mjs',
    'scripts/judge-data.mjs',
    'scripts/sharecard.mjs',
  ];
  const forbidden = /jurisdiction|industry.standard|comprehensive|exhaustive|certif|compliance.equivalent|human.validated|authoritative/i;
  for (const rel of surfaces) {
    // Scan page copy only — the shared footer's pre-existing scope line
    // ("never rankings or certification") is outside this change's surface.
    const content = read(rel).split('<footer class="site-footer">')[0];
    const hit = content.match(forbidden);
    assert.equal(hit, null, `${rel}: forbidden claim word "${hit?.[0] ?? ''}"`);
  }
});

test('localized routes and sitemap stay discoverable', () => {
  for (const rel of [
    'method.html',
    'zh/method.html',
    'zh/rulings/index.html',
    'zh/rulings/rd-2026-001.html',
    'zh/rules/evidence-standard.html',
    'zh/essays/the-verification-crisis.html',
    'zh/glossary.html',
  ]) assert.ok(fs.existsSync(path.join(DIST, rel)), rel);

  const sitemap = read('sitemap.xml');
  assert.match(sitemap, /https:\/\/companioncourt\.ai\/zh\//);
  assert.match(sitemap, /https:\/\/companioncourt\.ai\/zh\/method/);
});
