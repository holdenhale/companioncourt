export const DEFAULT_LOCALE_ID = 'en';

export const LOCALES = Object.freeze([
  Object.freeze({
    id: 'en',
    htmlLang: 'en',
    hreflang: 'en',
    ogLocale: 'en_US',
    nativeLabel: 'English',
    routes: Object.freeze({
      home: '/',
      rulings: '/rulings/',
      method: '/method',
      transparency: '/transparency',
      submit: '/submit',
      evidence: '/reports/',
      rules: '/rules/',
      reports: '/reports/',
      essays: '/essays/',
      glossary: '/glossary',
      about: '/about',
    }),
  }),
  Object.freeze({
    id: 'zh',
    htmlLang: 'zh-Hans',
    hreflang: 'zh-Hans',
    ogLocale: 'zh_CN',
    nativeLabel: '简体中文',
    routes: Object.freeze({
      home: '/zh/',
      rulings: '/zh/rulings/',
      method: '/zh/method',
      transparency: '/zh/transparency',
      submit: '/zh/submit',
      evidence: '/zh/rulings/',
      rules: '/zh/rules/',
      reports: '/zh/rulings/',
      essays: '/zh/essays/',
      glossary: '/zh/glossary',
      about: '/zh/about',
    }),
  }),
]);

const LOCALE_BY_ID = new Map(LOCALES.map((locale) => [locale.id, locale]));

const COPY = {
  en: {
    skip: 'Skip to content',
    homeAria: 'CompanionCourt home',
    navLabel: 'Primary navigation',
    navToggle: 'Open navigation',
    navClose: 'Close navigation',
    rulings: 'Rulings',
    method: 'Method',
    transparency: 'Transparency',
    submit: 'Submit',
    github: 'GitHub',
    githubAria: 'Open CompanionCourt on GitHub',
    footerNavLabel: 'Footer navigation',
    footerEvidence: 'Evidence library',
    rules: 'Rules',
    reports: 'Reports',
    essays: 'Essays',
    glossary: 'Glossary',
    about: 'About',
    feed: 'Docket updates',
    footerLine: 'Verdicts, not vibes. Every claim should lead back to the record.',
    footerScope: 'Case-scoped diagnostic rulings. Publicly contestable; never rankings or certification.',
    languageHeading: 'Language',
    languageNavLabel: 'Choose site language',
    currentLanguage: 'Current language',
    viewInLanguage: 'View this page in {language}',
    openLanguageHome: 'Open the {language} homepage; this page is not translated',
    imageAlt: 'A spectral pressure ring showing a conversational break at turn two.',
  },
  zh: {
    skip: '跳到主要内容',
    homeAria: 'CompanionCourt 首页',
    navLabel: '主导航',
    navToggle: '打开导航',
    navClose: '关闭导航',
    rulings: '判决',
    method: '方法',
    transparency: '透明度',
    submit: '提交案例',
    github: 'GitHub',
    githubAria: '在 GitHub 打开 CompanionCourt',
    footerNavLabel: '页脚导航',
    footerEvidence: '证据库',
    rules: '规则',
    reports: '报告',
    essays: '文章',
    glossary: '词汇表',
    about: '关于',
    feed: '案卷更新',
    footerLine: '要判决，不要感觉。每个结论都应该能查回原始记录。',
    footerScope: '只发布特定案例的诊断判决；可公开挑战，不做排名或认证。',
    languageHeading: '语言',
    languageNavLabel: '选择网站语言',
    currentLanguage: '当前语言',
    viewInLanguage: '用{language}查看此页面',
    openLanguageHome: '打开{language}首页；此页面暂无对应翻译',
    imageAlt: '一枚光谱压力环，显示对话在第二轮发生失守。',
  },
};

function icon(name, alt = '') {
  const hidden = alt ? '' : ' aria-hidden="true"';
  return `<img class="icon" src="/assets/icons/${name}.svg" alt="${alt}"${hidden}>`;
}

function interpolate(template, language) {
  return template.replace('{language}', language);
}

export function localeConfig(locale) {
  const config = LOCALE_BY_ID.get(locale);
  if (!config) throw new Error(`Unsupported locale: ${locale}`);
  return config;
}

