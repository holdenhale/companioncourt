// Input parsers: pasted text, uploaded files (.txt / .json / WhatsApp export),
// and normalization shared by every mode (including vision transcription output).
//
// Discipline:
// - hard caps BEFORE any model call (raw size, message count, char window),
// - truncation keeps the TAIL of the conversation (the most recent messages) and
//   reports what was kept, so the client can say "read the last N messages",
// - everything stays in memory; nothing here logs message content.

import type { ChatTurn, ParsedConversation, Speaker } from "./types.ts";
import { LensError } from "./types.ts";

/** Max characters of conversation forwarded to the reader (tail-kept). */
export const MAX_INPUT_CHARS = 8000;
/** Max characters accepted for a single raw file BEFORE parsing. */
export const MAX_RAW_FILE_CHARS = 200_000;
/** Max messages forwarded to the reader (tail-kept). */
export const MAX_MESSAGES = 80;
/** Max files per request. */
export const MAX_FILES = 3;

const USER_LABELS = /^(?:me|user|human|you\b.*?|我|用户|本人)$/iu;
const COMPANION_LABELS =
  /^(?:ai|assistant|bot|companion|model|chatgpt|gpt(?:-[\w.]+)?|claude|gemini|char(?:acter)?(?:\.ai)?|replika|pi|copilot|助手|伴侣|机器人|它)$/iu;

// WhatsApp export line, both bracketed and dash styles:
//   [2026/07/01, 23:14:05] Alice: hey     |     01/07/2026, 23:14 - Alice: hey
const WHATSAPP_LINE =
  /^\[?(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]?\s*(?:-\s*)?([^:]{1,60}?):\s(.*)$/u;

const WHATSAPP_NOISE =
  /(end-to-end encrypted|Messages and calls are end-to-end|<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|missed voice call|missed video call|消息和通话都进行端到端加密|<媒体文件已省略>)/iu;

/** Parses a WhatsApp .txt export. First distinct sender is treated as the user. */
export function parseWhatsApp(text: string): ChatTurn[] | null {
  const lines = text.split(/\r?\n/u);
  const turns: ChatTurn[] = [];
  let firstSender: string | null = null;
  let current: { sender: string; parts: string[] } | null = null;
  let matched = 0;

  const flush = (): void => {
    if (!current) return;
    const body = current.parts.join("\n").trim();
    if (body.length > 0 && !WHATSAPP_NOISE.test(body)) {
      const speaker: Speaker = current.sender === firstSender ? "user" : "companion";
      turns.push({ speaker, text: body });
    }
    current = null;
  };

  for (const line of lines) {
    const m = WHATSAPP_LINE.exec(line);
    if (m) {
      matched++;
      flush();
      const sender = m[3]!.trim();
      if (firstSender === null) firstSender = sender;
      current = { sender, parts: [m[4] ?? ""] };
    } else if (current && line.trim().length > 0) {
      current.parts.push(line);
    }
  }
  flush();

  // Require the format to actually dominate the file, or it is not a WhatsApp export.
  if (matched < 2 || turns.length < 2) return null;
  return turns;
}

/** Parses `Speaker: text` labeled lines (Me:/AI:/User:/Claude:/我：…), with continuations. */
export function parseLabeled(text: string): ChatTurn[] | null {
  const lines = text.split(/\r?\n/u);
  const turns: ChatTurn[] = [];
  let current: { speaker: Speaker; parts: string[] } | null = null;
  let labeledLines = 0;

  const flush = (): void => {
    if (!current) return;
    const body = current.parts.join("\n").trim();
    if (body.length > 0) turns.push({ speaker: current.speaker, text: body });
    current = null;
  };

  for (const line of lines) {
    const m = /^\s*(?:\*\*)?([^:：\n]{1,24}?)(?:\*\*)?\s*[:：]\s*(.*)$/u.exec(line);
    const label = m?.[1]?.trim();
    let speaker: Speaker | null = null;
    if (label && USER_LABELS.test(label)) speaker = "user";
    else if (label && COMPANION_LABELS.test(label)) speaker = "companion";

    if (speaker && m) {
      labeledLines++;
      flush();
      current = { speaker, parts: [m[2] ?? ""] };
    } else if (current && line.trim().length > 0) {
      current.parts.push(line);
    }
  }
  flush();

  if (labeledLines < 2) return null;
  const speakers = new Set(turns.map((t) => t.speaker));
  if (speakers.size < 2) return null;
  return turns;
}

/** Last resort for pasted text: blank-line blocks, alternating speakers, user first. */
export function parseAlternating(text: string): ChatTurn[] | null {
  const blocks = text
    .split(/\n\s*\n/u)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (blocks.length < 2) return null;
  return blocks.map((b, idx) => ({ speaker: idx % 2 === 0 ? ("user" as const) : ("companion" as const), text: b }));
}

function speakerFromRole(role: unknown): Speaker | null {
  if (typeof role !== "string") return null;
  const r = role.toLowerCase();
  if (["user", "human", "me"].includes(r)) return "user";
  if (["assistant", "ai", "model", "bot", "companion", "character"].includes(r)) return "companion";
  return null; // system/tool/etc. dropped
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : null))
      .filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (typeof content === "object" && content !== null) {
    const c = content as { parts?: unknown; text?: unknown };
    if (Array.isArray(c.parts)) return c.parts.filter((p): p is string => typeof p === "string").join("\n");
    if (typeof c.text === "string") return c.text;
  }
  return null;
}

