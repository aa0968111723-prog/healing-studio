import { useState, useMemo, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ZenCoPilot";
import { toast } from "sonner";
import {
  CalendarDays, Plus, Trash2, Clock, Image, Video, Music, Mic,
  ChevronLeft, ChevronRight, GripVertical, X, CheckCircle2, ExternalLink,
} from "lucide-react";
import { openGoogleCalendar } from "@/lib/googleCalendar";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";

// ─── Types ─────────────────────────────────────────────────────────────────

type CalendarNote = {
  id: number;
  title: string;
  content?: string | null;
  noteType: string;
  scheduledDate?: Date | string | null;
  createdAt: Date | string;
  tags?: string[] | null;
};

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
  compact = false,
}: {
  note: CalendarNote;
  onDelete: (id: number) => void;
  compact?: boolean;
}) {
  const typeColor =
    note.noteType === "calendar_event"
      ? "border-amber-500/30 bg-amber-500/10"
      : note.noteType === "script"
      ? "border-purple-500/30 bg-purple-500/10"
      : "border-cyan-500/30 bg-cyan-500/10";

  const handleAddToGoogleCalendar = (e: React.MouseEvent) => {
    e.stopPropagation();
    const eventDate = note.scheduledDate ? new Date(note.scheduledDate) : new Date();
    openGoogleCalendar({
      title: note.title,
      description: note.content ?? undefined,
      date: eventDate,
      allDay: true,
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
        compact ? "text-[10px]" : "text-xs"
      )}
      draggable
      onDragStart={(e: any) => {
        e.dataTransfer?.setData("text/plain", JSON.stringify({ noteId: note.id, title: note.title }));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0" />
          <span className="truncate font-medium text-foreground/80">{note.title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
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
            onClick={(e) => { e.stopPropagation(); onDelete(note.id); }}
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 transition-all"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>
      {!compact && note.content && (
        <p className="text-muted-foreground/60 line-clamp-1 mt-1 ml-4.5">{note.content}</p>
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
  const [addToGoogle, setAddToGoogle] = useState(false);

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      if (addToGoogle && title.trim()) {
        openGoogleCalendar({
          title: title.trim(),
          description: content.trim() || undefined,
          date,
          allDay: true,
        });
      }
      onCreated();
      onClose();
      toast.success(addToGoogle ? "排程已建立，已開啟 Google 日曆" : "排程已建立");
    },
    onError: (e) => toast.error(e.message),
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
        onChange={(e) => setTitle(e.target.value)}
        placeholder="排程標題"
        className="bg-white/5 border-white/10 text-sm"
      />

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="描述（選填）"
        rows={2}
        className="bg-white/5 border-white/10 text-xs resize-none"
      />

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={addToGoogle}
          onChange={(e) => setAddToGoogle(e.target.checked)}
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
            if (!title.trim()) { toast.error("請輸入標題"); return; }
            createNote.mutate({
              title: title.trim(),
              content: content.trim() || undefined,
              noteType: "calendar_event",
              scheduledDate: date.getTime(),
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

  // 全站新手引導
  usePageTour("calendar");

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [month, setMonth] = useState(new Date());

  // ── Drag state for calendar cell highlighting ──
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const dragCounterRef = useRef<Map<string, number>>(new Map());

  const notesQuery = trpc.notes.list.useQuery();
  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      notesQuery.refetch();
      toast.success("已刪除");
    },
  });

  const updateNote = trpc.notes.update.useMutation({
    onSuccess: (_data, variables) => {
      notesQuery.refetch();
      // Show a rich toast with the scheduled date
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

  // Unscheduled notes (available for drag)
  const unscheduledNotes = useMemo(() => {
    return (notesQuery.data || []).filter((n: CalendarNote) => !n.scheduledDate);
  }, [notesQuery.data]);

  // Dates that have events (for calendar dot indicators)
  const eventDates = useMemo(() => {
    return Array.from(notesByDate.keys()).map(d => new Date(d));
  }, [notesByDate]);

  // Handle drop on calendar date
  const handleDrop = useCallback((e: React.DragEvent, date: Date) => {
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
  }, [updateNote]);

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

  const handleCellDragEnter = useCallback((e: React.DragEvent) => {
    const date = getDateFromTarget(e.target);
    if (date) {
      const key = date.toDateString();
      const counter = dragCounterRef.current.get(key) || 0;
      dragCounterRef.current.set(key, counter + 1);
      setDragOverDate(key);
    }
  }, [getDateFromTarget]);

  const handleCellDragLeave = useCallback((e: React.DragEvent) => {
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
  }, [dragOverDate]);

  const handleCellDrop = useCallback((e: React.DragEvent) => {
    const date = getDateFromTarget(e.target);
    if (date) {
      handleDrop(e, date);
    }
  }, [getDateFromTarget, handleDrop]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <VisualSoul size="sm" state="idle" personality={personality} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">創作排程</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              拖曳筆記到日曆上安排創作時程
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { const t = new Date(); setSelectedDate(t); setMonth(t); }}
            className="gap-1.5 text-xs"
          >
            今天
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
              onSelect={setSelectedDate}
              month={month}
              onMonthChange={setMonth}
              modifiers={{ hasEvent: eventDates }}
              modifiersClassNames={{
                hasEvent: "relative after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-amber-400",
              }}
              className="w-full"
              classNames={{
                day: cn(
                  "relative w-full h-full p-0 text-center group/day aspect-square select-none transition-all duration-200",
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
                        isDragTarget && "ring-2 ring-amber-400 bg-amber-400/20 scale-110 shadow-lg shadow-amber-400/30 rounded-lg",
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

          {/* Selected Date Events */}
          {selectedDate && (
            <div className="mt-4 pt-4 border-t border-border/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  {selectedDate.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}
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
                          const eventDate = note.scheduledDate ? new Date(note.scheduledDate) : selectedDate;
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
                            .map((n, i) => `${i + 1}. ${n.title}${n.content ? `\n   ${n.content}` : ""}`)
                            .join("\n\n");
                          openGoogleCalendar({
                            title: combinedTitle,
                            description: combinedDescription,
                            date: selectedDate,
                            allDay: true,
                          });
                          toast.success(`已將 ${selectedDateEvents.length} 個排程匯出至 Google 日曆`);
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
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-amber-400/40", "bg-amber-500/5"); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove("border-amber-400/40", "bg-amber-500/5"); }}
                onDrop={(e) => { e.currentTarget.classList.remove("border-amber-400/40", "bg-amber-500/5"); handleDrop(e, selectedDate); }}
              >
                {selectedDateEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground/40 text-center py-4">
                    拖曳筆記到此處排程，或點擊「新增排程」
                  </p>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {selectedDateEvents.map((note: CalendarNote) => (
                      <EventCard
                        key={note.id}
                        note={note}
                        onDelete={(id) => deleteNote.mutate({ id })}
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
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-cyan-400" />
              待排程筆記
            </h3>
            <p className="text-[10px] text-muted-foreground/50 mb-3">
              拖曳以下筆記到日曆上的日期
            </p>

            {notesQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : unscheduledNotes.length === 0 ? (
              <div className="text-center py-6">
                <CalendarDays className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground/40">所有筆記已排程</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                <AnimatePresence mode="popLayout">
                  {unscheduledNotes.map((note: CalendarNote) => (
                    <EventCard
                      key={note.id}
                      note={note}
                      onDelete={(id) => deleteNote.mutate({ id })}
                      compact
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </GlassCard>

          {/* Quick Stats */}
          <GlassCard>
            <h3 className="text-sm font-medium text-foreground mb-3">排程統計</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                <p className="text-lg font-semibold text-amber-400 tabular-nums">
                  {Array.from(notesByDate.values()).reduce((sum, arr) => sum + arr.length, 0)}
                </p>
                <p className="text-[10px] text-muted-foreground/60">已排程</p>
              </div>
              <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-3 text-center">
                <p className="text-lg font-semibold text-cyan-400 tabular-nums">
                  {unscheduledNotes.length}
                </p>
                <p className="text-[10px] text-muted-foreground/60">待排程</p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
