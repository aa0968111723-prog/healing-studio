/**
 * Home.tsx — 登入後首頁「創作中樞」骨架（Step 2）
 *
 * Step 2 only ships the skeleton: title + three sections (繼續上次專案 /
 * 快速開始 / 直接問光球). Heavier hero / scene / onboarding visuals from the
 * previous landing-style home were intentionally removed so the page reads
 * as a hub, not a chat box or tool list. Page-internal renames are out of
 * scope — see PR description.
 */

import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useWorldContext } from "@/contexts/WorldContextContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
} from "../../../shared/agent-actions";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AskOrbSection,
  ContinueProjectSection,
  QuickStartSection,
  type CreationHubProject,
} from "@/components/home/CreationHubSections";

/** sessionStorage key the /agent page can opt into reading later so we don't
 *  drop the user's typed goal on the floor. Keep the name discoverable. */
const ORB_HANDOFF_KEY = "home-orb-pending-prompt";

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const world = useWorldContext();

  const listQuery = trpc.creativeProject.list.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  const projects = useMemo<CreationHubProject[]>(() => {
    const data = listQuery.data ?? [];
    return data.map(p => ({
      id: p.id,
      title: p.title,
      status: p.status,
      worldFrameworkId: p.worldFrameworkId,
      worldStoryboardId: p.worldStoryboardId,
      directorSessionId: p.directorSessionId,
    }));
  }, [listQuery.data]);

  const activeProject = useMemo(() => {
    if (world.currentProjectId === null) return null;
    return projects.find(p => p.id === world.currentProjectId) ?? null;
  }, [projects, world.currentProjectId]);

  const recentProjects = useMemo(
    () => projects.filter(p => p.id !== activeProject?.id),
    [projects, activeProject],
  );

  const handleAskOrbSubmit = useCallback(
    (prompt: string) => {
      try {
        window.sessionStorage.setItem(ORB_HANDOFF_KEY, prompt);
      } catch {
        // privacy mode / quota — fail open; user still lands on /agent.
      }
      setLocation("/agent");
    },
    [setLocation],
  );

  const handleOpenAgent = useCallback(() => {
    setLocation("/agent");
  }, [setLocation]);

  // 首頁本身只承接 navigate（PageAgentContext 已提供 universal handler）。
  // 註冊一條空 capabilities 紀錄主要是為了讓 scan-routes 通過、並讓光球的
  // 路由器知道 home 是合法 PageAgent。
  useRegisterPageAgent({
    pageId: "home",
    pageLabel: "創作中樞",
    pagePath: "/",
    capabilities: [],
    state: {
      hasActiveProject: activeProject !== null,
      projectCount: projects.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      return {
        ok: false,
        reason: `home page does not handle ${action.type}`,
      };
    },
  });

  return (
    <div className="page-shell page-shell-default space-y-6">
      <PageHeader
        title="今天想創作什麼？"
        subtitle="選擇繼續創作中的專案、從快速入口起步，或交給光球帶你進到正確系統。"
      />

      <ContinueProjectSection
        activeProject={activeProject}
        recentProjects={recentProjects}
        loading={listQuery.isLoading}
      />

      <QuickStartSection />

      <AskOrbSection
        onSubmit={handleAskOrbSubmit}
        onOpenAgent={handleOpenAgent}
      />
    </div>
  );
}
