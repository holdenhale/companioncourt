// scripts/lens.mjs — client logic for /check (the Conversation Lens).
//
// Privacy discipline, enforced here as much as on the Worker:
//   * Nothing is persisted client-side: no cookies, no localStorage, no
//     third-party scripts. State lives in module variables for one page view.
//   * Every user- or model-derived string reaches the DOM via textContent —
//     never innerHTML.
//   * Images are inline uploads only; this module never fetches an image URL.
//   * The response is validated structurally before anything renders; an
//     inconsistent read is an error, not a card.
//
// The API base is configurable via the JSON config block on the page
// (<script type="application/json" data-lens-config>), so the same static
// page runs against a local Worker, a preview deployment, or production.
// With no Worker attached, the page degrades to a labelled dev placeholder.

import {
  bandLabel,
  cardAltText,
  downloadCanvas,
  drawLensCard,
  headlineFor,
  lensCardLines,
  sanitizeLine,
} from './sharecard.mjs';

export const TIERS = ['HELD', 'WOBBLED', 'CAVED', 'UNTESTED'];
export const TURN_STATES = ['held', 'hedged', 'caved'];
export const CHAR_LIMIT = 8000;
export const MAX_IMAGES = 4;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_NOTES_LENGTH = 280;

// ---------------------------------------------------------------------------
// Transcript parsing (paste mode)
// ---------------------------------------------------------------------------

const USER_LABELS = new Set(['user', 'you', 'me', 'human', 'persona', '我']);
const COMPANION_LABELS = new Set(['companion', 'assistant', 'ai', 'bot', 'respondent', 'model', 'it']);
const LABEL_RE = /^\s*(?:\[[^\]]*\]\s*)?([A-Za-z一-鿿][\w .一-鿿-]{0,24}?)\s*[:：]\s*(.*)$/;

/** Split pasted text into speaker turns. Labelled lines ("Name: …") set the
 *  speaker; unlabelled lines continue the current turn; blank-line boundaries
 *  alternate speakers when no labels exist. The user corrects speakers in the
 *  UI afterwards — this only has to be a good first guess. */
export function parseTranscript(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const turns = [];
  const labelFor = new Map();
  let sawLabel = false;
  let current = null;

  const seenSides = new Set();
  const speakerFromLabel = (raw) => {
    const key = raw.trim().toLowerCase();
    let speaker;
    if (USER_LABELS.has(key)) speaker = 'user';
    else if (COMPANION_LABELS.has(key)) speaker = 'companion';
    else if (labelFor.has(key)) speaker = labelFor.get(key);
    else {
      // First unseen side goes to the human; the next distinct label is the
      // companion. The UI lets the user flip any turn afterwards.
      speaker = seenSides.has('user') ? 'companion' : 'user';
      labelFor.set(key, speaker);
    }
    seenSides.add(speaker);
    return speaker;
  };

  for (const line of lines) {
    const m = line.match(LABEL_RE);
    if (m && m[1] && m[2] !== undefined) {
      sawLabel = true;
      current = { speaker: speakerFromLabel(m[1]), text: m[2].trim() };
      turns.push(current);
      continue;
    }
    if (!line.trim()) {
      if (!sawLabel) current = null; // blank line = turn boundary in unlabelled text
      continue;
    }
    if (current) {
      current.text = current.text ? `${current.text}\n${line.trim()}` : line.trim();
    } else {
      const prev = turns[turns.length - 1];
      current = { speaker: prev ? (prev.speaker === 'user' ? 'companion' : 'user') : 'user', text: line.trim() };
      turns.push(current);
    }
  }
  return turns.filter((t) => t.text);
}

/** Serialize corrected turns back into the canonical "user:/companion:" text
 *  the API contract's text mode expects. */
export function normalizeTurns(turns) {
  return turns.map((t) => `${t.speaker}: ${t.text.replace(/\n/g, ' ')}`).join('\n');
}

/** 8k cap keeps the TAIL of the conversation (the most recent messages). */
export function truncateTail(turns, limit = CHAR_LIMIT) {
  const kept = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = turns[i].speaker.length + turns[i].text.length + 3;
    if (used + cost > limit && kept.length > 0) break;
    if (used + cost > limit && kept.length === 0) {
      kept.unshift({ speaker: turns[i].speaker, text: turns[i].text.slice(-(limit - used - turns[i].speaker.length - 3)) });
      used = limit;
      break;
    }
    kept.unshift(turns[i]);
    used += cost;
  }
  return { turns: kept, truncated: kept.length < turns.length, kept: kept.length, total: turns.length };
}

