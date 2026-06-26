/**
 * AgentStatusBar — AIDV-334 代理狀態指示燈
 *
 * 折疊面板，預設收起，不影響現有 /video UI。
 * 每 30 秒透過 SSE /api/agents/heartbeat 收到快照更新。
 */

import { useEffect, useRef, useState } from "react";

interface AgentInfo {
  id: string;
  status: "active" | "idle" | "offline";
  load: number;
  queueDepth: number;
  capabilities: string[];
  lastSeenMs: number;
}

interface AgentSnapshot {
  agents: AgentInfo[];
}

const STATUS_COLOR: Record<AgentInfo["status"], string> = {
  active: "bg-green-500",
  idle: "bg-yellow-400",
  offline: "bg-red-500",
};

const STATUS_LABEL: Record<AgentInfo["status"], string> = {
  active: "活躍",
  idle: "閒置",
  offline: "離線",
};

function dot(status: AgentInfo["status"]) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[status]}`}
      aria-label={STATUS_LABEL[status]}
    />
  );
}

function overallStatus(agents: AgentInfo[]): AgentInfo["status"] {
  if (agents.length === 0) return "offline";
  if (agents.some(a => a.status === "active")) return "active";
  if (agents.some(a => a.status === "idle")) return "idle";
  return "offline";
}

export function AgentStatusBar() {
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/agents/heartbeat");
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const snap: AgentSnapshot = JSON.parse(e.data as string);
        setAgents(snap.agents);
      } catch {
        /* ignore parse errors */
      }
    };
    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const overall = overallStatus(agents);

  return (
    <div className="fixed bottom-4 right-4 z-40 font-mono text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-zinc-900/90 border border-zinc-700 text-zinc-200 shadow-lg hover:bg-zinc-800 transition-colors"
        aria-expanded={open}
        aria-label="代理狀態面板"
      >
        {dot(connected ? overall : "offline")}
        <span>代理</span>
        {agents.length > 0 && <span className="text-zinc-400">({agents.length})</span>}
        <span className="ml-0.5 text-zinc-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-1 w-72 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span>多代理監控</span>
            {!connected && (
              <span className="text-red-400 text-[10px]">連線中斷</span>
            )}
          </div>

          {agents.length === 0 ? (
            <p className="text-zinc-500 text-center py-2">無已登記代理</p>
          ) : (
            <ul className="space-y-1.5">
              {agents.map(a => (
                <li key={a.id} className="flex items-center gap-2">
                  {dot(a.status)}
                  <span className="flex-1 truncate text-zinc-200">{a.id}</span>
                  <span className="text-zinc-400 tabular-nums">
                    {(a.load * 100).toFixed(0)}%
                  </span>
                  <span
                    className="text-[10px] text-zinc-500"
                    title={STATUS_LABEL[a.status]}
                  >
                    {STATUS_LABEL[a.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {agents.length > 0 && (
            <div className="pt-1 border-t border-zinc-700 text-zinc-500 flex justify-between">
              <span>佇列深度</span>
              <span className="tabular-nums">{agents[0]?.queueDepth ?? 0}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
