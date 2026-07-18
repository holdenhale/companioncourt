// Shared types for the CompanionCourt lens worker.
//
// Everything here is deliberately dependency-free: the worker runs on Cloudflare Workers,
// the unit tests run under plain `node --test` (type stripping), and neither side needs
// @cloudflare/workers-types. The tiny structural interfaces below cover exactly the slice
// of the platform API this worker touches.

export type Speaker = "user" | "companion";

/** One message of the submitted conversation, after parsing/normalization. */
export interface ChatTurn {
  speaker: Speaker;
  text: string;
}

export interface ParsedConversation {
  turns: ChatTurn[];
  /** Message count before tail-truncation. */
  totalMessages: number;
  /** Message count actually sent to the reader (the TAIL of the conversation). */
  keptMessages: number;
  truncated: boolean;
}

export type LensTier = "HELD" | "WOBBLED" | "CAVED" | "UNTESTED";
export type TurnState = "held" | "hedged" | "caved";
export type SafetyFlag = "none" | "selfharm" | "minor" | "abuse";

export interface LensTurnMark {
  /** 1-based index of the COMPANION turn (user messages are context, not marked). */
  i: number;
  state: TurnState;
}

/** What the reader model must return (validated server-side, never trusted). */
export interface ReaderOutput {
  tier: LensTier;
  cavingTurn: number | null;
  turns: LensTurnMark[];
  warmth: number;
  line: number;
  flipQuote: string | null;
  notes: string;
  safety: SafetyFlag;
}

/** Structured error the API returns; `code` is the contract, `message` is for humans. */
export class LensError extends Error {
  code: string;
  status: number;
  hint: string | undefined;
  retryAfterSeconds: number | undefined;

  constructor(code: string, message: string, status: number, hint?: string, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// ---- minimal platform shapes (structural, no @cloudflare/workers-types needed) ----

export interface KVNamespaceLite {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface DurableObjectStubLite {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLite {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLite;
}

export interface DurableObjectStorageLite {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
}

export interface DurableObjectStateLite {
  storage: DurableObjectStorageLite;
}

export interface ExecutionContextLite {
  waitUntil(p: Promise<unknown>): void;
}

/** Worker environment: vars from wrangler.toml [vars], secrets via `wrangler secret put`. */
export interface LensEnv {
  // --- bindings ---
  LENS_BUDGET: DurableObjectNamespaceLite;
  LENS_CACHE?: KVNamespaceLite; // optional short-TTL result cache (content-hash -> result JSON, never the transcript)
  IMAGES?: unknown; // optional Cloudflare Images binding for server-side downscale before the vision call

  // --- secrets (never in wrangler.toml, never logged) ---
  MODEL_ENDPOINT?: string; // gateway base URL, no trailing /v1
  MODEL_API_KEY?: string;
  LENS_ACTOR_SALT?: string; // salt for actor-key hashing; only salted hashes are ever stored
  TURNSTILE_SECRET?: string; // optional: enables first-party Turnstile verification

  // --- vars ---
  ALLOWED_ORIGIN?: string;
  READER_MODEL?: string;
  VISION_MODEL?: string;
  MAX_DAILY_USD?: string;
  MAX_DAILY_REQUESTS?: string;
  ACTOR_HOURLY_MAX?: string;
  ACTOR_DAILY_USD_MAX?: string;
  EST_READER_CALL_USD?: string;
  EST_VISION_PER_IMAGE_USD?: string;
  MODEL_USD_PER_MTOK_IN?: string;
  MODEL_USD_PER_MTOK_OUT?: string;
  CACHE_TTL_SECONDS?: string;
}
