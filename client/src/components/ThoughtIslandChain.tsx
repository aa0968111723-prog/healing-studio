import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Cpu,
  Sparkles,
  Palette,
  Zap,
  CheckCircle2,
  Scissors,
  Maximize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ChevronDown,
  ChevronUp,
  Eye,
  Code,
  Layers,
  StickyNote,
} from "lucide-react";
import * as d3 from "d3";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ThoughtNode = {
  id: string;
  label: string;
  status: "queued" | "processing" | "completed" | "passed" | "error";
  detail: string;
  timestamp: number;
  children?: ThoughtNode[];
  reasoning?: string;
  confidence?: number;
  tokens?: number;
};

type ZoomLevel = "overview" | "detail" | "json";

type Props = {
  nodes: ThoughtNode[];
  isVisible: boolean;
  onIntervene?: (
    nodeId: string,
    action: "trim" | "expand" | "redirect"
  ) => void;
  onPinToNotes?: (node: ThoughtNode) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  // Defensive: if an absolute Unix timestamp leaks in (years 2020+ ≈ 1.6e12),
  // convert to elapsed-from-now so we never print raw 1773762824205ms.
  if (ms > 1e12) {
    ms = Math.max(0, Date.now() - ms);
  }
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} 秒`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分鐘`;
  return `${(ms / 3_600_000).toFixed(1)} 小時`;
}

function computeRelativeDurations(nodes: ThoughtNode[]): Map<string, number> {
  const map = new Map<string, number>();
  if (nodes.length === 0) return map;
  const sorted = [...nodes].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      map.set(sorted[i].id, 0);
    } else {
      map.set(sorted[i].id, sorted[i].timestamp - sorted[i - 1].timestamp);
    }
  }
  return map;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  queued: "#6b7280",
  processing: "#f59e0b",
  completed: "#10b981",
  passed: "#10b981",
  error: "#ef4444",
};

const STATUS_GLOW: Record<string, string> = {
  queued: "rgba(107, 114, 128, 0.15)",
  processing: "rgba(245, 158, 11, 0.25)",
  completed: "rgba(16, 185, 129, 0.2)",
  passed: "rgba(16, 185, 129, 0.2)",
  error: "rgba(239, 68, 68, 0.25)",
};

// L12:未知 status(例:server 加新狀態但 client 沒同步)時 fallback 成
// 中性灰,而不是 undefined → "undefined" stroke 讓 d3 path 整條無色。
const FALLBACK_COLOR = "#6b7280";
const FALLBACK_GLOW = "rgba(107, 114, 128, 0.15)";
function colorForStatus(status: string): string {
  return STATUS_COLORS[status] ?? FALLBACK_COLOR;
}
function glowForStatus(status: string): string {
  return STATUS_GLOW[status] ?? FALLBACK_GLOW;
}

const NODE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  safety: Shield,
  compile: Cpu,
  generate: Sparkles,
  style: Palette,
  enhance: Zap,
};

const ZOOM_LABELS: Record<
  ZoomLevel,
  { label: string; icon: React.ReactNode; desc: string }
> = {
  overview: {
    label: "總覽",
    icon: <Layers className="w-3.5 h-3.5" />,
    desc: "島鏈全景",
  },
  detail: {
    label: "細節",
    icon: <Eye className="w-3.5 h-3.5" />,
    desc: "節點推理",
  },
  json: {
    label: "JSON",
    icon: <Code className="w-3.5 h-3.5" />,
    desc: "原始數據",
  },
};

// ─── D3 Island Visualization ───────────────────────────────────────────────

