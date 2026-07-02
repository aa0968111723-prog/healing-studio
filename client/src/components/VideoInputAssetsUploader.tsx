/**
 * VideoInputAssetsUploader — /video 多模態輸入素材上傳區塊（AIDV-270 AC2）
 *
 * 受控元件：`{ value, onChange }`，素材陣列由呼叫端（VideoProjectCreateDialog）
 * 持有並隨 videoProject.create 送出。拖放/選檔 → 逐檔用
 * inputAssetRejectionMessage（shared 契約）前置驗證 → presign 直傳 R2 →
 * 包成 VideoInputAsset。角色可用 Select 改，但選項依模態過濾
 * （影像只能 style_reference / product_shot、音訊只能 background_music），
 * 從 UI 上杜絕角色↔模態錯配。
 */

import { useRef, useState } from "react";
import { ImageIcon, Loader2, Music, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MAX_INPUT_ASSETS,
  ROLE_LABELS,
  ROLE_TO_TYPE,
  VIDEO_INPUT_ASSET_ROLES,
  inputAssetRejectionMessage,
  uploadVideoInputAsset,
  type VideoInputAsset,
  type VideoInputAssetRole,
} from "@/lib/videoInputAssets";

/** 與 shared 白名單一致的 accept（副檔名並列——部分瀏覽器對空 MIME 檔只認副檔名）。 */
const ACCEPT =
  "image/png,image/jpeg,audio/mpeg,audio/wav,audio/mp3,audio/x-wav,audio/wave,.png,.jpg,.jpeg,.mp3,.wav";

interface Props {
  value: VideoInputAsset[];
  onChange: (assets: VideoInputAsset[]) => void;
  disabled?: boolean;
}

/** 從素材 URL 取檔名尾段當顯示名（presign 直傳的 URL 尾段即安全化檔名）。 */
function assetDisplayName(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").pop() || url);
  } catch {
    return url;
  }
}

export function VideoInputAssetsUploader({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploading = uploadingCount > 0;
  const busy = disabled || uploading;

  async function addFiles(files: File[]) {
    if (busy || files.length === 0) return;
    if (value.length + files.length > MAX_INPUT_ASSETS) {
      toast.error(`素材數量上限為 ${MAX_INPUT_ASSETS} 個`);
      return;
    }
    // 逐檔序列上傳並在本地累積（onChange 是受控 prop，同一批內不能各自以舊 value 出發）。
    let current = value;
    for (const file of files) {
      const rejection = inputAssetRejectionMessage(file);
      if (rejection) {
        toast.error(`${file.name}：${rejection}`);
        continue;
      }
      setUploadingCount(c => c + 1);
      try {
        const asset = await uploadVideoInputAsset(file);
        current = [...current, asset];
        onChange(current);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "素材上傳失敗，請稍後再試");
      } finally {
        setUploadingCount(c => c - 1);
      }
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 清空 input，讓同一個檔案能重選（瀏覽器對相同路徑不觸發 change）。
    e.target.value = "";
    void addFiles(files);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (busy) return;
    void addFiles(Array.from(e.dataTransfer.files ?? []));
  }

  function handleRoleChange(index: number, role: VideoInputAssetRole) {
    onChange(value.map((a, i) => (i === index ? { ...a, role } : a)));
  }

  function handleRemove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  const atCapacity = value.length >= MAX_INPUT_ASSETS;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">輸入素材（選填）</div>
        <div className="text-[10px] text-muted-foreground">
          {value.length}/{MAX_INPUT_ASSETS}
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="拖放或點擊上傳素材"
        aria-disabled={busy || atCapacity}
        onClick={() => !busy && !atCapacity && inputRef.current?.click()}
        onKeyDown={e => {
          if ((e.key === "Enter" || e.key === " ") && !busy && !atCapacity) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          busy || atCapacity
            ? "border-border/60 opacity-60 cursor-not-allowed"
            : "border-border hover:border-primary/40 cursor-pointer"
        )}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="size-5 text-muted-foreground" />
        )}
        <div className="text-xs text-muted-foreground">
          {uploading
            ? "素材上傳中…"
            : atCapacity
              ? `已達 ${MAX_INPUT_ASSETS} 個素材上限`
              : "拖放或點擊上傳（PNG／JPG ≤10MB、MP3／WAV ≤20MB）"}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          aria-label="選擇素材檔案"
          disabled={busy}
          onChange={handleInputChange}
        />
      </div>

      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((asset, index) => {
            const Icon = asset.type === "image" ? ImageIcon : Music;
            const roleOptions = VIDEO_INPUT_ASSET_ROLES.filter(
              r => ROLE_TO_TYPE[r] === asset.type
            );
            return (
              <li
                key={`${asset.url}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs" title={asset.url}>
                  {assetDisplayName(asset.url)}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {asset.type === "image" ? "影像" : "音訊"}
                </span>
                <Select
                  value={asset.role}
                  onValueChange={v => handleRoleChange(index, v as VideoInputAssetRole)}
                  disabled={disabled}
                >
                  <SelectTrigger
                    className="h-7 w-[7.5rem] text-xs shrink-0"
                    aria-label={`素材用途：${assetDisplayName(asset.url)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(r => (
                      <SelectItem key={r} value={r} className="text-xs">
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={`移除素材 ${assetDisplayName(asset.url)}`}
                  disabled={disabled}
                  onClick={() => handleRemove(index)}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
