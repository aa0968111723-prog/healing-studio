// ============================================================================
// components/social/SocialNewsList.tsx — /social cockpit「時事選題」列（經脊椎讀 news.list）
// ----------------------------------------------------------------------------
// 自 SocialCockpitPage 抽出的純展示選題列：每則新聞一列，點「引用」把標題帶進 brief。
//
// U-6（AIDV-96，屬 U-2/AIDV-92 逐殼採用）· /social 視覺實裝第 3 片：
//   旗標 ON 時改用 design-kit 亮色暖光 IntelItem（情報列：標題＋來源＋tag，整列可點＝引用）；
//   OFF（預設）＝沿用既有列（標題 + 引用按鈕）＝零變化（與 chrome 同一個 ENABLE_AIDV_CHROME 開關）。
//   純展示、props 驅動、引用邏輯由呼叫端傳入＝零後端、可回滾。
//   設計門依 ui-ux-pro-max「色彩非唯一資訊(High)」：兩版皆以文字呈現標題/來源/tag。
// ============================================================================
import { Button } from "@/components/ui/button";
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, IntelItem } from "@/components/design-kit";
import type { NewsItem } from "@/spine/types";

export function SocialNewsList({ news, onCite }: { news: NewsItem[]; onCite: (n: NewsItem) => void }) {
  // 旗標 ON：design-kit IntelItem（整列為按鈕，點擊＝引用；顯示來源與 tag）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="div" className="space-y-0.5">
        {news.map((n) => (
          <IntelItem key={n.id} title={n.title} source={n.source} tag={n.tag} onClick={() => onCite(n)} />
        ))}
      </AidvKit>
    );
  }

  return (
    <ul className="space-y-2">
      {news.map((n) => (
        <li key={n.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{n.title}</span>
          <Button size="sm" variant="ghost" onClick={() => onCite(n)}>
            引用
          </Button>
        </li>
      ))}
    </ul>
  );
}

export default SocialNewsList;