type JsonMsg = { role?: unknown; speaker?: unknown; sender?: unknown; author?: unknown; content?: unknown; text?: unknown; message?: unknown };

function turnFromJsonMessage(m: JsonMsg): ChatTurn | null {
  const author = m.author as { role?: unknown } | undefined;
  const speaker =
    speakerFromRole(m.role) ??
    speakerFromRole(m.speaker) ??
    speakerFromRole(m.sender) ??
    (author ? speakerFromRole(author.role) : null);
  if (!speaker) return null;
  const text = textFromContent(m.content) ?? textFromContent(m.text) ?? textFromContent(m.message);
  if (!text || text.trim().length === 0) return null;
  return { speaker, text: text.trim() };
}

/** ChatGPT export `mapping` object: nodes with .message, ordered by create_time. */
function turnsFromMapping(mapping: Record<string, unknown>): ChatTurn[] {
  const entries: { at: number; turn: ChatTurn }[] = [];
  for (const node of Object.values(mapping)) {
    const msg = (node as { message?: unknown })?.message as
      | (JsonMsg & { create_time?: unknown })
      | null
      | undefined;
    if (!msg || typeof msg !== "object") continue;
    const turn = turnFromJsonMessage(msg);
    if (!turn) continue;
    const at = typeof msg.create_time === "number" ? msg.create_time : Number.MAX_SAFE_INTEGER;
    entries.push({ at, turn });
  }
  entries.sort((a, b) => a.at - b.at);
  return entries.map((e) => e.turn);
}

/** Parses common JSON chat exports: [{role,content}], {messages:[…]}, ChatGPT {mapping}. */
export function parseJsonExport(text: string): ChatTurn[] | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }

  const tryList = (list: unknown): ChatTurn[] | null => {
    if (!Array.isArray(list)) return null;
    const turns = list.map((m) => turnFromJsonMessage(m as JsonMsg)).filter((t): t is ChatTurn => t !== null);
    return turns.length >= 2 ? turns : null;
  };

  if (Array.isArray(root)) {
    const direct = tryList(root);
    if (direct) return direct;
    // Array of conversations (ChatGPT conversations.json): use the first with a mapping.
    for (const item of root) {
      const mapping = (item as { mapping?: unknown })?.mapping;
      if (mapping && typeof mapping === "object") {
        const turns = turnsFromMapping(mapping as Record<string, unknown>);
        if (turns.length >= 2) return turns;
      }
    }
    return null;
  }

  if (typeof root === "object" && root !== null) {
    const obj = root as { messages?: unknown; mapping?: unknown; chat_messages?: unknown };
    const fromMessages = tryList(obj.messages) ?? tryList(obj.chat_messages);
    if (fromMessages) return fromMessages;
    if (obj.mapping && typeof obj.mapping === "object") {
      const turns = turnsFromMapping(obj.mapping as Record<string, unknown>);
      if (turns.length >= 2) return turns;
    }
  }
  return null;
}

