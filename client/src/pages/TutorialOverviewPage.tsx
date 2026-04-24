import { useLocation } from "wouter";
import { BookOpen, Compass, Film, Image as ImageIcon, MicVocal, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteOnboarding, type PageId } from "@/contexts/SiteOnboardingContext";

const QUICK_LINKS = [
  {
    title: "學習文件中心",
    description: "先看文件與影片教學，建立全站觀念。",
    path: "/learn",
    icon: BookOpen,
  },
  {
    title: "導演 AI 教學",
    description: "把需求拆成圖像、影片、音訊三種任務流程。",
    path: "/director",
    icon: Compass,
  },
  {
    title: "圖片工作室教學",
    description: "快速完成第一版圖片產出與比較。",
    path: "/image-studio",
    icon: ImageIcon,
  },
  {
    title: "影片工作室教學",
    description: "建立分鏡與提示詞，產出第一版影片。",
    path: "/video-studio",
    icon: Film,
  },
  {
    title: "音樂配音工作室",
    description: "從情緒與用途出發，生成音樂或配音。",
    path: "/pro-studio",
    icon: MicVocal,
  },
];

const TOUR_TRACKS: Array<{
  id: PageId;
  label: string;
  path: string;
  note: string;
}> = [
  {
    id: "welcome",
    label: "全站新手導覽",
    path: "/",
    note: "先建立整體地圖，快速知道每個區塊用途。",
  },
  {
    id: "learn",
    label: "Learn 學習中心",
    path: "/learn",
    note: "看文件與教學影片，建立完整基礎。",
  },
  {
    id: "director",
    label: "Director AI",
    path: "/director",
    note: "從目標反推圖像、影片、音訊任務。",
  },
  {
    id: "image-studio",
    label: "Image Studio",
    path: "/image-studio",
    note: "先完成第一版圖片，再做比較迭代。",
  },
  {
    id: "video-studio",
    label: "Video Studio",
    path: "/video-studio",
    note: "從分鏡到輸出，跑完一輪短影片流程。",
  },
];

export default function TutorialOverviewPage() {
  const [, navigate] = useLocation();
  const { startTour } = useSiteOnboarding();

  return (
    <div className="w-full p-2.5 sm:p-6 lg:p-8 space-y-3 sm:space-y-5">
      <Card>
        <CardHeader className="pb-2 px-3.5 sm:px-6 sm:pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[11px] sm:text-xs text-muted-foreground">
              學習中心 / 教學總覽
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 text-xs"
              onClick={() => navigate("/learn")}
            >
              返回學習中心
            </Button>
          </div>
          <CardTitle className="text-lg sm:text-2xl flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> 教學總覽
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4 px-3.5 sm:px-6">
          <p className="text-xs sm:text-sm leading-5 sm:leading-6 text-muted-foreground">
            已將「首頁快速導覽」移到此頁。你可以從這裡選擇教學入口，再由光球或對應頁面完成逐步操作。
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              size="sm"
              className="w-full sm:w-auto min-h-11"
              onClick={() => {
                startTour("welcome", true);
                navigate("/");
              }}
            >
              啟動全站新手教學
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto min-h-11"
              onClick={() => navigate("/agent")}
            >
              用光球開始互動教學
            </Button>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">分站導覽（可左右滑動）</p>
            <div className="-mx-1.5 px-1.5 overflow-x-auto pb-1">
              <div className="flex gap-2 sm:gap-2.5 min-w-max snap-x snap-mandatory">
              {TOUR_TRACKS.map(track => (
                <Card
                  key={track.id}
                  className="w-[86vw] max-w-[300px] sm:w-[280px] snap-start rounded-xl"
                >
                  <CardHeader className="pb-2 px-3.5">
                    <CardTitle className="text-sm leading-5">{track.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 px-3.5">
                    <p className="text-xs text-muted-foreground leading-5">{track.note}</p>
                    <div className="flex flex-col gap-1.5">
                      <Button
                        size="sm"
                        className="h-9 text-xs w-full"
                        onClick={() => {
                          startTour(track.id, true);
                          navigate(track.path);
                        }}
                      >
                        開始導覽
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 text-xs w-full"
                        onClick={() => navigate(track.path)}
                      >
                        前往頁面
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">功能教學入口</p>
            <div className="grid gap-2 sm:gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map(item => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="h-full rounded-xl">
                  <CardHeader className="pb-2 px-3.5">
                    <CardTitle className="text-sm sm:text-base flex items-center gap-2 leading-5">
                      <Icon className="w-4 h-4" /> {item.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5 px-3.5">
                    <p className="text-xs text-muted-foreground leading-5">{item.description}</p>
                    <Button
                      size="sm"
                      className="w-full min-h-10"
                      onClick={() => navigate(item.path)}
                    >
                      前往 {item.title}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
