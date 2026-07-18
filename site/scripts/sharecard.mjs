// scripts/sharecard.mjs — canvas share cards for the lens (/check) and the
// blind bench (/judge). Server never sees a card: everything is drawn in the
// visitor's browser and downloaded locally.
//
// Hard rules baked into this module (they are not options):
//   * The card never renders, derives, or accepts a subject model/brand name.
//     The subject is always generic — "this companion" / "the conversation".
//   * The provenance stamp is permanent and non-toggleable; only the receipt
//     quote is opt-in.
//   * "a lens, not a verdict · your one chat, unverified" is locked into the
//     headline zone, and a faint full-bleed watermark covers the whole card.
//   * warmth/line are banded low/med/high — one read has no finer precision.

export const PERMANENT_STAMP = 'unverified · user-submitted · single automated read';
export const MICROTEXT = 'one conversation · one pass · a lens, not a verdict · companioncourt.ai/check';
export const HEADLINE_LOCK = 'a lens, not a verdict · your one chat, unverified';
export const WATERMARK = 'SINGLE READ · UNVERIFIED';
export const JUDGE_MICROTEXT = 'public rulings · verbatim excerpts · companioncourt.ai/judge';
export const QUOTE_LABEL = 'submitted text';

const BG = '#050817';
const INK = '#f7f5ff';
const SOFT = '#c7c6db';
const MUTED = '#9193ad';
const CYAN = '#70dcff';
const AMBER = '#ffad5c';
const PINK = '#ff6dbb';
const RED = '#ff5d73';
const GREY = '#3a3f58';

export const TIER_COLORS = { HELD: CYAN, WOBBLED: AMBER, CAVED: RED, UNTESTED: GREY };
const STATE_COLORS = { held: CYAN, hedged: AMBER, caved: RED, untested: GREY };

/** Strip control characters and clamp — everything drawn to canvas goes through here. */
export function sanitizeLine(value, max = 300) {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Coarse banding: one automated read supports low/med/high, never decimals. */
export function bandLabel(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 'low';
  if (v < 1 / 3) return 'low';
  if (v < 2 / 3) return 'med';
  return 'high';
}

export function firstHedgedTurn(result) {
  const hit = (result?.turns ?? []).find((t) => t.state === 'hedged');
  return hit ? hit.i : null;
}

/** The result headline. Formats are fixed; the number is the score. */
export function headlineFor(result) {
  const total = result?.turns?.length ?? 0;
  switch (result?.tier) {
    case 'CAVED':
      return `CAVED at message ${result.cavingTurn}`;
    case 'WOBBLED': {
      const n = firstHedgedTurn(result);
      return n ? `WOBBLED at message ${n} — never quite caved` : 'WOBBLED — never quite caved';
    }
    case 'HELD':
      return `HELD — all ${total} messages`;
    case 'UNTESTED':
      return 'UNTESTED — this chat never really put it on the spot';
    default:
      return '';
  }
}

/** Every text line burned into a lens card, in one place so tests can pin them.
 *  Accepts only the fields it knows; a brand/model/subject label on the input
 *  object is ignored by construction — there is no code path that renders it. */
export function lensCardLines(result, opts = {}) {
  const lines = {
    headline: sanitizeLine(headlineFor(result), 80),
    lock: HEADLINE_LOCK,
    stamp: PERMANENT_STAMP,
    micro: MICROTEXT,
    watermark: WATERMARK,
    subject: 'this companion',
    // No warmth/line axes on the shareable card — the two-axis read lives on
    // the results page only, banded low/med/high.
    reader: result?.readerModel
      ? sanitizeLine(`reader: ${result.readerModel} (requested reader model — provider may route/version)`, 110)
      : 'reader: requested reader model — provider may route/version',
  };
  if (opts.withQuote && result?.flipQuote) {
    lines.quoteLabel = QUOTE_LABEL;
    lines.quote = sanitizeLine(result.flipQuote, 220);
  }
  if (opts.sample) lines.sample = 'SAMPLE — not a real read';
  return lines;
}

export function judgeCardLines(score) {
  const n = Math.max(0, Math.trunc(score?.matched ?? 0));
  const m = Math.max(0, Math.trunc(score?.total ?? 0));
  return {
    title: 'YOU BE THE JUDGE',
    headline: `Matched the court on ${n} of ${m}`,
    sub: 'blind calls on real docket transcripts',
    micro: JUDGE_MICROTEXT,
    cta: 'read your own conversation → companioncourt.ai/check',
  };
}

/** Accessible description of the card image, used for the download alt text
 *  and the on-page figcaption. */
export function cardAltText(lines) {
  const parts = [
    `Share card: ${lines.headline || lines.title || ''}`,
    lines.axes,
    lines.quote ? `${lines.quoteLabel}: “${lines.quote}”` : '',
    lines.stamp,
    lines.micro,
  ].filter(Boolean);
  return parts.join('. ');
}

// ---------------------------------------------------------------------------
// Drawing (browser only)
// ---------------------------------------------------------------------------

function fontStack(px, weight = 600) {
  return `${weight} ${px}px "Geist", "PingFang SC", system-ui, sans-serif`;
}

function displayFont(px) {
  return `400 ${px}px "League Gothic", "Arial Narrow", sans-serif`;
}

function paintWatermark(ctx, w, h) {
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 9);
  ctx.font = displayFont(108);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(247, 245, 255, 0.05)';
  for (let row = -2; row <= 2; row++) {
    ctx.fillText(WATERMARK, ((row % 2) * w) / 5, row * 190);
  }
  ctx.restore();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
      lines += 1;
      if (lines >= maxLines - 1) {
        let tail = line;
        while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 1) tail = tail.slice(0, -1);
        ctx.fillText(`${tail}…`, x, y);
        return y + lineHeight;
      }
    } else {
      line = probe;
    }
  }
  ctx.fillText(line, x, y);
  return y + lineHeight;
}

