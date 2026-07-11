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
// no leading slash). All output values are root-absolute dist paths
// (leading slash, .html suffix) — consistent with base.html's own
// root-absolute nav/footer hrefs.

import path from 'node:path';

/** @type {Record<string,string>} */
export const SOURCE_TO_OUTPUT = {
  'rulings/ruling-01.md': '/rulings/rd-2026-001.html',
  'rulings/ruling-02.md': '/rulings/rd-2026-002.html',
  'rulings/ruling-03.md': '/rulings/rd-2026-003.html',
  'rulings/ruling-04.md': '/rulings/rd-2026-004.html',
  'rulings/INDEX.md': '/rulings/index.html',
  'essays/the-caving-turn.md': '/essays/the-caving-turn.html',
  'essays/the-verification-crisis.md': '/essays/the-verification-crisis.html',
  'rules/case-lifecycle-policy.md': '/rules/case-lifecycle-policy.html',
  'rules/evidence-standard.md': '/rules/evidence-standard.html',
  'rules/leakage-certification-policy.md': '/rules/leakage-certification-policy.html',
  'rules/model-rerun-policy.md': '/rules/model-rerun-policy.html',
  'rules/rules-of-procedure.md': '/rules/rules-of-procedure.html',
  'rules/verdict-template.md': '/rules/verdict-template.html',
  'reports/report-hb-companion-product.md': '/reports/report-hb-companion-product.html',
  'reports/report-claude-sonnet-4-6.md': '/reports/report-claude-sonnet-4-6.html',
  'reports/sample-diagnostic-report-qwen-max.md': '/reports/sample-diagnostic-report-qwen-max.html',
  'reports/README.md': '/reports/index.html',
  'GLOSSARY.md': '/glossary.html',
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
