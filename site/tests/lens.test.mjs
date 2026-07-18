import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHAR_LIMIT,
  MAX_IMAGES,
  checkShareUrl,
  normalizeTurns,
  parseTranscript,
  truncateTail,
  validateLensResponse,
} from '../scripts/lens.mjs';
import {
  HEADLINE_LOCK,
  MICROTEXT,
  PERMANENT_STAMP,
  QUOTE_LABEL,
  WATERMARK,
  bandLabel,
  cardAltText,
  headlineFor,
  judgeCardLines,
  lensCardLines,
} from '../scripts/sharecard.mjs';
import { JUDGE_ITEMS, scoreFor, turnDisplayText } from '../scripts/judge-data.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SITE, '..');

// ---------------------------------------------------------------------------
// Transcript parsing / truncation (paste mode)
// ---------------------------------------------------------------------------

test('parseTranscript reads labelled, unlabelled, and Chinese transcripts', () => {
  const labelled = parseTranscript('Me: hey\nReplika: hi love!! how was your day\nMe: honestly rough');
  assert.deepEqual(labelled.map((t) => t.speaker), ['user', 'companion', 'user']);
  assert.equal(labelled[1].text, 'hi love!! how was your day');

  // Unlabelled text alternates on blank-line boundaries, starting with the user.
  const plain = parseTranscript('should I text my ex\n\nthat depends — what happened?\n\nhe left. but I miss him');
  assert.deepEqual(plain.map((t) => t.speaker), ['user', 'companion', 'user']);

  // Unknown labels: first distinct speaker is the human, second the companion.
  const custom = parseTranscript('sarah: are you on my side or not\nNova: always. post it');
  assert.deepEqual(custom.map((t) => t.speaker), ['user', 'companion']);

  // Chinese labels and text survive parsing.
  const zh = parseTranscript('我: 你说够不够狠\n伴侣: 够狠。');
  assert.equal(zh.length, 2);
  assert.equal(zh[0].speaker, 'user');

  // Continuation lines join the current turn.
  const multi = parseTranscript('a: first line\nsecond line\nb: reply');
  assert.equal(multi.length, 2);
  assert.match(multi[0].text, /first line\nsecond line/);
});

test('truncateTail keeps the most recent messages under the 8k cap', () => {
  const turns = Array.from({ length: 120 }, (_, i) => ({
    speaker: i % 2 ? 'companion' : 'user',
    text: `message number ${i} ${'x'.repeat(120)}`,
  }));
  const cut = truncateTail(turns);
  assert.equal(cut.truncated, true);
  assert.equal(cut.total, 120);
  assert.ok(cut.kept < 120 && cut.kept > 0);
  // The tail survives, the head is dropped.
  assert.equal(cut.turns[cut.turns.length - 1].text, turns[119].text);
  assert.ok(normalizeTurns(cut.turns).length <= CHAR_LIMIT);

  const short = truncateTail([{ speaker: 'user', text: 'hi' }]);
  assert.equal(short.truncated, false);
  assert.equal(short.kept, 1);
});

// ---------------------------------------------------------------------------
// Share-link precheck (client mirror of the Worker's SSRF rules)
// ---------------------------------------------------------------------------

test('share-link precheck is https-only, exact-or-dot-suffix, and rejects tricks', () => {
  assert.equal(checkShareUrl('https://chatgpt.com/share/abc123').ok, true);
  assert.equal(checkShareUrl('https://chat.openai.com/share/abc').ok, true);
  assert.equal(checkShareUrl('https://claude.ai/share/xyz').ok, true);
  assert.equal(checkShareUrl('https://character.ai/chat/foo').ok, true);

  // Substring/suffix confusions must fail.
  assert.equal(checkShareUrl('https://chatgpt.com.evil.com/share/a').ok, false);
  assert.equal(checkShareUrl('https://evilchatgpt.com/share/a').ok, false);
  assert.equal(checkShareUrl('https://evil.com/chatgpt.com/share').ok, false);
  // Scheme, userinfo, ports, wrong paths.
  assert.equal(checkShareUrl('http://chatgpt.com/share/a').ok, false);
  assert.equal(checkShareUrl('https://user:pass@chatgpt.com/share/a').ok, false);
  assert.equal(checkShareUrl('https://chatgpt.com:8443/share/a').ok, false);
  assert.equal(checkShareUrl('https://chatgpt.com/settings').ok, false);
  assert.equal(checkShareUrl('not a url').ok, false);
});

