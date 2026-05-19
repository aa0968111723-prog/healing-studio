import {
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  Clapperboard,
  Clock,
  Coins,
  Cpu,
  Film,
  FolderOpen,
  Gift,
  GraduationCap,
  Image,
  Layers,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Monitor,
  Music,
  Package,
  Palette,
  Settings,
  Sparkles,
  StickyNote,
  Users,
  Wand2,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Lucide icon name → component lookup, used by the dock to materialise the
 * string icon names declared on appRegistry entries / SIDEBAR_GROUPS. Add an
 * entry here whenever you reference a new icon from the registry.
 */
const SIDEBAR_ICONS: Record<string, LucideIcon> = {
  BarChart3,
  BookMarked,
  BookOpen,
  Bot,
  CalendarDays,
  Clapperboard,
  Clock,
  Coins,
  Cpu,
  Film,
  FolderOpen,
  Gift,
  GraduationCap,
  Image,
  Layers,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Monitor,
  Music,
  Package,
  Palette,
  Settings,
  Sparkles,
  StickyNote,
  Users,
  Wand2,
  Zap,
};

export function resolveSidebarIcon(name: string | undefined): LucideIcon {
  if (name && SIDEBAR_ICONS[name]) return SIDEBAR_ICONS[name];
  return BookOpen;
}
