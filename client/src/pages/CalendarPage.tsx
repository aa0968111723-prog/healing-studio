import { useState, useMemo, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import { PlanningSubpageGuide } from "@/components/PlanningSubpageGuide";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ZenCoPilot";
import { LocationPicker, type ScheduleLocation } from "@/components/LocationPicker";
import { toast } from "sonner";
import {
  CalendarDays,
  Plus,
  Trash2,
  Clock,
  Image,
  Video,
  Music,
  Mic,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  X,
  CheckCircle2,
  ExternalLink,
  MapPin,
  Bell,
  Smartphone,
  Copy,
  RefreshCw,
  Circle,
  CircleDot,
  CircleCheck,
  AlertTriangle,
  Download,
} from "lucide-react";
import { openGoogleCalendar } from "@/lib/googleCalendar";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";

// ─── Types ─────────────────────────────────────────────────────────────────

type NoteStatus = "todo" | "in_progress" | "done";

type CalendarNote = {
  id: number;
  title: string;
  content?: string | null;
  noteType: string;
  status?: NoteStatus | null;
  scheduledDate?: Date | string | null;
  endDate?: Date | string | null;
  reminderMinutes?: number | null;
  location?: ScheduleLocation | null;
  meetingUrl?: string | null;
  createdAt: Date | string;
  tags?: string[] | null;
};

const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "不提醒" },
  { value: 15, label: "提前 15 分鐘" },
  { value: 30, label: "提前 30 分鐘" },
  { value: 60, label: "提前 1 小時" },
  { value: 60 * 24, label: "提前 1 天" },
];

const statusInfo: Record<
  NoteStatus,
  { label: string; icon: React.ReactNode; pill: string }
