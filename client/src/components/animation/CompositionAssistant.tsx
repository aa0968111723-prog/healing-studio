/**
 * CompositionAssistant — 多角色多場景構圖助手
 *
 * 功能：
 * 1. 拖放式 Canvas 畫布
 * 2. 角色、物件的拖放定位
 * 3. AI 構圖建議
 * 4. 圖層管理
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Layers,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  MoveUp,
  MoveDown,
  Sparkles,
  Save,
  RotateCw,
} from "lucide-react";
import type {
  SceneComposition,
  CompositionElement,
  CompositionSuggestion,
} from "../../../../shared/worldbuilding-timeline";
import type { WorldbuildingFrameworkData, WorldCharacter, WorldObject } from "../../../../shared/worldbuilding-types";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface CompositionAssistantProps {
  framework: WorldbuildingFrameworkData;
  storyboardId?: number;
  initialComposition?: SceneComposition;
  className?: string;
  onSave?: (composition: SceneComposition) => void;
}

export function CompositionAssistant({
  framework,
  storyboardId,
  initialComposition,
  className = "",
  onSave,
}: CompositionAssistantProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [canvasSize, setCanvasSize] = useState({ width: 1920, height: 1080 });
  const [elements, setElements] = useState<CompositionElement[]>(
    initialComposition?.elements || []
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [backgroundSceneId, setBackgroundSceneId] = useState<string | undefined>(
    initialComposition?.backgroundSceneId
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | undefined>(
    initialComposition?.backgroundImageUrl
  );
  const [aiSuggestions, setAiSuggestions] = useState<CompositionSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // Save composition mutation
  const saveCompositionMutation = trpc.worldbuilding.saveComposition.useMutation({
    onSuccess: (saved) => {
      alert("構圖已儲存");
      onSave?.(saved);
    },
    onError: (error) => {
      alert(`儲存失敗：${error.message}`);
    },
  });

  // Get AI suggestions mutation
  const getSuggestionsMutation = trpc.worldbuilding.getCompositionSuggestions.useMutation({
    onSuccess: (suggestions) => {
      setAiSuggestions(suggestions);
      setIsLoadingSuggestions(false);
    },
    onError: () => {
      setIsLoadingSuggestions(false);
    },
  });

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Draw background
    if (backgroundImageUrl) {
      const img = new Image();
      img.src = backgroundImageUrl;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
        renderElements(ctx);
      };
    } else {
      // Draw grid background
      ctx.fillStyle = "#f5f5f5";
      ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvasSize.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasSize.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvasSize.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasSize.width, y);
        ctx.stroke();
      }

      renderElements(ctx);
    }
  }, [canvasSize, backgroundImageUrl, elements, selectedElementId]);

  const renderElements = (ctx: CanvasRenderingContext2D) => {
    // Sort by zIndex
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

    sorted.forEach((element) => {
      ctx.save();

      // Apply opacity
      if (element.opacity !== undefined) {
        ctx.globalAlpha = element.opacity;
      }

      // Apply rotation
      if (element.rotation) {
        const centerX = element.position.x + element.size.width / 2;
        const centerY = element.position.y + element.size.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((element.rotation * Math.PI) / 180);
        ctx.translate(-centerX, -centerY);
      }

      // Draw element
      if (element.imageUrl) {
        const img = new Image();
        img.src = element.imageUrl;
        img.onload = () => {
          ctx.drawImage(
            img,
            element.position.x,
            element.position.y,
            element.size.width,
            element.size.height
          );
        };
      } else {
        // Draw placeholder
        ctx.fillStyle = element.type === "character" ? "#93c5fd" : "#d1d5db";
        ctx.fillRect(
          element.position.x,
          element.position.y,
          element.size.width,
          element.size.height
        );
        ctx.fillStyle = "#000";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          element.type,
          element.position.x + element.size.width / 2,
          element.position.y + element.size.height / 2
        );
      }

      // Draw selection border
      if (element.id === selectedElementId) {
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          element.position.x,
          element.position.y,
          element.size.width,
          element.size.height
        );
        ctx.setLineDash([]);
      }

      ctx.restore();
    });
  };

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasSize.width / rect.width;
    const scaleY = canvasSize.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Find clicked element (reverse order to check top elements first)
    const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);
    const clicked = sorted.find(
      (el) =>
        x >= el.position.x &&
        x <= el.position.x + el.size.width &&
        y >= el.position.y &&
        y <= el.position.y + el.size.height
    );

    if (clicked) {
      setSelectedElementId(clicked.id);
      setDragOffset({
        x: x - clicked.position.x,
        y: y - clicked.position.y,
      });
    } else {
      setSelectedElementId(null);
    }
  }, [canvasSize, elements]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedElementId) {
      setIsDragging(true);
    }
  }, [selectedElementId]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !selectedElementId) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasSize.width / rect.width;
    const scaleY = canvasSize.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setElements((prev) =>
      prev.map((el) =>
        el.id === selectedElementId
          ? {
              ...el,
              position: {
                x: Math.max(0, Math.min(canvasSize.width - el.size.width, x - dragOffset.x)),
                y: Math.max(0, Math.min(canvasSize.height - el.size.height, y - dragOffset.y)),
              },
            }
          : el
      )
    );
  }, [isDragging, selectedElementId, canvasSize, dragOffset]);

  const handleCanvasMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const addElement = (type: CompositionElement["type"], characterId?: string, objectId?: string) => {
    const newElement: CompositionElement = {
      id: `el-${Date.now()}`,
      type,
      characterId,
      objectId,
      position: { x: canvasSize.width / 2 - 100, y: canvasSize.height / 2 - 100 },
      size: { width: 200, height: 300 },
      zIndex: elements.length,
    };
    setElements([...elements, newElement]);
    setSelectedElementId(newElement.id);
  };

  const deleteElement = (id: string) => {
    setElements(elements.filter((el) => el.id !== id));
    if (selectedElementId === id) {
      setSelectedElementId(null);
    }
  };

  const moveElementUp = (id: string) => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id);
      if (idx < prev.length - 1) {
        const newArr = [...prev];
        [newArr[idx].zIndex, newArr[idx + 1].zIndex] = [newArr[idx + 1].zIndex, newArr[idx].zIndex];
        return newArr;
      }
      return prev;
    });
  };

  const moveElementDown = (id: string) => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id);
      if (idx > 0) {
        const newArr = [...prev];
        [newArr[idx].zIndex, newArr[idx - 1].zIndex] = [newArr[idx - 1].zIndex, newArr[idx].zIndex];
        return newArr;
      }
      return prev;
    });
  };

  const handleGetSuggestions = () => {
    setIsLoadingSuggestions(true);
    getSuggestionsMutation.mutate({
      worldId: framework.id ?? 0,
      elements,
      backgroundSceneId,
    });
  };

  const handleSave = () => {
    if (!framework.id) return;

    saveCompositionMutation.mutate({
      worldId: framework.id,
      storyboardId,
      name: `構圖 ${new Date().toLocaleString("zh-TW")}`,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      backgroundSceneId,
      backgroundImageUrl,
      elements,
    });
  };

  const selectedElement = elements.find((el) => el.id === selectedElementId);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Layers className="w-5 h-5" />
          構圖助手
        </h3>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleGetSuggestions}
            disabled={isLoadingSuggestions || elements.length === 0}
            size="sm"
            variant="outline"
          >
            <Sparkles className={`w-4 h-4 mr-2 ${isLoadingSuggestions ? "animate-pulse" : ""}`} />
            {isLoadingSuggestions ? "分析中..." : "AI 建議"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveCompositionMutation.isPending || elements.length === 0}
            size="sm"
          >
            <Save className="w-4 h-4 mr-2" />
            儲存
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left Panel - Assets */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 bg-card">
            <h4 className="text-sm font-semibold mb-3">角色</h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {framework.characters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => addElement("character", char.id)}
                  className="w-full p-2 text-left text-sm border border-border rounded hover:bg-accent transition-colors"
                >
                  {char.name}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border p-4 bg-card">
            <h4 className="text-sm font-semibold mb-3">物件</h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {framework.objects?.map((obj) => (
                <button
                  key={obj.id}
                  onClick={() => addElement("object", undefined, obj.id)}
                  className="w-full p-2 text-left text-sm border border-border rounded hover:bg-accent transition-colors"
                >
                  {obj.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center - Canvas */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center gap-2">
            <select
              aria-label="畫布尺寸"
              value={`${canvasSize.width}x${canvasSize.height}`}
              onChange={(e) => {
                const [w, h] = e.target.value.split("x").map(Number);
                setCanvasSize({ width: w, height: h });
              }}
              className="text-sm border border-border rounded px-2 py-1"
            >
              <option value="1920x1080">1920×1080 (16:9)</option>
              <option value="1080x1920">1080×1920 (9:16)</option>
              <option value="1080x1080">1080×1080 (1:1)</option>
              <option value="2560x1080">2560×1080 (21:9)</option>
            </select>
          </div>

          <div
            ref={containerRef}
            className="rounded-lg border-2 border-border overflow-hidden bg-muted"
          >
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              onClick={handleCanvasClick}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              className="w-full h-auto cursor-crosshair"
              style={{ maxHeight: "600px" }}
            />
          </div>

          {selectedElement && (
            <div className="rounded-lg border border-border p-3 bg-card">
              <div className="text-sm font-medium mb-2">屬性編輯</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label htmlFor="comp-elem-x" className="text-muted-foreground">X</label>
                  <input
                    id="comp-elem-x"
                    type="number"
                    value={Math.round(selectedElement.position.x)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setElements((prev) =>
                        prev.map((el) =>
                          el.id === selectedElementId
                            ? { ...el, position: { ...el.position, x: val } }
                            : el
                        )
                      );
                    }}
                    className="w-full border border-border rounded px-2 py-1 mt-1"
                  />
                </div>
                <div>
                  <label htmlFor="comp-elem-y" className="text-muted-foreground">Y</label>
                  <input
                    id="comp-elem-y"
                    type="number"
                    value={Math.round(selectedElement.position.y)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setElements((prev) =>
                        prev.map((el) =>
                          el.id === selectedElementId
                            ? { ...el, position: { ...el.position, y: val } }
                            : el
                        )
                      );
                    }}
                    className="w-full border border-border rounded px-2 py-1 mt-1"
                  />
                </div>
                <div>
                  <label htmlFor="comp-elem-w" className="text-muted-foreground">寬度</label>
                  <input
                    id="comp-elem-w"
                    type="number"
                    value={Math.round(selectedElement.size.width)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setElements((prev) =>
                        prev.map((el) =>
                          el.id === selectedElementId
                            ? { ...el, size: { ...el.size, width: val } }
                            : el
                        )
                      );
                    }}
                    className="w-full border border-border rounded px-2 py-1 mt-1"
                  />
                </div>
                <div>
                  <label htmlFor="comp-elem-h" className="text-muted-foreground">高度</label>
                  <input
                    id="comp-elem-h"
                    type="number"
                    value={Math.round(selectedElement.size.height)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      setElements((prev) =>
                        prev.map((el) =>
                          el.id === selectedElementId
                            ? { ...el, size: { ...el.size, height: val } }
                            : el
                        )
                      );
                    }}
                    className="w-full border border-border rounded px-2 py-1 mt-1"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Layers & Suggestions */}
        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4 bg-card">
            <h4 className="text-sm font-semibold mb-3">圖層 ({elements.length})</h4>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {[...elements]
                .sort((a, b) => b.zIndex - a.zIndex)
                .map((el) => {
                  const char = el.characterId
                    ? framework.characters.find((c) => c.id === el.characterId)
                    : null;
                  const obj = el.objectId
                    ? framework.objects?.find((o) => o.id === el.objectId)
                    : null;
                  const label = char?.name || obj?.name || el.type;

                  return (
                    <div
                      key={el.id}
                      className={`flex items-center gap-2 p-2 rounded text-xs border ${
                        el.id === selectedElementId
                          ? "border-primary bg-primary/10"
                          : "border-border"
                      }`}
                    >
                      <button
                        onClick={() => setSelectedElementId(el.id)}
                        className="flex-1 text-left truncate"
                      >
                        {label}
                      </button>
                      <button
                        onClick={() => moveElementUp(el.id)}
                        className="p-1 hover:bg-accent rounded"
                      >
                        <MoveUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveElementDown(el.id)}
                        className="p-1 hover:bg-accent rounded"
                      >
                        <MoveDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => deleteElement(el.id)}
                        className="p-1 hover:bg-destructive hover:text-destructive-foreground rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {aiSuggestions.length > 0 && (
            <div className="rounded-lg border border-border p-4 bg-card">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI 建議
              </h4>
              <div className="space-y-2">
                {aiSuggestions.map((suggestion, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded border border-border bg-muted text-xs"
                  >
                    <div className="font-medium mb-1">{suggestion.title}</div>
                    <div className="text-muted-foreground">{suggestion.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