// ---------------------------------------------------------------------------
// Share-link precheck (fast client gate; the Worker re-checks everything
// server-side and is the deciding layer)
// ---------------------------------------------------------------------------

const SHARE_HOSTS = [
  { host: 'chatgpt.com', pathPrefix: '/share' },
  { host: 'chat.openai.com', pathPrefix: '/share' },
  { host: 'claude.ai', pathPrefix: '/share' },
  { host: 'character.ai', pathPrefix: '/' },
];

/** Strict allowlist: https only, no userinfo, no explicit port, hostname by
 *  exact match or dot-suffix (never substring). The Worker re-validates after
 *  redirects and resolves/pins the IP; this is only the fast client gate. */
export function checkShareUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return { ok: false, reason: 'not a valid link' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'only https links work here' };
  if (url.username || url.password) return { ok: false, reason: "links with login details in them won't work" };
  if (url.port) return { ok: false, reason: "links with a custom port won't work" };
  const host = url.hostname.toLowerCase();
  for (const entry of SHARE_HOSTS) {
    const match = host === entry.host || host.endsWith(`.${entry.host}`);
    if (match && url.pathname.startsWith(entry.pathPrefix)) return { ok: true, host: entry.host };
  }
  return { ok: false, reason: "that site isn't on the share-link list yet" };
}

// ---------------------------------------------------------------------------
// Response validation (client-side defense; the Worker validates first)
// ---------------------------------------------------------------------------

export const SAFETY_FLAGS = ['none', 'selfharm', 'minor', 'abuse'];

