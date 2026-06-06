// ============================================================================
// shells/learn/LearnHome.tsx — /learn 富首頁（六分頁聚合）
// ----------------------------------------------------------------------------
// 把 P6 五大面板聚合成 /learn 的 landing：研究代理 / 模型情報 / 學習中心 / 積分 /
//   API 金鑰 / 新聞。分頁狀態同步到 URL ?sub=，方便深連結（如 /learn?sub=models）。
// 對映模擬 learn shell 的 subtabs；改用 repo 既有 shadcn Tabs + 真實接縫。
// ============================================================================
import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { Globe, Cpu, BookOpen, Coins, KeyRound, Newspaper } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResearchPanel } from "./panels/ResearchPanel";
import { AIModelHubPanel } from "./panels/AIModelHubPanel";
import { LearnDocsPanel } from "./panels/LearnDocsPanel";
import { CreditsUsagePanel } from "./panels/CreditsUsagePanel";
import { ApiKeysPanel } from "./panels/ApiKeysPanel";
import { NewsPanel } from "./panels/NewsPanel";

const TABS = [
  { key: "research", label: "研究代理", icon: Globe },
  { key: "models", label: "模型情報", icon: Cpu },
  { key: "hub", label: "學習中心", icon: BookOpen },
  { key: "credits", label: "積分", icon: Coins },
  { key: "keys", label: "API 金鑰", icon: KeyRound },
  { key: "news", label: "新聞", icon: Newspaper },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function readSub(search: string, fallback: TabKey): TabKey {
  const sp = new URLSearchParams(search);
  const v = sp.get("sub");
  return (TABS.some((t) => t.key === v) ? v : fallback) as TabKey;
}

/** initial：canonical 子路徑（如 /learn/ai-models）指定的預設分頁；URL ?sub= 優先。 */
export function LearnHome({ initial = "research" }: { initial?: TabKey }) {
  const search = useSearch();
  const [sub, setSub] = useState<TabKey>(() => readSub(search, initial));

  // URL ?sub= 變動（如 cmdk 深連結）→ 同步分頁。
  useEffect(() => { setSub(readSub(search, initial)); }, [search, initial]);

  const onChange = (v: string) => {
    setSub(v as TabKey);
    const sp = new URLSearchParams(window.location.search);
    sp.set("sub", v);
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 space-y-4 animate-in fade-in duration-300">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">📚 學習文件系統</h1>
        <p className="text-sm text-muted-foreground mt-1">
          學習中心 · 模型情報（115）· 研究代理（Sonar+Brave）· 積分 / API · 情報新聞
        </p>
      </div>

      <Tabs value={sub} onValueChange={onChange} className="w-full">
        <TabsList className="flex flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="research" className="mt-4"><ResearchPanel /></TabsContent>
        <TabsContent value="models" className="mt-4"><AIModelHubPanel /></TabsContent>
        <TabsContent value="hub" className="mt-4"><LearnDocsPanel /></TabsContent>
        <TabsContent value="credits" className="mt-4"><CreditsUsagePanel /></TabsContent>
        <TabsContent value="keys" className="mt-4"><ApiKeysPanel /></TabsContent>
        <TabsContent value="news" className="mt-4"><NewsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

export default LearnHome;
