// ============================================================================
// spine/contextPacket.ts — Context Packet 本地決定性重編（脊椎核心）
// ----------------------------------------------------------------------------
// 來源：AI-Director-模擬 spine/contextPacket.ts。把專案壓成精華摘要 + 來源清單 + token 估算。
//
// 兩種用途：
//   1) 真實模式：rebuildPacket 會優先打 contextPacket.compileProject（伺服器 Deterministic→
//      Cache→RAG）。本地重編是**離線/樂觀回退**——伺服器無回應或 mock 模式時用它即時重算，
//      讓「重建 Context Packet」與「引導式拆解後更新 packet」永遠有結果可顯示。
//   2) mock 模式：完全用本地重編。
//
// 對映 healing-studio：context_packets（伺服器版為權威；本地版為 UI 即時回饋）。
// ============================================================================
import type { CreativeProject, ContextPacket } from "@/spine/types";

export function compileContextPacket(p: CreativeProject): ContextPacket {
  const charLine = p.characters.length
    ? p.characters
        .map((c) => `${c.name}(${c.sourceGrade === "precise" ? "定版" : c.sourceGrade === "estimate" ? "估算" : "未確認"})`)
        .join("、")
    : "（無角色）";
  const done = p.shots.filter((s) => s.gen.status === "done").length;
  const summary =
    `${p.name}・${p.type}線。Logline：${p.logline || "（未填）"}。風格＝${p.styleBible || "（未定）"}。` +
    `角色：${charLine}。分鏡 ${p.shots.length} 鏡（已生 ${done}）。場景 ${p.scenes.length} 個。`;

  const sourceRefs: ContextPacket["sourceRefs"] = [];
  if (p.characters.length || p.scenes.length) {
    sourceRefs.push({ ref: `worldbuilding_frameworks#${p.id}`, kind: "世界觀", fresh: true });
  }
  if (p.shots.length) {
    sourceRefs.push({ ref: `world_storyboards#${p.shots[0]?.no}-${p.shots[p.shots.length - 1]?.no}`, kind: "分鏡", fresh: true });
  }
  p.characters
    .filter((c) => c.locked)
    .forEach((c) => sourceRefs.push({ ref: `consistency_vault#${c.id}`, kind: "角色鎖定", fresh: true }));

  // 保留既有外部來源（雲端教材 / Drive / 發佈 / 選題 / 品牌 / news）的新鮮度。
  p.packet.sourceRefs
    .filter((r) => /教材|Drive|發佈|選題|品牌|news/i.test(r.kind))
    .forEach((r) => sourceRefs.push(r));

  // 粗估 token：摘要長度 × 1.6 + 每來源 ~120 + 每鏡 ~60。
  const tokenEstimate = Math.round(summary.length * 1.6 + sourceRefs.length * 120 + p.shots.length * 60);
  return { summaryMarkdown: summary, sourceRefs, tokenEstimate, ttlSec: 1800, permissions: p.packet.permissions };
}