> = {
  todo: {
    label: "待辦",
    icon: <Circle className="w-3 h-3" />,
    pill: "bg-zen-sky/15 text-zen-sky border-zen-sky/30",
  },
  in_progress: {
    label: "進行中",
    icon: <CircleDot className="w-3 h-3" />,
    pill: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  done: {
    label: "已完成",
    icon: <CircleCheck className="w-3 h-3" />,
    pill: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
};

function nextStatus(s: NoteStatus): NoteStatus {
  if (s === "todo") return "in_progress";
  if (s === "in_progress") return "done";
  return "todo";
}

function isOverdueNote(n: CalendarNote): boolean {
  if (!n.scheduledDate) return false;
  if ((n.status ?? "todo") === "done") return false;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(n.scheduledDate).getTime() < d.getTime();
}

function downloadIcsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Modality Icons ────────────────────────────────────────────────────────

const MODALITY_ICONS: Record<string, React.ReactNode> = {
  image: <Image className="w-3 h-3" />,
  video: <Video className="w-3 h-3" />,
  audio: <Music className="w-3 h-3" />,
  voice: <Mic className="w-3 h-3" />,
};

// ─── Event Card ────────────────────────────────────────────────────────────

function EventCard({
  note,
  onDelete,
  onCycleStatus,
  compact = false,
}: {
  note: CalendarNote;
  onDelete: (id: number) => void;
  onCycleStatus?: (note: CalendarNote) => void;
  compact?: boolean;
}) {
  const status = (note.status ?? "todo") as NoteStatus;
  const sInfo = statusInfo[status];
  const overdue = isOverdueNote(note);
  const typeColor =
    note.noteType === "calendar_event"
      ? "border-amber-500/30 bg-amber-500/10"
      : note.noteType === "script"
        ? "border-purple-500/30 bg-purple-500/10"
        : "border-cyan-500/30 bg-cyan-500/10";

  const time =
    note.scheduledDate &&
    new Date(note.scheduledDate).toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const hasTimeOfDay =
    !!note.scheduledDate &&
    (() => {
      const d = new Date(note.scheduledDate!);
      return d.getHours() !== 0 || d.getMinutes() !== 0;
    })();

  const handleAddToGoogleCalendar = (e: React.MouseEvent) => {
    e.stopPropagation();
    const eventDate = note.scheduledDate
      ? new Date(note.scheduledDate)
      : new Date();
    openGoogleCalendar({
      title: note.title,
      description: note.content ?? undefined,
      date: eventDate,
      allDay: !hasTimeOfDay,
      durationMinutes: 60,
    });
    toast.success("已開啟 Google 日曆");
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        "group rounded-lg border p-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-md",
        typeColor,
        overdue && "ring-1 ring-red-500/40",
        status === "done" && "opacity-60",
        compact ? "text-[10px]" : "text-xs"
      )}
      draggable
      onDragStart={(e: any) => {
        e.dataTransfer?.setData(
          "text/plain",
          JSON.stringify({ noteId: note.id, title: note.title })
        );
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {onCycleStatus ? (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onCycleStatus(note);
              }}
              title={`狀態：${sInfo.label}（點擊推進）`}
              className={cn(
                "shrink-0 rounded-full p-0.5 border hover:scale-110 transition-transform",
                sInfo.pill
              )}
            >
              {sInfo.icon}
            </button>
          ) : (
            <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0" />
          )}
          <span
            className={cn(
              "truncate font-medium",
              status === "done"
                ? "line-through text-muted-foreground/60"
                : "text-foreground/80"
            )}
          >
            {note.title}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {hasTimeOfDay && (
            <span
              className={cn(
                "tabular-nums px-1 rounded text-[10px] font-medium",
                overdue
                  ? "bg-red-500/15 text-red-500"
                  : "bg-foreground/10 text-foreground/70"
              )}
            >
              {time}
            </span>
          )}
          {overdue && (
            <span title="逾期" className="text-red-500">
              <AlertTriangle className="w-2.5 h-2.5" />
            </span>
          )}
          {note.scheduledDate && (
            <button
              onClick={handleAddToGoogleCalendar}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded hover:bg-blue-500/20 text-muted-foreground/40 hover:text-blue-400 transition-all"
              title="加入 Google 日曆"
            >
              <ExternalLink className="w-2.5 h-2.5" />
            </button>
          )}
          <button
            onClick={e => {
              e.stopPropagation();
              onDelete(note.id);
            }}
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 transition-all"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
      {!compact && note.content && (
        <p className="text-muted-foreground/60 line-clamp-1 mt-1 ml-4.5">
          {note.content}
        </p>
      )}
      {!compact && (note.location || note.reminderMinutes || note.scheduledDate) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 ml-4.5 text-[10px] text-muted-foreground/70">
          {note.scheduledDate && (
            <span className="inline-flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {new Date(note.scheduledDate).toLocaleTimeString("zh-TW", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
          {note.location?.name && (
            <span className="inline-flex items-center gap-0.5 max-w-[140px] truncate">
              <MapPin className="w-2.5 h-2.5 text-amber-400" />
              {note.location.name}
            </span>
          )}
          {typeof note.reminderMinutes === "number" && note.reminderMinutes > 0 && (
            <span className="inline-flex items-center gap-0.5 text-cyan-400/80">
              <Bell className="w-2.5 h-2.5" />
              {note.reminderMinutes >= 60
                ? `${Math.round(note.reminderMinutes / 60)}h`
                : `${note.reminderMinutes}m`}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ─── New Event Form ────────────────────────────────────────────────────────

function NewEventForm({
  date,
  onClose,
  onCreated,
}: {
  date: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  // Default to 09:00 — most users plan a "morning slot" for creative work.
  const [timeStr, setTimeStr] = useState("09:00");
  const [allDay, setAllDay] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reminderMinutes, setReminderMinutes] = useState(30);
  const [location, setLocation] = useState<ScheduleLocation | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [addToGoogle, setAddToGoogle] = useState(false);

  // Returns the chosen start (midnight if allDay) plus an `end` only when
  // not allDay so callers can persist it as the event's end timestamp.
  const buildSchedule = useCallback((): { start: Date; end: Date | null } => {
    const start = new Date(date);
    if (allDay) {
      start.setHours(0, 0, 0, 0);
      return { start, end: null };
    }
    const [hStr, mStr] = timeStr.split(":");
    const h = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(mStr, 10) || 0));
    start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return { start, end };
  }, [date, allDay, timeStr, durationMinutes]);

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      if (addToGoogle && title.trim()) {
        const { start } = buildSchedule();
        openGoogleCalendar({
          title: title.trim(),
          description: content.trim() || undefined,
          date: start,
          allDay,
          durationMinutes: allDay ? undefined : durationMinutes,
        });
      }
      onCreated();
      onClose();
      toast.success(
        addToGoogle ? "排程已建立，已開啟 Google 日曆" : "排程已建立"
      );
    },
    onError: e => toast.error(e.message),
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 backdrop-blur-sm p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-amber-400 flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          新增排程 - {date.toLocaleDateString("zh-TW")}
        </h4>
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10">
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <Input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="排程標題（例如：陽明山外拍）"
        className="bg-white/5 border-white/10 text-sm"
      />

      <Textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="描述（選填）"
        rows={2}
        className="bg-white/5 border-white/10 text-xs resize-none"
      />

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allDay}
            onChange={e => setAllDay(e.target.checked)}
            className="rounded border-white/20 bg-white/5 h-3.5 w-3.5 accent-amber-500"
          />
          全天事件
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" /> 開始時間
            </span>
            <Input
              type="time"
              value={timeStr}
              onChange={e => setTimeStr(e.target.value)}
              disabled={allDay}
              className="bg-white/5 border-white/10 text-xs h-8 disabled:opacity-40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground/70">時長</span>
            <select
              value={durationMinutes}
              onChange={e => setDurationMinutes(Number(e.target.value))}
              disabled={allDay}
              className="w-full bg-white/5 border border-white/10 rounded-md text-xs h-8 px-2 disabled:opacity-40"
            >
              <option value={30}>30 分鐘</option>
              <option value={60}>1 小時</option>
              <option value={90}>1.5 小時</option>
              <option value={120}>2 小時</option>
              <option value={180}>3 小時</option>
              <option value={240}>4 小時</option>
              <option value={480}>整天</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <Bell className="w-2.5 h-2.5" /> 提醒
            </span>
            <select
              value={reminderMinutes}
              onChange={e => setReminderMinutes(Number(e.target.value))}
              className="w-full bg-white/5 border border-white/10 rounded-md text-xs h-8 px-2"
            >
              {REMINDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowLocationPicker(v => !v)}
            className="w-full flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs hover:border-amber-500/30"
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="w-3 h-3 text-amber-400" />
              {location ? location.name : "外拍地點（選填）"}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {showLocationPicker ? "收合" : "展開地圖"}
            </span>
          </button>
          <AnimatePresence>
            {showLocationPicker && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <LocationPicker value={location} onChange={setLocation} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={addToGoogle}
          onChange={e => setAddToGoogle(e.target.checked)}
          className="rounded border-white/20 bg-white/5 h-3.5 w-3.5 accent-blue-500"
        />
        <ExternalLink className="w-3 h-3" />
        同時加入 Google 日曆
      </label>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="flex-1 text-xs"
        >
          取消
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (!title.trim()) {
              toast.error("請輸入標題");
              return;
            }
            const { start, end } = buildSchedule();
            createNote.mutate({
              title: title.trim(),
              content: content.trim() || undefined,
              noteType: "calendar_event",
              scheduledDate: start.getTime(),
              endDate: end ? end.getTime() : undefined,
              reminderMinutes: reminderMinutes > 0 ? reminderMinutes : undefined,
              location: location ?? undefined,
            });
          }}
          disabled={createNote.isPending}
          className="flex-1 text-xs bg-amber-600 hover:bg-amber-500 text-white"
        >
          {createNote.isPending ? "建立中..." : "建立排程"}
        </Button>
      </div>
    </motion.div>
  );
}

// ─── Calendar Page ─────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { personality } = useAIState();
  const [, navigate] = useLocation();

  // 全站新手引導
  usePageTour("calendar");

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date()
  );
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [month, setMonth] = useState(new Date());

  // ── Drag state for calendar cell highlighting ──
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());

  // ── Tap-to-schedule（手機備援，HTML5 拖拉在觸控裝置失效）──
  // 行為：點待排程列表中的筆記 → 進入 "armed" 狀態 → 點日曆上的日期 →
  // 立刻把該筆記排到那一天的 09:00。再點一次同一筆筆記則取消選取。
  const [armedNoteId, setArmedNoteId] = useState<number | null>(null);

  const notesQuery = trpc.notes.list.useQuery();
  const trpcUtils = trpc.useUtils();
  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      trpcUtils.notes.summary.invalidate();
      toast.success("已刪除");
    },
  });

  const updateNote = trpc.notes.update.useMutation({
    onSuccess: (_data, variables) => {
      notesQuery.refetch();
      trpcUtils.notes.summary.invalidate();
      if (variables?.status) {
        if (variables.status === "done") toast.success("已標記完成 ✓");
        else toast.success("狀態已更新");
        return;
      }
      if (variables.scheduledDate) {
        const dateObj = new Date(variables.scheduledDate);
        const dateStr = dateObj.toLocaleDateString("zh-TW", {
          month: "long",
          day: "numeric",
          weekday: "long",
        });
        toast.success(
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            <span>
              已排程至 <strong>{dateStr}</strong>
            </span>
          </div>,
          { duration: 3000 }
        );
      } else {
        toast.success("排程已更新");
      }
    },
  });

  const cycleStatus = useCallback(
    (note: CalendarNote) => {
      const current = (note.status ?? "todo") as NoteStatus;
      updateNote.mutate({ id: note.id, status: nextStatus(current) });
    },
    [updateNote]
  );

  // Group notes by date
  const notesByDate = useMemo(() => {
    const map = new Map<string, CalendarNote[]>();
    (notesQuery.data || []).forEach((note: CalendarNote) => {
      if (note.scheduledDate) {
        const dateKey = new Date(note.scheduledDate).toDateString();
        const existing = map.get(dateKey) || [];
        existing.push(note);
        map.set(dateKey, existing);
      }
    });
    return map;
  }, [notesQuery.data]);

  // Get events for selected date
  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) return [];
    return notesByDate.get(selectedDate.toDateString()) || [];
  }, [selectedDate, notesByDate]);

  // Unscheduled notes available for drag — hide done items so the sidebar
  // shows only what still needs a slot on the calendar.
  const unscheduledNotes = useMemo(() => {
    return (notesQuery.data || []).filter(
      (n: CalendarNote) =>
        !n.scheduledDate && (n.status ?? "todo") !== "done"
    );
  }, [notesQuery.data]);

  // Dates that have events (for calendar dot indicators)
  const eventDates = useMemo(() => {
    return Array.from(notesByDate.keys()).map(d => new Date(d));
  }, [notesByDate]);

  // ── Week / today summary ──────────────────────────────────────────────────
  const weekSummary = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const endOfWeek = new Date(startOfToday);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const all = (notesQuery.data || []) as CalendarNote[];
    const todayList: CalendarNote[] = [];
    const upcomingList: CalendarNote[] = [];
    const overdueList: CalendarNote[] = [];
    let doneCount = 0;
    for (const n of all) {
      if ((n.status ?? "todo") === "done") {
        doneCount += 1;
        continue;
      }
      if (!n.scheduledDate) continue;
      const ts = new Date(n.scheduledDate).getTime();
      if (ts < startOfToday.getTime()) overdueList.push(n);
      else if (ts < endOfToday.getTime()) todayList.push(n);
      else if (ts < endOfWeek.getTime()) upcomingList.push(n);
    }
    todayList.sort(
      (a, b) =>
        new Date(a.scheduledDate!).getTime() -
        new Date(b.scheduledDate!).getTime()
    );
    upcomingList.sort(
      (a, b) =>
        new Date(a.scheduledDate!).getTime() -
        new Date(b.scheduledDate!).getTime()
    );
    overdueList.sort(
      (a, b) =>
        new Date(a.scheduledDate!).getTime() -
        new Date(b.scheduledDate!).getTime()
    );
    return { today: todayList, upcoming: upcomingList, overdue: overdueList, doneCount };
  }, [notesQuery.data]);

  const exportIcsQuery = trpc.notes.exportIcs.useQuery(
    { includeDone: false },
    { enabled: false }
  );
  const handleExportIcs = useCallback(async () => {
    try {
      const result = await exportIcsQuery.refetch();
      const data = result.data;
      if (!data) {
        toast.error("無法產生行事曆檔");
        return;
      }
      if (data.eventCount === 0) {
        toast.info("目前沒有未完成的排程可匯出");
        return;
      }
      downloadIcsFile(data.filename, data.content);
      toast.success(`已匯出 ${data.eventCount} 個排程到 ${data.filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "匯出失敗");
    }
  }, [exportIcsQuery]);

  // ─── PageAgent 註冊（Phase 4b：行事曆接入光球） ──────────────────────────
  // 光球可：回到今天、前進 / 後退一個月、跳到筆記頁建立內容。
  // 加入 image-studio / video-studio / pro-studio 三個常見的後續創作目的地，
  // 讓「行事曆 → 建立排程 → 直接前往對應工作室開工」的工作流可以一氣呵成。
  const CALENDAR_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/notes",
        "/dashboard",
        "/studio",
        "/focus-flow",
        "/image-studio",
        "/video-studio",
        "/pro-studio",
      ]),
    []
  );
  const calendarAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setParam",
        label: "切換月份",
        options: [
          { id: "selectToday", label: "回到今天", meta: { bestFor: "快速歸位", tip: "每日開始先回今天檢查任務" } },
          { id: "monthOffset", label: "月份偏移", meta: { bestFor: "中期排程", tip: "用 ±1 檢視跨月負載" } },
        ],
        hint: "setParam key='monthOffset' value=<number>（0=本月、1=下個月、-1=上個月）；key='selectToday' value=true 回到今天",
      },
      {
        action: "navigate",
        label: "跳到相關頁面",
        options: [
          { id: "/notes", label: "專案筆記", meta: { bestFor: "補計畫內容", tip: "先寫清任務再拖曳排程" } },
          { id: "/dashboard", label: "儀表板", meta: { bestFor: "看產能與趨勢", tip: "依數據反調排程密度" } },
          { id: "/studio", label: "創作工作室", meta: { bestFor: "開始創作", tip: "排程完直接開工" } },
          { id: "/focus-flow", label: "專注流", meta: { bestFor: "深度工作", tip: "搭配行事曆排程使用" } },
          { id: "/image-studio", label: "圖片工作室", meta: { bestFor: "排程後出圖", tip: "把排程目標當提示詞" } },
          { id: "/video-studio", label: "影片工作室", meta: { bestFor: "排程後出影片", tip: "為里程碑拍動畫" } },
          { id: "/pro-studio", label: "音樂工作室", meta: { bestFor: "排程後配樂", tip: "為段落配音樂" } },
        ],
        hint: "navigate path='/notes' | '/dashboard' | '/studio' | '/focus-flow' | '/image-studio' | '/video-studio' | '/pro-studio'",
      },
      {
        action: "reset",
        label: "回到本月並選今天",
        hint: "month、selectedDate 都還原為今天",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "calendar",
    pageLabel: "創作行事曆",
    pagePath: "/calendar",
    capabilities: calendarAgentCapabilities,
    state: {
      month: month.toISOString(),
      selectedDate: selectedDate?.toISOString() ?? null,
      selectedEventsCount: selectedDateEvents.length,
      totalScheduled: eventDates.length,
      unscheduledCount: unscheduledNotes.length,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setParam": {
          if (action.key === "selectToday") {
            if (action.value) {
              const today = new Date();
              setMonth(today);
              setSelectedDate(today);
              return { ok: true, message: "已回到今天" };
            }
            return { ok: false, reason: "selectToday=false 沒意義" };
          }
          if (action.key === "monthOffset") {
            const offset = Number(action.value);
            if (!Number.isFinite(offset)) {
              return { ok: false, reason: "monthOffset 必須為整數" };
            }
            const next = new Date();
            next.setMonth(next.getMonth() + Math.trunc(offset));
            setMonth(next);
            return { ok: true, message: `月份切換 offset=${offset}` };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "navigate": {
          const path = String(action.path ?? "");
          if (!CALENDAR_NAV_ALLOWLIST.has(path)) {
            return { ok: false, reason: `不在允許跳轉清單：${path}` };
          }
          navigate(path);
          return { ok: true, message: `跳到 ${path}` };
        }
        case "reset": {
          const today = new Date();
          setMonth(today);
          setSelectedDate(today);
          return { ok: true, message: "已回到今天" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on calendar: ${action.type}`,
          };
      }
    },
  });

  // Handle drop on calendar date
  const handleDrop = useCallback(
    (e: React.DragEvent, date: Date) => {
      e.preventDefault();
      setDragOverDate(null);
      dragCounterRef.current.clear();
      try {
        const data = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (data.noteId) {
          updateNote.mutate({
            id: data.noteId,
            scheduledDate: date.getTime(),
          });
        }
      } catch {
        // Not a valid drag payload
      }
    },
    [updateNote]
  );

  // Handle drag over on the calendar container — detect which date cell is being hovered
  const handleCalendarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // Find the date from a drag event target by traversing up to find [data-day]
  const getDateFromTarget = useCallback((target: EventTarget): Date | null => {
    let el = target as HTMLElement;
    while (el) {
      const dayAttr = el.getAttribute("data-day");
      if (dayAttr) {
        // data-day is stored as ISO string, parse reliably
        const parsed = new Date(dayAttr);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      if (el.parentElement) {
        el = el.parentElement;
      } else {
        break;
      }
    }
    return null;
  }, []);

  const handleCellDragEnter = useCallback(
    (e: React.DragEvent) => {
      const date = getDateFromTarget(e.target);
      if (date) {
        const key = date.toDateString();
        const counter = dragCounterRef.current.get(key) || 0;
        dragCounterRef.current.set(key, counter + 1);
        setDragOverDate(key);
      }
    },
    [getDateFromTarget]
  );

  const handleCellDragLeave = useCallback(
    (e: React.DragEvent) => {
      const date = getDateFromTarget(e.target);
      if (date) {
        const key = date.toDateString();
        const counter = (dragCounterRef.current.get(key) || 1) - 1;
        if (counter <= 0) {
          dragCounterRef.current.delete(key);
          // Only clear if no other cell is being hovered
          if (dragOverDate === key) {
            setDragOverDate(null);
          }
        } else {
          dragCounterRef.current.set(key, counter);
        }
      }
    },
    [dragOverDate]
  );

  const handleCellDrop = useCallback(
    (e: React.DragEvent) => {
      const date = getDateFromTarget(e.target);
      if (date) {
        handleDrop(e, date);
      }
    },
    [getDateFromTarget, handleDrop]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="hs-h2 !mb-0">創作排程</h1>
            <p className="hs-small !mb-0 text-muted-foreground mt-0.5">
              拖曳筆記到日曆上安排創作時程
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const t = new Date();
              setSelectedDate(t);
              setMonth(t);
            }}
            className="gap-1.5 text-xs"
          >
            今天
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportIcs}
            disabled={exportIcsQuery.isFetching}
            className="gap-1.5 text-xs"
            title="匯出 .ics 行事曆檔，可在 Apple Calendar / Outlook / Notion Calendar 開啟"
          >
            <Download className="w-3.5 h-3.5" />
            {exportIcsQuery.isFetching ? "產生中..." : "匯出 .ics"}
          </Button>
          <Button
            size="sm"
            onClick={() => setShowNewEvent(true)}
            className="gap-1.5"
            disabled={!selectedDate}
          >
            <Plus className="w-3.5 h-3.5" />
            新增排程
          </Button>
        </div>
      </div>

      {/* ── Weekly focus panel ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div
          className={`rounded-xl border p-3 ${
            weekSummary.overdue.length > 0
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : "border-border/50 bg-muted/20 text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
            <AlertTriangle className="w-3.5 h-3.5" />
            逾期
          </div>
          <div className="text-2xl font-semibold tabular-nums leading-tight mt-1">
            {weekSummary.overdue.length}
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 ${
            weekSummary.today.length > 0
              ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
              : "border-border/50 bg-muted/20 text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
            <Clock className="w-3.5 h-3.5" />
            今天
          </div>
          <div className="text-2xl font-semibold tabular-nums leading-tight mt-1">
            {weekSummary.today.length}
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 ${
            weekSummary.upcoming.length > 0
              ? "border-zen-sky/40 bg-zen-sky/10 text-zen-sky"
              : "border-border/50 bg-muted/20 text-muted-foreground"
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
            <CalendarDays className="w-3.5 h-3.5" />
            未來 7 天
          </div>
          <div className="text-2xl font-semibold tabular-nums leading-tight mt-1">
            {weekSummary.upcoming.length}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
            <CircleCheck className="w-3.5 h-3.5" />
            已完成
          </div>
          <div className="text-2xl font-semibold tabular-nums leading-tight mt-1">
            {weekSummary.doneCount}
          </div>
        </div>
      </div>

      {(weekSummary.overdue.length > 0 || weekSummary.today.length > 0) && (
        <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-zen-sky/5 p-3 space-y-2">
          <p className="text-xs font-medium text-foreground/80">今日聚焦</p>
          <div className="space-y-1.5">
            {[
              ...weekSummary.overdue.map(n => ({ note: n, kind: "overdue" as const })),
              ...weekSummary.today.map(n => ({ note: n, kind: "today" as const })),
            ]
              .slice(0, 6)
              .map(({ note, kind }) => {
                const dt = note.scheduledDate
                  ? new Date(note.scheduledDate)
                  : null;
                const status = (note.status ?? "todo") as NoteStatus;
                const sInfo = statusInfo[status];
                return (
                  <div
                    key={note.id}
                    className={`flex items-center gap-2 rounded-lg border bg-background/40 px-2.5 py-1.5 text-xs ${
                      kind === "overdue"
                        ? "border-red-500/30"
                        : "border-amber-500/20"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => cycleStatus(note)}
                      className={`shrink-0 rounded-full p-0.5 border hover:scale-110 transition-transform ${sInfo.pill}`}
                      title={`狀態：${sInfo.label}（點擊推進）`}
                    >
                      {sInfo.icon}
                    </button>
                    <span
                      className={`flex-1 truncate ${
                        status === "done"
                          ? "line-through text-muted-foreground"
                          : ""
                      }`}
                    >
                      {note.title}
                    </span>
                    {dt && (
                      <span
                        className={`text-[10px] tabular-nums ${
                          kind === "overdue" ? "text-red-500" : "text-amber-500"
                        }`}
                      >
                        {kind === "overdue"
                          ? dt.toLocaleDateString("zh-TW", {
                              month: "numeric",
                              day: "numeric",
                            })
                          : dt.toLocaleTimeString("zh-TW", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <PlanningSubpageGuide page="calendar" />
      <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
        <p className="text-xs font-medium text-foreground/80 mb-2">
          生成前後排程串接
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={() => navigate("/notes")}
          >
            先建規劃筆記
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => navigate("/studio")}
          >
            進入生成執行
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1.5"
            onClick={() => navigate("/history")}
          >
            生成後回看
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar with drag-over support */}
        <GlassCard className="lg:col-span-2">
          <div
            onDragOver={handleCalendarDragOver}
            onDragEnter={handleCellDragEnter}
            onDragLeave={handleCellDragLeave}
            onDrop={handleCellDrop}
          >
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={d => {
                setSelectedDate(d);
                if (d && armedNoteId != null) {
                  const target = new Date(d);
                  target.setHours(9, 0, 0, 0);
                  updateNote.mutate({
                    id: armedNoteId,
                    scheduledDate: target.getTime(),
                  });
                  setArmedNoteId(null);
                }
              }}
              month={month}
              onMonthChange={setMonth}
              modifiers={{ hasEvent: eventDates }}
              modifiersClassNames={{
                hasEvent:
                  "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-amber-400",
              }}
              className="w-full"
              classNames={{
                day: cn(
                  "relative w-full h-full p-0 text-center group/day aspect-square select-none transition-all duration-200"
                ),
              }}
              components={{
                DayButton: ({ day, modifiers, className, ...props }) => {
                  const isDragTarget = dragOverDate === day.date.toDateString();
                  return (
                    <Button
                      variant="ghost"
                      size="icon"
                      data-day={day.date.toISOString()}
                      data-selected-single={
                        modifiers.selected &&
                        !modifiers.range_start &&
                        !modifiers.range_end &&
                        !modifiers.range_middle
                      }
                      className={cn(
                        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal [&>span]:text-xs [&>span]:opacity-70",
                        isDragTarget &&
                          "ring-2 ring-amber-400 bg-amber-400/20 scale-110 shadow-lg shadow-amber-400/30 rounded-lg",
                        className
                      )}
                      {...props}
                    />
                  );
                },
              }}
            />
          </div>

          {/* Drag hint banner */}
          <AnimatePresence>
            {dragOverDate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-400 flex items-center gap-2"
              >
                <CalendarDays className="w-3.5 h-3.5" />
                放開以排程至{" "}
                <strong>
                  {new Date(dragOverDate).toLocaleDateString("zh-TW", {
                    month: "long",
                    day: "numeric",
                  })}
                </strong>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tap-to-schedule hint banner（手機備援）*/}
          <AnimatePresence>
            {armedNoteId != null && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-400 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    已選取「
                    <strong>
                      {(notesQuery.data || []).find(
                        n => n.id === armedNoteId
                      )?.title ?? "未命名"}
                    </strong>
                    」，點日曆上的日期排程
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setArmedNoteId(null)}
                  className="shrink-0 text-[11px] underline hover:text-amber-300"
                >
                  取消
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected Date Events */}
          {selectedDate && (
            <div className="mt-4 pt-4 border-t border-border/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="hs-h3 !mb-0 text-foreground flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  {selectedDate.toLocaleDateString("zh-TW", {
                    month: "long",
                    day: "numeric",
                    weekday: "long",
                  })}
                </h3>
                <div className="flex items-center gap-2">
                  {selectedDateEvents.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] gap-1 text-blue-500 hover:text-blue-400 hover:bg-blue-500/10"
                      onClick={() => {
                        if (selectedDateEvents.length === 1) {
                          const note = selectedDateEvents[0];
                          const eventDate = note.scheduledDate
                            ? new Date(note.scheduledDate)
                            : selectedDate;
                          openGoogleCalendar({
                            title: note.title,
                            description: note.content ?? undefined,
                            date: eventDate,
                            allDay: true,
                          });
                          toast.success("已開啟 Google 日曆");
                        } else {
                          // Combine multiple events into a single Google Calendar event
                          // to avoid popup blockers from opening multiple tabs
                          const combinedTitle = `${selectedDate.toLocaleDateString("zh-TW")} 創作排程（${selectedDateEvents.length} 項）`;
                          const combinedDescription = selectedDateEvents
                            .map(
                              (n, i) =>
                                `${i + 1}. ${n.title}${n.content ? `\n   ${n.content}` : ""}`
                            )
                            .join("\n\n");
                          openGoogleCalendar({
                            title: combinedTitle,
                            description: combinedDescription,
                            date: selectedDate,
                            allDay: true,
                          });
                          toast.success(
                            `已將 ${selectedDateEvents.length} 個排程匯出至 Google 日曆`
                          );
                        }
                      }}
                    >
                      <ExternalLink className="w-3 h-3" />
                      匯出至 Google 日曆
                    </Button>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {selectedDateEvents.length} 個排程
                  </Badge>
                </div>
              </div>

              <AnimatePresence>
                {showNewEvent && (
                  <NewEventForm
                    date={selectedDate}
                    onClose={() => setShowNewEvent(false)}
                    onCreated={() => notesQuery.refetch()}
                  />
                )}
              </AnimatePresence>

              <div
                className="space-y-2 mt-2 min-h-[60px] rounded-lg border border-dashed border-white/10 p-2 transition-colors"
                onDragOver={e => {
                  e.preventDefault();
                  e.currentTarget.classList.add(
                    "border-amber-400/40",
                    "bg-amber-500/5"
                  );
                }}
                onDragLeave={e => {
                  e.currentTarget.classList.remove(
                    "border-amber-400/40",
                    "bg-amber-500/5"
                  );
                }}
                onDrop={e => {
                  e.currentTarget.classList.remove(
                    "border-amber-400/40",
                    "bg-amber-500/5"
                  );
                  handleDrop(e, selectedDate);
                }}
              >
                {selectedDateEvents.length === 0 ? (
                  <p className="hs-small !mb-0 text-muted-foreground/40 text-center py-4">
                    拖曳筆記到此處排程，或點擊「新增排程」
                  </p>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {selectedDateEvents.map((note: CalendarNote) => (
                      <EventCard
                        key={note.id}
                        note={note}
                        onDelete={id => deleteNote.mutate({ id })}
                        onCycleStatus={cycleStatus}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>
          )}
        </GlassCard>

        {/* Sidebar: Unscheduled Notes */}
        <div className="space-y-4">
          <GlassCard>
            <h3 className="hs-h3 !mb-0 text-foreground flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-cyan-400" />
              待排程筆記
            </h3>
            <p className="hs-small !mb-0 text-muted-foreground/50 mb-3">
              拖曳到日期，或在手機上「先點筆記、再點日期」
            </p>

            {notesQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="h-10 rounded-lg bg-white/5 animate-pulse"
                  />
                ))}
              </div>
            ) : unscheduledNotes.length === 0 ? (
              <div className="text-center py-6">
                <CalendarDays className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="hs-small !mb-0 text-muted-foreground/40">
                  所有筆記已排程
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                <AnimatePresence mode="popLayout">
                  {unscheduledNotes.map((note: CalendarNote) => {
                    const armed = armedNoteId === note.id;
                    return (
                      <div
                        key={note.id}
                        onClick={() =>
                          setArmedNoteId(armed ? null : note.id)
                        }
                        className={cn(
                          "rounded-lg transition-all",
                          armed &&
                            "ring-2 ring-amber-400 shadow-lg shadow-amber-400/20"
                        )}
                        title={
                          armed
                            ? "已選取，點日曆上的日期即可排程"
                            : "點一下選取，再點日期即可排程（手機備援）"
                        }
                      >
                        <EventCard
                          note={note}
                          onDelete={id => deleteNote.mutate({ id })}
                          onCycleStatus={cycleStatus}
                          compact
                        />
                      </div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </GlassCard>

          {/* Quick Stats */}
          <GlassCard>
            <h3 className="hs-h3 !mb-0 text-foreground mb-3">排程統計</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="hs-h3-lg !mb-0 text-amber-400 tabular-nums">
                  {Array.from(notesByDate.values()).reduce(
                    (sum, arr) => sum + arr.length,
                    0
                  )}
                </p>
                <p className="hs-small !mb-0 text-muted-foreground/60">
                  已排程
                </p>
              </div>
              <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-3 text-center">
                <p className="hs-h3-lg !mb-0 text-cyan-400 tabular-nums">
                  {unscheduledNotes.length}
                </p>
                <p className="hs-small !mb-0 text-muted-foreground/60">
                  待排程
                </p>
              </div>
            </div>
          </GlassCard>

          <PhoneSubscribePanel />
        </div>
      </div>
    </div>
  );
}

// ─── Phone Subscribe Panel ─────────────────────────────────────────────────
// Shows the user's ICS feed URL so phones (Apple Calendar, Google Calendar,
// Outlook) can subscribe — the feed includes VALARM blocks so phone alarms
// fire automatically.

function PhoneSubscribePanel() {
  const utils = trpc.useUtils();
  const feedQuery = trpc.schedule.icsFeed.useQuery();
  const rotate = trpc.schedule.rotateIcsFeed.useMutation({
    onSuccess: () => {
      utils.schedule.icsFeed.invalidate();
      toast.success("已重設訂閱連結，舊連結將失效");
    },
  });

  const url = feedQuery.data?.url;
  const fullUrl = useMemo(() => {
    if (!url) return "";
    if (typeof window === "undefined") return url;
    return new URL(url, window.location.origin).toString();
  }, [url]);

  // Most phone calendars accept the `webcal://` scheme to add a subscription
  // straight from a tap; fall back to https for desktop users.
  const webcalUrl = useMemo(() => {
    if (!fullUrl) return "";
    return fullUrl.replace(/^https?:\/\//, "webcal://");
  }, [fullUrl]);

  return (
    <GlassCard>
      <h3 className="hs-h3 !mb-0 text-foreground flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-emerald-400" />
        手機日曆 / 鬧鐘訂閱
      </h3>
      <p className="hs-small !mb-3 text-muted-foreground/60">
        把這條連結加進 Apple Calendar、Google Calendar 或 Outlook，所有排程會自動同步並依「提醒時間」響鬧鐘。
      </p>

      {feedQuery.isLoading ? (
        <div className="h-9 rounded-md bg-white/5 animate-pulse" />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={fullUrl}
              className="bg-white/5 border-white/10 text-[11px] font-mono"
              onFocus={e => e.currentTarget.select()}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-9 px-2 shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(fullUrl);
                toast.success("已複製訂閱連結");
              }}
              title="複製連結"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
              onClick={() => {
                if (webcalUrl) window.location.href = webcalUrl;
              }}
            >
              <Smartphone className="w-3 h-3" />
              一鍵加入手機日曆
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1.5 text-muted-foreground"
              onClick={() => {
                if (
                  window.confirm(
                    "重設後，舊的手機訂閱連結會失效，需要重新加入。確定？"
                  )
                ) {
                  rotate.mutate();
                }
              }}
              disabled={rotate.isPending}
              title="重設訂閱連結"
            >
              <RefreshCw className="w-3 h-3" />
              重設
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/40">
            iPhone：點上方按鈕 → 同意「訂閱行事曆」。Android：複製連結 → Google 行事曆 → 從網址新增。
          </p>
        </div>
      )}
    </GlassCard>
  );
}