function paintStrip(ctx, turns, x, y, w, h, median) {
  const n = Math.max(turns.length, 1);
  const gap = Math.min(6, w / (n * 8));
  const segW = (w - gap * (n - 1)) / n;
  turns.forEach((t, idx) => {
    ctx.fillStyle = STATE_COLORS[t.state] ?? GREY;
    ctx.fillRect(x + idx * (segW + gap), y, segW, h);
  });
  if (median && median >= 1 && median <= n) {
    const tickX = x + (median - 0.5) * (segW + gap);
    ctx.strokeStyle = SOFT;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(tickX, y - 14);
    ctx.lineTo(tickX, y + h + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    ctx.font = fontStack(18, 500);
    ctx.textAlign = 'center';
    ctx.fillText('docket median', tickX, y - 22);
    ctx.textAlign = 'left';
  }
}

export function drawLensCard(canvas, result, opts = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const lines = lensCardLines(result, opts);
  const tierColor = TIER_COLORS[result?.tier] ?? GREY;
  const turns = (result?.tier === 'UNTESTED')
    ? (result?.turns ?? []).map((t) => ({ ...t, state: 'untested' }))
    : (result?.turns ?? []);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  paintWatermark(ctx, w, h);

  const left = 72;
  // Headline zone: lock line, tier headline, subject line — inseparable.
  ctx.fillStyle = MUTED;
  ctx.font = fontStack(22, 500);
  ctx.textAlign = 'left';
  ctx.fillText(lines.lock, left, 78);

  ctx.fillStyle = tierColor;
  ctx.font = displayFont(118);
  wrapText(ctx, lines.headline.toUpperCase(), left, 196, w - left * 2, 112, 2);

  ctx.fillStyle = SOFT;
  ctx.font = fontStack(26, 500);
  ctx.fillText(`how ${lines.subject} met the pressure, message by message`, left, 330);

  paintStrip(ctx, turns, left, 372, w - left * 2, 46, opts.median);

  if (lines.quote) {
    ctx.fillStyle = MUTED;
    ctx.font = fontStack(20, 500);
    ctx.fillText(lines.quoteLabel, left, 494);
    ctx.fillStyle = SOFT;
    ctx.font = `italic 500 26px "Geist", "PingFang SC", system-ui, sans-serif`;
    wrapText(ctx, `“${lines.quote}”`, left, 526, w - left * 2, 34, 2);
  }

  ctx.fillStyle = MUTED;
  ctx.font = fontStack(19, 500);
  ctx.fillText(lines.reader, left, h - 92);
  ctx.fillStyle = SOFT;
  ctx.font = fontStack(21, 650);
  ctx.fillText(lines.stamp, left, h - 62);
  ctx.fillStyle = MUTED;
  ctx.font = fontStack(19, 500);
  ctx.fillText(lines.micro, left, h - 32);

  if (lines.sample) {
    ctx.save();
    ctx.fillStyle = PINK;
    ctx.font = displayFont(54);
    ctx.textAlign = 'right';
    ctx.fillText(lines.sample, w - 48, 78);
    ctx.restore();
  }
  return lines;
}

export function drawJudgeCard(canvas, score) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const lines = judgeCardLines(score);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  paintWatermark(ctx, w, h);

  const left = 72;
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = fontStack(22, 500);
  ctx.fillText(lines.sub, left, 84);

  ctx.fillStyle = INK;
  ctx.font = displayFont(120);
  ctx.fillText(lines.title, left, 210);

  ctx.fillStyle = CYAN;
  ctx.font = displayFont(88);
  ctx.fillText(lines.headline.toUpperCase(), left, 330);

  ctx.fillStyle = SOFT;
  ctx.font = fontStack(26, 650);
  ctx.fillText(lines.cta, left, h - 92);
  ctx.fillStyle = MUTED;
  ctx.font = fontStack(19, 500);
  ctx.fillText(lines.micro, left, h - 40);
  return lines;
}

/** Download helper shared by both pages. */
export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}
