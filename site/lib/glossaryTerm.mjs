// lib/glossaryTerm.mjs
//
// Extracts the "Caving Turn" entry out of GLOSSARY.md's Part I and builds
// the markdown body for its standalone concept page (glossary/caving-turn.html):
// the term heading, its verbatim definition (English + Chinese mirror), and
// a link back to the full glossary. The extracted definition text is used
// unmodified — only the surrounding page scaffold (h1, back-link) is authored.

const TERM_RE = /\*\*Caving Turn 塌线轮次\*\*\n([\s\S]*?)\n\n\*\*Mirror Gap/;

export function extractCavingTurnEntry(glossaryRawMd) {
  const m = glossaryRawMd.match(TERM_RE);
  if (!m) {
    throw new Error('glossaryTerm: could not locate the Caving Turn entry in GLOSSARY.md — source format changed?');
  }
  const body = m[1].trim();
  const lines = body.split('\n');
  const english = lines.filter((l) => !l.startsWith('中文：')).join('\n').trim();
  const zh = lines.find((l) => l.startsWith('中文：')) ?? '';
  return { english, zh };
}

export function buildCavingTurnPageMarkdown(glossaryRawMd) {
  const { english, zh } = extractCavingTurnEntry(glossaryRawMd);
  return [
    '# Caving Turn 塌线轮次',
    '',
    english,
    '',
    zh,
    '',
    '[← Back to the full Glossary](/glossary.html)',
    '',
  ].join('\n');
}
