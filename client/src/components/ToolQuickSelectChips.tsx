/**
 * ToolQuickSelectChips — 白名單／黑名單 CSV 快選按鈕
 * ────────────────────────────────────────────────────────────────────────────
 * 給「全站光球代理設定」與 /settings/agent 兩個地方共用：
 *   - 直接讀 shared/GLOBAL_AGENT_TOOL_REGISTRY，把工具按風險等級分組成 chip
 *   - 點 chip 直接 toggle 該工具名稱進／出 CSV 字串，使用者不必手打名字
 *   - 也提供萬用 `*`（全部工具）做為第一格快選
 *
 * variant="allow" 時用綠色高亮（白名單情境）；
 * variant="block" 時用紅色高亮（黑名單情境）。
 */
import { useMemo } from "react";
import {
  GLOBAL_AGENT_TOOL_REGISTRY,
  type GlobalAgentToolDefinition,
} from "@shared/global-agent-tools";

type Variant = "allow" | "block";

interface ToolQuickSelectChipsProps {
  csv: string;
  setCsv: (value: string) => void;
  variant: Variant;
}

interface ChipGroup {
  label: string;
  hint?: string;
  items: Array<{ name: string; description?: string }>;
}

function csvToSet(csv: string): Set<string> {
  return new Set(
    csv
      .split(/[,\n]/g)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function setToCsv(set: Set<string>): string {
  return Array.from(set).join(", ");
}

function describeTool(tool: GlobalAgentToolDefinition): string {
  const target =
    tool.executionTarget === "claudeCode"
      ? "Claude Code"
      : tool.executionTarget === "external-provider"
        ? "外部供應商"
        : tool.executionTarget === "server-side"
          ? "後端"
          : "前端 UI";
  return `${target}・${tool.riskLevel}`;
}

const RISK_GROUP_LABEL: Record<
  GlobalAgentToolDefinition["riskLevel"],
  { label: string; hint: string }
> = {
  low: {
    label: "低風險",
    hint: "建議放白名單，光球可直接執行",
  },
  medium: {
    label: "中風險",
    hint: "工作流常用工具，看情況放行",
  },
  high: {
    label: "高風險",
    hint: "會動到外部資源，建議手動確認或放黑名單",
  },
};

function buildGroups(): ChipGroup[] {
  const byRisk: Record<
    GlobalAgentToolDefinition["riskLevel"],
    GlobalAgentToolDefinition[]
  > = { low: [], medium: [], high: [] };
  for (const tool of GLOBAL_AGENT_TOOL_REGISTRY) {
    byRisk[tool.riskLevel].push(tool);
  }
  const groups: ChipGroup[] = [
    {
      label: "通用",
      hint: "代表全部工具",
      items: [{ name: "*", description: "套用到所有工具" }],
    },
  ];
  (["low", "medium", "high"] as const).forEach(risk => {
    if (byRisk[risk].length === 0) return;
    groups.push({
      label: RISK_GROUP_LABEL[risk].label,
      hint: RISK_GROUP_LABEL[risk].hint,
      items: byRisk[risk].map(tool => ({
        name: tool.name,
        description: describeTool(tool),
      })),
    });
  });
  return groups;
}

export default function ToolQuickSelectChips({
  csv,
  setCsv,
  variant,
}: ToolQuickSelectChipsProps) {
  const selected = useMemo(() => csvToSet(csv), [csv]);
  const groups = useMemo(() => buildGroups(), []);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCsv(setToCsv(next));
  };

  const activeClass =
    variant === "allow"
      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-destructive bg-destructive/10 text-destructive";
  const inactiveClass =
    variant === "allow"
      ? "border-border text-muted-foreground hover:border-emerald-400 hover:text-emerald-600"
      : "border-border text-muted-foreground hover:border-destructive hover:text-destructive";

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        快選（點一下加入／移除，會自動寫進下方文字框）
      </p>
      <div className="space-y-2">
        {groups.map(group => (
          <div key={group.label}>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium">{group.label}</span>
              {group.hint && (
                <span className="text-[10px] text-muted-foreground">
                  {group.hint}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {group.items.map(item => {
                const isActive = selected.has(item.name);
                return (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => toggle(item.name)}
                    title={item.description ?? item.name}
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-mono transition ${
                      isActive ? activeClass : inactiveClass
                    }`}
                    aria-pressed={isActive}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
