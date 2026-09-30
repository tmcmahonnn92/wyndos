import Link from "next/link";
import { AlertCircle, CalendarDays, CreditCard } from "lucide-react";
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
      href: null,
      links: summary.overdueAreas.items.map((area) => ({ href: `/scheduler?area=${area.id}`, label: `${area.name} · ${fmtDate(area.dueDate)}` })),
      detail: "No overdue areas right now.",
    },
    {
      title: "Runs Waiting",
      icon: AlertCircle,
      count: summary.unfinishedRuns.count,
      accent: "text-amber-600",
      href: null,
      links: summary.unfinishedRuns.items.map((day) => ({ href: `/days/${day.id}`, label: `${day.name} · ${fmtDate(day.date)} · ${day.reason}` })),
      detail: "Every run's parts are done. Next visits are booked.",
    },
    {
      title: "Holiday Conflicts",
      icon: CalendarDays,
      count: summary.holidayConflicts.count,
      accent: "text-amber-600",
      href: null,
      links: summary.holidayConflicts.items.map((day) => ({ href: `/scheduler?day=${day.id}`, label: `${day.name} · ${fmtDate(day.date)}` })),
      detail: "No scheduled work is landing on a holiday.",
    },
    {
      title: "Customers Owing",
      icon: CreditCard,
      count: summary.customersOwing.count,
      accent: "text-blue-600",
      href: "/payments",
      links: [] as Array<{ href: string; label: string }>,
      detail: summary.customersOwing.count > 0
        ? `${summary.customersOwing.count} customer${summary.customersOwing.count === 1 ? "" : "s"} owe ${fmtCurrency(summary.customersOwing.totalAmount)}.`
        : "No customer debt at the moment.",
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
                {card.links.length > 0 ? (
                  <ul className="space-y-1">
                    {card.links.map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="block rounded-md px-1.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
                          {link.label} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="whitespace-pre-line text-xs text-slate-500">{card.detail}</p>
                )}
                {card.href && (
                  <Link href={card.href} className="text-xs font-semibold text-blue-600 hover:underline">
                    Open →
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </aside>
  );
}