/** Parses pasted free text through the strategy chain. */
export function parseText(text: string): ChatTurn[] {
  const turns = parseWhatsApp(text) ?? parseJsonExport(text) ?? parseLabeled(text) ?? parseAlternating(text);
  if (!turns) {
    throw new LensError(
      "unparseable",
      "could not split this text into a two-party conversation",
      422,
      "label the speakers (e.g. `Me:` / `AI:`) or separate messages with blank lines"
    );
  }
  return turns;
}

/** Parses one uploaded file (already decoded to UTF-8 text client-side). */
export function parseFile(name: string, text: string): ChatTurn[] {
  if (text.length > MAX_RAW_FILE_CHARS) {
    throw new LensError("file_too_large", `file exceeds ${MAX_RAW_FILE_CHARS} characters before parsing`, 413);
  }
  const looksJson = /\.json$/iu.test(name) || /^\s*[[{]/u.test(text);
  if (looksJson) {
    const turns = parseJsonExport(text);
    if (turns) return turns;
  }
  return parseText(text);
}

/**
 * Shared normalization for every input mode:
 * merges consecutive same-speaker messages, drops empties, enforces the tail-kept
 * char/message window, and requires a readable two-party conversation.
 */
export function normalizeConversation(rawTurns: readonly ChatTurn[]): ParsedConversation {
  const merged: ChatTurn[] = [];
  for (const t of rawTurns) {
    const text = t.text.trim();
    if (text.length === 0) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.speaker === t.speaker) prev.text = `${prev.text}\n${text}`;
    else merged.push({ speaker: t.speaker, text });
  }

  const totalMessages = merged.length;
  if (totalMessages < 2 || !merged.some((t) => t.speaker === "companion")) {
    throw new LensError(
      "too_short",
      "need at least one user message and one companion message",
      422,
      "the lens reads a two-party conversation; make sure both sides are present"
    );
  }

  // Keep the TAIL: most recent whole messages within the char and message windows.
  const kept: ChatTurn[] = [];
  let remaining = MAX_INPUT_CHARS;
  let sliced = false;
  for (let idx = merged.length - 1; idx >= 0 && kept.length < MAX_MESSAGES; idx--) {
    const t = merged[idx]!;
    if (t.text.length <= remaining) {
      kept.unshift(t);
      remaining -= t.text.length;
      continue;
    }
    // Message is bigger than what's left of the window. If we still lack minimal
    // context (fewer than 2 messages), keep its tail slice but leave room for at
    // least one earlier message; otherwise stop (older messages are dropped).
    if (kept.length < 2 && remaining >= 400) {
      const slice = Math.max(400, remaining - 1200);
      kept.unshift({ speaker: t.speaker, text: t.text.slice(t.text.length - slice) });
      remaining -= slice;
      sliced = true;
      continue;
    }
    break;
  }

  if (kept.length < 2 || !kept.some((t) => t.speaker === "companion")) {
    throw new LensError("too_short", "after truncation, too little conversation remained to read", 422);
  }

  // Truncated if we dropped leading messages OR tail-sliced an oversized message.
  const truncated = kept.length < totalMessages || sliced;

  return {
    turns: kept,
    totalMessages,
    keptMessages: kept.length,
    truncated
  };
}

export function companionTurnCount(turns: readonly ChatTurn[]): number {
  return turns.filter((t) => t.speaker === "companion").length;
}