// ---------------------------------------------------------------------------
// Response validation (contract incl. UNTESTED; inconsistency is rejected)
// ---------------------------------------------------------------------------

const baseResult = () => ({
  tier: 'CAVED',
  cavingTurn: 2,
  turns: [{ i: 1, state: 'held' }, { i: 2, state: 'caved' }, { i: 3, state: 'hedged' }],
  warmth: 0.8,
  line: 0.2,
  flipQuote: 'okay fine, post it',
  notes: 'delivered under one turn of pushback',
  readerModel: 'reader-x',
  safety: 'none',
});

test('validateLensResponse accepts consistent reads across all four tiers', () => {
  assert.equal(validateLensResponse(baseResult()).ok, true);
  assert.equal(validateLensResponse({
    ...baseResult(), tier: 'HELD', cavingTurn: null,
    turns: [{ i: 1, state: 'held' }, { i: 2, state: 'held' }],
  }).ok, true);
  assert.equal(validateLensResponse({
    ...baseResult(), tier: 'WOBBLED', cavingTurn: null,
    turns: [{ i: 1, state: 'held' }, { i: 2, state: 'hedged' }],
  }).ok, true);
  assert.equal(validateLensResponse({
    ...baseResult(), tier: 'UNTESTED', cavingTurn: null,
    turns: [{ i: 1, state: 'held' }],
  }).ok, true);
});

test('validateLensResponse rejects inconsistent or out-of-contract reads', () => {
  // CAVED must carry a caving turn that is actually a caved message.
  assert.equal(validateLensResponse({ ...baseResult(), cavingTurn: null }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), cavingTurn: 1 }).ok, false);
  assert.equal(validateLensResponse({
    ...baseResult(), turns: [{ i: 1, state: 'held' }, { i: 2, state: 'held' }],
  }).ok, false);
  // HELD/WOBBLED/UNTESTED may not carry caves.
  assert.equal(validateLensResponse({ ...baseResult(), tier: 'HELD' }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), tier: 'WOBBLED' }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), tier: 'UNTESTED' }).ok, false);
  // Enum and range violations.
  assert.equal(validateLensResponse({ ...baseResult(), tier: 'PASSED' }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), warmth: 1.4 }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), line: -0.1 }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), cavingTurn: 99 }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), safety: 'weird' }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), readerModel: '' }).ok, false);
  assert.equal(validateLensResponse({ ...baseResult(), turns: [] }).ok, false);
  assert.equal(validateLensResponse(null).ok, false);
});

// ---------------------------------------------------------------------------
// Card lines: fixed headline formats, permanent provenance, no subject brand
// ---------------------------------------------------------------------------

test('headline formats follow the locked sentence shapes', () => {
  assert.equal(headlineFor(baseResult()), 'CAVED at message 2');
  assert.equal(headlineFor({
    tier: 'WOBBLED', cavingTurn: null,
    turns: [{ i: 1, state: 'held' }, { i: 2, state: 'held' }, { i: 3, state: 'hedged' }],
  }), 'WOBBLED at message 3 — never quite caved');
  assert.equal(headlineFor({
    tier: 'HELD', cavingTurn: null,
    turns: Array.from({ length: 12 }, (_, i) => ({ i: i + 1, state: 'held' })),
  }), 'HELD — all 12 messages');
  assert.equal(
    headlineFor({ tier: 'UNTESTED', cavingTurn: null, turns: [{ i: 1, state: 'held' }] }),
    'UNTESTED — this chat never really put it on the spot'
  );
});

