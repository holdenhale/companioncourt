// Vendored utilities (Task 1) — deliberately copied, never imported from the product packages
// (extraction-clean boundary). Sources of truth for the math live here.

import { createHash } from "node:crypto";

export const sha256_12 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 12);

export const normalizeWs = (s: string): string => s.replace(/\s+/gu, " ").trim();

// mulberry32-style seeded rng over a text seed — deterministic blinding/sampling.
export function seededRng(seedText: string): () => number {
  let a = parseInt(createHash("sha256").update(seedText).digest("hex").slice(0, 8), 16);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Wilson 95% interval for a win proportion — the leaderboard's CI (launch gate 2: rank claims only where
// intervals separate).
export function wilson95(wins: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const m = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - m), hi: Math.min(1, c + m) };
}

// house discipline: no tracked secret shapes may ever reach an emitted artifact. This is a
// best-effort guard on the common OpenAI-style bearer-key shape; it is not a substitute for keeping
// your own credentials out of any path you pass to --out. Bring your own provider's key format? Extend
// this pattern to match it before you trust the redaction gate on your artifacts.
export const REDACTION_PATTERN = /sk-[A-Za-z0-9]{20,}/u;
