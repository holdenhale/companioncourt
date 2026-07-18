// scripts/judge.mjs — the blind bench (/judge). Entirely static: the page
// tests the visitor's judgment against published rulings. No uploads, no
// backend, no privacy surface. All strings reach the DOM via textContent.

import { JUDGE_ITEMS, scoreFor, turnDisplayText } from './judge-data.mjs';
import { cardAltText, downloadCanvas, drawJudgeCard } from './sharecard.mjs';

const answers = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTranscript(item) {
  const block = el('div', 'judge-transcript');
  for (const turn of item.turns) {
    if (turn.stage) {
      block.append(el('p', 'judge-stage', turnDisplayText(turn)));
      continue;
    }
    const row = el('div', `judge-turn judge-turn-${turn.speaker}`);
    row.append(el('span', 'judge-speaker', turn.speaker));
    row.append(el('p', 'judge-text', turnDisplayText(turn)));
    block.append(row);
  }
  return block;
}

function renderReveal(item, pickedId) {
  const correct = item.options.find((o) => o.correct);
  const agreed = pickedId === correct.id;
  const reveal = el('div', 'judge-reveal');
  reveal.append(el('p', `judge-agree ${agreed ? 'judge-agree-yes' : 'judge-agree-no'}`,
    agreed ? 'You called it with the court.' : 'The court saw it differently.'));
  reveal.append(el('p', 'judge-verdict', item.verdict));
  for (const seg of item.revealSegments) {
    const quote = el('blockquote', 'judge-quote');
    quote.append(el('p', '', seg));
    reveal.append(quote);
  }
  const cite = el('p', 'judge-cite');
  const link = el('a', '', `Read the full ruling ${item.ruling} →`);
  link.href = item.rulingHref;
  cite.append(link);
  reveal.append(cite);
  return reveal;
}

function renderFinal(app) {
  if (answers.size !== JUDGE_ITEMS.length) return;
  const finalEl = app.querySelector('[data-judge-final]');
  const score = scoreFor(answers);
  finalEl.hidden = false;
  finalEl.querySelector('[data-judge-score]').textContent =
    `You matched the court on ${score.matched} of ${score.total} calls.`;

  const canvas = finalEl.querySelector('[data-judge-card]');
  const draw = () => {
    const lines = drawJudgeCard(canvas, score);
    const alt = cardAltText(lines);
    canvas.setAttribute('aria-label', alt);
    finalEl.querySelector('[data-judge-card-alt]').textContent = alt;
  };
  if (document.fonts?.ready) document.fonts.ready.then(draw, draw);
  else draw();

  finalEl.querySelector('[data-judge-download]')?.addEventListener('click', () => {
    downloadCanvas(canvas, 'companioncourt-blind-bench.png');
  }, { once: false });
  finalEl.scrollIntoView?.({ block: 'nearest' });
}

function renderItem(app, item, index) {
  const li = el('li', 'judge-item');
  const head = el('div', 'judge-head');
  head.append(el('span', 'judge-number', String(index + 1).padStart(2, '0')));
  const heading = el('div', 'judge-heading');
  heading.append(el('h2', '', item.title));
  heading.append(el('p', 'judge-setup', item.setup));
  head.append(heading);
  li.append(head);
  li.append(renderTranscript(item));

  const voteWrap = el('div', 'judge-vote');
  voteWrap.append(el('p', 'judge-question', item.question));
  const buttons = el('div', 'judge-options');
  for (const option of item.options) {
    const btn = el('button', 'judge-option', option.label);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (answers.has(item.id)) return;
      answers.set(item.id, option.id);
      btn.classList.add('is-picked');
      for (const b of buttons.querySelectorAll('button')) b.disabled = true;
      voteWrap.append(renderReveal(item, option.id));
      const progress = app.querySelector('[data-judge-progress]');
      const score = scoreFor(answers);
      progress.textContent = `${answers.size} of ${JUDGE_ITEMS.length} called · with the court on ${score.matched}`;
      renderFinal(app);
    });
    buttons.append(btn);
  }
  voteWrap.append(buttons);
  li.append(voteWrap);
  return li;
}

function initJudge(app) {
  const list = app.querySelector('[data-judge-list]');
  JUDGE_ITEMS.forEach((item, index) => list.append(renderItem(app, item, index)));
}

if (typeof document !== 'undefined') {
  const app = document.querySelector('[data-judge-app]');
  if (app) initJudge(app);
}
