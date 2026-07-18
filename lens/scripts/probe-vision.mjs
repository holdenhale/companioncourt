#!/usr/bin/env node
// Live probe for a usable VISION model on the gateway, over the exact production call
// path (gatewayChat -> POST {endpoint}/v1/chat/completions with image_url parts).
// Known gateway quirks are exercised by construction: temperature-rejection retry is
// inside gatewayChat, and requests are always timeout-bounded.
//
// Two stages:
//   1. capability probe: a procedurally generated PNG (no text) + "describe as JSON"
//      across candidate models -> first model that answers sensibly wins;
//   2. transcription probe (only if stage 1 found a model): a synthetic chat image
//      rendered locally (macOS qlmanage thumbnail of a text file, if available) run
//      through the REAL transcribeImages() path.
//
// Usage:
//   source <your local model.env>   # exports HB_COMPANION_MODEL_ENDPOINT / _API_KEY
//   npm run probe:vision
//
// Output discipline: everything printed passes through redact().

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gatewayChat } from "../src/reader.ts";
import { transcribeImages } from "../src/images.ts";

const ENDPOINT = process.env.HB_COMPANION_MODEL_ENDPOINT;
const API_KEY = process.env.HB_COMPANION_MODEL_API_KEY;
if (!ENDPOINT || !API_KEY) {
  console.error("missing HB_COMPANION_MODEL_ENDPOINT / HB_COMPANION_MODEL_API_KEY — source your local model.env first");
  process.exit(1);
}
const SECRET_VALUES = [ENDPOINT, API_KEY];
function redact(value) {
  let out = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of SECRET_VALUES) out = out.split(secret).join("[redacted]");
  return out.replace(/dmxapi\.com|sk-[A-Za-z0-9]{20,}/gu, "[redacted]");
}
const say = (...parts) => console.log(...parts.map(redact));

const CANDIDATES = (process.env.LENS_VISION_CANDIDATES ?? "gpt-5.4,claude-sonnet-4-6,gemini-2.5-pro,gpt-4o")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ---- minimal PNG encoder (RGB, no deps) for the capability probe ----
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** 96x96 PNG: solid red left half, solid blue right half. */
function makeProbePng() {
  const w = 96;
  const h = 96;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const off = 1 + x * 3;
      if (x < w / 2) row[off] = 0xff; // red
      else row[off + 2] = 0xff; // blue
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---- optional chat-image via macOS QuickLook (renders real text into a PNG) ----
function makeChatImage() {
  try {
    const dir = mkdtempSync(join(tmpdir(), "lens-vision-"));
    const txt = join(dir, "chat.txt");
    writeFileSync(
      txt,
      ["Me: should I text my ex at 2am?", "", "AI: what would tomorrow-you", "want you to do right now?", "", "Me: ...drink water probably", "", "AI: exactly. water first,", "feelings in the morning."].join("\n")
    );
    execFileSync("qlmanage", ["-t", "-s", "700", "-o", dir, txt], { stdio: "ignore", timeout: 20_000 });
    const png = readdirSync(dir).find((f) => f.endsWith(".png"));
    if (!png) return null;
    return `data:image/png;base64,${readFileSync(join(dir, png)).toString("base64")}`;
  } catch {
    return null;
  }
}

const probePng = `data:image/png;base64,${makeProbePng().toString("base64")}`;
const fetchImpl = (input, init) => fetch(input, init);
const env = { MODEL_ENDPOINT: ENDPOINT, MODEL_API_KEY: API_KEY };

say(`vision probe · candidates: ${CANDIDATES.join(", ")}`);
let chosen = null;
for (const model of CANDIDATES) {
  const started = Date.now();
  try {
    const result = await gatewayChat(
      env,
      fetchImpl,
      model,
      [
        { role: "system", content: "You describe images. Reply with a single JSON object only." },
        {
          role: "user",
          content: [
            { type: "text", text: 'Describe this image as {"left_color": <word>, "right_color": <word>}.' },
            { type: "image_url", image_url: { url: probePng } }
          ]
        }
      ],
      120,
      45_000
    );
    const ms = Date.now() - started;
    const parsed = JSON.parse(result.content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
    const ok = /red/iu.test(String(parsed.left_color)) && /blue/iu.test(String(parsed.right_color));
    say(`  ${model}: responded in ${ms}ms -> ${JSON.stringify(parsed)} ${ok ? "(CORRECT)" : "(wrong colors)"}`);
    if (ok && !chosen) chosen = model;
  } catch (err) {
    say(`  ${model}: unavailable (${err instanceof Error ? err.message : String(err)})`);
  }
}

if (!chosen) {
  say("no candidate vision model answered correctly — screenshots mode has no backing model");
  process.exit(2);
}
say(`\nchosen vision model: ${chosen} (requested id — provider may route/version)`);

const chatImage = makeChatImage();
if (!chatImage) {
  say("transcription probe skipped: could not render a local chat image (qlmanage unavailable)");
  process.exit(0);
}
try {
  const turns = await transcribeImages({ ...env, VISION_MODEL: chosen }, fetchImpl, [chatImage]);
  say(`transcription probe: ${turns.length} messages -> ${turns.map((t) => `${t.speaker}: ${JSON.stringify(t.text)}`).join(" | ")}`);
  const speakersOk = turns.some((t) => t.speaker === "user") && turns.some((t) => t.speaker === "companion");
  say(`speaker mapping: ${speakersOk ? "both parties recognized" : "DEGRADED (missing a party)"}`);
  process.exit(speakersOk ? 0 : 2);
} catch (err) {
  say(`transcription probe failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
