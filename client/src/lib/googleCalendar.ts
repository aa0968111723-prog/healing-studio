/**
 * googleCalendar.ts — Google Calendar URL builder
 *
 * Generates pre-filled Google Calendar event creation URLs.
 * No additional OAuth scopes or server-side changes required.
 *
 * Reference: https://github.com/nicoleahmed/google-calendar-link-generator
 */

export interface GoogleCalendarEventParams {
  title: string;
  description?: string;
  /** The scheduled date for the event */
  date: Date;
  /** Duration in minutes (default: 60) */
  durationMinutes?: number;
  /** Whether this is an all-day event (default: true) */
  allDay?: boolean;
}

/**
 * Format a Date to Google Calendar's date-only format: YYYYMMDD
 */
function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Format a Date to Google Calendar's datetime format: YYYYMMDDTHHmmSSZ
 */
function formatDateTime(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Build a Google Calendar "add event" URL.
 *
 * Opens the user's Google Calendar in a new tab with the event
 * pre-filled. The user confirms and saves it themselves.
 */
export function buildGoogleCalendarUrl(
  params: GoogleCalendarEventParams
): string {
  const {
    title,
    description,
    date,
    durationMinutes = 60,
    allDay = true,
  } = params;

  const url = new URL("https://www.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);

  if (description) {
    url.searchParams.set("details", description);
  }

  if (allDay) {
    // All-day events use date-only format with end = start + 1 day
    const startStr = formatDateOnly(date);
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    const endStr = formatDateOnly(endDate);
    url.searchParams.set("dates", `${startStr}/${endStr}`);
  } else {
    // Timed events use full datetime format
    const startStr = formatDateTime(date);
    const endDate = new Date(date.getTime() + durationMinutes * 60 * 1000);
    const endStr = formatDateTime(endDate);
    url.searchParams.set("dates", `${startStr}/${endStr}`);
  }

  return url.toString();
}

/**
 * Open a Google Calendar event creation page in a new tab.
 */
export function openGoogleCalendar(params: GoogleCalendarEventParams): void {
  const url = buildGoogleCalendarUrl(params);
  window.open(url, "_blank", "noopener,noreferrer");
}