export function validateLensResponse(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { ok: false, errors: ['no result object'] };
  if (!TIERS.includes(data.tier)) errors.push('tier');
  const turns = Array.isArray(data.turns) ? data.turns : null;
  if (!turns || turns.length === 0) errors.push('turns');
  else {
    for (const t of turns) {
      if (!t || !Number.isInteger(t.i) || t.i < 1 || t.i > turns.length || !TURN_STATES.includes(t.state)) {
        errors.push('turns');
        break;
      }
    }
  }
  const cavingOk = data.cavingTurn === null
    || (Number.isInteger(data.cavingTurn) && turns && data.cavingTurn >= 1 && data.cavingTurn <= turns.length);
  if (!cavingOk) errors.push('cavingTurn');
  for (const axis of ['warmth', 'line']) {
    if (typeof data[axis] !== 'number' || !Number.isFinite(data[axis]) || data[axis] < 0 || data[axis] > 1) errors.push(axis);
  }
  if (data.flipQuote !== null && typeof data.flipQuote !== 'string') errors.push('flipQuote');
  if (typeof data.notes !== 'string') errors.push('notes');
  if (typeof data.readerModel !== 'string' || !data.readerModel) errors.push('readerModel');
  if (data.safety !== undefined && !SAFETY_FLAGS.includes(data.safety)) errors.push('safety');

  // Cross-field consistency: an inconsistent read is rejected, not rendered.
  if (turns && errors.length === 0) {
    const cavedTurns = turns.filter((t) => t.state === 'caved');
    if (data.tier === 'CAVED' && (!Number.isInteger(data.cavingTurn) || cavedTurns.length === 0)) errors.push('consistency: CAVED needs cavingTurn + a caved message');
    if (data.tier === 'CAVED' && Number.isInteger(data.cavingTurn) && !cavedTurns.some((t) => t.i === data.cavingTurn)) errors.push('consistency: cavingTurn must be a caved message');
    if (data.tier === 'HELD' && (cavedTurns.length > 0 || data.cavingTurn !== null)) errors.push('consistency: HELD cannot carry a cave');
    if (data.tier === 'WOBBLED' && (cavedTurns.length > 0 || data.cavingTurn !== null)) errors.push('consistency: WOBBLED cannot carry a cave');
    if (data.tier === 'UNTESTED' && data.cavingTurn !== null) errors.push('consistency: UNTESTED has no caving turn');
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Page wiring (browser only from here down)
// ---------------------------------------------------------------------------

const SAMPLE_RESULT = Object.freeze({
  tier: 'WOBBLED',
  cavingTurn: null,
  turns: [
    { i: 1, state: 'held' }, { i: 2, state: 'held' }, { i: 3, state: 'hedged' },
    { i: 4, state: 'hedged' }, { i: 5, state: 'held' }, { i: 6, state: 'hedged' },
  ],
  warmth: 0.8,
  line: 0.45,
  flipQuote: 'well, maybe you know the situation better than I do…',
  notes: 'Sample data — not a live read. This companion stayed warm but softened its own position twice when pushed.',
  readerModel: 'sample-reader',
  safety: 'none',
});

function initLens(app) {
  const $ = (sel) => app.querySelector(sel);
  const configEl = $('[data-lens-config]');
  let apiBase = '';
  try { apiBase = JSON.parse(configEl?.textContent ?? '{}').apiBase ?? ''; } catch { apiBase = ''; }
  const median = Number(app.dataset.docketMedian) || null;

  const state = {
    mode: 'text',
    turns: [],
    files: [],
    images: [],
    gateConfirmed: false,
    result: null,
    sample: false,
    withQuote: false,
  };

  // --- mode tabs ---
  const tabs = [...app.querySelectorAll('[data-lens-mode]')];
  const panels = [...app.querySelectorAll('[data-lens-panel]')];
  const selectMode = (mode) => {
    state.mode = mode;
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset.lensMode === mode));
    for (const panel of panels) panel.hidden = panel.dataset.lensPanel !== mode;
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => selectMode(tab.dataset.lensMode)));
  selectMode('text');

  // --- paste mode: parse + speaker correction ---
  const textarea = $('[data-lens-text]');
  const turnList = $('[data-lens-turns]');
  const truncNote = $('[data-lens-truncnote]');

  const renderTurns = () => {
    turnList.replaceChildren();
    const cut = truncateTail(state.turns);
    for (const [idx, turn] of state.turns.entries()) {
      const row = document.createElement('li');
      row.className = 'lens-turn';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `lens-speaker lens-speaker-${turn.speaker}`;
      btn.textContent = turn.speaker === 'user' ? 'you' : 'companion';
      btn.title = 'Wrong speaker? Click to flip.';
      btn.addEventListener('click', () => {
        turn.speaker = turn.speaker === 'user' ? 'companion' : 'user';
        renderTurns();
      });
      const text = document.createElement('p');
      text.textContent = turn.text.length > 160 ? `${turn.text.slice(0, 159)}…` : turn.text;
      row.append(btn, text);
      if (cut.truncated && idx < state.turns.length - cut.kept) row.classList.add('lens-turn-cut');
      turnList.append(row);
    }
    if (cut.truncated) {
      truncNote.hidden = false;
      truncNote.textContent = `Long chat — the lens will read the last ${cut.kept} messages (the ${CHAR_LIMIT.toLocaleString('en-US')}-character tail). The faded ones fall outside the read.`;
    } else {
      truncNote.hidden = true;
    }
  };

  textarea?.addEventListener('input', () => {
    state.turns = parseTranscript(textarea.value);
    renderTurns();
  });
  $('[data-lens-swap]')?.addEventListener('click', () => {
    for (const t of state.turns) t.speaker = t.speaker === 'user' ? 'companion' : 'user';
    renderTurns();
  });

  // --- file mode ---
  const fileInput = $('[data-lens-file]');
  const fileNote = $('[data-lens-filenote]');
  fileInput?.addEventListener('change', async () => {
    state.files = [];
    fileNote.textContent = '';
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      fileNote.textContent = "That export is over 512 KB. Trim it down to the conversation you want read — the lens only reads the last 8,000 characters anyway.";
      fileInput.value = '';
      return;
    }
    state.files = [{ name: file.name, text: await file.text() }];
    fileNote.textContent = `${file.name} is ready — the lens reads the tail, so your most recent messages are the ones that count.`;
  });

  // --- images mode (inline upload only; never fetched by URL) ---
  const imageInput = $('[data-lens-images]');
  const imageNote = $('[data-lens-imagenote]');
  const thumbs = $('[data-lens-thumbs]');

  const downscale = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable image')); };
    img.src = url;
  });

  imageInput?.addEventListener('change', async () => {
    const files = [...(imageInput.files ?? [])].slice(0, MAX_IMAGES);
    imageNote.textContent = (imageInput.files?.length ?? 0) > MAX_IMAGES
      ? `The lens takes up to ${MAX_IMAGES} screenshots per read — we kept the first ${MAX_IMAGES}.`
      : '';
    state.images = [];
    thumbs.replaceChildren();
    for (const f of files) {
      try {
        const dataUrl = await downscale(f);
        state.images.push(dataUrl);
        const t = document.createElement('img');
        t.src = dataUrl;
        t.alt = `screenshot ${state.images.length} of ${files.length}`;
        thumbs.append(t);
      } catch {
        imageNote.textContent = "One image couldn't be read, so it was skipped.";
      }
    }
  });

  // --- url mode ---
  const urlInput = $('[data-lens-url]');
  const urlNote = $('[data-lens-urlnote]');
  urlInput?.addEventListener('input', () => {
    if (!urlInput.value.trim()) { urlNote.textContent = ''; return; }
    const check = checkShareUrl(urlInput.value);
    urlNote.textContent = check.ok
      ? 'That link looks importable. The lens only fetches the shared page — never your account.'
      : `${check.reason}. Screenshots are the reliable way in — switch to the screenshots tab.`;
  });

  // --- consent gate (hard interstitial; single affirmation) ---
  const gate = $('[data-lens-gate]');
  const gateCheck = $('[data-lens-gate-check]');
  const gateRun = $('[data-lens-gate-run]');
  gateCheck?.addEventListener('change', () => { gateRun.disabled = !gateCheck.checked; });
  $('[data-lens-gate-cancel]')?.addEventListener('click', () => gate.close());
  gateRun?.addEventListener('click', () => {
    state.gateConfirmed = true;
    gate.close();
    void submit();
  });

  // --- status / result rendering ---
  const statusEl = $('[data-lens-status]');
  const resultEl = $('[data-lens-result]');
  const capacityEl = $('[data-lens-capacity]');

  const setStatus = (kind, message) => {
    statusEl.hidden = !message;
    statusEl.dataset.kind = kind ?? '';
    statusEl.textContent = message ?? '';
  };

  const buildPayload = () => {
    if (state.mode === 'text') {
      const cut = truncateTail(state.turns);
      if (cut.turns.length === 0) return { error: 'Paste a conversation first.' };
      return { payload: { mode: 'text', text: normalizeTurns(cut.turns) } };
    }
    if (state.mode === 'file') {
      if (state.files.length === 0) return { error: 'Choose a chat export first.' };
      return { payload: { mode: 'file', files: state.files } };
    }
    if (state.mode === 'images') {
      if (state.images.length === 0) return { error: 'Add at least one screenshot first.' };
      return { payload: { mode: 'images', images: state.images } };
    }
    const check = checkShareUrl(urlInput?.value ?? '');
    if (!check.ok) return { error: `${check.reason}. Screenshots are the reliable way in.` };
    return { payload: { mode: 'url', url: urlInput.value.trim() } };
  };

  const renderCapacity = () => {
    resultEl.hidden = true;
    setStatus('', '');
    capacityEl.hidden = false;
    const sampleCanvas = capacityEl.querySelector('[data-lens-samplecard]');
    if (sampleCanvas) drawLensCard(sampleCanvas, SAMPLE_RESULT, { median, sample: true });
    capacityEl.scrollIntoView?.({ block: 'nearest' });
  };

  const cardCanvas = $('[data-lens-card]');
  const cardCaption = $('[data-lens-card-alt]');

  const renderCard = () => {
    if (!state.result || !cardCanvas) return;
    const draw = () => {
      const lines = drawLensCard(cardCanvas, state.result, {
        median,
        withQuote: state.withQuote,
        sample: state.sample,
      });
      const alt = cardAltText(lines);
      cardCanvas.setAttribute('aria-label', alt);
      cardCaption.textContent = alt;
    };
    if (document.fonts?.ready) document.fonts.ready.then(draw, draw);
    else draw();
  };

  const renderResult = (result) => {
    state.result = result;
    capacityEl.hidden = true;
    setStatus('', '');

    // Safety-flagged content: no scored card, crisis line only.
    if (result.safety && result.safety !== 'none') {
      resultEl.hidden = true;
      setStatus('crisis',
        "The lens doesn't score conversations involving harm, minors, or abuse — no card is produced. "
        + 'If you or anyone in this conversation is in danger or crisis, please reach a human now: findahelpline.com lists free, confidential helplines by country.');
      return;
    }

    resultEl.hidden = false;
    $('[data-lens-headline]').textContent = headlineFor(result);
    $('[data-lens-headline]').dataset.tier = result.tier;

    // Turn strip
    const strip = $('[data-lens-strip]');
    strip.replaceChildren();
    const untested = result.tier === 'UNTESTED';
    for (const turn of result.turns) {
      const seg = document.createElement('span');
      seg.className = `lens-seg lens-seg-${untested ? 'untested' : turn.state}`;
      seg.title = `message ${turn.i} — ${untested ? 'no pressure to test' : turn.state}`;
      strip.append(seg);
    }
    if (median && result.turns.length >= median) {
      const tick = document.createElement('span');
      tick.className = 'lens-median-tick';
      tick.style.left = `${((median - 0.5) / result.turns.length) * 100}%`;
      tick.setAttribute('aria-hidden', 'true');
      const tickLabel = document.createElement('em');
      tickLabel.textContent = 'docket median';
      tick.append(tickLabel);
      strip.append(tick);
    }

    // Axes (banded, with plain-language labels)
    $('[data-lens-warm]').textContent = bandLabel(result.warmth);
    $('[data-lens-line]').textContent = bandLabel(result.line);

    // Notes + reader pin
    $('[data-lens-notes]').textContent = sanitizeLine(result.notes, MAX_NOTES_LENGTH);
    const pin = document.querySelector('[data-reader-pin-value]');
    if (pin) pin.textContent = result.readerModel;

    // Receipt (flip quote): opt-in, one step, re-renders the card live.
    const receiptWrap = $('[data-lens-receiptwrap]');
    const receipt = $('[data-lens-receipt]');
    const quoteEl = $('[data-lens-quote]');
    if (result.flipQuote) {
      receiptWrap.hidden = false;
      receipt.checked = state.withQuote;
      quoteEl.hidden = !state.withQuote;
      $('[data-lens-quotetext]').textContent = sanitizeLine(result.flipQuote, 220);
    } else {
      receiptWrap.hidden = true;
      quoteEl.hidden = true;
      state.withQuote = false;
    }
    renderCard();
    resultEl.scrollIntoView?.({ block: 'nearest' });
  };

  $('[data-lens-receipt]')?.addEventListener('change', (event) => {
    state.withQuote = event.target.checked;
    $('[data-lens-quote]').hidden = !state.withQuote;
    renderCard();
  });

  $('[data-lens-download]')?.addEventListener('click', () => {
    if (cardCanvas) downloadCanvas(cardCanvas, 'companioncourt-lens-read.png');
  });

  // --- submit flow ---
  const submitBtn = $('[data-lens-submit]');

  async function submit() {
    const built = buildPayload();
    if (built.error) { setStatus('error', built.error); return; }
    if (!state.gateConfirmed) { gate.showModal(); return; }

    state.sample = false;
    submitBtn.disabled = true;
    setStatus('busy', 'Reading now — one pass, usually well under a minute…');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75_000);
    try {
      const res = await fetch(`${apiBase}/api/lens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.payload),
        signal: controller.signal,
      });
      if (res.status === 429 || res.status === 503) { renderCapacity(); return; }
      if (!res.ok) {
        setStatus('error', state.mode === 'url'
          ? "We couldn't import that link. Screenshots are the reliable way in — switch tabs and try again."
          : 'Something failed on our side. Give it a moment and try once more.');
        return;
      }
      const data = await res.json();
      const check = validateLensResponse(data);
      if (!check.ok) {
        setStatus('error', "The reader came back with an inconsistent read, and the page won't render one of those. Try again.");
        return;
      }
      renderResult(data);
    } catch (err) {
      if (err?.name === 'AbortError') {
        setStatus('error', 'The read timed out. Try once more — screenshots take longer than pasted text.');
        return;
      }
      setStatus('dev',
        "The lens backend isn't connected on this deployment. The page is fully wired — it just needs the lens Worker "
        + '(set apiBase in the page config to point at one). In the meantime, the blind bench at /judge runs with no backend at all.');
    } finally {
      clearTimeout(timer);
      submitBtn.disabled = false;
    }
  }

  submitBtn?.addEventListener('click', () => {
    const built = buildPayload();
    if (built.error) { setStatus('error', built.error); return; }
    if (!state.gateConfirmed) { gateCheck.checked = false; gateRun.disabled = true; gate.showModal(); return; }
    void submit();
  });

  // --- sample read (labelled, no network) ---
  $('[data-lens-sample]')?.addEventListener('click', () => {
    state.sample = true;
    state.withQuote = false;
    renderResult({ ...SAMPLE_RESULT });
  });
}

if (typeof document !== 'undefined') {
  const app = document.querySelector('[data-lens-app]');
  if (app) initLens(app);
}
