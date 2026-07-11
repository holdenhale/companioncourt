// lib/audit.mjs
//
// Walks a built dist/ directory, extracts every href/src in every *.html
// file, and checks that internal targets actually exist on disk. External
// links (http/https/mailto/tel) and in-page fragments (#...) are counted
// but not checked (fragments include the intentional pre-launch `#gh`
// GITHUB_BASE placeholder, which is not a defect).

import fs from 'node:fs';
import path from 'node:path';

function walkHtml(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const REF_RE = /\s(?:href|src)="([^"]+)"/g;

export function auditDist(distDir) {
  const files = walkHtml(distDir).sort();
  const dead = [];
  let hrefsChecked = 0;
  let external = 0;
  let fragmentSkipped = 0;

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    REF_RE.lastIndex = 0;
    let m;
    while ((m = REF_RE.exec(html))) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        external++;
        continue;
      }
      if (href.startsWith('#')) {
        fragmentSkipped++;
        continue;
      }
      const clean = href.split('#')[0].split('?')[0];
      if (!clean) {
        fragmentSkipped++;
        continue;
      }
      hrefsChecked++;
      let target = clean.startsWith('/')
        ? path.join(distDir, clean.slice(1))
        : path.join(path.dirname(file), clean);

      let exists = false;
      if (clean.endsWith('/')) {
        exists = fs.existsSync(path.join(target, 'index.html'));
      } else if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        exists = true;
      } else if (!path.extname(target)) {
        exists = fs.existsSync(path.join(target, 'index.html')) || fs.existsSync(`${target}.html`);
      }

      if (!exists) {
        dead.push({ file: path.relative(distDir, file), href });
      }
    }
  }

  return { filesChecked: files.length, hrefsChecked, external, fragmentSkipped, dead };
}

export function formatAuditReport(result) {
  const lines = [];
  lines.push(
    `link audit: ${result.filesChecked} html files, ${result.hrefsChecked} internal hrefs checked, ` +
      `${result.external} external, ${result.fragmentSkipped} fragment/placeholder — ${result.dead.length} dead`
  );
  for (const d of result.dead) {
    lines.push(`  DEAD  ${d.file}  ->  ${d.href}`);
  }
  return lines.join('\n');
}
