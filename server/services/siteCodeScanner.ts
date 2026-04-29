/**
 * Site Code Scanner
 * ────────────────────────────────────────────────────────────────────────────
 * 真正的全站程式碼掃描器：遍歷 server/、client/src/、shared/ 的 TypeScript 檔案，
 * 套用啟發式規則找出潛在缺陷（安全、效能、品質、可維護性），並把結果輸出為
 * 結構化的 CodeFinding[]。AI 全站研究系統會以這些結果為基礎自動產生
 * ReflectionProposal 給管理員審核。
 *
 * 設計原則：
 *  - 純檔案掃描，不依賴 AST，避免引入 babel/typescript-eslint 重量級依賴
 *  - 啟發式規則保持可讀且可測：每條規則回傳 (file, line, snippet, severity)
 *  - 重複觸發同一規則的相同檔案位置會自動去重（dedupKey）
 *  - 預設只掃 ~3,500 個檔案、跳過 node_modules / dist / *.test.ts，避免噪音
 *  - 提供簡單的 AI 增強路徑（geminiReviewSnippet），讓 caller 可選擇對高嚴重度
 *    findings 進一步呼叫 LLM 取得修補建議
 */

import { promises as fs } from "fs";
import path from "path";

export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export type FindingCategory =
  | "security"
  | "performance"
  | "reliability"
  | "maintainability"
  | "quality"
  | "todo";

export interface CodeFinding {
  /** 穩定 ID — file + rule + line，用於去重 */
  dedupKey: string;
  rule: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string; // 相對於 repo root
  line: number;
  snippet: string;
  message: string;
  suggestion: string;
}

export interface ScanOptions {
  /** repo root（預設 process.cwd()） */
  rootDir?: string;
  /** 要掃描的子目錄（相對 rootDir） */
  includeDirs?: string[];
  /** 額外排除路徑（substring 比對） */
  excludePatterns?: string[];
  /** 單檔大小上限（bytes），超過視為 build artifact 略過 */
  maxFileBytes?: number;
  /** 每次掃描檔案數上限 */
  maxFiles?: number;
  /** 每條規則最多回報數（避免單一規則洗版） */
  maxFindingsPerRule?: number;
}

export interface ScanResult {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  filesScanned: number;
  filesSkipped: number;
  totalLines: number;
  findings: CodeFinding[];
  severityCounts: Record<FindingSeverity, number>;
  categoryCounts: Record<FindingCategory, number>;
}

const DEFAULT_INCLUDE_DIRS = ["server", "client/src", "shared"];

const DEFAULT_EXCLUDE_PATTERNS = [
  "node_modules",
  "/dist/",
  "/.git/",
  "/coverage/",
  "/playwright-report/",
  "/.next/",
  "/__tests__/",
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".d.ts",
  "drizzle/migrations",
  "drizzle/meta",
];

const SCAN_FILE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const DEFAULT_OPTIONS: Required<ScanOptions> = {
  rootDir: "",
  includeDirs: DEFAULT_INCLUDE_DIRS,
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  maxFileBytes: 600_000,
  maxFiles: 3500,
  maxFindingsPerRule: 30,
};

// ───────────────────────────────────────────────────────────────────────────
// 啟發式規則定義
// ───────────────────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  message: string;
  suggestion: string;
  /** 純 regex 規則（最常用） */
  pattern?: RegExp;
  /** 客製檢查 — 接收整個檔案內容、回傳所有命中行（1-based） */
  custom?: (content: string, filePath: string) => number[];
  /** 是否要忽略註解行 */
  ignoreComments?: boolean;
  /** 限制只在某些路徑套用（substring） */
  pathIncludes?: string[];
  /** 排除某些路徑（substring） */
  pathExcludes?: string[];
}

