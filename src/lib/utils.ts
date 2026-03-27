import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isToday, isTomorrow, isPast } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Calculate next due date from completion date + frequency weeks */
export function calcNextDue(completedAt: Date, frequencyWeeks: number): Date {
  const base = new Date(Date.UTC(
    completedAt.getUTCFullYear(),
    completedAt.getUTCMonth(),
    completedAt.getUTCDate()
  ));
  return new Date(base.getTime() + frequencyWeeks * 7 * 86_400_000);
}

/** Format a date for display */
export function fmtDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE d MMM yyyy");
}

export function fmtShortDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "d MMM");
}

export function fmtCurrency(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

export function isOverdue(date: Date | string | null): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return isPast(d) && !isToday(d);
}

export function isDueToday(date: Date | string | null): boolean {
  if (!date) return false;
  const d = typeof date === "string" ? new Date(date) : date;
  return isToday(d);
}

export function statusColor(status: string): string {
  switch (status) {
    case "COMPLETE":
      return "bg-green-100 text-green-800";
    case "PENDING":
      return "bg-blue-100 text-blue-800";
    case "SKIPPED":
      return "bg-gray-100 text-gray-600";
    case "MOVED":
      return "bg-yellow-100 text-yellow-800";
    case "OUTSTANDING":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function dayStatusColor(status: string): string {
  switch (status) {
    case "COMPLETE":
      return "bg-green-100 text-green-800 border-green-200";
    case "IN_PROGRESS":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "PLANNED":
      return "bg-slate-100 text-slate-700 border-slate-200";
    default:
      return "bg-slate-100 text-slate-600";
  }
}
