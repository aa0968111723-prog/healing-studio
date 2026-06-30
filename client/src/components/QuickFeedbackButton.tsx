// AIDV-864 PR②：右下角快速情境回饋浮動按鈕
// 功能：類型 chips + 功能區域自動偵測 + 標出位置（點選 DOM 元素）+ 截圖（best-effort html2canvas）
import { useState, useCallback } from "react";
import { MessageSquarePlus, X, MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { FEEDBACK_AREAS, detectAreaFromPath } from "@/lib/feedbackAreas";
import { useElementPicker, type PickedElement } from "@/hooks/useElementPicker";
import { uploadFileToS3 } from "@/lib/upload";

type Category = "bug" | "feature_request" | "quality_issue" | "general";

const CATEGORY_CHIPS: { id: Category; label: string }[] = [
  { id: "bug",             label: "錯誤" },
  { id: "feature_request", label: "功能建議" },
  { id: "quality_issue",   label: "品質問題" },
  { id: "general",         label: "一般意見" },
];

async function captureViewportScreenshot(): Promise<string | undefined> {
  try {
    // html2canvas 是 lazy dynamic import（新增依賴）；失敗即略過截圖
    const mod = await import("html2canvas");
    const canvas = await mod.default(document.body, {
      useCORS: true,
      scale: Math.min(window.devicePixelRatio ?? 1, 2),
      logging: false,
    });
    return new Promise<string | undefined>(resolve => {
      canvas.toBlob(async blob => {
        if (!blob) { resolve(undefined); return; }
        const file = new File([blob], `feedback-${Date.now()}.png`, { type: "image/png" });
        const result = await uploadFileToS3(file).catch(() => null);
        resolve(result?.fileKey ?? undefined);
      }, "image/png", 0.85);
    });
  } catch {
    return undefined;
  }
}

export function QuickFeedbackButton() {
  const [location] = useLocation();
  const [open, setOpen]           = useState(false);
  const [category, setCategory]   = useState<Category>("bug");
  const [description, setDescription] = useState("");
  const [featureArea, setFeatureArea] = useState("");
  const [landmark, setLandmark]   = useState<PickedElement | null>(null);
  const [picking, setPicking]     = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const create = trpc.feedback.create.useMutation();

  const handlePick = useCallback((result: PickedElement) => {
    setLandmark(result);
    setPicking(false);
    setOpen(true);
  }, []);

  const handlePickCancel = useCallback(() => {
    setPicking(false);
    setOpen(true);
  }, []);

  useElementPicker(picking, handlePick, handlePickCancel);

  const openPanel = () => {
    setFeatureArea(detectAreaFromPath(location));
    setSubmitted(false);
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    resetForm();
  };

  const startPick = () => {
    setOpen(false);
    setPicking(true);
  };

  const handleSubmit = async () => {
    const text = description.trim();
    if (!text) return;

    let screenshotKey: string | undefined;
    try { screenshotKey = await captureViewportScreenshot(); } catch { /* skip */ }

    await create.mutateAsync({
      title: text.slice(0, 200),
      description: text,
      category,
      priority: "medium",
      featureArea: featureArea || undefined,
      pageContext: {
        route:    location,
        url:      typeof window !== "undefined" ? window.location.href : undefined,
        viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : undefined,
      },
      landmark: landmark
        ? { selector: landmark.selector, label: landmark.label, rect: landmark.rect, textSnippet: landmark.textSnippet }
        : undefined,
      screenshotKey,
    });

    setSubmitted(true);
    toast.success("感謝您的回饋！");
    setTimeout(() => { setOpen(false); resetForm(); }, 2000);
  };

  const resetForm = () => {
    setDescription("");
    setLandmark(null);
    setCategory("bug");
    setSubmitted(false);
  };

  // 點選模式提示條
  if (picking) {
    return (
      <div
        className="fixed bottom-4 left-1/2 z-[99997] -translate-x-1/2 flex items-center gap-2 rounded-xl border bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur"
        role="status"
        aria-live="polite"
      >
        <MapPin className="size-3.5 animate-pulse text-primary" />
        點選畫面上的元素來標記位置…按 ESC 取消
      </div>
    );
  }

  return (
    <>
      {/* 浮動按鈕（面板收起時顯示） */}
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          className="fixed bottom-24 right-4 z-[99996] flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          aria-label="快速回饋"
        >
          <MessageSquarePlus className="size-4" />
        </button>
      )}

      {/* 快速回饋面板 */}
      {open && (
        <div
          className="fixed bottom-24 right-4 z-[99996] w-80 rounded-2xl border bg-background/95 shadow-xl backdrop-blur"
          role="dialog"
          aria-label="快速回饋"
          aria-modal="false"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-medium">快速回饋</span>
            <button
              type="button"
              onClick={closePanel}
              className="text-muted-foreground hover:text-foreground"
              aria-label="關閉"
            >
              <X className="size-4" />
            </button>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8">
              <CheckCircle2 className="size-8 text-emerald-500" />
              <p className="text-sm text-muted-foreground">感謝您的回饋！</p>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {/* 問題類型 chips */}
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_CHIPS.map(c => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={[
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                      category === c.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* 功能區域（自動帶入當前頁，可手動改） */}
              <Select value={featureArea} onValueChange={setFeatureArea}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="功能區域…" />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_AREAS.map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 說明文字 */}
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="描述問題或建議…"
                className="min-h-[80px] resize-none text-xs"
                maxLength={2000}
              />

              {/* 標出位置 */}
              {landmark ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-[10px]">
                  <MapPin className="size-3 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-mono">{landmark.label.slice(0, 50)}</span>
                  <button
                    type="button"
                    onClick={() => setLandmark(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="移除位置標記"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full gap-1.5 text-[11px]"
                  onClick={startPick}
                >
                  <MapPin className="size-3" />
                  標出位置（點選元素）
                </Button>
              )}

              <Button
                size="sm"
                className="w-full"
                disabled={!description.trim() || create.isPending}
                onClick={() => void handleSubmit()}
              >
                {create.isPending && <Loader2 className="size-4 animate-spin" />}
                送出回饋
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
