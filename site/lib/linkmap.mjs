// lib/linkmap.mjs
//
// Maps court-repo-relative source markdown paths to their generated,
// root-absolute dist URL, and resolves internal cross-references found
// inside the corpus markdown (both `[text](path.md)` links and bare
// `` `path.md` `` code-span references) to either:
//   - the corresponding generated page, or
//   - GITHUB_BASE, for repo files that have no generated page (e.g.
//     NAMING-DECISION.md or anything else uncovered).
//
// All paths in SOURCE_TO_OUTPUT are court-repo-relative (posix-style,
// no leading slash). All output values are root-absolute public URLs.
// Generated files retain .html names on disk, while Cloudflare Pages serves
// the clean paths below directly.

import path from 'node:path';

/** @type {Record<string,string>} */
export const SOURCE_TO_OUTPUT = {
  'rulings/ruling-01.md': '/rulings/rd-2026-001',
  'rulings/ruling-02.md': '/rulings/rd-2026-002',
  'rulings/ruling-03.md': '/rulings/rd-2026-003',
  'rulings/ruling-04.md': '/rulings/rd-2026-004',
  'rulings/INDEX.md': '/rulings/',
  'essays/the-caving-turn.md': '/essays/the-caving-turn',
  'essays/the-verification-crisis.md': '/essays/the-verification-crisis',
  'rules/case-lifecycle-policy.md': '/rules/case-lifecycle-policy',
  'rules/evidence-standard.md': '/rules/evidence-standard',
  'rules/leakage-certification-policy.md': '/rules/leakage-certification-policy',
  'rules/model-rerun-policy.md': '/rules/model-rerun-policy',
  'rules/rules-of-procedure.md': '/rules/rules-of-procedure',
  'rules/verdict-template.md': '/rules/verdict-template',
  'reports/report-hb-companion-product.md': '/reports/report-hb-companion-product',
  'reports/report-claude-sonnet-4-6.md': '/reports/report-claude-sonnet-4-6',
  'reports/sample-diagnostic-report-qwen-max.md': '/reports/sample-diagnostic-report-qwen-max',
  'reports/README.md': '/reports/',
  'GLOSSARY.md': '/glossary',
};

/**
 * Normalize a relative href found inside `fromRepoDir` (a court-repo-relative
 * directory, '' for repo root) to a court-repo-relative path with no leading
 * slash and no `./`/`../` segments left unresolved.
 * @param {string} fromRepoDir
 * @param {string} href
 * @returns {string}
 */
function normalize(fromRepoDir, href) {
  const joined = path.posix.normalize(path.posix.join(fromRepoDir, href));
  return joined.replace(/^\.\/+/, '');
}

/**
 * Resolve an internal-looking relative reference (as written inside a
 * source markdown file) to the href it should carry in the rendered site.
 * @param {string} fromRepoDir  court-repo-relative directory of the file being rendered ('' for repo root)
 * @param {string} rawHref      the href/path exactly as written in the markdown (may carry a #fragment)
 * @param {string} githubBase   fallback constant for repo files with no generated page
 * @returns {string}
 */
export function resolveInternalHref(fromRepoDir, rawHref, githubBase) {
  const hashIdx = rawHref.indexOf('#');
  const pathPart = hashIdx === -1 ? rawHref : rawHref.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? '' : rawHref.slice(hashIdx);
  if (!pathPart) return githubBase + fragment; // pure in-page anchor, shouldn't happen for our .md matches
  const normalized = normalize(fromRepoDir, pathPart);
  const mapped = SOURCE_TO_OUTPUT[normalized];
  return mapped ? mapped + fragment : githubBase;
}
