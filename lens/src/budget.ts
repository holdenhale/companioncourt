// LensBudget — the single strongly-consistent money/rate gate, as a Durable Object.
//
// Why a DO and not KV: KV is eventually-consistent and its writes race, so a $15/day
// cap "enforced" through KV can be blown past by any concurrent burst. A Durable
// Object serializes access (platform input gates; plus an internal mutex so the class
// is safe even outside the platform), which makes reserve/commit genuinely atomic.
//
// Accounting model (reserve -> commit/release):
// - RESERVE the estimated worst-case cost BEFORE any model call; the reservation
//   counts against the daily cap immediately, so parallel requests cannot all squeeze
//   through the same remaining dollar;
// - COMMIT the actual cost afterwards (refunding the reserved delta);
// - RELEASE the full reservation when no tokens were generated.
//
// Gates, in order:
// 1. hard per-day request-count ceiling (independent of any cost estimation),
// 2. per-actor hourly request limit (salted-hash actor keys only — never raw IPs),
// 3. per-actor daily sub-budget (one party cannot drain the global pool),
// 4. global daily USD cap: spent + reserved + estimate <= MAX_DAILY_USD.
//
// Privacy: storage holds ONLY aggregate numbers and salted-hash actor keys with
// day/hour-scoped lifetimes (wiped at day rollover). No transcripts, no raw IPs,
// nothing user-identifying.

import type { DurableObjectStateLite, LensEnv } from "./types.ts";

export interface ReserveRequest {
  actor: string;
  estUsd: number;
}

export type ReserveResponse =
  | { ok: true; id: string }
  | { ok: false; code: "capacity" | "rate_limited" | "actor_budget"; retryAfterSeconds?: number };

interface Reservation {
  est: number;
  actor: string;
}

const DEFAULTS = {
  MAX_DAILY_USD: 15,
  MAX_DAILY_REQUESTS: 800,
  ACTOR_HOURLY_MAX: 5,
  ACTOR_DAILY_USD_MAX: 0.75
};

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export class LensBudget {
  #state: DurableObjectStateLite;
  #env: LensEnv;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectStateLite, env: LensEnv) {
    this.#state = state;
    this.#env = env;
  }

  /** Overridable for tests. */
  now(): number {
    return Date.now();
  }

  async fetch(request: Request): Promise<Response> {
    // Serialize all handler bodies: with platform input gates this is redundant,
    // without them (tests, other runtimes) it is what keeps the counters atomic.
    const run = this.#chain.then(() => this.#handle(request));
    this.#chain = run.catch(() => undefined);
    return run;
  }

  async #handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const day = new Date(this.now()).toISOString().slice(0, 10);
    await this.#rolloverIfNeeded(day);

    if (request.method === "GET" && url.pathname === "/stats") {
      return Response.json({
        day,
        requests: await this.#getNum("g:req"),
        reservedUsd: await this.#getNum("g:reserved"),
        spentUsd: await this.#getNum("g:spent")
      });
    }
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return new Response("bad request", { status: 400 });

    switch (url.pathname) {
      case "/reserve":
        return Response.json(await this.#reserve(String(body["actor"] ?? ""), Number(body["estUsd"] ?? NaN)));
      case "/commit":
        return Response.json(await this.#settle(String(body["id"] ?? ""), Number(body["actualUsd"] ?? NaN)));
      case "/release":
        return Response.json(await this.#settle(String(body["id"] ?? ""), 0));
      default:
        return new Response("not found", { status: 404 });
    }
  }

  async #rolloverIfNeeded(day: string): Promise<void> {
    const storedDay = (await this.#state.storage.get("day")) as string | undefined;
    if (storedDay !== day) {
      await this.#state.storage.deleteAll();
      await this.#state.storage.put("day", day);
    }
  }

  async #getNum(key: string): Promise<number> {
    const v = await this.#state.storage.get(key);
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  async #reserve(actor: string, estUsd: number): Promise<ReserveResponse> {
    if (actor.length === 0 || !Number.isFinite(estUsd) || estUsd < 0) {
      return { ok: false, code: "capacity" };
    }
    const maxDailyUsd = num(this.#env.MAX_DAILY_USD, DEFAULTS.MAX_DAILY_USD);
    const maxDailyReq = num(this.#env.MAX_DAILY_REQUESTS, DEFAULTS.MAX_DAILY_REQUESTS);
    const actorHourlyMax = num(this.#env.ACTOR_HOURLY_MAX, DEFAULTS.ACTOR_HOURLY_MAX);
    const actorDailyUsdMax = num(this.#env.ACTOR_DAILY_USD_MAX, DEFAULTS.ACTOR_DAILY_USD_MAX);

    // Gate 1: hard request ceiling, independent of cost estimation.
    const requests = await this.#getNum("g:req");
    if (requests + 1 > maxDailyReq) return { ok: false, code: "capacity" };

    // Gate 2: per-actor hourly rate limit.
    const hour = Math.floor(this.now() / 3_600_000);
    const actorReqKey = `a:req:${hour}:${actor}`;
    const actorHourly = await this.#getNum(actorReqKey);
    if (actorHourly + 1 > actorHourlyMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((hour + 1) * 3_600_000 - this.now()) / 1000));
      return { ok: false, code: "rate_limited", retryAfterSeconds };
    }

    // Gate 3: per-actor daily sub-budget.
    const actorUsdKey = `a:usd:${actor}`;
    const actorUsd = await this.#getNum(actorUsdKey);
    if (actorUsd + estUsd > actorDailyUsdMax) return { ok: false, code: "actor_budget" };

    // Gate 4: global daily USD cap against spent + outstanding reservations.
    const spent = await this.#getNum("g:spent");
    const reserved = await this.#getNum("g:reserved");
    if (spent + reserved + estUsd > maxDailyUsd) return { ok: false, code: "capacity" };

    const id = crypto.randomUUID();
    await this.#state.storage.put("g:req", requests + 1);
    await this.#state.storage.put(actorReqKey, actorHourly + 1);
    await this.#state.storage.put(actorUsdKey, actorUsd + estUsd);
    await this.#state.storage.put("g:reserved", reserved + estUsd);
    await this.#state.storage.put(`r:${id}`, { est: estUsd, actor } as Reservation);
    return { ok: true, id };
  }

  /** Commit (actualUsd > 0) or release (actualUsd = 0): refund est-actual everywhere. */
  async #settle(id: string, actualUsd: number): Promise<{ ok: boolean }> {
    const key = `r:${id}`;
    const resv = (await this.#state.storage.get(key)) as Reservation | undefined;
    if (!resv) return { ok: false };
    const actual = Number.isFinite(actualUsd) && actualUsd >= 0 ? Math.min(actualUsd, resv.est) : resv.est;

    const reserved = await this.#getNum("g:reserved");
    const spent = await this.#getNum("g:spent");
    const actorUsd = await this.#getNum(`a:usd:${resv.actor}`);

    await this.#state.storage.put("g:reserved", Math.max(0, reserved - resv.est));
    await this.#state.storage.put("g:spent", spent + actual);
    await this.#state.storage.put(`a:usd:${resv.actor}`, Math.max(0, actorUsd - resv.est + actual));
    await this.#state.storage.delete(key);
    return { ok: true };
  }
}
