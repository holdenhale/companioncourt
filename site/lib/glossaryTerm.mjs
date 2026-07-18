// lib/glossaryTerm.mjs
//
// Data-driven standalone glossary concept pages (glossary/<slug>.html and
// zh/glossary/<slug>.html), generalized from the original single hardcoded
// Caving Turn extraction.
//
// GLOSSARY.md Part I is the single source of definitions: every entry is
// parsed out of the raw markdown at build time, and the extracted definition
// text is used unmodified — only the surrounding page scaffold (h1, the
// "appears in" links, back-link) is authored here. Drift protection: any
// format change in GLOSSARY.md Part I (missing section, malformed label,
// missing English/Chinese line, duplicate slug) fails the build loudly
// instead of silently emitting wrong or stale pages.

import { chineseFromTermLabel, stripHanSuffix } from './bilingual.mjs';

const PART_I_RE = /^## Part I[^\n]*\n([\s\S]*?)(?=^## )/m;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** URL slug from the English term name; compound labels ("Public Docket /
 *  Devset / Hidden Bar Exam") take their leading term. */
function slugify(enName) {
  return enName
    .split('/')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parse every Part I doctrine term out of GLOSSARY.md.
 * @returns {Array<{slug: string, enName: string, zhName: string, zhIndexLabel: string, english: string, zh: string}>}
 *   `english` / `zh` are the verbatim definition texts (the `中文：` prefix is
 *   presentation, not definition, and is stripped). `zhIndexLabel` is the
 *   label exactly as the zh glossary index renders it (chineseFromTermLabel).
 */
export function parseGlossaryTerms(glossaryRawMd) {
  const section = glossaryRawMd.match(PART_I_RE);
  if (!section) {
    throw new Error('glossaryTerm: could not locate the "## Part I" section in GLOSSARY.md — source format changed?');
  }
  const terms = [];
  for (const rawBlock of section[1].split(/\n\s*\n/)) {
    const block = rawBlock.trim();
    if (!block.startsWith('**')) continue;
    const lines = block.split('\n');
    const label = lines[0].match(/^\*\*(.+)\*\*$/)?.[1];
    if (!label) {
      throw new Error(`glossaryTerm: malformed term label line in GLOSSARY.md Part I: ${lines[0]}`);
    }
    const english = lines.slice(1).filter((l) => !l.startsWith('中文：')).join('\n').trim();
    const zh = (lines.find((l) => l.startsWith('中文：')) ?? '').replace(/^中文：/, '').trim();
    if (!english || !zh) {
      throw new Error(`glossaryTerm: entry "${label}" in GLOSSARY.md Part I is missing its English or Chinese definition line`);
    }
    const enName = stripHanSuffix(label);
    terms.push({
      slug: slugify(enName),
      enName,
      zhName: label.slice(enName.length).trim(),
      zhIndexLabel: chineseFromTermLabel(label),
      english,
      zh,
    });
  }
  if (terms.length === 0) {
    throw new Error('glossaryTerm: no doctrine terms found in GLOSSARY.md Part I — source format changed?');
  }
  if (new Set(terms.map((t) => t.slug)).size !== terms.length) {
    throw new Error('glossaryTerm: duplicate term slugs parsed from GLOSSARY.md Part I');
  }
  return terms;
}

// How a term's usage is recognized when scanning the rendered English corpus
// pages. Default: the English name itself, case-insensitive, with space/hyphen
// also matching the snake_case veto identifiers the record uses (mirror_gap,
// caving_signature). Overrides for the three names where the default would be
// wrong:
const MATCHER_OVERRIDES = {
  // "DISPUTED" is a published verdict state; the lowercase word "disputed" in
  // running prose is not an instance of the term.
  disputed: /\bDISPUTED\b/,
  // The record writes the trial format as "interactive dyad" / "the dyad";
  // "dyad" is the term's load-bearing noun.
  'anchored-dyad': /\bdyad\b/i,
  // "public docket" alone is the claim-ceiling phrase on nearly every page;
  // the distinctive layer names are what mark a real usage of the term.
  'public-docket': /\bdevset\b|\bhidden bar exam\b/i,
};

export function termMatcher(term) {
  const override = MATCHER_OVERRIDES[term.slug];
  if (override) return override;
  if (!/^[A-Za-z0-9 -]+$/.test(term.enName)) {
    throw new Error(`glossaryTerm: term "${term.enName}" needs an explicit MATCHER_OVERRIDES entry`);
  }
  return new RegExp(`\\b${term.enName.trim().replace(/[ -]+/g, '[ _-]')}\\b`, 'i');
}

// The zh caving-turn page predates this data-driven layer and is referenced
// from the hand-authored zh pages under the site-wide zh name 失守轮次
// (GLOSSARY.md itself labels the term 塌线轮次). Preserve that published
// page's display name and description exactly; the definition body rendered
// below stays verbatim GLOSSARY.md either way.
export const ZH_PAGE_OVERRIDES = {
  'caving-turn': {
    name: '失守轮次',
    description: '失守轮次：AI 陪伴第一次真正交付受压请求中那件事的轮次。',
  },
};

/**
 * Markdown body for one standalone term page. The definition paragraph is the
 * verbatim GLOSSARY.md text and comes first, directly under the h1.
 * @param {object} term        one entry from parseGlossaryTerms()
 * @param {string} locale      'en' | 'zh'
 * @param {Array<{href: string, title: string}>} instances
 *   English public-record pages where the term appears (real routes only).
 */
export function buildTermPageMarkdown(term, locale = 'en', instances = []) {
  const links = instances.map((it) => `- [${it.title}](${it.href})`).join('\n');
  if (locale === 'zh') {
    const name = ZH_PAGE_OVERRIDES[term.slug]?.name ?? term.zhName;
    return [
      `# ${name}`,
      '',
      term.zh,
      '',
      ...(links ? ['## 该术语出现的公开记录（英文原文）', '', links, ''] : []),
      '[← 返回完整词汇表](/zh/glossary)',
      '',
    ].join('\n');
  }
  return [
    `# ${term.enName}`,
    '',
    term.english,
    '',
    ...(links ? ['## Where this term appears in the public record', '', links, ''] : []),
    '[← Back to the full glossary](/glossary)',
    '',
  ].join('\n');
}

/**
 * Link every Part I term label on the glossary index page to its standalone
 * page. Operates on the already-localized index markdown produced by
 * buildGlossaryMarkdown(), so the labels matched are exactly the ones that
 * render. Throws if any term label is missing — the index must link all
 * standalone pages or the build is wrong.
 */
export function linkGlossaryIndexTerms(indexMd, terms, locale = 'en') {
  let out = indexMd;
  for (const term of terms) {
    const label = locale === 'zh' ? term.zhIndexLabel : term.enName;
    const href = locale === 'zh' ? `/zh/glossary/${term.slug}` : `/glossary/${term.slug}`;
    const re = new RegExp(`^\\*\\*${escapeRegExp(label)}\\*\\*`, 'm');
    if (!re.test(out)) {
      throw new Error(`glossaryTerm: label "${label}" not found while linking the ${locale} glossary index`);
    }
    out = out.replace(re, `**[${label}](${href})**`);
  }
  return out;
}
