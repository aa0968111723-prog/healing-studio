/**
 * OrbWorkflowTemplates.tsx - Browse, create, and execute workflow templates
 *
 * Allows users to:
 * - Browse popular and personal workflow templates
 * - Execute multi-step workflows with one click
 * - Create custom workflows from scratch or learn from history
 * - Rate and favorite templates
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play,
  Star,
  TrendingUp,
  Clock,
  Users,
  Sparkles,
  Plus,
  BookOpen,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface WorkflowTemplate {
  id: string;
  templateId: string;
  templateName: string;
  description: string;
  category: string;
  totalSteps: number;
  estimatedDuration: number; // in seconds
  usageCount: number;
  successRate: number;
  avgRating: number;
  spiritsInvolved: string[];
  isPublic: boolean;
  isFeatured: boolean;
  createdBy?: string;
  tags?: string[];
}

interface OrbWorkflowTemplatesProps {
  onExecute: (templateId: string) => void;
  onCreateNew: () => void;
  onViewDetails: (templateId: string) => void;
}

export default function OrbWorkflowTemplates({
  onExecute,
  onCreateNew,
  onViewDetails,
}: OrbWorkflowTemplatesProps) {
  // Mock data - replace with actual tRPC queries
  const [featuredTemplates] = useState<WorkflowTemplate[]>([
    {
      id: "1",
      templateId: "video-creation-workflow",
      templateName: "完整影片創作流程",
      description: "從腳本規劃到最終渲染的完整影片製作流程",
      category: "video_creation",
      totalSteps: 5,
      estimatedDuration: 300,
      usageCount: 156,
      successRate: 0.92,
      avgRating: 4.7,
      spiritsInvolved: ["director", "video-specialist", "image-specialist"],
      isPublic: true,
      isFeatured: true,
      tags: ["影片", "創作", "腳本"],
    },
    {
      id: "2",
      templateId: "social-media-pack",
      templateName: "社群媒體素材包",
      description: "批量生成多種規格的社群媒體圖像",
      category: "content_marketing",
      totalSteps: 3,
      estimatedDuration: 120,
      usageCount: 234,
      successRate: 0.95,
      avgRating: 4.9,
      spiritsInvolved: ["image-specialist", "style-advisor"],
      isPublic: true,
      isFeatured: true,
      tags: ["社群", "圖像", "批量"],
    },
  ]);

  const [personalTemplates] = useState<WorkflowTemplate[]>([
    {
      id: "3",
      templateId: "my-daily-recap",
      templateName: "每日總結報告",
      description: "自動彙整今日創作和使用統計",
      category: "analytics",
      totalSteps: 2,
      estimatedDuration: 30,
      usageCount: 12,
      successRate: 1.0,
      avgRating: 5.0,
      spiritsInvolved: ["analyzer", "reporter"],
      isPublic: false,
      isFeatured: false,
      createdBy: "me",
      tags: ["報告", "統計"],
    },
  ]);

  const [popularTemplates] = useState<WorkflowTemplate[]>([
    {
      id: "4",
      templateId: "lora-training-flow",
      templateName: "LoRA 模型訓練流程",
      description: "完整的 LoRA 模型訓練和測試流程",
      category: "model_training",
      totalSteps: 6,
      estimatedDuration: 600,
      usageCount: 89,
      successRate: 0.88,
      avgRating: 4.5,
      spiritsInvolved: ["trainer", "tester", "model-specialist"],
      isPublic: true,
      isFeatured: false,
      tags: ["訓練", "模型", "LoRA"],
    },
  ]);

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return `約 ${minutes} 分鐘`;
  };

  const renderTemplateCard = (template: WorkflowTemplate) => {
    return (
      <Card key={template.id} className="group hover:shadow-md transition-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                {template.templateName}
                {template.isFeatured && (
                  <Badge variant="default" className="bg-yellow-500 text-xs">
                    <Star className="w-3 h-3 mr-1" />
                    精選
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1 line-clamp-2">
                {template.description}
              </CardDescription>
            </div>
          </div>

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {template.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Zap className="w-3 h-3" />
              {template.totalSteps} 個步驟
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" />
              {formatDuration(template.estimatedDuration)}
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <TrendingUp className="w-3 h-3" />
              {template.usageCount} 次使用
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Star className="w-3 h-3" />
              {template.avgRating.toFixed(1)} 分
            </div>
          </div>

          {/* Success rate */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${template.successRate * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {Math.round(template.successRate * 100)}% 成功
            </span>
          </div>

          {/* Spirits involved */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="w-3 h-3" />
            <span>{template.spiritsInvolved.length} 個精靈協作</span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => onExecute(template.templateId)}
              className="flex-1"
            >
              <Play className="w-3 h-3 mr-1" />
              執行
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onViewDetails(template.templateId)}
            >
              <BookOpen className="w-3 h-3 mr-1" />
              詳情
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-500" />
            工作流程模板
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            一鍵執行複雜的多步驟任務
          </p>
        </div>
        <Button onClick={onCreateNew} variant="outline">
          <Plus className="w-4 h-4 mr-1" />
          建立新模板
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="featured" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="featured" className="text-xs">
            <Star className="w-3 h-3 mr-1" />
            精選
          </TabsTrigger>
          <TabsTrigger value="popular" className="text-xs">
            <TrendingUp className="w-3 h-3 mr-1" />
            熱門
          </TabsTrigger>
          <TabsTrigger value="personal" className="text-xs">
            <Users className="w-3 h-3 mr-1" />
            我的
          </TabsTrigger>
        </TabsList>

        <TabsContent value="featured" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {featuredTemplates.map((template) => renderTemplateCard(template))}
          </div>
        </TabsContent>

        <TabsContent value="popular" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {popularTemplates.map((template) => renderTemplateCard(template))}
          </div>
        </TabsContent>

        <TabsContent value="personal" className="mt-4">
          {personalTemplates.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {personalTemplates.map((template) => renderTemplateCard(template))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">
                  您還沒有建立任何工作流程模板
                </p>
                <Button onClick={onCreateNew} variant="outline">
                  <Plus className="w-4 h-4 mr-1" />
                  建立第一個模板
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
