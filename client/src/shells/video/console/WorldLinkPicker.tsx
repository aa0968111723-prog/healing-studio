// ============================================================================
// shells/video/console/WorldLinkPicker.tsx — I-6 Phase 2b 世界連結選單（AIDV-100）
// ----------------------------------------------------------------------------
// 創作流程嚮導「世界觀」步未連結時內嵌：列出使用者世界（spine.listWorlds →
// worldbuilding.list）→ 選一個 → spine.linkWorld（creativeProject.link，既有 procedure、
// 零新後端）。連結後嚮導世界步即打勾、世界上下文（I-2 風格）帶入後續。
// 純前端、唯讀消費既有脊椎動作；只在 ENABLE_PROJECT_HUB 之下（由 ProjectFlowGuide 掛載）渲染。
// ============================================================================
import { useEffect, useState } from "react";
import { Globe2, Loader2 } from "lucide-react";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";

export function WorldLinkPicker() {
  const { listWorlds, linkWorld } = useProjectSpine();
  const [worlds, setWorlds] = useState<{ id: number; name: string }[] | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let alive = true;
    listWorlds()
      .then((w) => { if (alive) setWorlds(w); })
      .catch(() => { if (alive) setWorlds([]); });
    return () => { alive = false; };
  }, [listWorlds]);

  const pick = async (worldFrameworkId: number) => {
    setLinking(true);
    try { await linkWorld(worldFrameworkId); } finally { setLinking(false); }
  };

  if (worlds == null) {
    return (
      <div className="mt-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> 載入世界清單…
      </div>
    );
  }
  if (worlds.length === 0) {
    return (
      <div className="mt-1 px-1 text-[10px] text-muted-foreground">
        尚無世界——先到世界觀建立角色／場景，再回來連結。
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1">
      <div className="px-1 text-[10px] text-muted-foreground">選一個世界連結（自動帶入風格／角色一致性）</div>
      {worlds.map((w) => (
        <button
          key={w.id}
          type="button"
          disabled={linking}
          onClick={() => pick(w.id)}
          className="flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-healing hover:border-border hover:bg-muted/50 disabled:opacity-60"
        >
          <Globe2 className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{w.name}</span>
        </button>
      ))}
    </div>
  );
}

export default WorldLinkPicker;
