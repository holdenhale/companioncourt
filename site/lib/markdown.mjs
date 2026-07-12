// lib/markdown.mjs
//
// Court-repo markdown -> HTML rendering.
//
// Strategy: marked (CommonMark/GFM) does the actual markdown -> HTML
// conversion untouched. All CompanionCourt-specific behavior (internal
// link rewriting, HTML-comment stripping, the transcript/ruling-meta
// wrapping, and the banner/contestability/sources/verdict-red CSS-class
// contract) is implemented as plain string pre/post-processing around
// that call. This keeps the pipeline resilient to marked's internal
// Renderer API shifting between versions, and keeps every transform easy
// to unit-eyeball against the exact corpus text.
//
// CRITICAL FIDELITY RULE: none of these passes may change visible wording.
// They only strip HTML comments (invisible) and wrap/link existing text.

import { marked } from 'marked';
import { resolveInternalHref } from './linkmap.mjs';

marked.use({ gfm: true, breaks: false });

const MD_LINK_RE = /\]\(([^\s()]+\.md(?:#[^\s()]*)?)\)/g;
const MD_CODESPAN_PATH_RE = /(?<!\[)`((?:\.\.\/)*[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.md)`/g;

/**
 * Strip HTML comments from raw markdown. Per the fidelity rule, this is the
 * one content-bearing transform allowed to remove text outright — comments
 * are authoring notes, never part of the published wording.
 */
export function stripComments(md) {
  return md.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Rewrite `[text](path.md)` links and bare `` `path.md` `` code-span
 * references into the resolved site URL (or GITHUB_BASE if the target
 * has no generated page). `fromRepoDir` is the court-repo-relative
 * directory of the file being processed ('' for repo root).
 */
export function rewriteInternalLinks(md, fromRepoDir, githubBase) {
  let out = md.replace(MD_LINK_RE, (whole, href) => {
    const resolved = resolveInternalHref(fromRepoDir, href, githubBase);
    return `](${resolved})`;
  });
  out = out.replace(MD_CODESPAN_PATH_RE, (whole, href) => {
    const resolved = resolveInternalHref(fromRepoDir, href, githubBase);
    return `[\`${href}\`](${resolved})`;
  });
  return out;
}

/**
 * Wrap raw `<details><summary>...</summary>...</details>` transcript
 * blocks (already raw-HTML passthrough blocks in the corpus) in
 * `<div class="transcript">`, matching court.css's `.transcript details`
 * selector. Relies on the corpus's existing convention of a blank line
 * before/after each tag, which is what lets CommonMark treat the div as
 * its own HTML block and keep parsing the markdown nested inside.
 */
export function wrapTranscripts(md) {
  return md
    .replace(/<details><summary>/g, '<div class="transcript">\n\n<details><summary>')
    .replace(/<\/details>/g, '</details>\n\n</div>');
}

const RULING_META_RE =
  /^\*\*Ruling ID:\*\*.*\n\*\*Respondent:\*\*.*\n\*\*Case class:\*\*.*\n\*\*Evidence:\*\*.*$/m;

/**
 * Wrap the four-line ruling header metadata block (Ruling ID / Respondent /
 * Case class / Evidence) in `<div class="ruling-meta">`, forcing each field
 * onto its own line via CommonMark hard breaks (trailing double-space) so
 * it renders as a metadata block rather than one run-on paragraph. Only
 * ever matches the ruling-NN.md shape; never fires on rules/*.md's
 * "Version: ... Status: ..." header (different field set, checked via the
 * fixed anchor labels above).
 */
export function wrapRulingMeta(md) {
  return md.replace(RULING_META_RE, (block) => {
    const withBreaks = block
      .split('\n')
      .map((line) => line.replace(/\s+$/, '') + '  ')
      .join('\n');
    return `<div class="ruling-meta">\n\n${withBreaks}\n\n</div>`;
  });
}

function textOf(html) {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Post-render HTML fix-ups that are easiest to apply against the final
 * markup rather than the markdown source: blockquote classification
 * (banner / contestability), table-wrap + verdict-red cell tagging, and
 * the Sources-line class.
 */
export function postprocessHtml(html) {
  let out = html;
  const usedHeadingIds = new Set();

  // Public-record blockquote.
  out = out.replace(
    /<blockquote>(\s*)<p>PUBLIC RECORD/,
    '<blockquote class="banner">$1<p>PUBLIC RECORD'
  );

  // Contestability blockquote.
  out = out.replace(
    /<blockquote>(\s*)<p><strong>Contestability:<\/strong>/,
    '<blockquote class="contestability">$1<p><strong>Contestability:</strong>'
  );

  // Tables: wrap in .table-wrap, and flag any RED-bearing cell.
  out = out.replace(/<table>/g, '<div class="table-wrap">\n<table>');
  out = out.replace(/<\/table>/g, '</table>\n</div>');
  out = out.replace(/<(td|th)>([\s\S]*?)<\/\1>/g, (whole, tag, inner) => {
    if (/\bRED\b/.test(textOf(inner))) {
      return `<${tag} class="verdict-red">${inner}</${tag}>`;
    }
    return whole;
  });

  // Sources line: `*Sources: ...*` renders as `<p><em>Sources: ...</em></p>`.
  out = out.replace(/<p><em>Sources:/g, '<p class="sources"><em>Sources:');

  // marked's GFM autolinker turns any bare `word@word.word`-shaped text into a
  // mailto: link per the GFM extended-autolink spec. The corpus contains no real
  // email addresses anywhere — the only text matching that shape is version-pin
  // notation like `hb-companion-runtime@0.1.0` in report identity tables (written
  // there without backticks) — so any autolinked mailto is by construction a false
  // positive here. De-linkify without touching the visible text.
  out = out.replace(/<a href="mailto:[^"]*">([^<]*)<\/a>/g, '$1');

  // Stable heading anchors make long evidence records directly navigable.
  out = out.replace(/<h([2-3])>([\s\S]*?)<\/h\1>/g, (whole, level, inner) => {
    const visible = textOf(inner).trim();
    let slug = visible
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (!slug) return whole;
    if (slug.startsWith('transcript-excerpt')) slug = 'transcript-excerpt';
    const base = slug;
    let suffix = 2;
    while (usedHeadingIds.has(slug)) slug = `${base}-${suffix++}`;
    usedHeadingIds.add(slug);
    return `<h${level} id="${slug}">${inner}</h${level}>`;
  });

  return out;
}

/**
 * Full pipeline: raw court-repo markdown -> final HTML fragment, ready to
 * drop into {{CONTENT}}.
 * @param {string} rawMd
 * @param {object} opts
 * @param {string} opts.fromRepoDir  court-repo-relative directory of the source file ('' for repo root)
 * @param {string} opts.githubBase
 * @param {boolean} [opts.rulingMeta] apply the ruling-meta wrap (ruling-NN.md only)
 */
export function renderCorpusMarkdown(rawMd, { fromRepoDir, githubBase, rulingMeta = false }) {
  let md = stripComments(rawMd);
  md = rewriteInternalLinks(md, fromRepoDir, githubBase);
  md = wrapTranscripts(md);
  if (rulingMeta) md = wrapRulingMeta(md);
  const html = marked.parse(md);
  return postprocessHtml(html);
}
