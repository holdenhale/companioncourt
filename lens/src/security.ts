// Actor identification for rate limiting — privacy-first by construction.
//
// - IPv6 clients are keyed on their /64 prefix (one household/subscriber), IPv4 on the
//   full address; either way ONLY a salted SHA-256 hash ever reaches storage, so the
//   counters hold no raw IPs and the zero-tracking claim stays truthful.
// - A coarse user-agent bucket (mobile/desktop x browser family) is mixed in so a
//   carrier NAT does not collapse thousands of users into one rate-limit key.

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Expands an IPv6 address ("2001:db8::1") to its 8 hextets; returns null if invalid. */
export function expandIpv6(ip: string): string[] | null {
  const noZone = ip.split("%")[0]!;
  if (noZone.includes(":::")) return null;
  const halves = noZone.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1]!.split(":")) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 1) return null;
  if (halves.length === 1 && left.length !== 8) return null;
  const groups = [...left, ...Array<string>(Math.max(0, missing)).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const out: string[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(g)) return null;
    out.push(parseInt(g, 16).toString(16));
  }
  return out;
}

/** IPv4 -> full address; IPv6 -> /64 prefix. Unparseable input hashes as-is (still salted). */
export function ipRateKey(ip: string): string {
  if (ip.includes(":")) {
    const groups = expandIpv6(ip);
    if (groups) return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return ip;
}

/** Coarse UA bucket: enough to split a NAT, too coarse to fingerprint anyone. */
export function uaBucket(ua: string | null): string {
  const s = ua ?? "";
  const device = /Mobi|Android|iPhone|iPad/iu.test(s) ? "m" : "d";
  const browser = /Firefox\//u.test(s)
    ? "ff"
    : /Edg\//u.test(s)
      ? "edge"
      : /Chrome\//u.test(s)
        ? "chrome"
        : /Safari\//u.test(s)
          ? "safari"
          : "other";
  return `${device}-${browser}`;
}

/** The only identifier the budget object ever sees: salted hash of (ip-prefix | ua-bucket). */
export async function actorId(ip: string, ua: string | null, salt: string): Promise<string> {
  const hash = await sha256Hex(`${salt}|${ipRateKey(ip)}|${uaBucket(ua)}`);
  return hash.slice(0, 32);
}
