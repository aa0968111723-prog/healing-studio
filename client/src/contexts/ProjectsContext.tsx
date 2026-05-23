/**
 * ProjectsContext — Step 3 creation-hub state.
 *
 * Client-only project store backed by MOCK_PROJECTS. The home page,
 * /projects list, and /projects/:id detail all read from here so we have
 * exactly one source of truth while the real tRPC / DB persistence is
 * still in design. activeProjectId lives in localStorage so the home's
 * 「繼續上次專案」 sticks across reloads.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MOCK_PROJECTS } from "@/data/mockProjects";
import type { Project, ProjectType } from "@/types/projects";

const ACTIVE_PROJECT_KEY = "creation-hub-active-project-id";

export interface CreateProjectDraft {
  title: string;
  type: ProjectType;
  worldFramework?: string;
  storyboard?: string;
  directorSession?: string;
}

interface ProjectsContextValue {
  projects: Project[];
  activeProjectId: string | null;
  /** The latest-updated project among `projects`, regardless of status —
   *  used by the home's "繼續上次專案" card when no explicit active id is
   *  pinned. Returns null when there are no projects. */
  latestProject: Project | null;
  /** Either the explicitly pinned project (if its id is still present) or
   *  latestProject as a fallback. */
  activeProject: Project | null;
  setActiveProjectId: (id: string | null) => void;
  getProjectById: (id: string) => Project | undefined;
  /** Append a new project to the local store and pin it as active. Mock-only
   *  for now — the real persistence lands when /creative-projects graduates
   *  to tRPC/Drizzle. */
  createProject: (draft: CreateProjectDraft) => Project;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    }
  } catch {
    // ignore quota / privacy mode
  }
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(() => [...MOCK_PROJECTS]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    () => readStoredId(),
  );

  // Drop a stale stored id (e.g. mock data changed between releases).
  useEffect(() => {
    if (activeProjectId && !projects.some(p => p.id === activeProjectId)) {
      setActiveProjectIdState(null);
      writeStoredId(null);
    }
  }, [activeProjectId, projects]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    writeStoredId(id);
  }, []);

  const getProjectById = useCallback(
    (id: string) => projects.find(p => p.id === id),
    [projects],
  );

  const createProject = useCallback((draft: CreateProjectDraft): Project => {
    const now = new Date().toISOString();
    const id = `proj-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const binding =
      draft.worldFramework || draft.storyboard || draft.directorSession
        ? {
            ...(draft.worldFramework ? { worldFramework: draft.worldFramework } : {}),
            ...(draft.storyboard ? { storyboard: draft.storyboard } : {}),
            ...(draft.directorSession
              ? { directorSession: draft.directorSession }
              : {}),
          }
        : undefined;
    const project: Project = {
      id,
      title: draft.title.trim(),
      type: draft.type,
      status: "draft",
      progress: 0,
      currentStep: "剛建立，待設定世界觀與腳本。",
      nextAction: "到導演工作室為這個專案綁定世界觀與腳本。",
      createdAt: now,
      updatedAt: now,
      ...(binding ? { binding } : {}),
    };
    setProjects(prev => [...prev, project]);
    setActiveProjectIdState(id);
    writeStoredId(id);
    return project;
  }, []);

  const latestProject = useMemo<Project | null>(() => {
    if (projects.length === 0) return null;
    return [...projects].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
  }, [projects]);

  const activeProject = useMemo<Project | null>(() => {
    const pinned = activeProjectId
      ? projects.find(p => p.id === activeProjectId) ?? null
      : null;
    return pinned ?? latestProject;
  }, [activeProjectId, projects, latestProject]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
    }),
    [
      projects,
      activeProjectId,
      latestProject,
      activeProject,
      setActiveProjectId,
      getProjectById,
      createProject,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext);
  if (!ctx) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return ctx;
}
