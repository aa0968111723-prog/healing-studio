// ============================================================================
// shells/video/GuidedJourney.tsx — 引導式創作旅程（長腳本 → 拆幕/分鏡 → 角色/場景 → 確認門 → 排程）
// ----------------------------------------------------------------------------
// 來源：模擬 shells/video/GuidedJourney.tsx，改寫為真實 repo 慣例（shadcn Dialog + Tailwind）。
// 拆解 → useProjectSpine().breakdownScript()（薄包 P0 commander.breakdownScript：過渡用
//   director.analyzeScriptOverview + director.generateVideoScript；正式 director.breakdown M3 待建）。
// 寫入 → useProjectSpine().ingestBreakdown()（樂觀本地 + worldStoryboard.createFromSegments 回寫）。
// 抽出的角色預設「⚠ 估算」未定版 → 確認門擋住，需到角色頁上傳參考升「✅ 精準」解鎖。
// ============================================================================
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Wand2, Loader2, Check, Plus, Lock, ArrowLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import type { ScriptBreakdown } from "@/adapters/types";
import { shortErrorMsg } from "@/lib/upload";

const SAMPLE = `雪山道上，狂風大作。密勒日巴獨自盤坐於岩石，閉目入定。

弟子惹瓊巴自山下而來，衣衫單薄，神情堅定。他在洞口停下，向師父頂禮。

密勒日巴張開雙眼，與惹瓊巴四目相接。師徒相見，無需言語。

忽然，山神示現於雲海之上，俯瞰二人。

夜幕低垂，村莊燈火點點，遠處傳來誦經之聲。`;

export function GuidedJourney({ open, onClose }: { open: boolean; onClose: () => void }) {
  const spine = useProjectSpine();
  const [step, setStep] = useState<"input" | "loading" | "review">("input");
  const [text, setText] = useState("");
  const [bd, setBd] = useState<ScriptBreakdown | null>(null);
  const [name, setName] = useState("");

  /** 遞增序號＝取消保護：按「取消返回」後，過期的拆解結果/錯誤直接丟棄。 */
  const runSeq = useRef(0);

  const reset = () => { runSeq.current++; setStep("input"); setText(""); setBd(null); setName(""); };
  const close = () => { onClose(); reset(); };

  const run = async () => {
    setStep("loading");
    const token = ++runSeq.current;
    try {
      const b = await spine.breakdownScript(text || SAMPLE);
      if (runSeq.current !== token) return; // 已取消或重跑
      setBd(b);
      setStep("review");
    } catch (err) {
      if (runSeq.current !== token) return;
      toast.error("腳本拆解失敗，請稍後再試", {
        description: shortErrorMsg(err) || "伺服器暫時無法處理，請稍後重試，或先按「填入範例腳本」測試流程。",
        duration: 7000,
      });
      setStep("input");
    }
  };

  /** loading 的取消出口：拆解可長達數十秒，不能把使用者關在轉圈圈裡。 */
  const cancelRun = () => {
    runSeq.current++;
    setStep("input");
  };

  const commit = async (newProject: boolean) => {
    if (bd) {
      try {
        await spine.ingestBreakdown(name || spine.project?.name || "引導式新專案", bd, { newProject });
      } catch (err) {
        // 寫入失敗不關窗：拆解結果還在，使用者可改名或換目標重試。
        toast.error("寫入分鏡資料失敗，請稍後重試", {
          description: "拆解結果仍保留，你可以改名或換目標後重試。",
          duration: 7000,
        });
        return;
      }
    }
    close();
  };

  const totalShots = bd ? bd.acts.reduce((n, a) => n + a.shots.length, 0) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[86vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wand2 className="size-5 text-primary" /> 引導式創作旅程
          </DialogTitle>
          <DialogDescription className="text-xs">
            長腳本 → 拆幕/分鏡 → 角色/場景 → 確認門 → 排程生成
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] overflow-y-auto p-4">
          {step === "input" && (
            <>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">STEP 1 · 貼上你的長腳本</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setText(SAMPLE)}>填入範例腳本</Button>
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="把整份腳本貼進來，系統會自動拆幕、建議分鏡、抽出角色與場景…"
                className="min-h-[220px] text-sm"
              />
              <div className="mt-3 flex items-center gap-2">
                <Button onClick={run}>
                  <Wand2 className="size-4" /> 自動拆解
                </Button>
                <span className="text-xs text-muted-foreground">＊未輸入時按「填入範例腳本」即可一鍵示範</span>
              </div>
            </>
          )}

          {step === "loading" && (
            <div role="status" aria-busy="true" className="flex flex-col items-center gap-3 py-16 text-center">
              <Loader2 className="size-7 animate-spin text-primary" />
              <div className="text-sm font-medium">commander 正在拆解腳本…</div>
              <div className="max-w-sm text-xs text-muted-foreground">
                Deterministic→Cache→RAG 壓成 Context Packet，再由導演腦切幕/分鏡、抽角色場景。
              </div>
              <Button size="sm" variant="ghost" onClick={cancelRun}>
                <ArrowLeft className="size-4" /> 取消返回
              </Button>
            </div>
          )}

          {step === "review" && bd && (
            <>
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                STEP 2 · 確認拆解結果（{bd.acts.length} 幕 · {totalShots} 鏡）
              </span>
              <div className="mb-3 mt-2 flex flex-wrap gap-1.5">
                {bd.characters.map((c) => <Badge key={c} variant="secondary" className="text-[10px]">👤 {c}</Badge>)}
                {bd.scenes.map((c) => <Badge key={c} variant="outline" className="text-[10px]">🎬 {c}</Badge>)}
              </div>

              {bd.acts.map((act, i) => (
                <div key={i} className="mb-2 rounded-xl border p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium">{act.title}</span>
                    <span className="text-[10px] text-muted-foreground">{act.shots.length} 鏡</span>
                  </div>
                  {act.shots.map((sh, j) => (
                    <div key={j} className="flex items-center gap-2 border-t py-1.5 first:border-t-0">
                      <span className="text-sm">{sh.route === "ref" ? "🔒" : "🌄"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{sh.title}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {sh.route === "ref" ? `參考圖轉繪 · ${sh.characters.join("、") || "—"}` : "文字生成（空景）"} · {sh.scene}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 p-2.5">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Lock className="size-4 text-primary" /> 確認門
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  抽出的角色預設「⚠ 估算」，未定版不會進入生成。寫入後到右欄角色頁上傳參考圖 → 升級「✅ 精準」→ 解鎖該鏡。
                </p>
              </div>

              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="專案名稱（留空＝寫入目前作用中專案）"
                className="mb-3 h-9 text-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void commit(false)}>
                  <Check className="size-4" /> 寫入目前專案
                </Button>
                <Button variant="secondary" onClick={() => void commit(true)}>
                  <Plus className="size-4" /> 建立新專案再寫入
                </Button>
                <Button variant="ghost" onClick={() => setStep("input")}>
                  <ArrowLeft className="size-4" /> 返回
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default GuidedJourney;
