// ============================================================================
// shells/video/columns/DatabaseColumn.tsx — 右欄：專案資料庫（分頁）
// ----------------------------------------------------------------------------
// 分頁：分鏡 / 角色 / 場景 / 筆記 / 資產 / 提示詞。每頁是一個 panel 元件，全部 bound 到
// useProjectSpine()。對映 healing-studio：world_storyboards / consistency_vault /
// worldbuilding_frameworks(scenes) / project_notes_calendar / digital_asset_library / prompt_library。
// ============================================================================
import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProjectSpine } from "@/spine/ProjectSpineProvider";
import { ShotPanel } from "../panels/ShotPanel";
import { CharacterPanel } from "../panels/CharacterPanel";
import { ScenePanel } from "../panels/ScenePanel";
import { NotesPanel } from "../panels/NotesPanel";
import { AssetsPanel } from "../panels/AssetsPanel";
import { PromptsPanel } from "../panels/PromptsPanel";

export function DatabaseColumn() {
  const spine = useProjectSpine();
  const p = spine.project!;

  return (
    <Card className="glass-card-static self-start">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="size-4 text-primary" /> 專案資料庫
          <Badge variant="outline" className="ml-auto text-[10px]">{p.shots.length} 鏡</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="shots">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="shots" className="text-[11px]">分鏡</TabsTrigger>
            <TabsTrigger value="chars" className="text-[11px]">角色</TabsTrigger>
            <TabsTrigger value="scenes" className="text-[11px]">場景</TabsTrigger>
            <TabsTrigger value="notes" className="text-[11px]">筆記</TabsTrigger>
            <TabsTrigger value="assets" className="text-[11px]">資產</TabsTrigger>
            <TabsTrigger value="prompts" className="text-[11px]">提示詞</TabsTrigger>
          </TabsList>

          <div className="mt-3 max-h-[440px] overflow-y-auto pr-1">
            <TabsContent value="shots" className="mt-0"><ShotPanel /></TabsContent>
            <TabsContent value="chars" className="mt-0"><CharacterPanel /></TabsContent>
            <TabsContent value="scenes" className="mt-0"><ScenePanel /></TabsContent>
            <TabsContent value="notes" className="mt-0"><NotesPanel /></TabsContent>
            <TabsContent value="assets" className="mt-0"><AssetsPanel /></TabsContent>
            <TabsContent value="prompts" className="mt-0"><PromptsPanel /></TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default DatabaseColumn;
