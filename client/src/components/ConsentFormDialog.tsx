/**
 * ConsentFormDialog — 數位肖像權 / 照片使用同意書
 *
 * 訓練資料若包含真實人類或第三方版權素材，使用者必須先讓主體 / 法定代理人 /
 * 著作權持有人填寫並數位簽名本同意書，後端才會接受 models.create。
 *
 * 表單分為 4 個區塊：
 *   1. 主體與簽署人資訊
 *   2. 授權範圍 / 有效期間
 *   3. 條款全文（可捲動），勾選「我已閱讀並同意」才能簽名
 *   4. 數位簽名（canvas 手寫，匯出為 base64 PNG）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Eraser, FileSignature, Loader2 } from "lucide-react";

// ─── 條款版本 / 全文（與 server/routers/modelConsents.ts 同步）────────────
export const CONSENT_TERMS_VERSION = "v1.0-2026-05";

const TERMS_TEXT = `《Healing Studio 模型訓練 — 肖像權與照片使用同意書》v1.0（2026-05）

一、定義
  「主體」：被拍攝、被錄製或受版權保護的本人 / 著作權人。
  「使用者」：在 Healing Studio 帳號中上傳資料並啟動模型訓練的帳號持有人。
  「素材」：使用者上傳作為訓練資料的影像、影片、聲音檔。

二、授權內容
  1. 主體 / 法定代理人 / 著作權持有人（以下統稱「簽署人」）同意使用者
     將上述素材用於 Healing Studio 平台的 LoRA / 微調模型訓練、推論、
     生成衍生影像或影片。
  2. 授權範圍由本同意書「使用範圍」欄位指定，超出範圍之利用須另行取得
     書面同意。

三、簽署人聲明
  1. 簽署人保證為主體本人，或具有合法代理 / 著作權處分權限。
  2. 簽署人保證所提供素材未侵害任何第三人之肖像權、著作權或其他權利。
  3. 若有不實，簽署人應自行負擔法律責任，並使 Healing Studio 免於損害。

四、撤回機制
  1. 簽署人可隨時於 Healing Studio 「同意書管理」頁面提出撤回。
  2. 撤回生效後，未來訓練 / 推論不得再使用本同意書授權之素材；既已生成
     之模型權重不溯及失效，但使用者承諾於合理期間內停止使用。

五、資料保存與稽核
  1. 本同意書（含簽名圖、IP、時間戳）將以加密形式保存於 Healing Studio，
     保存期限至少 7 年，供法律 / 稽核使用。
  2. 主體得依個資法請求查閱、更正或刪除其個人資料。

六、爭議處理
  本同意書之解釋與履行以中華民國法律為準據法，並合意以臺灣臺北地方法院
  為第一審管轄法院。

簽署人於下方手寫簽名並送出，視為已充分閱讀、理解並同意上述全部條款。`;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 建立成功後回傳新建立的同意書 ID 與摘要 */
  onCreated?: (consent: { id: number; subjectName: string }) => void;
  /** 預設主體類型（依使用者於訓練頁的選擇） */
  defaultSubjectType?: "self" | "real_person" | "copyrighted";
}

type SubjectType = "self" | "real_person" | "copyrighted";
type ConsentType = "portrait" | "photo_usage" | "both";
type SignerRelation =
  | "self"
  | "guardian"
  | "copyright_holder"
  | "authorized_representative";
type UsageScope =
  | "training_only"
  | "personal_output"
  | "public_display"
  | "commercial";

const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  self: "本人",
  real_person: "真實他人",
  copyrighted: "第三方版權素材",
};
const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  portrait: "肖像權",
  photo_usage: "照片 / 影像使用",
  both: "肖像權 + 照片使用",
};
const SIGNER_RELATION_LABELS: Record<SignerRelation, string> = {
  self: "本人",
  guardian: "法定代理人",
  copyright_holder: "著作權持有人",
  authorized_representative: "授權代表",
};
const USAGE_SCOPE_LABELS: Record<UsageScope, string> = {
  training_only: "僅內部訓練",
  personal_output: "訓練 + 個人輸出",
  public_display: "公開展示（含社群）",
  commercial: "商業使用",
};

