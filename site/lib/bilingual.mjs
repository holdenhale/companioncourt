const ZH_SUMMARY_HEADING = /^##\s+(?:中文摘要（zh summary）|摘要（zh）)\s*$/m;

export function splitTrailingZhSummary(rawMd) {
  const match = ZH_SUMMARY_HEADING.exec(rawMd);
  if (!match) return { english: rawMd.trim(), chinese: '' };
  return {
    english: rawMd.slice(0, match.index).trim(),
    chinese: rawMd.slice(match.index + match[0].length).trim(),
  };
}

function stripHanSuffix(text) {
  return text
    .replace(/\s*\/\s*[\p{Script=Han}][\s\S]*$/u, '')
    .replace(/\s+[\p{Script=Han}][\p{Script=Han}\s·，。、“”‘’（）—：；！？]+$/u, '')
    .trim();
}

function chineseFromTermLabel(text) {
  const han = text.match(/[\p{Script=Han}][\p{Script=Han}\s·，。、“”‘’（）—：；！？]*/u);
  return han ? han[0].trim() : text.trim();
}

export function buildGlossaryMarkdown(rawMd, locale = 'en') {
  const lines = rawMd.split('\n');
  if (locale === 'en') {
    return lines
      .filter((line) => !line.trimStart().startsWith('中文：'))
      .map((line) => {
        if (line.startsWith('#')) return stripHanSuffix(line);
        if (/^\*\*.+\*\*/.test(line)) {
          const end = line.indexOf('**', 2);
          if (end !== -1) {
            const label = line.slice(2, end);
            return `**${stripHanSuffix(label)}**${line.slice(end + 2)}`;
          }
        }
        return line;
      })
      .join('\n')
      .replace(/法庭审判的永远是 AI，绝不是用户。/g, '')
      .trim();
  }

  const out = [
    '# CompanionCourt 词汇表',
    '',
    '> 这里收录公开压力测试案卷使用的概念。CompanionCourt 审视的是 AI 陪伴的行为，而不是向它倾诉的人。',
    '',
  ];
  let pendingLabel = '';
  let pendingMeta = '';
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      const zhHeading = chineseFromTermLabel(heading[1]);
      out.push(`## ${zhHeading}`, '');
      continue;
    }

    const term = line.match(/^\*\*(.+?)\*\*(.*)$/);
    if (term) {
      pendingLabel = chineseFromTermLabel(term[1]);
      pendingMeta = term[2].trim();
      continue;
    }

    if (line.trimStart().startsWith('中文：')) {
      const body = line.replace(/^\s*中文：/, '');
      out.push(`**${pendingLabel || '术语'}**${pendingMeta ? ` ${pendingMeta}` : ''}`, body, '');
      pendingLabel = '';
      pendingMeta = '';
    }
  }
  return out.join('\n').trim();
}
