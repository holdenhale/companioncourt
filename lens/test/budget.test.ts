import { test } from "node:test";
import assert from "node:assert/strict";
import { LensBudget } from "../src/budget.ts";
import type { DurableObjectStateLite, LensEnv } from "../src/types.ts";

class MemoryStorage {
  map = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }
  async put(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
}

class TestBudget extends LensBudget {
  fixedNow = Date.UTC(2026, 6, 15, 12, 0, 0);
  override now(): number {
    return this.fixedNow;
  }
}

function makeBudget(vars: Partial<LensEnv> = {}): { budget: TestBudget; storage: MemoryStorage } {
  const storage = new MemoryStorage();
  const state: DurableObjectStateLite = { storage };
  const env = {
    LENS_BUDGET: { idFromName: () => "x", get: () => ({ fetch: async () => new Response("{}") }) },
    MAX_DAILY_USD: "1.00",
    MAX_DAILY_REQUESTS: "100",
    ACTOR_HOURLY_MAX: "5",
    ACTOR_DAILY_USD_MAX: "0.50",
    ...vars
  } as LensEnv;
  return { budget: new TestBudget(state, env), storage };
}

async function reserve(budget: TestBudget, actor: string, estUsd: number): Promise<{ ok: boolean; id?: string; code?: string; retryAfterSeconds?: number }> {
  const res = await budget.fetch(new Request("https://budget/reserve", { method: "POST", body: JSON.stringify({ actor, estUsd }) }));
  return (await res.json()) as { ok: boolean; id?: string; code?: string; retryAfterSeconds?: number };
}

async function settle(budget: TestBudget, path: "commit" | "release", id: string, actualUsd: number): Promise<void> {
  await budget.fetch(new Request(`https://budget/${path}`, { method: "POST", body: JSON.stringify({ id, actualUsd }) }));
}

async function stats(budget: TestBudget): Promise<{ requests: number; reservedUsd: number; spentUsd: number }> {
  const res = await budget.fetch(new Request("https://budget/stats", { method: "GET" }));
  return (await res.json()) as { requests: number; reservedUsd: number; spentUsd: number };
}

test("reserve -> commit refunds the estimate delta; release refunds everything", async () => {
  const { budget } = makeBudget();
  const r1 = await reserve(budget, "actorA", 0.1);
  assert.equal(r1.ok, true);
  await settle(budget, "commit", r1.id!, 0.04);
  let s = await stats(budget);
  assert.equal(s.reservedUsd, 0);
  assert.ok(Math.abs(s.spentUsd - 0.04) < 1e-9);

  const r2 = await reserve(budget, "actorA", 0.1);
  await settle(budget, "release", r2.id!, 0);
  s = await stats(budget);
  assert.equal(s.reservedUsd, 0);
  assert.ok(Math.abs(s.spentUsd - 0.04) < 1e-9);
});

test("hard daily cap: spent + reserved + estimate can never pass MAX_DAILY_USD", async () => {
  const { budget } = makeBudget({ ACTOR_DAILY_USD_MAX: "100", ACTOR_HOURLY_MAX: "1000" });
  // 1.00 daily cap, 0.30 each -> only 3 fit
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await reserve(budget, "actorA", 0.3));
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, true, false, false]
  );
  assert.equal(results[3]!.code, "capacity");
});

test("concurrency: 20 parallel reserves cannot race past the cap", async () => {
  const { budget } = makeBudget({ ACTOR_DAILY_USD_MAX: "100", ACTOR_HOURLY_MAX: "1000" });
  const results = await Promise.all(Array.from({ length: 20 }, (_v, i) => reserve(budget, `actor${i}`, 0.3)));
  const granted = results.filter((r) => r.ok).length;
  assert.equal(granted, 3, "exactly floor(1.00/0.30) reservations may be granted under parallel load");
  const s = await stats(budget);
  assert.ok(s.reservedUsd <= 1.0 + 1e-9);
});

