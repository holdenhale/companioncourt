const COPY = {
  en: {
    lang: 'en',
    ogLocale: 'en_US',
    skip: 'Skip to content',
    navLabel: 'Primary navigation',
    navToggle: 'Open navigation',
    navClose: 'Close navigation',
    rulings: 'Rulings',
    method: 'Method',
    transparency: 'Transparency',
    submit: 'Submit',
    language: '中文',
    languageAria: '切换到中文',
    github: 'GitHub',
    githubAria: 'Open CompanionCourt on GitHub',
    footerEvidence: 'Evidence library',
    rules: 'Rules',
    reports: 'Reports',
    essays: 'Essays',
    glossary: 'Glossary',
    about: 'About',
    feed: 'Docket updates',
    footerLine: 'Verdicts, not vibes. Every claim should lead back to the record.',
    footerScope: 'Case-scoped diagnostic rulings. Publicly contestable; never rankings or certification.',
    imageAlt: 'A spectral pressure ring showing a conversational break at turn two.',
  },
  zh: {
    lang: 'zh-Hans',
    ogLocale: 'zh_CN',
    skip: '跳到主要内容',
    navLabel: '主导航',
    navToggle: '打开导航',
    navClose: '关闭导航',
    rulings: '判决',
    method: '方法',
    transparency: '透明度',
    submit: '提交案例',
    language: 'EN',
    languageAria: 'Switch to English',
    github: 'GitHub',
    githubAria: '在 GitHub 打开 CompanionCourt',
    footerEvidence: '证据库',
    rules: '规则',
    reports: '报告',
    essays: '文章',
    glossary: '词汇表',
    about: '关于',
    feed: '案卷更新',
    footerLine: '要判决，不要感觉。每个结论都应该能查回原始记录。',
    footerScope: '只发布特定案例的诊断判决；可公开挑战，不做排名或认证。',
    imageAlt: '一枚光谱压力环，显示对话在第二轮发生失守。',
  },
};

function icon(name, alt = '') {
  const hidden = alt ? '' : ' aria-hidden="true"';
  return `<img class="icon" src="/assets/icons/${name}.svg" alt="${alt}"${hidden}>`;
}

export function localeCopy(locale) {
  return COPY[locale] ?? COPY.en;
}

export function renderHeader({ locale, alternatePath }) {
  const c = localeCopy(locale);
  const prefix = locale === 'zh' ? '/zh' : '';
  return `<header class="site-header" data-header>
  <div class="header-inner">
    <a class="wordmark" href="${prefix || '/'}" aria-label="CompanionCourt home">CompanionCourt</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="${c.navToggle}" data-nav-toggle data-open-label="${c.navToggle}" data-close-label="${c.navClose}">
      <span data-nav-open>${icon('menu')}</span><span data-nav-close hidden>${icon('x')}</span>
      <span class="sr-only" data-nav-label>${c.navToggle}</span>
    </button>
    <nav class="primary-nav" id="primary-nav" aria-label="${c.navLabel}" data-nav-menu>
      <a href="${prefix}/rulings/" data-nav="rulings">${c.rulings}</a>
      <a href="${prefix}/method" data-nav="method">${c.method}</a>
      <a href="${prefix}/transparency" data-nav="transparency">${c.transparency}</a>
      <a href="${prefix}/submit" data-nav="submit">${c.submit}</a>
      <a class="nav-github" href="https://github.com/holdenhale/companioncourt" aria-label="${c.githubAria}">${c.github}${icon('arrow-up-right')}</a>
      <a class="language-switch" href="${alternatePath}" hreflang="${locale === 'zh' ? 'en' : 'zh-Hans'}" lang="${locale === 'zh' ? 'en' : 'zh-Hans'}" aria-label="${c.languageAria}">${c.language}</a>
    </nav>
  </div>
</header>`;
}

export function renderFooter({ locale }) {
  const c = localeCopy(locale);
  const prefix = locale === 'zh' ? '/zh' : '';
  const evidenceHref = locale === 'zh' ? '/zh/rulings/' : '/reports/';
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-lead">
      <a class="wordmark footer-wordmark" href="${prefix || '/'}">CompanionCourt</a>
      <p>${c.footerLine}</p>
      <p class="footer-scope">${c.footerScope}</p>
    </div>
    <nav class="footer-links" aria-label="Footer">
      <a href="${evidenceHref}">${c.footerEvidence}</a>
      <a href="${prefix}/rules/">${c.rules}</a>
      <a href="${locale === 'zh' ? '/zh/rulings/' : '/reports/'}">${c.reports}</a>
      <a href="${prefix}/essays/">${c.essays}</a>
      <a href="${prefix}/glossary">${c.glossary}</a>
      <a href="${prefix}/about">${c.about}</a>
      <a href="/feed.xml">${c.feed}</a>
      <a href="https://github.com/holdenhale/companioncourt">${c.github}${icon('arrow-up-right')}</a>
    </nav>
    <p class="footer-meta">CompanionCourt · Apache-2.0 · Holden Hale · © 2026</p>
  </div>
</footer>`;
}

export function shellFor({ locale, alternatePath }) {
  const c = localeCopy(locale);
  return {
    lang: c.lang,
    ogLocale: c.ogLocale,
    skipLabel: c.skip,
    ogImageAlt: c.imageAlt,
    header: renderHeader({ locale, alternatePath }),
    footer: renderFooter({ locale }),
  };
}
