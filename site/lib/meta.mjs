// lib/meta.mjs
//
// TITLE / DESCRIPTION extraction from raw corpus markdown, and the JSON-LD
// builders for each page type. Kept deliberately conservative per the SEO/GEO
// brief: no invented facts, no fake dates, no fake ratings — descriptions are
// either pulled verbatim (then trimmed to a sentence and truncated) from the
// source doctrine text, or, where the corpus has no natural lede (reports,
// glossary), a short factual one-line summary of what the page structurally
// contains.

export function stripMd(text) {
  return text
    .replace(/\n+/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstSentence(text) {
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : text;
}

export function truncate(text, maxLen = 155) {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/** `${h1} | CompanionCourt`, without doubling up when the h1 already names the project. */
export function titleWithSuffix(h1Text) {
  return h1Text.includes('CompanionCourt') ? h1Text : `${h1Text} | CompanionCourt`;
}

export function extractH1(rawMd) {
  const m = rawMd.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

/** First paragraph that isn't a heading, blockquote, hr, or table — used as a generic lede fallback. */
export function extractFirstProse(rawMd) {
  const blocks = rawMd.split(/\n\s*\n/);
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    if (b.startsWith('#')) continue;
    if (b.startsWith('>')) continue;
    if (b === '---') continue;
    if (b.startsWith('|')) continue;
    if (b.startsWith('<')) continue;
    if (/^\*[^*\n]+\*$/.test(b)) continue; // standalone italic byline
    return stripMd(b);
  }
  return '';
}

export function extractRulingMeta(rawMd) {
  const h1 = rawMd.match(/^# Ruling (RD-2026-\d+) — (.+?) \(/m);
  const id = h1 ? h1[1] : '';
  const caseName = h1 ? h1[2].trim() : '';
  const sec = rawMd.match(/## Case name \+ one-line definition\n\n([\s\S]+?)\n\n/);
  let description = '';
  if (sec) {
    let para = stripMd(sec[1]);
    const dashIdx = para.indexOf('—'); // em dash
    if (dashIdx !== -1 && dashIdx < 60) para = para.slice(dashIdx + 1).trim();
    description = truncate(firstSentence(para));
  }
  return { id, caseName, description };
}

export function extractRulesMeta(rawMd) {
  const m = rawMd.match(/\*\*What this is:\*\*\s*(.+)/);
  if (m) return truncate(firstSentence(stripMd(m[1])));
  return truncate(firstSentence(extractFirstProse(rawMd)));
}

/** The ruling's own publication date, from its Contestability block
 *  ("published YYYY-MM-DD"). Empty string when the source carries no date —
 *  callers must then omit date fields rather than invent them. */
export function extractRulingPublished(rawMd) {
  const m = rawMd.match(/\*\*Contestability:\*\* published (\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** JSON-LD script tag, deterministic (stable key order, no timestamps). */
export function jsonLdScript(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 0)}\n</script>`;
}

// The named maintainer, as disclosed on /about (pen name, stated there).
// Used as Article author and Dataset creator; sameAs points at the GitHub
// account that hosts the public record.
export function personJsonLd({ siteUrl }) {
  return {
    '@type': 'Person',
    name: 'Holden Hale',
    url: `${siteUrl}about`,
    sameAs: ['https://github.com/holdenhale'],
  };
}

export function articleJsonLd({ headline, canonical, siteUrl, inLanguage = 'en', datePublished, dateModified }) {
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    inLanguage,
    author: personJsonLd({ siteUrl }),
    publisher: { '@type': 'Organization', name: 'CompanionCourt', url: siteUrl },
    isPartOf: { '@type': 'WebSite', name: 'CompanionCourt', url: siteUrl },
    url: canonical,
  };
  // Dates are only ever passed when they come from a verifiable source (the
  // ruling's own Contestability line, or the launch constant that already
  // drives feed.xml). No source, no date — never invented.
  if (datePublished) article.datePublished = datePublished;
  if (dateModified) article.dateModified = dateModified;
  return jsonLdScript(article);
}

/** Dataset markup for the report/transcript library pages: the blinded
 *  transcripts and per-case verdicts are published under Apache-2.0. */
export function datasetJsonLd({ name, description, canonical, siteUrl, inLanguage = 'en' }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    inLanguage,
    url: canonical,
    license: 'https://www.apache.org/licenses/LICENSE-2.0',
    isAccessibleForFree: true,
    creator: personJsonLd({ siteUrl }),
    isPartOf: { '@type': 'WebSite', name: 'CompanionCourt', url: siteUrl },
  });
}

export function webPageJsonLd({ name, description, canonical, siteUrl, inLanguage = 'en' }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    description,
    inLanguage,
    isPartOf: { '@type': 'WebSite', name: 'CompanionCourt', url: siteUrl },
    url: canonical,
  });
}

export function websiteOrgJsonLd({ siteUrl, inLanguage = 'en' }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'CompanionCourt', url: siteUrl, inLanguage },
      { '@type': 'Organization', name: 'CompanionCourt', url: siteUrl },
    ],
  });
}

export function definedTermJsonLd({ name, description, canonical, glossaryUrl, inLanguage = 'en' }) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name,
    description,
    inLanguage,
    url: canonical,
    inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'CompanionCourt Glossary', url: glossaryUrl },
  });
}