// ─── Wrapped with memo — D3 re-renders are expensive ──────────────────────
const D3IslandCanvas = memo(function D3IslandCanvas({
  nodes,
  zoomLevel,
  selectedNode,
  onSelectNode,
}: {
  nodes: ThoughtNode[];
  zoomLevel: ZoomLevel;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>(undefined);
  const durationsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    durationsRef.current = computeRelativeDurations(nodes);
  }, [nodes]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.max(180, nodes.length * 45 + 60);

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Clear previous
    svg.selectAll("*").remove();

    // Create defs for gradients and filters
    const defs = svg.append("defs");

    // Glow filter
    const glow = defs.append("filter").attr("id", "node-glow");
    glow
      .append("feGaussianBlur")
      .attr("stdDeviation", "4")
      .attr("result", "blur");
    glow
      .append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", d => d);

    // Processing pulse filter
    const pulse = defs.append("filter").attr("id", "pulse-glow");
    pulse
      .append("feGaussianBlur")
      .attr("stdDeviation", "6")
      .attr("result", "blur");
    pulse
      .append("feMerge")
      .selectAll("feMergeNode")
      .data(["blur", "SourceGraphic"])
      .join("feMergeNode")
      .attr("in", d => d);

    // Main group with zoom
    const g = svg.append("g");

    // Setup zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 4])
      .on("zoom", event => {
        g.attr("transform", event.transform.toString());
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Layout nodes in a flowing chain
    const nodeSpacing = width / (nodes.length + 1);
    const centerY = height / 2;

    // Draw connecting paths (flowing curves)
    for (let i = 0; i < nodes.length - 1; i++) {
      const x1 = nodeSpacing * (i + 1);
      const x2 = nodeSpacing * (i + 2);
      const midX = (x1 + x2) / 2;
      const waveY = Math.sin(i * 0.8) * 12;

      const pathData = `M ${x1 + 22} ${centerY} C ${midX} ${centerY + waveY}, ${midX} ${centerY - waveY}, ${x2 - 22} ${centerY}`;

      // Path glow
      g.append("path")
        .attr("d", pathData)
        .attr("fill", "none")
        .attr("stroke", colorForStatus(nodes[i].status))
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 0.15)
        .attr("filter", "url(#node-glow)");

      // Main path
      const path = g
        .append("path")
        .attr("d", pathData)
        .attr("fill", "none")
        .attr("stroke", colorForStatus(nodes[i].status))
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.5)
        .attr("stroke-dasharray", function () {
          return (this as SVGPathElement).getTotalLength();
        })
        .attr("stroke-dashoffset", function () {
          return (this as SVGPathElement).getTotalLength();
        });

      // Animate path drawing
      path
        .transition()
        .delay(i * 200)
        .duration(600)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);
    }

    // Draw nodes
    nodes.forEach((node, i) => {
      const cx = nodeSpacing * (i + 1);
      const cy = centerY;
      const isSelected = selectedNode === node.id;
      const color = colorForStatus(node.status);
      const glowColor = glowForStatus(node.status);

      const nodeGroup = g
        .append("g")
        .attr("transform", `translate(${cx}, ${cy})`)
        .attr("cursor", "pointer")
        .on("click", () => onSelectNode(isSelected ? null : node.id));

      // Outer glow ring
      nodeGroup
        .append("circle")
        .attr("r", 0)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", isSelected ? 2 : 1)
        .attr("stroke-opacity", isSelected ? 0.6 : 0.2)
        .attr("filter", "url(#node-glow)")
        .transition()
        .delay(i * 150)
        .duration(500)
        .ease(d3.easeElasticOut.amplitude(1).period(0.4))
        .attr("r", isSelected ? 28 : 24);

      // Background circle
      nodeGroup
        .append("circle")
        .attr("r", 0)
        .attr("fill", glowColor)
        .attr("stroke", color)
        .attr("stroke-width", isSelected ? 2 : 1)
        .attr("stroke-opacity", 0.6)
        .transition()
        .delay(i * 150)
        .duration(400)
        .ease(d3.easeBackOut.overshoot(1.5))
        .attr("r", 20);

      // Processing pulse animation
      if (node.status === "processing") {
        const pulseCircle = nodeGroup
          .append("circle")
          .attr("r", 20)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.6);

        const animatePulse = () => {
          pulseCircle
            .attr("r", 20)
            .attr("stroke-opacity", 0.6)
            .transition()
            .duration(1200)
            .ease(d3.easeQuadOut)
            .attr("r", 32)
            .attr("stroke-opacity", 0)
            .on("end", animatePulse);
        };
        animatePulse();
      }

      // Icon text (emoji fallback)
      const iconMap: Record<string, string> = {
        safety: "🛡",
        compile: "⚙",
        generate: "✨",
        style: "🎨",
        enhance: "⚡",
      };
      nodeGroup
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "14px")
        .attr("opacity", 0)
        .text(iconMap[node.id] || "●")
        .transition()
        .delay(i * 150 + 200)
        .duration(300)
        .attr("opacity", 1);

      // Label below
      nodeGroup
        .append("text")
        .attr("y", 36)
        .attr("text-anchor", "middle")
        .attr("font-size", "11px")
        .attr("fill", color)
        .attr("font-weight", "500")
        .attr("opacity", 0)
        .text(node.label)
        .transition()
        .delay(i * 150 + 300)
        .duration(300)
        .attr("opacity", 0.9);

      // Timestamp below label
      if (node.timestamp > 0 && zoomLevel !== "overview") {
        nodeGroup
          .append("text")
          .attr("y", 50)
          .attr("text-anchor", "middle")
          .attr("font-size", "9px")
          .attr("fill", "rgba(255,255,255,0.4)")
          .attr("opacity", 0)
          .text(formatDuration(durationsRef.current.get(node.id) ?? 0))
          .transition()
          .delay(i * 150 + 400)
          .duration(300)
          .attr("opacity", 1);
      }
    });

    // Auto-zoom to fit
    const initialScale =
      zoomLevel === "json" ? 1.5 : zoomLevel === "detail" ? 1.2 : 1;
    svg
      .transition()
      .duration(500)
      .call(
        zoom.transform,
        d3.zoomIdentity.translate(0, 0).scale(initialScale)
      );
  }, [nodes, zoomLevel, selectedNode, onSelectNode]);

  // Handle scroll-to-zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    // D3 zoom handles this via svg.call(zoom)
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-lg"
      style={{ minHeight: "180px" }}
      onWheel={handleWheel}
    >
      <svg
        ref={svgRef}
        className="w-full"
        style={{
          minHeight: "180px",
          background: "rgba(0,0,0,0.15)",
          borderRadius: "8px",
        }}
      />
    </div>
  );
});

