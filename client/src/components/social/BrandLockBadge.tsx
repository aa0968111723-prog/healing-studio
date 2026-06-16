// ============================================================================
// components/social/BrandLockBadge.tsx — 品牌鎖定狀態徽章（已鎖定 / 草稿等）
// ----------------------------------------------------------------------------
// 自 SocialCockpitPage 品牌摘要卡抽出的純展示狀態徽章。
//
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 視覺實裝第 5 片：
//   旗標 ON 時改用 design-kit 亮色暖光 Pill（已鎖定＝ok 鼠尾草綠、未鎖＝mute，帶狀態點）；
//   OFF（預設）＝沿用既有 shadcn Badge＝零變化（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）。
//   純展示、props 驅動＝零後端、可回滾。
//   設計門依 ui-ux-pro-max「色彩非唯一資訊(High)」：兩版皆以文字呈現鎖定狀態，不單靠顏色。
// ============================================================================
import { Badge } from "@/components/ui/badge";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, Pill } from "@/components/design-kit";

export function BrandLockBadge({ locked, lockState }: { locked: boolean; lockState: string }) {
  const label = locked ? "已鎖定" : lockState;
  // 旗標 ON：design-kit Pill（ok/mute 語意＋狀態點）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="span">
        <Pill kind={locked ? "ok" : "mute"} dot>
          {label}
        </Pill>
      </AidvKit>
    );
  }
  return (
    <Badge variant={locked ? "default" : "secondary"} className={locked ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
      {label}
    </Badge>
  );
}

export default BrandLockBadge;
