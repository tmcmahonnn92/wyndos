import Link from "next/link";
import { AlertCircle, BellRing, CalendarDays, CreditCard, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { getSchedulerTodoSummary } from "@/lib/actions";

type SchedulerTodoSummary = Awaited<ReturnType<typeof getSchedulerTodoSummary>>;

export function SchedulerTodoPanel({ summary }: { summary: SchedulerTodoSummary }) {
  const cards = [
    {
      title: "Areas Overdue",
      icon: AlertCircle,
      count: summary.overdueAreas.count,
      accent: "text-red-600",
      href: "/scheduler",
      detail: summary.overdueAreas.count > 0
        ? summary.overdueAreas.items.map((area) => `${area.name} · ${fmtDate(area.dueDate)}`).join("\n")
        : "No overdue areas right now.",
    },
    {
      title: "Holiday Conflicts",
      icon: CalendarDays,
      count: summary.holidayConflicts.count,
      accent: "text-amber-600",
      href: "/scheduler",
      detail: summary.holidayConflicts.count > 0
        ? summary.holidayConflicts.items.map((day) => `${day.name} · ${fmtDate(day.date)}`).join("\n")
        : "No scheduled work is landing on a holiday.",
    },
    {
      title: "Customers Owing",
      icon: CreditCard,
      count: summary.customersOwing.count,
      accent: "text-blue-600",
      href: "/payments",
      detail: summary.customersOwing.count > 0
        ? `${summary.customersOwing.count} customer${summary.customersOwing.count === 1 ? "" : "s"} owe ${fmtCurrency(summary.customersOwing.totalAmount)}.`
        : "No customer debt at the moment.",
    },
    {
      title: "Reminders Due",
      icon: BellRing,
      count: summary.reminderCustomers.count,
      accent: "text-emerald-600",
      href: "/payments",
      detail: summary.reminderCustomers.count > 0
        ? `${summary.reminderCustomers.count} customer${summary.reminderCustomers.count === 1 ? "" : "s"} need advance notice soon.`
        : "No advance notice reminders are due today.",
    },
    {
      title: "Outstanding Visits",
      icon: RotateCcw,
      count: summary.outstandingVisits.count,
      accent: "text-violet-600",
      href: "/outstanding",
      detail: summary.outstandingVisits.count > 0
        ? `${summary.outstandingVisits.count} visit${summary.outstandingVisits.count === 1 ? " is" : "s are"} marked outstanding.`
        : "No outstanding visits right now.",
    },
  ];

  return (
    <aside className="hidden md:block border-l border-slate-200 bg-slate-50/80 px-4 py-5 overflow-y-auto">
      <div className="sticky top-0 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-slate-800">Scheduler To-Do</h2>
          <p className="text-xs text-slate-500 mt-0.5">Quick checks that need attention while planning the round.</p>
        </div>

        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <Icon size={15} className={card.accent} />
                    {card.title}
                  </span>
                  <span className={`text-lg font-bold ${card.accent}`}>{card.count}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="whitespace-pre-line text-xs text-slate-500">{card.detail}</p>
                <Link href={card.href} className="text-xs font-semibold text-blue-600 hover:underline">
                  Open →
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </aside>
  );
}