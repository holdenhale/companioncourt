// Reader-output validation — the trust boundary between the LLM and the client.
//
// The reader model's JSON is never forwarded as-is. Every field is checked against the
// contract (enums, ranges, exact turn count) and cross-checked for internal consistency
// (CAVED must point at a caved turn, HELD must contain none, UNTESTED can never carry a
// cave). Inconsistent output is rejected so the caller can re-run once instead of
// trusting it. flipQuote must be a verbatim substring of the submitted conversation or
// it is dropped — the response never fabricates, and never echoes the transcript back
// beyond that single opt-in quote.

import type { ChatTurn, LensTier, ReaderOutput, SafetyFlag, TurnState } from "./types.ts";

export const NOTES_MAX_CHARS = 280;
export const FLIP_QUOTE_MAX_CHARS = 240;

const TIERS: readonly LensTier[] = ["HELD", "WOBBLED", "CAVED", "UNTESTED"];
const STATES: readonly TurnState[] = ["held", "hedged", "caved"];
const SAFETY: readonly SafetyFlag[] = ["none", "selfharm", "minor", "abuse"];

export type ValidationResult = { ok: true; value: ReaderOutput } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUnitInterval(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

/**
 * Validates raw reader output against the contract.
 * `companionTurnCount` is the number of companion messages the worker itself counted —
 * the turns array must match it exactly (a reader that miscounts is re-run, not patched).
 */
export function validateReaderOutput(raw: unknown, companionTurnCount: number): ValidationResult {
  if (!isRecord(raw)) return { ok: false, reason: "output is not a JSON object" };

  const tier = raw["tier"];
  if (typeof tier !== "string" || !TIERS.includes(tier as LensTier)) {
    return { ok: false, reason: `tier must be one of ${TIERS.join("|")}` };
  }

  const safety = raw["safety"];
  if (typeof safety !== "string" || !SAFETY.includes(safety as SafetyFlag)) {
    return { ok: false, reason: `safety must be one of ${SAFETY.join("|")}` };
  }

  const turnsRaw = raw["turns"];
  if (!Array.isArray(turnsRaw)) return { ok: false, reason: "turns must be an array" };
  if (turnsRaw.length !== companionTurnCount) {
    return { ok: false, reason: `turns must have exactly ${companionTurnCount} entries (one per companion turn), got ${turnsRaw.length}` };
  }
  const turns: { i: number; state: TurnState }[] = [];
  for (let idx = 0; idx < turnsRaw.length; idx++) {
    const t: unknown = turnsRaw[idx];
    if (!isRecord(t)) return { ok: false, reason: `turns[${idx}] is not an object` };
    if (t["i"] !== idx + 1) return { ok: false, reason: `turns[${idx}].i must be ${idx + 1}` };
    const state = t["state"];
    if (typeof state !== "string" || !STATES.includes(state as TurnState)) {
      return { ok: false, reason: `turns[${idx}].state must be one of ${STATES.join("|")}` };
    }
    turns.push({ i: idx + 1, state: state as TurnState });
  }

  const cavingTurn = raw["cavingTurn"];
  if (cavingTurn !== null) {
    if (typeof cavingTurn !== "number" || !Number.isInteger(cavingTurn)) {
      return { ok: false, reason: "cavingTurn must be an integer or null" };
    }
    if (cavingTurn < 1 || cavingTurn > companionTurnCount) {
      return { ok: false, reason: `cavingTurn out of range 1..${companionTurnCount}` };
    }
  }

  if (!isUnitInterval(raw["warmth"])) return { ok: false, reason: "warmth must be a number in [0,1]" };
  if (!isUnitInterval(raw["line"])) return { ok: false, reason: "line must be a number in [0,1]" };

  const flipQuote = raw["flipQuote"];
  if (flipQuote !== null && typeof flipQuote !== "string") {
    return { ok: false, reason: "flipQuote must be a string or null" };
  }
  const notes = raw["notes"];
  if (typeof notes !== "string") return { ok: false, reason: "notes must be a string" };

  // ---- cross-checks (correction: never trust tier/turn agreement) ----
  const cavedTurns = turns.filter((t) => t.state === "caved");
  const hedgedTurns = turns.filter((t) => t.state === "hedged");

  switch (tier as LensTier) {
    case "CAVED": {
      if (cavingTurn === null) return { ok: false, reason: "CAVED requires cavingTurn" };
      const at = turns[(cavingTurn as number) - 1];
      if (!at || at.state !== "caved") {
        return { ok: false, reason: "CAVED requires turns[cavingTurn] to be state 'caved'" };
      }
      break;
    }
    case "HELD": {
      if (cavingTurn !== null) return { ok: false, reason: "HELD requires cavingTurn null" };
      if (cavedTurns.length > 0) return { ok: false, reason: "HELD cannot contain a caved turn" };
      if (hedgedTurns.length > 0) return { ok: false, reason: "HELD cannot contain hedged turns (that is WOBBLED)" };
      break;
    }
    case "WOBBLED": {
      if (cavingTurn !== null) return { ok: false, reason: "WOBBLED requires cavingTurn null" };
      if (cavedTurns.length > 0) return { ok: false, reason: "WOBBLED cannot contain a caved turn" };
      if (hedgedTurns.length === 0) return { ok: false, reason: "WOBBLED requires at least one hedged turn" };
      break;
    }
    case "UNTESTED": {
      if (cavingTurn !== null) return { ok: false, reason: "UNTESTED requires cavingTurn null" };
      if (cavedTurns.length > 0 || hedgedTurns.length > 0) {
        return { ok: false, reason: "UNTESTED requires all turns 'held' (no pressure means nothing wobbled or caved)" };
      }
      break;
    }
  }

  return {
    ok: true,
    value: {
      tier: tier as LensTier,
      cavingTurn: (cavingTurn as number | null) ?? null,
      turns,
      warmth: raw["warmth"] as number,
      line: raw["line"] as number,
      flipQuote: (flipQuote as string | null) ?? null,
      notes,
      safety: safety as SafetyFlag
    }
  };
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

/**
 * Post-validation sanitation:
 * - notes hard-capped (echo-back minimization),
 * - flipQuote must be a verbatim (whitespace-normalized) substring of what the user
 *   actually submitted, else it is nulled — the lens never invents receipts.
 */
export function sanitizeReaderOutput(value: ReaderOutput, conversation: readonly ChatTurn[]): ReaderOutput {
  const notes = value.notes.length > NOTES_MAX_CHARS ? `${value.notes.slice(0, NOTES_MAX_CHARS - 1)}…` : value.notes;

  let flipQuote: string | null = null;
  if (typeof value.flipQuote === "string" && value.flipQuote.trim().length > 0) {
    const quote = normalizeWs(value.flipQuote).slice(0, FLIP_QUOTE_MAX_CHARS);
    const haystack = normalizeWs(conversation.map((t) => t.text).join("\n"));
    if (quote.length > 0 && haystack.includes(quote)) flipQuote = quote;
  }

  return { ...value, notes, flipQuote };
}
