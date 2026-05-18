/**
 * Truncate a long error message to a max length for display in toasts.
 * Prevents storage-config paragraphs from flooding the UI.
 */
export function shortErrorMsg(raw: unknown, maxLen = 60): string {
  const msg =
    typeof raw === "string" ? raw : (raw as any)?.message || "未知錯誤";
  return msg.length > maxLen ? msg.slice(0, maxLen) + "…" : msg;
}

/**
 * Shared file upload helper — uploads a File to S3 via /api/upload
 */
export async function uploadFileToS3(
  file: File
): Promise<{ url: string; fileKey: string }> {
  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      data: base64,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "上傳失敗" }));
    throw new Error(err.error || "上傳失敗");
  }

  const result = await response.json();
  return { url: result.url, fileKey: result.fileKey };
}

/**
 * 給「批次上傳」用的進度版本。本端點吃的是 base64 JSON，沒有 multipart
 * stream 可以攔，所以進度只能切成幾個離散階段：
 *   0%   reading (FileReader → base64)
 *   50%  uploading (XHR send → server.storagePut → S3)
 *  100%  done
 * 比 fetch + 一條 spinner 多了「正在讀檔 / 正在送上去」的可見回饋，
 * 也是 React 進度條 UX 業界常規。
 */
export async function uploadFileToS3WithProgress(
  file: File,
  onProgress: (percent: number) => void
): Promise<{ url: string; fileKey: string }> {
  onProgress(5);

  const reader = new FileReader();
  const base64 = await new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  onProgress(40);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true;
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      // map XHR upload 0..100 -> 40..90 of overall progress
      const pct = 40 + Math.round((e.loaded / e.total) * 50);
      onProgress(pct);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = "上傳失敗";
        try {
          const body = JSON.parse(xhr.responseText);
          msg = body.error || msg;
        } catch {
          // not JSON — keep default
        }
        reject(new Error(msg));
        return;
      }
      try {
        const result = JSON.parse(xhr.responseText);
        onProgress(100);
        resolve({ url: result.url, fileKey: result.fileKey });
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error("網路錯誤，上傳中斷"));
    xhr.send(
      JSON.stringify({
        fileName: file.name,
        mimeType: file.type,
        data: base64,
      })
    );
  });
}

/**
 * 由 File 推斷 teaching-archive 用的 mediaType。
 * 與 server/uploadRoute.ts 的 ALLOWED_MIME_TYPES 對齊。
 */
export type DetectedMediaType =
  | "pdf"
  | "document"
  | "image"
  | "video"
  | "audio"
  | "presentation";

export function detectMediaTypeFromFile(file: File): DetectedMediaType {
  const mime = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime === "application/vnd.ms-powerpoint" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  ) {
    return "presentation";
  }
  // Fallback bucket for Word/TXT/MD/RTF and anything else allowed
  return "document";
}

/** 從檔名導出預設標題：去除副檔名、底線/減號改空白。 */
export function deriveTitleFromFileName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").trim() || filename;
}
