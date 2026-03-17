import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, CheckCircle2, Clock, Zap, Shield, Sparkles, Database, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ThoughtNode = {
  id: string;
  label: string;
  status: "passed" | "completed" | "queued" | "processing" | "failed";
  detail: string;
  timestamp: number;
};

type Props = {
  nodes: ThoughtNode[];
  isVisible?: boolean;
};

// ─── Icon Map ───────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, typeof Brain> = {
  safety: Shield,
  compile: Sparkles,
  weight: Zap,
  generate: Brain,
  quota: Database,
  history: Clock,
};

const STATUS_COLORS: Record<string, string> = {
  passed: "#4ade80",
  completed: "#60a5fa",
  queued: "#fbbf24",
  processing: "#a78bfa",
  failed: "#f87171",
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ThoughtIslandChain({ nodes, isVisible = true }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const hasProcessing = nodes.some(n => n.status === "processing");

  // Auto-expand when generation is in progress
  useEffect(() => {
    if (hasProcessing) setExpanded(true);
  }, [hasProcessing]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 120 });

  // Responsive sizing
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setDimensions({ width: Math.max(400, w), height: 120 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !nodes.length || !expanded) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;
    const padding = 50;
    const nodeRadius = 18;
    const usableWidth = width - padding * 2;
    const nodeSpacing = usableWidth / Math.max(nodes.length - 1, 1);
    const cy = height / 2;

    // Draw connecting lines (animated path)
    const lineGroup = svg.append("g").attr("class", "connections");

    for (let i = 0; i < nodes.length - 1; i++) {
      const x1 = padding + i * nodeSpacing;
      const x2 = padding + (i + 1) * nodeSpacing;

      // Curved connection line
      const midX = (x1 + x2) / 2;
      const curveOffset = -8;

      lineGroup
        .append("path")
        .attr("d", `M ${x1 + nodeRadius} ${cy} Q ${midX} ${cy + curveOffset} ${x2 - nodeRadius} ${cy}`)
        .attr("fill", "none")
        .attr("stroke", STATUS_COLORS[nodes[i].status] || "#666")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "6 3")
        .attr("opacity", 0.5)
        .transition()
        .duration(300)
        .delay(i * 150)
        .attr("opacity", 0.8)
        .attr("stroke-dasharray", "0 0");
    }

    // Draw nodes
    const nodeGroup = svg.append("g").attr("class", "nodes");

    nodes.forEach((node, i) => {
      const cx = padding + i * nodeSpacing;
      const g = nodeGroup.append("g").attr("transform", `translate(${cx}, ${cy})`);

      // Glow effect
      const defs = svg.append("defs");
      const filter = defs.append("filter").attr("id", `glow-${node.id}`);
      filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
      const feMerge = filter.append("feMerge");
      feMerge.append("feMergeNode").attr("in", "coloredBlur");
      feMerge.append("feMergeNode").attr("in", "SourceGraphic");

      // Outer ring (pulse animation for processing)
      g.append("circle")
        .attr("r", nodeRadius + 4)
        .attr("fill", "none")
        .attr("stroke", STATUS_COLORS[node.status] || "#666")
        .attr("stroke-width", 1.5)
        .attr("opacity", 0)
        .transition()
        .duration(400)
        .delay(i * 150)
        .attr("opacity", node.status === "processing" ? 0.6 : 0.3);

      // Main circle
      g.append("circle")
        .attr("r", 0)
        .attr("fill", `${STATUS_COLORS[node.status]}20`)
        .attr("stroke", STATUS_COLORS[node.status] || "#666")
        .attr("stroke-width", 2)
        .attr("filter", `url(#glow-${node.id})`)
        .attr("cursor", "pointer")
        .on("mouseenter", () => setHoveredNode(node.id))
        .on("mouseleave", () => setHoveredNode(null))
        .transition()
        .duration(400)
        .delay(i * 150)
        .attr("r", nodeRadius);

      // Status icon (checkmark for completed/passed)
      if (node.status === "completed" || node.status === "passed") {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("fill", STATUS_COLORS[node.status])
          .attr("font-size", "14px")
          .attr("opacity", 0)
          .text("✓")
          .transition()
          .duration(300)
          .delay(i * 150 + 200)
          .attr("opacity", 1);
      } else if (node.status === "queued") {
        g.append("text")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("fill", STATUS_COLORS[node.status])
          .attr("font-size", "12px")
          .text("⏳");
      }

      // Label below
      g.append("text")
        .attr("y", nodeRadius + 16)
        .attr("text-anchor", "middle")
        .attr("fill", "currentColor")
        .attr("font-size", "11px")
        .attr("opacity", 0)
        .text(node.label)
        .transition()
        .duration(300)
        .delay(i * 150 + 100)
        .attr("opacity", 0.8);
    });
  }, [nodes, dimensions, expanded]);

  if (!isVisible || !nodes.length) return null;

  const hoveredData = nodes.find((n) => n.id === hoveredNode);

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`relative rounded-xl overflow-hidden transition-all duration-500 ${
        hasProcessing
          ? "border-2 border-primary/40 shadow-lg shadow-primary/10 bg-card/70"
          : "border border-border/50 bg-card/50"
      } backdrop-blur-sm`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-accent/30 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
          <Brain className="w-4 h-4 text-primary" />
          <span>AI 思維島鏈</span>
          <span className="text-xs text-muted-foreground ml-1">
            ({nodes.filter((n) => n.status === "completed" || n.status === "passed").length}/{nodes.length} 節點完成)
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* D3 SVG Canvas */}
            <svg
              ref={svgRef}
              width={dimensions.width}
              height={dimensions.height}
              className="text-foreground"
              style={{ display: "block" }}
            />

            {/* Hover tooltip */}
            <AnimatePresence>
              {hoveredData && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="mx-4 mb-3 p-3 rounded-lg bg-popover border border-border/50 text-sm"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {(() => {
                      const Icon = NODE_ICONS[hoveredData.id] || Brain;
                      return <Icon className="w-4 h-4" style={{ color: STATUS_COLORS[hoveredData.status] }} />;
                    })()}
                    <span className="font-medium text-foreground">{hoveredData.label}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${STATUS_COLORS[hoveredData.status]}20`,
                        color: STATUS_COLORS[hoveredData.status],
                      }}
                    >
                      {hoveredData.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{hoveredData.detail}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Node detail cards (compact) */}
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {nodes.map((node) => {
                const Icon = NODE_ICONS[node.id] || CheckCircle2;
                return (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: nodes.indexOf(node) * 0.1 }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs"
                    style={{
                      backgroundColor: `${STATUS_COLORS[node.status]}10`,
                      border: `1px solid ${STATUS_COLORS[node.status]}30`,
                    }}
                  >
                    <Icon className="w-3 h-3" style={{ color: STATUS_COLORS[node.status] }} />
                    <span className="text-foreground/70">{node.label}</span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
