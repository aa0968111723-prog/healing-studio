/**
 * RFC 6238 TOTP implementation backed solely by Node's crypto module.
 *
 * Generates Base32 secrets compatible with Google Authenticator, Authy,
 * 1Password, etc. Uses HMAC-SHA1 over a 30-second window with a ±1 step
 * tolerance to absorb client/server clock drift.
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const TOLERANCE_STEPS = 1;

export function generateBase32Secret(byteLength = 20): string {
  const bytes = randomBytes(byteLength);
  let bits = "";
  for (let i = 0; i < bytes.length; i++) {
    bits += bytes[i].toString(2).padStart(8, "0");
  }
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 53-bit safe — the high 21 bits are zero for any counter we'll see.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function generateTotp(base32Secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(base32Secret), counter);
}

export function verifyTotp(
  base32Secret: string,
  token: string,
  atMs = Date.now()
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  const secret = base32Decode(base32Secret);
  for (let drift = -TOLERANCE_STEPS; drift <= TOLERANCE_STEPS; drift++) {
    if (hotp(secret, counter + drift) === token) return true;
  }
  return false;
}

/**
 * Build the otpauth:// URI consumed by authenticator app QR codes.
 * Per the Key Uri Format spec, label is "Issuer:account" and parameters
 * are URL-encoded.
 */
export function buildOtpAuthUri(input: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = input.issuer ?? "Healing Studio";
  const label = encodeURIComponent(`${issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