export default function ConsentFormDialog({
  open,
  onClose,
  onCreated,
  defaultSubjectType = "real_person",
}: Props) {
  const [subjectType, setSubjectType] = useState<SubjectType>(defaultSubjectType);
  const [consentType, setConsentType] = useState<ConsentType>("both");

  const [subjectName, setSubjectName] = useState("");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [subjectIdLast4, setSubjectIdLast4] = useState("");

  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerRelation, setSignerRelation] = useState<SignerRelation>("self");

  const [usageScope, setUsageScope] = useState<UsageScope>("training_only");
  const [allowDerivative, setAllowDerivative] = useState(false);
  const [validUntil, setValidUntil] = useState("");

  const [agreed, setAgreed] = useState(false);

  // 簽名 canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const createMutation = trpc.modelConsents.create.useMutation({
    onSuccess: data => {
      toast.success("同意書已簽署完成");
      onCreated?.({ id: data.id, subjectName: subjectName.trim() });
      reset();
      onClose();
    },
    onError: e => toast.error("簽署失敗：" + e.message),
  });

  // 重置 state
  const reset = useCallback(() => {
    setSubjectType(defaultSubjectType);
    setConsentType("both");
    setSubjectName("");
    setSubjectEmail("");
    setSubjectIdLast4("");
    setSignerName("");
    setSignerEmail("");
    setSignerRelation("self");
    setUsageScope("training_only");
    setAllowDerivative(false);
    setValidUntil("");
    setAgreed(false);
    clearSignature();
  }, [defaultSubjectType]);

  // ── 簽名 canvas 互動 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [open]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const onPointerUp = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      setHasSignature(true);
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  // ── 提交 ─────────────────────────────────────────────────────────────
  const canSubmit = useMemo(() => {
    if (!subjectName.trim() || !signerName.trim() || !signerEmail.trim()) return false;
    if (signerRelation === "self" && subjectName.trim() !== signerName.trim()) {
      return false;
    }
    if (!agreed || !hasSignature) return false;
    return true;
  }, [
    subjectName,
    signerName,
    signerEmail,
    signerRelation,
    agreed,
    hasSignature,
  ]);

  const submit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL("image/png");

    createMutation.mutate({
      subjectType,
      consentType,
      subjectName: subjectName.trim(),
      subjectEmail: subjectEmail.trim() || undefined,
      subjectIdLast4: subjectIdLast4.trim() || undefined,
      signerName: signerName.trim(),
      signerEmail: signerEmail.trim(),
      signerRelation,
      usageScope,
      allowDerivative,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      termsVersion: CONSENT_TERMS_VERSION,
      termsSnapshot: TERMS_TEXT,
      signatureDataUrl,
    });
  }, [
    createMutation,
    subjectType,
    consentType,
    subjectName,
    subjectEmail,
    subjectIdLast4,
    signerName,
    signerEmail,
    signerRelation,
    usageScope,
    allowDerivative,
    validUntil,
  ]);

  return (
    <Dialog open={open} onOpenChange={v => (!v ? onClose() : null)}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-indigo-500" />
            數位肖像權 / 照片使用同意書
          </DialogTitle>
          <DialogDescription>
            訓練真實人物或第三方版權素材時，必須先簽署本同意書。簽名與條款全文
            將以加密形式保存以供日後稽核。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ── Section 1: 主體與簽署人資訊 ─────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              ① 主體與簽署人資訊
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">主體類型</Label>
                <select
                  value={subjectType}
                  onChange={e => setSubjectType(e.target.value as SubjectType)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(Object.keys(SUBJECT_TYPE_LABELS) as SubjectType[]).map(t => (
                    <option key={t} value={t}>
                      {SUBJECT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">同意書類型</Label>
                <select
                  value={consentType}
                  onChange={e => setConsentType(e.target.value as ConsentType)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {(Object.keys(CONSENT_TYPE_LABELS) as ConsentType[]).map(t => (
                    <option key={t} value={t}>
                      {CONSENT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">主體姓名 *</Label>
                <Input
                  value={subjectName}
                  onChange={e => setSubjectName(e.target.value)}
                  placeholder="王小明 / 著作權人名稱"
                />
              </div>
              <div>
                <Label className="text-xs">主體 Email</Label>
                <Input
                  type="email"
                  value={subjectEmail}
                  onChange={e => setSubjectEmail(e.target.value)}
                  placeholder="可選，用於通知與撤回驗證"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">身分證件後 4 碼（可選）</Label>
              <Input
                value={subjectIdLast4}
                onChange={e => setSubjectIdLast4(e.target.value)}
                maxLength={8}
                placeholder="僅取末 4 碼以供稽核比對，不存全碼"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">簽署人姓名 *</Label>
                <Input
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">簽署人 Email *</Label>
                <Input
                  type="email"
                  value={signerEmail}
                  onChange={e => setSignerEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">簽署人與主體的關係</Label>
              <select
                value={signerRelation}
                onChange={e =>
                  setSignerRelation(e.target.value as SignerRelation)
                }
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(SIGNER_RELATION_LABELS) as SignerRelation[]).map(
                  t => (
                    <option key={t} value={t}>
                      {SIGNER_RELATION_LABELS[t]}
                    </option>
                  )
                )}
              </select>
              {signerRelation === "self" &&
                subjectName.trim() &&
                signerName.trim() &&
                subjectName.trim() !== signerName.trim() && (
                  <p className="text-xs text-red-500 mt-1">
                    本人簽署時，主體姓名與簽署人姓名必須一致
                  </p>
                )}
            </div>
          </section>

          {/* ── Section 2: 授權範圍 ────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">
              ② 授權範圍
            </h3>

            <div>
              <Label className="text-xs">使用範圍</Label>
              <select
                value={usageScope}
                onChange={e => setUsageScope(e.target.value as UsageScope)}
                className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {(Object.keys(USAGE_SCOPE_LABELS) as UsageScope[]).map(t => (
                  <option key={t} value={t}>
                    {USAGE_SCOPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="allow-derivative"
                checked={allowDerivative}
                onCheckedChange={v => setAllowDerivative(Boolean(v))}
              />
              <Label htmlFor="allow-derivative" className="text-sm">
                允許衍生作品再分享（例：他人 remix / 二次創作）
              </Label>
            </div>

            <div>
              <Label className="text-xs">有效截止日（留空表示無期限）</Label>
              <Input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
              />
            </div>
          </section>

          {/* ── Section 3: 條款全文 ────────────────────────────────── */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              ③ 條款全文（{CONSENT_TERMS_VERSION}）
            </h3>
            <Textarea
              readOnly
              value={TERMS_TEXT}
              className="h-44 text-xs font-mono leading-relaxed"
            />
            <div className="flex items-start gap-2">
              <Checkbox
                id="agree-terms"
                checked={agreed}
                onCheckedChange={v => setAgreed(Boolean(v))}
              />
              <Label htmlFor="agree-terms" className="text-sm leading-relaxed">
                我已閱讀並同意上述全部條款，並保證簽署資訊真實正確。
              </Label>
            </div>
          </section>

          {/* ── Section 4: 數位簽名 ────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                ④ 數位簽名
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSignature}
              >
                <Eraser className="w-3.5 h-3.5 mr-1" /> 重新簽名
              </Button>
            </div>
            <div className="rounded-md border border-input bg-white">
              <canvas
                ref={canvasRef}
                width={640}
                height={180}
                className="w-full h-44 touch-none cursor-crosshair"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerUp}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              請在上方框內以滑鼠或觸控筆手寫簽名。
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" /> 簽署中…
              </>
            ) : (
              <>
                <FileSignature className="w-4 h-4 mr-1" /> 簽署並送出
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
