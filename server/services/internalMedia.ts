import { storagePut } from "../storage";
import { serverEnv } from "../_core/env.validated";
import { assertSafeExternalUrl, SsrfBlockedError } from "../_core/ssrfGuard";
import { assertSafeMediaBytes } from "./fileValidation";

type PersistOptions = {
  category: "image" | "video" | "audio" | "voice" | "binary";
  prefix?: string;
};

export function isInternalUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true;
  const s3Public = serverEnv.S3_PUBLIC_URL || serverEnv.S3_PUBLIC_DOMAIN;
  if (s3Public && url.startsWith(s3Public.replace(/\/+$/, ""))) return true;
  const forgeUrl = serverEnv.BUILT_IN_FORGE_API_URL;
  if (forgeUrl && url.startsWith(forgeUrl.replace(/\/+$/, ""))) return true;
  return false;
}

function inferExtension(contentType: string, url: string, category: string): string {
  const mime = contentType.toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("gltf")) return "glb";

  const fromUrl = (() => {
    try {
      const pathname = new URL(url).pathname;
      const ext = pathname.split(".").pop();
      return ext && ext.length <= 8 ? ext : null;
    } catch {
      return null;
    }
  })();
  if (fromUrl) return fromUrl;

  if (category === "image") return "png";
  if (category === "video") return "mp4";
  if (category === "audio" || category === "voice") return "mp3";
  return "bin";
}

// 10 MB cap on downloaded media to bound memory usage.
const PERSIST_MAX_BYTES = 10 * 1024 * 1024;

export async function persistExternalMediaUrl(
  url: string,
  options: PersistOptions
): Promise<string> {
  if (!url || isInternalUrl(url)) return url;
  // Throw early if the URL targets a private/loopback/IMDS host (AIDV-262).
  try {
    assertSafeExternalUrl(url, process.env.NODE_ENV !== "production");
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err;
    throw err;
  }
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    redirect: "error",
  });
  const rawLength = Number(resp.headers.get("content-length") ?? "0");
  if (rawLength > PERSIST_MAX_BYTES) {
    throw new Error(`外部媒體過大（${rawLength} bytes > ${PERSIST_MAX_BYTES}）`);
  }
  if (!resp.ok) throw new Error(`下載外部媒體失敗（${resp.status}）`);
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  // AIDV-315: block markup/executables disguised as media (defence-in-depth after SSRF guard).
  await assertSafeMediaBytes(buffer);
  const contentType =
    resp.headers.get("content-type") || "application/octet-stream";
  const ext = inferExtension(contentType, url, options.category);
  const scope = (options.prefix || `generated/${options.category}`).replace(
    /\/+$/,
    ""
  );
  const key = `${scope}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const stored = await storagePut(key, buffer, contentType);
  return stored.url;
}

function classifyByKey(key: string): PersistOptions["category"] {
  if (/voice/i.test(key)) return "voice";
  if (/audio/i.test(key)) return "audio";
  if (/video/i.test(key)) return "video";
  if (/image|thumbnail|mask|texture|pose/i.test(key)) return "image";
  return "binary";
}

export async function localizeResultUrls(
  value: unknown,
  prefix = "generated/result"
): Promise<unknown> {
  const walk = async (node: unknown, keyHint = ""): Promise<unknown> => {
    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node)) {
        return persistExternalMediaUrl(node, {
          category: classifyByKey(keyHint),
          prefix,
        }).catch(() => node);
      }
      return node;
    }

    if (Array.isArray(node)) {
      const next = await Promise.all(node.map(v => walk(v, keyHint)));
      return next;
    }

    if (node && typeof node === "object") {
      const entries = Object.entries(node as Record<string, unknown>);
      const next = await Promise.all(
        entries.map(async ([k, v]) => [k, await walk(v, k)] as const)
      );
      return Object.fromEntries(next);
    }

    return node;
  };

  return walk(value);
}