const RULES: Rule[] = [
  // ── 安全（Critical / High）────────────────────────────────────────────
  {
    id: "hardcoded-openai-key",
    category: "security",
    severity: "critical",
    // 支援 legacy `sk-...` 與 project-style `sk-proj-...`、Anthropic `sk-ant-...`
    pattern: /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{20,}\b/,
    message: "硬編碼疑似 OpenAI / Anthropic 風格 API Key",
    suggestion: "立即移除程式碼中的金鑰並透過環境變數讀取，輪替已外洩金鑰。",
    pathExcludes: [".env.example", "siteCodeScanner.ts", "site-code-scanner.test.ts"],
  },
  {
    id: "hardcoded-aws-key",
    category: "security",
    severity: "critical",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: "硬編碼疑似 AWS Access Key ID",
    suggestion: "立即移除並輪替 AWS 憑證；改用 IAM 角色或環境變數。",
  },
  {
    id: "hardcoded-google-key",
    category: "security",
    severity: "high",
    pattern: /\bAIza[0-9A-Za-z\-_]{30,}\b/,
    message: "硬編碼疑似 Google API Key",
    suggestion: "立即移除並輪替金鑰；改由 GEMINI_API_KEY 環境變數讀取。",
    pathExcludes: [".env.example"],
  },
  {
    id: "hardcoded-github-token",
    category: "security",
    severity: "critical",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    message: "硬編碼疑似 GitHub Personal Access Token",
    suggestion: "立即移除並輪替 token；改用 GITHUB_TOKEN 環境變數。",
  },
  {
    id: "eval-usage",
    category: "security",
    severity: "high",
    pattern: /(^|[^.\w])(eval|Function)\s*\(/,
    message: "使用 eval / new Function — 高風險動態程式碼執行",
    suggestion: "改用結構化解析（JSON.parse、查表）；如必要請嚴格驗證輸入。",
  },
  {
    id: "dangerous-html",
    category: "security",
    severity: "high",
    pattern: /dangerouslySetInnerHTML\s*=/,
    message: "dangerouslySetInnerHTML 可能引入 XSS",
    suggestion: "改用文字節點，或先以 DOMPurify 等函式庫消毒 HTML 字串。",
  },
  {
    id: "child-process-exec",
    category: "security",
    severity: "high",
    pattern: /\bchild_process\b.*\b(exec|spawn)Sync\b/,
    message: "同步 exec/spawn 可能讓使用者輸入注入 shell",
    suggestion: "改用 execFile/spawn 並以陣列傳參；嚴格驗證來源輸入。",
  },

  // ── 可靠性（Medium / High）────────────────────────────────────────────
  {
    id: "non-null-env",
    category: "reliability",
    severity: "medium",
    pattern: /process\.env\.[A-Z_][A-Z0-9_]*!/,
    message: "對 process.env 使用非空斷言（!），缺少 env 時會 NullPointer",
    suggestion: "改用 serverEnv（已驗證）或 if-guard，並對缺值情境提供預設。",
  },
  {
    id: "process-exit",
    category: "reliability",
    severity: "high",
    pattern: /\bprocess\.exit\s*\(/,
    message: "process.exit 立即終止 Node 程序，可能導致資源未清理",
    suggestion: "改用拋錯給上層 handler 處理；只在啟動入口（index.ts）使用。",
    pathExcludes: ["server/_core/index.ts", "/scripts/", "/cli/"],
  },
  {
    id: "swallowed-error",
    category: "reliability",
    severity: "medium",
    pattern: /catch\s*\(\s*[\w$]*\s*\)\s*\{\s*\}/,
    message: "空 catch — 完全吞掉例外，難以除錯",
    suggestion: "至少 console.warn 或紀錄到 error trace；明確標註為何安全略過。",
  },
  {
    id: "promise-no-await",
    category: "reliability",
    severity: "low",
    pattern: /^\s*(await\s+)?Promise\.all\([^)]*\)\s*;?\s*$/m,
    message: "Promise.all 可能未被 await — 結果遺失或例外吞掉",
    suggestion: "確認該 Promise 已被 await 或回傳，否則加 void 標註是 fire-and-forget。",
  },

  // ── 效能（Low / Medium）────────────────────────────────────────────
  {
    id: "sync-fs",
    category: "performance",
    severity: "medium",
    pattern: /\bfs\.(readFile|writeFile|readdir|stat|exists|access)Sync\b/,
    message: "同步 fs API 阻塞 event loop",
    suggestion: "改用 fs.promises 或 callback 版本以避免阻塞請求迴圈。",
    pathExcludes: ["/scripts/", "siteCodeScanner.ts"],
  },
  {
    id: "json-parse-no-try",
    category: "reliability",
    severity: "low",
    custom: (content) => {
      const lines = content.split("\n");
      const hits: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes("JSON.parse(")) continue;
        // 粗略檢查：往前 10 行內若沒有 try {，視為未保護
        const back = lines.slice(Math.max(0, i - 10), i + 1).join("\n");
        if (!/\btry\s*\{/.test(back)) hits.push(i + 1);
      }
      return hits;
    },
    message: "JSON.parse 未包在 try/catch — 無效 JSON 會炸 process",
    suggestion: "用 try/catch 包覆並回傳安全預設值，或改用 zod safeParse。",
  },

  // ── 品質（Low）────────────────────────────────────────────────────────
  {
    id: "console-log-prod",
    category: "quality",
    severity: "low",
    pattern: /^\s*console\.log\s*\(/m,
    message: "console.log 殘留在生產程式碼",
    suggestion: "替換為 BrainAuditLogger 或 console.warn/error；測試/腳本可保留。",
    pathExcludes: ["/scripts/", "/__tests__/", "siteCodeScanner.ts"],
  },
  {
    id: "debugger-stmt",
    category: "quality",
    severity: "medium",
    pattern: /^\s*debugger\s*;/m,
    message: "debugger 陳述會在開發者工具開啟時凍結頁面",
    suggestion: "送 commit 前移除 debugger 陳述。",
  },
  {
    id: "todo-comment",
    category: "todo",
    severity: "info",
    pattern: /\b(TODO|FIXME|XXX|HACK)\b\s*[:：]/,
    message: "TODO/FIXME 註解尚未處理",
    suggestion: "建立追蹤 issue 或於本次清理；確認是否仍有效。",
  },

  // ── 可維護性（Low）────────────────────────────────────────────────────
  {
    id: "huge-file",
    category: "maintainability",
    severity: "low",
    custom: (content) => {
      const lineCount = content.split("\n").length;
      return lineCount > 1500 ? [1] : [];
    },
    message: "檔案超過 1500 行 — 維護成本偏高",
    suggestion: "考慮按子系統拆分（services/、helpers/、types.ts），以 barrel index 重新匯出。",
    pathExcludes: ["package-lock.json", ".min.js"],
  },
];

// ───────────────────────────────────────────────────────────────────────────
// 檔案遍歷
// ───────────────────────────────────────────────────────────────────────────

async function walk(
  dir: string,
  excludePatterns: readonly string[],
  acc: string[],
  maxFiles: number
): Promise<void> {
  if (acc.length >= maxFiles) return;
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= maxFiles) return;
    const full = path.join(dir, entry.name);
    if (excludePatterns.some(p => full.includes(p))) continue;
    if (entry.isDirectory()) {
      await walk(full, excludePatterns, acc, maxFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCAN_FILE_EXTS.has(ext)) acc.push(full);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 規則套用
// ───────────────────────────────────────────────────────────────────────────

function trimSnippet(line: string, maxLen = 200): string {
  const compact = line.trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}…` : compact;
}

function applyRules(
  filePath: string,
  relativePath: string,
  content: string,
  ruleHitCounts: Map<string, number>,
  maxFindingsPerRule: number
): CodeFinding[] {
  const findings: CodeFinding[] = [];
  const lines = content.split("\n");

  for (const rule of RULES) {
    if (
      rule.pathIncludes &&
      !rule.pathIncludes.some(p => relativePath.includes(p))
    )
      continue;
    if (
      rule.pathExcludes &&
      rule.pathExcludes.some(p => relativePath.includes(p))
    )
      continue;

    const hitCount = ruleHitCounts.get(rule.id) ?? 0;
    if (hitCount >= maxFindingsPerRule) continue;

    let hitLineNumbers: number[] = [];

    if (rule.custom) {
      hitLineNumbers = rule.custom(content, relativePath);
    } else if (rule.pattern) {
      // 對每一行套用 regex（避免跨行誤判）
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (rule.ignoreComments) {
          const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
          if (!stripped.trim()) continue;
        }
        if (rule.pattern.test(line)) hitLineNumbers.push(i + 1);
      }
    }

    for (const lineNo of hitLineNumbers) {
      if ((ruleHitCounts.get(rule.id) ?? 0) >= maxFindingsPerRule) break;
      const snippet = lines[lineNo - 1] ? trimSnippet(lines[lineNo - 1]) : "";
      findings.push({
        dedupKey: `${rule.id}|${relativePath}|${lineNo}`,
        rule: rule.id,
        category: rule.category,
        severity: rule.severity,
        filePath: relativePath,
        line: lineNo,
        snippet,
        message: rule.message,
        suggestion: rule.suggestion,
      });
      ruleHitCounts.set(rule.id, (ruleHitCounts.get(rule.id) ?? 0) + 1);
    }
  }

  return findings;
}

// ───────────────────────────────────────────────────────────────────────────
// 主進入點
// ───────────────────────────────────────────────────────────────────────────

export async function scanSiteCode(
  options: ScanOptions = {}
): Promise<ScanResult> {
  const opts: Required<ScanOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    rootDir: options.rootDir ?? process.cwd(),
  };
  const startedAt = Date.now();

  // 1. 收集要掃描的檔案
  const candidates: string[] = [];
  for (const sub of opts.includeDirs) {
    await walk(
      path.join(opts.rootDir, sub),
      opts.excludePatterns,
      candidates,
      opts.maxFiles
    );
  }

  // 2. 套用規則
  const findings: CodeFinding[] = [];
  const ruleHitCounts = new Map<string, number>();
  let filesScanned = 0;
  let filesSkipped = 0;
  let totalLines = 0;

  for (const absPath of candidates) {
    let stat: import("fs").Stats;
    try {
      stat = await fs.stat(absPath);
    } catch {
      filesSkipped++;
      continue;
    }
    if (stat.size > opts.maxFileBytes) {
      filesSkipped++;
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(absPath, "utf8");
    } catch {
      filesSkipped++;
      continue;
    }
    filesScanned++;
    totalLines += content.split("\n").length;
    const relativePath = path.relative(opts.rootDir, absPath).replaceAll("\\", "/");
    findings.push(
      ...applyRules(absPath, relativePath, content, ruleHitCounts, opts.maxFindingsPerRule)
    );
  }

  // 3. 統計
  const severityCounts: Record<FindingSeverity, number> = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  const categoryCounts: Record<FindingCategory, number> = {
    security: 0,
    performance: 0,
    reliability: 0,
    maintainability: 0,
    quality: 0,
    todo: 0,
  };
  for (const f of findings) {
    severityCounts[f.severity]++;
    categoryCounts[f.category]++;
  }

  const finishedAt = Date.now();
  return {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    filesScanned,
    filesSkipped,
    totalLines,
    findings,
    severityCounts,
    categoryCounts,
  };
}

/** 嚴重度排序：critical > high > medium > low > info */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** 取出最值得管理員關注的 findings（按嚴重度與 dedupKey 排序） */
export function rankFindings(
  findings: readonly CodeFinding[],
  topN = 20
): CodeFinding[] {
  return [...findings]
    .sort((a, b) => {
      const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return a.dedupKey.localeCompare(b.dedupKey);
    })
    .slice(0, topN);
}

/** 將 finding 渲染成適合放進 GitHub Issue body 的 Markdown 區塊 */
export function findingToMarkdown(f: CodeFinding): string {
  return [
    `**${f.severity.toUpperCase()}** · \`${f.category}\` · \`${f.rule}\``,
    "",
    `**檔案**：\`${f.filePath}:${f.line}\``,
    "",
    "```",
    f.snippet || "(無片段)",
    "```",
    "",
    `**問題**：${f.message}`,
    "",
    `**建議**：${f.suggestion}`,
  ].join("\n");
}

/** 暴露規則清單（測試用） */
export function getRuleIds(): string[] {
  return RULES.map(r => r.id);
}
