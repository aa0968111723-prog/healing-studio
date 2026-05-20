/**
 * StoryboardTimelineUploader — 時間軸圖幀上傳組件
 *
 * 功能：
 * 1. 圖幀上傳至時間軸特定位置
 * 2. 顯示時間軸上的所有已上傳圖幀
 * 3. 與腳本分鏡同步
 * 4. 觸發一致性檢查
 */

import { useState, useCallback } from "react";
import { Upload, Clock, Image as ImageIcon, Check, AlertCircle, Trash2 } from "lucide-react";
import type { TimelineFrame, TimelineFrameInput } from "../../../../shared/worldbuilding-timeline";
import type { WorldStoryboard, StoryboardScene } from "../../../../shared/worldbuilding-animation";
import { Button } from "../ui/button";
import { trpc } from "../../lib/trpc";
import { formatTimecode } from "../../../../shared/worldbuilding-animation";

interface StoryboardTimelineUploaderProps {
  storyboard: WorldStoryboard;
  className?: string;
  onFrameUploaded?: (frame: TimelineFrame) => void;
  onFrameDeleted?: (frameId: number) => void;
}

export function StoryboardTimelineUploader({
  storyboard,
  className = "",
  onFrameUploaded,
  onFrameDeleted,
}: StoryboardTimelineUploaderProps) {
  const [selectedScene, setSelectedScene] = useState<StoryboardScene | null>(
    storyboard.scenes[0] || null
  );
  const [timeOffset, setTimeOffset] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Query timeline frames for this storyboard
  const { data: timelineFrames, refetch: refetchFrames } = trpc.worldbuilding.listTimelineFrames.useQuery(
    { storyboardId: storyboard.id ?? 0 },
    { enabled: !!storyboard.id }
  );

  // Upload mutation
  const uploadFrameMutation = trpc.worldbuilding.uploadTimelineFrame.useMutation({
    onSuccess: (frame) => {
      setUploadProgress(null);
      setUploadError(null);
      refetchFrames();
      onFrameUploaded?.(frame);
    },
    onError: (error) => {
      setUploadProgress(null);
      setUploadError(error.message);
    },
  });

  // Delete mutation
  const deleteFrameMutation = trpc.worldbuilding.deleteTimelineFrame.useMutation({
    onSuccess: (frameId) => {
      refetchFrames();
      onFrameDeleted?.(frameId);
    },
  });

  // Handle file upload
  const handleFileUpload = useCallback(async (file: File) => {
    if (!selectedScene || !storyboard.id) {
      setUploadError("請選擇場景");
      return;
    }

    setUploadProgress(0);
    setUploadError(null);

    try {
      // Upload to storage (假設有一個上傳 API)
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", "timeline-frame");

      // 模擬上傳進度
      setUploadProgress(30);

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error("上傳失敗");
      }

      const { url } = await uploadResponse.json();
      setUploadProgress(70);

      // Create timeline frame record
      const frameInput: TimelineFrameInput = {
        storyboardId: storyboard.id,
        sceneId: selectedScene.id,
        timeOffsetSec: selectedScene.startSec + timeOffset,
        imageUrl: url,
        frameType: "keyframe",
        title: `${selectedScene.title || "場景"} - ${formatTimecode(timeOffset)}`,
      };

      setUploadProgress(90);
      uploadFrameMutation.mutate(frameInput);
    } catch (error) {
      setUploadProgress(null);
      setUploadError(error instanceof Error ? error.message : "上傳失敗");
    }
  }, [selectedScene, storyboard.id, timeOffset, uploadFrameMutation]);

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith("image/"));

    if (imageFile) {
      handleFileUpload(imageFile);
    }
  }, [handleFileUpload]);

  // Get frames for selected scene
  const sceneFrames = timelineFrames?.filter(
    f => f.sceneId === selectedScene?.id
  ) || [];

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="w-5 h-5" />
          時間軸圖幀上傳
        </h3>
        <div className="text-sm text-muted-foreground">
          總時長：{formatTimecode(storyboard.totalDurationSec)}
        </div>
      </div>

      {/* Scene Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">選擇場景</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {storyboard.scenes.map((scene) => (
            <button
              key={scene.id}
              onClick={() => {
                setSelectedScene(scene);
                setTimeOffset(0);
              }}
              className={`p-3 rounded-lg border text-left transition-colors ${
                selectedScene?.id === scene.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="text-sm font-medium truncate">{scene.title}</div>
              <div className="text-xs text-muted-foreground">
                {formatTimecode(scene.startSec)} - {formatTimecode(scene.endSec)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedScene && (
        <>
          {/* Time Offset Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              場景內時間點（相對於場景開始）
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={0}
                max={selectedScene.endSec - selectedScene.startSec}
                step={0.1}
                value={timeOffset}
                onChange={(e) => setTimeOffset(parseFloat(e.target.value))}
                className="flex-1"
              />
              <div className="text-sm font-mono bg-muted px-3 py-1 rounded">
                {formatTimecode(timeOffset)}
              </div>
            </div>
          </div>

          {/* Upload Area */}
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors"
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              拖曳圖片至此或點擊上傳
            </p>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
              className="hidden"
              id="frame-upload"
            />
            <label htmlFor="frame-upload">
              <Button variant="outline" asChild>
                <span>選擇檔案</span>
              </Button>
            </label>

            {uploadProgress !== null && (
              <div className="mt-4">
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  上傳中... {uploadProgress}%
                </p>
              </div>
            )}

            {uploadError && (
              <div className="mt-4 flex items-center justify-center gap-2 text-destructive text-sm">
                <AlertCircle className="w-4 h-4" />
                {uploadError}
              </div>
            )}
          </div>

          {/* Uploaded Frames for Selected Scene */}
          {sceneFrames.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">已上傳圖幀 ({sceneFrames.length})</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {sceneFrames.map((frame) => (
                  <div
                    key={frame.id}
                    className="relative group rounded-lg border border-border overflow-hidden bg-card"
                  >
                    <div className="aspect-video relative">
                      <img
                        src={frame.imageUrl}
                        alt={frame.title || "Timeline frame"}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            if (frame.id && confirm("確定刪除此圖幀？")) {
                              deleteFrameMutation.mutate(frame.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-medium truncate">
                        {frame.title}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {formatTimecode(frame.timeOffsetSec - selectedScene.startSec)}
                      </div>
                      {frame.consistencyCheck && (
                        <div className="flex items-center gap-1 mt-1">
                          {frame.consistencyCheck.overallScore >= 80 ? (
                            <Check className="w-3 h-3 text-green-500" />
                          ) : (
                            <AlertCircle className="w-3 h-3 text-yellow-500" />
                          )}
                          <span className="text-xs">
                            {frame.consistencyCheck.overallScore}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
