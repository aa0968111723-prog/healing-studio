/**
 * OrbFeatureSearch.tsx - Smart feature discovery and recommendation interface
 *
 * Helps users discover features through natural language search and personalized
 * recommendations based on usage patterns and context.
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  TrendingUp,
  Star,
  Clock,
  ArrowRight,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FeatureRecommendation {
  featureId: string;
  featureName: string;
  description: string;
  targetPage: string;
  category: string;
  relevanceScore: number;
  usageCount?: number;
  lastUsed?: number;
  successRate?: number;
  quickAction?: {
    label: string;
    action: "navigate" | "execute" | "guide";
    params: any;
  };
  tags?: string[];
}

interface OrbFeatureSearchProps {
  onNavigate: (path: string) => void;
  onExecuteAction: (action: any) => void;
  currentPage?: string;
}

export default function OrbFeatureSearch({
  onNavigate,
  onExecuteAction,
  currentPage,
}: OrbFeatureSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FeatureRecommendation[]>([]);
  const [recommendations, setRecommendations] = useState<FeatureRecommendation[]>([]);
  const [frequentFeatures, setFrequentFeatures] = useState<FeatureRecommendation[]>([]);
  const [recentFeatures, setRecentFeatures] = useState<FeatureRecommendation[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Simulated search (replace with actual tRPC call)
  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    // TODO: Replace with actual tRPC mutation
    // const results = await trpc.orb.searchFeatures.mutate({ query: searchQuery, context: { currentPage } });

    // Simulated delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Mock results
    setSearchResults([
      {
        featureId: "image-generation",
        featureName: "圖像生成",
        description: "使用 AI 模型生成創意圖像",
        targetPage: "/studio",
        category: "creation",
        relevanceScore: 0.95,
        tags: ["AI", "創作", "圖像"],
        quickAction: {
          label: "開始生成",
          action: "navigate",
          params: { page: "/studio" },
        },
      },
    ]);
    setIsSearching(false);
  };

  // Load recommendations on mount
  useEffect(() => {
    // TODO: Replace with actual tRPC query
    // const data = await trpc.orb.getRecommendations.query({ context: { currentPage } });

    // Mock data
    setRecommendations([
      {
        featureId: "video-editing",
        featureName: "影片編輯",
        description: "專業的影片剪輯和特效處理",
        targetPage: "/video-studio",
        category: "creation",
        relevanceScore: 0.88,
        tags: ["影片", "編輯"],
      },
    ]);

    setFrequentFeatures([
      {
        featureId: "prompt-library",
        featureName: "提示詞庫",
        description: "瀏覽和收藏優質提示詞",
        targetPage: "/assets",
        category: "management",
        relevanceScore: 0.92,
        usageCount: 45,
        tags: ["提示詞", "資產"],
      },
    ]);

    setRecentFeatures([
      {
        featureId: "model-training",
        featureName: "模型訓練",
        description: "訓練專屬的 AI 模型",
        targetPage: "/models",
        category: "advanced",
        relevanceScore: 0.85,
        lastUsed: Date.now() - 3600000,
        tags: ["模型", "訓練"],
      },
    ]);
  }, [currentPage]);

  const renderFeatureCard = (feature: FeatureRecommendation, showScore = false) => {
    const handleAction = () => {
      if (feature.quickAction) {
        if (feature.quickAction.action === "navigate") {
          onNavigate(feature.targetPage);
        } else {
          onExecuteAction(feature.quickAction);
        }
      } else {
        onNavigate(feature.targetPage);
      }
    };

    return (
      <Card
        key={feature.featureId}
        className="group hover:shadow-md transition-shadow cursor-pointer"
        onClick={handleAction}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm truncate">{feature.featureName}</h3>
                {showScore && (
                  <Badge variant="secondary" className="text-xs">
                    {Math.round(feature.relevanceScore * 100)}% 符合
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                {feature.description}
              </p>

              {/* Tags */}
              {feature.tags && feature.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {feature.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {feature.usageCount !== undefined && (
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    使用 {feature.usageCount} 次
                  </span>
                )}
                {feature.successRate !== undefined && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    {Math.round(feature.successRate * 100)}% 成功率
                  </span>
                )}
                {feature.lastUsed && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    最近使用
                  </span>
                )}
              </div>
            </div>

            {/* Action button */}
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {feature.quickAction?.label || "前往"}
              <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="搜尋功能... (例如: 如何生成影片？)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          className="pl-9 pr-4"
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <Sparkles className="w-4 h-4 text-emerald-500 animate-pulse" />
          </div>
        )}
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-500" />
              搜尋結果
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {searchResults.map((feature) => renderFeatureCard(feature, true))}
          </CardContent>
        </Card>
      )}

      {/* Tabs for different recommendation types */}
      {searchResults.length === 0 && (
        <Tabs defaultValue="recommended" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="recommended" className="text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              推薦
            </TabsTrigger>
            <TabsTrigger value="frequent" className="text-xs">
              <Zap className="w-3 h-3 mr-1" />
              常用
            </TabsTrigger>
            <TabsTrigger value="recent" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              最近
            </TabsTrigger>
          </TabsList>

          <TabsContent value="recommended" className="space-y-2 mt-4">
            {recommendations.length > 0 ? (
              recommendations.map((feature) => renderFeatureCard(feature))
            ) : (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  開始使用功能後，我們將為您提供個性化推薦
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="frequent" className="space-y-2 mt-4">
            {frequentFeatures.length > 0 ? (
              frequentFeatures.map((feature) => renderFeatureCard(feature))
            ) : (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  尚無常用功能記錄
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="recent" className="space-y-2 mt-4">
            {recentFeatures.length > 0 ? (
              recentFeatures.map((feature) => renderFeatureCard(feature))
            ) : (
              <Card>
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  尚無最近使用記錄
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
