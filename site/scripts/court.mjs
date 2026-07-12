const root = document.documentElement;
root.classList.add('is-enhanced');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
root.dataset.motion = reducedMotion.matches ? 'reduced' : 'full';
reducedMotion.addEventListener?.('change', (event) => {
  root.dataset.motion = event.matches ? 'reduced' : 'full';
});

const navToggle = document.querySelector('[data-nav-toggle]');
const navMenu = document.querySelector('[data-nav-menu]');
if (navToggle && navMenu) {
  const openIcon = navToggle.querySelector('[data-nav-open]');
  const closeIcon = navToggle.querySelector('[data-nav-close]');
  const setOpen = (open) => {
    navToggle.setAttribute('aria-expanded', String(open));
    navMenu.dataset.open = String(open);
    openIcon.hidden = open;
    closeIcon.hidden = !open;
    const label = open ? navToggle.dataset.closeLabel : navToggle.dataset.openLabel;
    navToggle.setAttribute('aria-label', label);
    const labelNode = navToggle.querySelector('[data-nav-label]');
    if (labelNode) labelNode.textContent = label;
    document.body.classList.toggle('nav-is-open', open);
  };
  navToggle.addEventListener('click', () => setOpen(navToggle.getAttribute('aria-expanded') !== 'true'));
  navMenu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      navToggle.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 820) setOpen(false);
  });
}

for (const stage of document.querySelectorAll('[data-pressure-stage]')) {
  const tabs = [...stage.querySelectorAll('[data-turn]')];
  const panels = [...stage.querySelectorAll('[data-turn-panel]')];
  const scrubber = stage.querySelector('[data-pressure-scrubber]');

  const selectTurn = (value, focus = false) => {
    const turn = String(value);
    stage.dataset.activeTurn = turn;
    for (const tab of tabs) {
      const active = tab.dataset.turn === turn;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.turnPanel !== turn;
    if (scrubber) scrubber.value = turn;
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTurn(tab.dataset.turn));
    tab.addEventListener('keydown', (event) => {
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTurn(tabs[next].dataset.turn, true);
    });
  });
  scrubber?.addEventListener('input', () => selectTurn(scrubber.value));
  selectTurn(stage.dataset.activeTurn || '2');
}

const revealItems = [...document.querySelectorAll('[data-reveal]')];
if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

const rulingPage = document.querySelector('[data-page~="ruling-page"] .record-prose');
if (rulingPage) {
  const headings = [...rulingPage.querySelectorAll('h2[id]')].slice(0, 8);
  const actionBar = rulingPage.querySelector('.record-actions');
  if (headings.length && actionBar) {
    const nav = document.createElement('nav');
    nav.className = 'record-outline';
    nav.setAttribute('aria-label', 'Ruling sections');
    nav.innerHTML = headings.map((heading) => `<a href="#${heading.id}">${heading.textContent}</a>`).join('');
    actionBar.insertAdjacentElement('afterend', nav);
  }
}
