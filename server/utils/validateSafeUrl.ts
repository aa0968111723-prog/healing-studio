/**
 * validateSafeUrl — AIDV-201 SSRF 防護
 *
 * 只允許 https:// scheme；拒絕私有 IP / 雲端 metadata 地址，
 * 防止攻擊者把 fal / 外部 agent 當 SSRF proxy 打穿內網。
 *
 * 拒絕範圍：
 *   IPv4  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *         169.254.0.0/16（link-local / AWS EC2 metadata）
 *         127.0.0.0/8（loopback）
 *   IPv6  ::1, fc00::/7（ULA）, fe80::/10（link-local）
 */
import { z } from "zod";

/**
 * 傳回 true 代表「安全（非私有）」，可通過 zod refinement。
 * 若無法解析 hostname 亦拒絕（fail-closed）。
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // 無效 URL → 拒絕
  }

  // 只允許 HTTPS
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  // localhost / loopback
  if (host === "localhost") return false;

  // IPv4 私有 + loopback + link-local + metadata
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c] = ipv4Match.map(Number);
    if (a === 10) return false;                              // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;      // 172.16.0.0/12
    if (a === 192 && b === 168) return false;               // 192.168.0.0/16
    if (a === 169 && b === 254) return false;               // 169.254.0.0/16（metadata）
    if (a === 127) return false;                            // 127.0.0.0/8（loopback）
    if (a === 0) return false;                              // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false;    // 100.64.0.0/10（CGNAT）
  }

  // IPv6 — 包含方括號的情況 [::1]
  const ipv6Host = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;

  if (ipv6Host === "::1") return false;                    // loopback
  if (/^fe80:/i.test(ipv6Host)) return false;              // fe80::/10 link-local
  if (/^fc[0-9a-f]{2}:/i.test(ipv6Host)) return false;    // fc00::/7 ULA
  if (/^fd[0-9a-f]{2}:/i.test(ipv6Host)) return false;    // fd00::/8 ULA
  if (/^::ffff:/i.test(ipv6Host)) {
    // IPv4-mapped IPv6 → 還原後再判斷
    const v4 = ipv6Host.replace(/^::ffff:/i, "");
    return isSafeExternalUrl(`https://${v4}/`);
  }

  return true;
}

/** Zod schema：必填安全外部 URL（https + 非私有）。 */
export const safeExternalUrl = z
  .string()
  .url()
  .refine(isSafeExternalUrl, { message: "URL 必須使用 https 且不可指向內部網路或私有 IP" });

/** Zod schema：選填版本。 */
export const safeExternalUrlOptional = safeExternalUrl.optional();