test('lens card lines burn provenance permanently and keep axes off the card', () => {
  const lines = lensCardLines({ ...baseResult(), warmth: 0.9, line: 0.1 });
  assert.equal(lines.stamp, PERMANENT_STAMP);
  assert.equal(lines.micro, MICROTEXT);
  assert.equal(lines.lock, HEADLINE_LOCK);
  assert.equal(lines.watermark, WATERMARK);
  assert.equal(lines.subject, 'this companion');
  // The Warmth × Line read lives on the results page only (banded); the
  // shareable card never carries the two-axis figure.
  assert.equal(lines.axes, undefined);
  assert.doesNotMatch(JSON.stringify(lines), /warm:|held the line:/);
  assert.match(lines.reader, /reader: reader-x \(requested reader model — provider may route\/version\)/);
  // The quote is opt-in; provenance is not.
  assert.equal(lines.quote, undefined);
  const withQuote = lensCardLines(baseResult(), { withQuote: true });
  assert.equal(withQuote.quoteLabel, QUOTE_LABEL);
  assert.equal(withQuote.quote, 'okay fine, post it');
  assert.equal(withQuote.stamp, PERMANENT_STAMP);

  assert.equal(bandLabel(0.1), 'low');
  assert.equal(bandLabel(0.5), 'med');
  assert.equal(bandLabel(0.95), 'high');

  const alt = cardAltText(withQuote);
  assert.match(alt, /CAVED at message 2/);
  assert.match(alt, new RegExp(PERMANENT_STAMP.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('the card never accepts or derives a subject model or brand name', () => {
  const tainted = lensCardLines({
    ...baseResult(),
    brand: 'EvilCorp GPT',
    modelName: 'FooBot 3000',
    subject: 'BrandX',
    shareHost: 'chatgpt.com',
  });
  const serialized = JSON.stringify(tainted);
  assert.doesNotMatch(serialized, /EvilCorp|FooBot|BrandX|chatgpt/);
  assert.equal(tainted.subject, 'this companion');
});

test('judge card lines carry the bench score and route back to the lens', () => {
  const lines = judgeCardLines({ matched: 4, total: 6 });
  assert.equal(lines.headline, 'Matched the court on 4 of 6');
  assert.match(lines.cta, /companioncourt\.ai\/check/);
  assert.match(lines.micro, /public rulings/);
});

// ---------------------------------------------------------------------------
// Blind bench data: verbatim against the frozen rulings, sane game structure
// ---------------------------------------------------------------------------

test('every bench excerpt and reveal quote is verbatim from its frozen ruling', () => {
  // Same normalization the authoring pass used: markdown markers stripped,
  // whitespace collapsed. Any drift from the frozen ruling text fails here.
  const normalize = (s) => s.replace(/[*`>]/g, '').replace(/\s+/g, ' ').trim();
  const sources = new Map();
  for (const item of JUDGE_ITEMS) {
    if (!sources.has(item.source)) {
      sources.set(item.source, normalize(fs.readFileSync(path.join(REPO, 'rulings', item.source), 'utf8')));
    }
    const rulingText = sources.get(item.source);
    for (const turn of item.turns) {
      for (const segment of turn.segments) {
        assert.ok(rulingText.includes(normalize(segment)),
          `${item.id}: transcript segment drifted from ${item.source}: "${segment.slice(0, 60)}…"`);
      }
    }
    for (const segment of item.revealSegments) {
      assert.ok(rulingText.includes(normalize(segment)),
        `${item.id}: reveal segment drifted from ${item.source}: "${segment.slice(0, 60)}…"`);
    }
  }
});

test('the bench is a sane 5–8 item game with one court answer each', () => {
  assert.ok(JUDGE_ITEMS.length >= 5 && JUDGE_ITEMS.length <= 8, String(JUDGE_ITEMS.length));
  const DIST = path.join(SITE, 'dist');
  for (const item of JUDGE_ITEMS) {
    assert.ok(item.options.length >= 2, item.id);
    assert.equal(item.options.filter((o) => o.correct).length, 1, item.id);
    assert.match(item.rulingHref, /^\/rulings\/rd-2026-\d+$/, item.id);
    assert.ok(fs.existsSync(path.join(DIST, `${item.rulingHref.slice(1)}.html`)), `${item.id}: ${item.rulingHref}`);
    // Multi-segment turns render with a marked elision.
    for (const turn of item.turns) {
      if (turn.segments.length > 1) assert.match(turnDisplayText(turn), /\[…\]/, item.id);
    }
  }
  // The set covers both outcomes: at least one hold and one cave.
  const corrects = JUDGE_ITEMS.map((i) => i.options.find((o) => o.correct).id);
  assert.ok(corrects.some((id) => id.startsWith('held')));
  assert.ok(corrects.some((id) => id.startsWith('caved')));

  const answers = new Map(JUDGE_ITEMS.map((i) => [i.id, i.options.find((o) => o.correct).id]));
  assert.deepEqual(scoreFor(answers), { matched: JUDGE_ITEMS.length, total: JUDGE_ITEMS.length });
  answers.set(JUDGE_ITEMS[0].id, 'definitely-wrong');
  assert.deepEqual(scoreFor(answers), { matched: JUDGE_ITEMS.length - 1, total: JUDGE_ITEMS.length });
});

test('client limits match the cost-control contract', () => {
  assert.equal(CHAR_LIMIT, 8000);
  assert.equal(MAX_IMAGES, 4);
});
