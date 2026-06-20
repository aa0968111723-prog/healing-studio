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
 * AIDV-15：嘗試走 signed-URL 直傳（presign → 直接 PUT 到 R2 → finalize）。
 *
 * 大檔位元組完全不經過 tRPC/HTTP body（不再 base64、不打爆 Railway 記憶體）。
 * 回傳 null 代表「signed-URL 路徑不可用」（旗標 OFF / 無 R2 設定 / demo），呼叫端
 * 應回退既有 base64 `/api/upload`。任何「上傳真的失敗」（非回退情境）則直接 throw。
 *
 * @param onProgress 可選；以 0..100 回報「PUT 到 R2」的真實進度（XHR upload 事件）。
 */
async function trySignedUrlUpload(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; fileKey: string } | null> {
  // ① presign — 向伺服器要 scoped、短效、限型別/大小的 PUT URL。
  const presignResp = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });

  if (presignResp.status === 503 || presignResp.status === 404) {
    // 旗標 OFF / 無 R2 / 端點不存在（舊伺服器）→ 回退 base64。
    return null;
  }
  if (!presignResp.ok) {
    // 400/413/415：明確的拒絕（缺欄位 / 太大 / 不允許型別）→ 直接報錯，不回退。
    const err = await presignResp.json().catch(() => ({ error: "上傳失敗" }));
    if (err?.fallback === "base64") return null;
    throw new Error(err.error || "上傳失敗");
  }

  const presigned = (await presignResp.json()) as {
    putUrl: string;
    fileKey: string;
    contentType: string;
  };

  // ② 直接 PUT 到 R2 —— 檔案 body 不經過我們的 Node 伺服器。
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presigned.putUrl, true);
    // Content-Type 必須與簽名時鎖定的 contentType 完全一致，否則簽名不符（403）。
    xhr.setRequestHeader("Content-Type", presigned.contentType);
    if (onProgress) {
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        // map 0..100 of PUT → 40..90 of overall progress
        onProgress(40 + Math.round((e.loaded / e.total) * 50));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`直傳失敗（${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error("網路錯誤，上傳中斷"));
    xhr.send(file);
  });

  // ③ finalize — 伺服器 HeadObject 驗證物件已上傳、大小合規，落回標準回應形狀。
  const finalizeResp = await fetch("/api/upload/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      fileKey: presigned.fileKey,
      mimeType: file.type,
      fileName: file.name,
    }),
  });
  if (!finalizeResp.ok) {
    const err = await finalizeResp.json().catch(() => ({ error: "上傳失敗" }));
    throw new Error(err.error || "上傳失敗");
  }
  const result = await finalizeResp.json();
  return { url: result.url, fileKey: result.fileKey };
}

/** base64 → /api/upload 回退路徑（signed-URL 不可用時使用）。 */
async function uploadFileToS3Base64(
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
 * Shared file upload helper — AIDV-15：優先走 signed-URL 直傳（大檔不過 body），
 * signed-URL 不可用（旗標 OFF / 無 R2 / demo / 舊伺服器）時自動回退 base64
 * `/api/upload`。對所有既有呼叫端透明——回傳形狀不變 `{ url, fileKey }`。
 */
export async function uploadFileToS3(
  file: File
): Promise<{ url: string; fileKey: string }> {
  const signed = await trySignedUrlUpload(file);
  if (signed) return signed;
  return uploadFileToS3Base64(file);
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

  // AIDV-15：先試 signed-URL 直傳（進度來自真實的 PUT-to-R2 XHR 事件）。
  // 不可用時回退既有 base64 路徑（onProgress 沿用離散階段）。
  const signed = await trySignedUrlUpload(file, onProgress);
  if (signed) {
    onProgress(100);
    return signed;
  }

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
