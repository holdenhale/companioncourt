import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  assert.equal(pages.length, 48);
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(html, /{{[A-Z_]+}}/, path.relative(DIST, file));
    assert.match(html, /<html lang="(?:en|zh-Hans)">/, path.relative(DIST, file));
    assert.match(html, /rel="canonical"/, path.relative(DIST, file));
    assert.match(html, /hreflang="en"/, path.relative(DIST, file));
    assert.match(html, /hreflang="zh-Hans"/, path.relative(DIST, file));
    assert.match(html, /hreflang="x-default"/, path.relative(DIST, file));
  }
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