export function localeCopy(locale) {
  localeConfig(locale);
  const copy = COPY[locale];
  if (!copy) throw new Error(`Missing localized shell copy: ${locale}`);
  return copy;
}

export function renderHeader({ locale }) {
  const c = localeCopy(locale);
  const config = localeConfig(locale);
  const routes = config.routes;
  return `<header class="site-header" data-header>
  <div class="header-inner">
    <a class="wordmark" href="${routes.home}" aria-label="${c.homeAria}">CompanionCourt</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="${c.navToggle}" data-nav-toggle data-open-label="${c.navToggle}" data-close-label="${c.navClose}">
      <span data-nav-open>${icon('menu')}</span><span data-nav-close hidden>${icon('x')}</span>
      <span class="sr-only" data-nav-label>${c.navToggle}</span>
    </button>
    <nav class="primary-nav" id="primary-nav" aria-label="${c.navLabel}" data-nav-menu>
      <a href="${routes.rulings}" data-nav="rulings">${c.rulings}</a>
      <a href="${routes.method}" data-nav="method">${c.method}</a>
      <a href="${routes.transparency}" data-nav="transparency">${c.transparency}</a>
      <a href="${routes.submit}" data-nav="submit">${c.submit}</a>
      <a class="nav-github" href="https://github.com/holdenhale/companioncourt" aria-label="${c.githubAria}">${c.github}${icon('arrow-up-right')}</a>
    </nav>
  </div>
</header>`;
}

export function renderLocaleSelector({ locale, localeRoutes }) {
  const c = localeCopy(locale);
  const items = LOCALES.flatMap((target) => {
    const route = localeRoutes[target.id];
    if (!route?.path) return [];
    const current = target.id === locale;
    const aria = current
      ? ''
      : ` aria-label="${interpolate(route.exact === false ? c.openLanguageHome : c.viewInLanguage, target.nativeLabel)}"`;
    const currentMarkup = current ? ` aria-current="page"` : '';
    const currentText = current ? `<span class="sr-only"> — ${c.currentLanguage}</span>` : '';
    const kind = route.exact === false ? 'fallback' : 'exact';
    return [`<li><a href="${route.path}" lang="${target.htmlLang}" hreflang="${target.hreflang}" data-locale="${target.id}" data-route-kind="${kind}"${currentMarkup}${aria}>${target.nativeLabel}${currentText}</a></li>`];
  }).join('');

  return `<nav class="footer-locales" aria-label="${c.languageNavLabel}">
      <span class="footer-locales-label">${c.languageHeading}</span>
      <ul>${items}</ul>
    </nav>`;
}

export function renderFooter({ locale, localeRoutes }) {
  const c = localeCopy(locale);
  const routes = localeConfig(locale).routes;
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-lead">
      <a class="wordmark footer-wordmark" href="${routes.home}">CompanionCourt</a>
      <p>${c.footerLine}</p>
      <p class="footer-scope">${c.footerScope}</p>
    </div>
    <nav class="footer-links" aria-label="${c.footerNavLabel}">
      <a href="${routes.evidence}">${c.footerEvidence}</a>
      <a href="${routes.rules}">${c.rules}</a>
      <a href="${routes.reports}">${c.reports}</a>
      <a href="${routes.essays}">${c.essays}</a>
      <a href="${routes.glossary}">${c.glossary}</a>
      <a href="${routes.about}">${c.about}</a>
      <a href="/feed.xml">${c.feed}</a>
      <a href="https://github.com/holdenhale/companioncourt">${c.github}${icon('arrow-up-right')}</a>
    </nav>
    <div class="footer-meta">
      <p>CompanionCourt · Apache-2.0 · <a href="${routes.about}">Holden Hale</a> · © 2026</p>
      ${renderLocaleSelector({ locale, localeRoutes })}
    </div>
  </div>
</footer>`;
}

export function shellFor({ locale, localeRoutes }) {
  const c = localeCopy(locale);
  const config = localeConfig(locale);
  return {
    lang: config.htmlLang,
    ogLocale: config.ogLocale,
    skipLabel: c.skip,
    ogImageAlt: c.imageAlt,
    header: renderHeader({ locale }),
    footer: renderFooter({ locale, localeRoutes }),
  };
}
