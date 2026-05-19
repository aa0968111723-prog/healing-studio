/**
 * AssetUploader —— 動畫工作室通用的上傳元件
 *
 * 對外行為：選檔 → 上傳到 /api/upload (S3 / CDN) → 回呼 URL + fileKey + mimeType。
 * UI 緊湊（適合放在角色卡 / 場景卡內），支援拖放、進度提示、錯誤顯示。
 */

import { useCallback, useRef, useState } from "react";
import { uploadFileToS3, shortErrorMsg } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

export type UploadedAssetResult = {
  url: string;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export function AssetUploader({
  accept,
  label,
  onUploaded,
  multiple = false,
  disabled = false,
  variant = "outline",
  size = "sm",
}: {
  /** 接受的 MIME / 副檔名（image/*, audio/*, video/*, .pdf 等） */
  accept?: string;
  /** 按鈕文字 */
  label?: string;
  onUploaded: (result: UploadedAssetResult) => void;
  multiple?: boolean;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg";
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          try {
            const { url, fileKey } = await uploadFileToS3(file);
            onUploaded({
              url,
              fileKey,
              fileName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
            });
          } catch (e) {
            toast.error(`「${file.name}」上傳失敗：${shortErrorMsg(e)}`);
          }
        }
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [onUploaded]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        className="h-7 text-xs"
      >
        {uploading ? (
          <>
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            上傳中…
          </>
        ) : (
          <>
            <Upload className="w-3 h-3 mr-1" />
            {label ?? "上傳"}
          </>
        )}
      </Button>
    </>
  );
}

/**
 * 推測資產類型 —— 從 MIME 對映到 WorldAssetRef.assetType
 */
export function inferAssetType(
  mimeType: string
): "image" | "audio" | "video" | "pdf" | "document" | "other" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType.startsWith("text/") ||
    mimeType.includes("officedocument") ||
    mimeType.includes("opendocument")
  )
    return "document";
  return "other";
}