// ─── Main Component ────────────────────────────────────────────────────────

// ─── Wrapped with React.memo to prevent re-renders when nodes haven't changed ─
const ThoughtIslandChain = memo(function ThoughtIslandChain({
  nodes,
  isVisible,
  onIntervene,
  onPinToNotes,
}: Props) {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("overview");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const durationsRef = useRef<Map<string, number>>(new Map());

  // Compute relative durations whenever nodes change
  useEffect(() => {
    durationsRef.current = computeRelativeDurations(nodes);
  }, [nodes]);

  const selectedNodeData = useMemo(
    () => nodes.find(n => n.id === selectedNode),
    [nodes, selectedNode]
  );

  const completedCount = useMemo(
    () => nodes.filter(n => n.status === "completed").length,
    [nodes]
  );

  const handleIntervene = useCallback(
    (action: "trim" | "expand" | "redirect") => {
      if (selectedNode && onIntervene) {
        onIntervene(selectedNode, action);
      }
    },
    [selectedNode, onIntervene]
  );

  const cycleZoom = useCallback(() => {
    const levels: ZoomLevel[] = ["overview", "detail", "json"];
    const idx = levels.indexOf(zoomLevel);
    setZoomLevel(levels[(idx + 1) % levels.length]);
  }, [zoomLevel]);

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-left"
        >
          <div className="relative">
            <Cpu className="w-4 h-4 text-primary" />
            {nodes.some(n => n.status === "processing") && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="text-sm font-semibold text-foreground">
            思維島鏈
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {completedCount}/{nodes.length} 完成
          </span>
        </button>

        <div className="flex items-center gap-1.5">
          {/* Zoom level tabs */}
          {(["overview", "detail", "json"] as ZoomLevel[]).map(level => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all",
                zoomLevel === level
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-card/5"
              )}
            >
              {ZOOM_LABELS[level].icon}
              {ZOOM_LABELS[level].label}
            </button>
          ))}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-card/5 transition-colors ml-1"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 mx-4 rounded-full bg-card/5 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary/60 to-emerald-500/60"
          initial={{ width: "0%" }}
          animate={{
            width: `${(completedCount / Math.max(nodes.length, 1)) * 100}%`,
          }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            {/* D3 Canvas */}
            <div className="px-4 pt-3">
              <D3IslandCanvas
                nodes={nodes}
                zoomLevel={zoomLevel}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
              />
            </div>

            {/* Selected Node Detail Panel */}
            <AnimatePresence>
              {selectedNodeData && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mx-4 mt-3 rounded-lg overflow-hidden"
                  style={{
                    background: `${glowForStatus(selectedNodeData.status)}`,
                    border: `1px solid ${colorForStatus(selectedNodeData.status)}30`,
                  }}
                >
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const Icon =
                            NODE_ICONS[selectedNodeData.id] || CheckCircle2;
                          return (
                            <span
                              style={{
                                color: colorForStatus(selectedNodeData.status),
                              }}
                            >
                              <Icon className="w-4 h-4" />
                            </span>
                          );
                        })()}
                        <span className="text-sm font-medium text-foreground">
                          {selectedNodeData.label}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            background: `${colorForStatus(selectedNodeData.status)}20`,
                            color: colorForStatus(selectedNodeData.status),
                          }}
                        >
                          {selectedNodeData.status === "completed"
                            ? "完成"
                            : selectedNodeData.status === "processing"
                              ? "處理中"
                              : selectedNodeData.status === "error"
                                ? "錯誤"
                                : "等待中"}
                        </span>
                      </div>
                      {selectedNodeData.timestamp > 0 && (
                        <span className="text-[10px] text-muted-foreground/50">
                          {formatDuration(
                            durationsRef.current.get(selectedNodeData.id) ?? 0
                          )}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-foreground/70 leading-relaxed">
                      {selectedNodeData.detail}
                    </p>

                    {/* Reasoning (Detail/JSON level) */}
                    {zoomLevel !== "overview" && selectedNodeData.reasoning && (
                      <div
                        className="p-2 rounded-md"
                        style={{ background: "rgba(0,0,0,0.15)" }}
                      >
                        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1">
                          推理過程
                        </p>
                        <p className="text-xs text-foreground/60 leading-relaxed">
                          {selectedNodeData.reasoning}
                        </p>
                      </div>
                    )}

                    {/* JSON Deep Dive */}
                    {zoomLevel === "json" && (
                      <div
                        className="p-2 rounded-md font-mono text-[10px] leading-relaxed overflow-x-auto"
                        style={{
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <pre className="text-emerald-400/80 whitespace-pre-wrap">
                          {JSON.stringify(selectedNodeData, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Pin to Notes + Intervention buttons */}
                    <div className="flex gap-1.5 pt-1 flex-wrap">
                      {onPinToNotes && (
                        <button
                          onClick={() => onPinToNotes(selectedNodeData)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                        >
                          <StickyNote className="w-3 h-3" />
                          釘選至筆記
                        </button>
                      )}
                    </div>
                    {onIntervene && selectedNodeData.status !== "queued" && (
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => handleIntervene("trim")}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <Scissors className="w-3 h-3" />
                          修剪
                        </button>
                        <button
                          onClick={() => handleIntervene("expand")}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                        >
                          <Maximize2 className="w-3 h-3" />
                          擴充
                        </button>
                        <button
                          onClick={() => handleIntervene("redirect")}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" />
                          重新引導
                        </button>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Node chips (compact overview) */}
            <div className="px-4 py-3 flex flex-wrap gap-1.5">
              {nodes.map((node, i) => {
                const Icon = NODE_ICONS[node.id] || CheckCircle2;
                const isSelected = selectedNode === node.id;
                return (
                  <motion.button
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => setSelectedNode(isSelected ? null : node.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all",
                      isSelected && "ring-2 ring-primary/40"
                    )}
                    style={{
                      backgroundColor: `${colorForStatus(node.status)}${isSelected ? "25" : "10"}`,
                      border: `1px solid ${colorForStatus(node.status)}${isSelected ? "60" : "30"}`,
                    }}
                  >
                    <span style={{ color: colorForStatus(node.status) }}>
                      <Icon className="w-3 h-3" />
                    </span>
                    <span className="text-foreground/70">{node.label}</span>
                    {node.timestamp > 0 && (
                      <span className="text-[9px] text-muted-foreground/50 ml-0.5">
                        {formatDuration(durationsRef.current.get(node.id) ?? 0)}
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

ThoughtIslandChain.displayName = "ThoughtIslandChain";

export default ThoughtIslandChain;