test("commit is idempotent-ish: settling an unknown/settled reservation is a no-op", async () => {
  const { budget } = makeBudget();
  const r = await reserve(budget, "actorA", 0.2);
  await settle(budget, "commit", r.id!, 0.1);
  await settle(budget, "commit", r.id!, 0.1); // second settle must not double-spend
  const s = await stats(budget);
  assert.ok(Math.abs(s.spentUsd - 0.1) < 1e-9);
});

test("actual cost is clamped to the reservation (worst-case estimate is the ceiling)", async () => {
  const { budget } = makeBudget();
  const r = await reserve(budget, "actorA", 0.2);
  await settle(budget, "commit", r.id!, 5.0);
  const s = await stats(budget);
  assert.ok(Math.abs(s.spentUsd - 0.2) < 1e-9);
});

test("per-actor hourly rate limit fires with retryAfterSeconds; other actors unaffected", async () => {
  const { budget } = makeBudget({ MAX_DAILY_USD: "100", ACTOR_DAILY_USD_MAX: "100" });
  for (let i = 0; i < 5; i++) {
    const r = await reserve(budget, "actorA", 0.01);
    assert.equal(r.ok, true);
  }
  const blocked = await reserve(budget, "actorA", 0.01);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "rate_limited");
  assert.ok((blocked.retryAfterSeconds ?? 0) > 0 && (blocked.retryAfterSeconds ?? 0) <= 3600);

  const other = await reserve(budget, "actorB", 0.01);
  assert.equal(other.ok, true);

  // next hour: actorA can read again
  budget.fixedNow += 3_600_000;
  const nextHour = await reserve(budget, "actorA", 0.01);
  assert.equal(nextHour.ok, true);
});

test("per-actor daily sub-budget stops one party draining the pool", async () => {
  const { budget } = makeBudget({ MAX_DAILY_USD: "100", ACTOR_HOURLY_MAX: "1000" });
  // sub-budget 0.50, est 0.2 -> two fit, third blocked
  assert.equal((await reserve(budget, "actorA", 0.2)).ok, true);
  assert.equal((await reserve(budget, "actorA", 0.2)).ok, true);
  const blocked = await reserve(budget, "actorA", 0.2);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "actor_budget");
  assert.equal((await reserve(budget, "actorB", 0.2)).ok, true, "the pool is still open to others");
});

test("hard request ceiling is independent of cost estimation", async () => {
  const { budget } = makeBudget({ MAX_DAILY_REQUESTS: "3", MAX_DAILY_USD: "100", ACTOR_DAILY_USD_MAX: "100", ACTOR_HOURLY_MAX: "1000" });
  for (let i = 0; i < 3; i++) assert.equal((await reserve(budget, "actorA", 0)).ok, true);
  const blocked = await reserve(budget, "actorA", 0);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "capacity");
});

test("day rollover wipes all counters (and with them every actor-hash key)", async () => {
  const { budget, storage } = makeBudget({ MAX_DAILY_REQUESTS: "2", ACTOR_HOURLY_MAX: "1000" });
  assert.equal((await reserve(budget, "actorA", 0.1)).ok, true);
  assert.equal((await reserve(budget, "actorA", 0.1)).ok, true);
  assert.equal((await reserve(budget, "actorA", 0.1)).ok, false);

  budget.fixedNow += 24 * 3_600_000;
  assert.equal((await reserve(budget, "actorA", 0.1)).ok, true, "fresh day, fresh budget");
  // storage was wiped: no keys from the previous day survive
  const staleKeys = [...storage.map.keys()].filter((k) => k.startsWith("a:req:") && !k.includes(String(Math.floor(budget.fixedNow / 3_600_000))));
  assert.equal(staleKeys.length, 0);
});

test("privacy: storage never contains anything but aggregate keys and hashed actors", async () => {
  const { budget, storage } = makeBudget();
  await reserve(budget, "0123456789abcdef0123456789abcdef", 0.1);
  for (const key of storage.map.keys()) {
    assert.ok(/^(day|g:req|g:reserved|g:spent|a:req:\d+:[0-9a-f]+|a:usd:[0-9a-f]+|r:[0-9a-f-]+)$/u.test(key), `unexpected storage key shape: ${key}`);
  }
});
