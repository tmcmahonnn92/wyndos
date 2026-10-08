"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Loader2, Pencil, Plus, Receipt, TrendingDown, TrendingUp, Trash2, Upload, Wallet, X } from "lucide-react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { lockedReason } from "@/lib/mtd/actions";
import { updateOtherIncome, type getAccountingMonth, createExpense, createOtherIncome, deleteExpense, deleteOtherIncome, updateExpense } from "@/lib/actions";
import type { ExpenseCategoryDefinition, OtherIncomeCategoryDefinition, TaxTreatmentDefinition } from "@/lib/accounting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtCurrency } from "@/lib/utils";

type MonthlySummary = {
  monthKey: string;
  monthLabel: string;
  income: number;
  incomeVat: number;
  expenses: number;
  expenseVat: number;
  net: number;
  paymentCount: number;
  expenseCount: number;
  categoryBreakdown: Record<string, number>;
};

type RecentExpense = {
  id: number;
  category: string;
  categoryLabel: string;
  hmrcLabel: string;
  supplier: string;
  amount: number;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  taxTreatment: string;
  taxTreatmentLabel: string;
  expenseDate: string | Date;
  notes: string | null;
  isRecurring: boolean;
  recurrenceTemplateId?: number | null;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  nextScheduledAt?: string | Date | null;
  businessPct?: number;
  vehicleId?: number | null;
};

type RecentPayment = {
  id: number;
  amount: number;
  paidAt: string | Date;
  method: string;
  customer: { id: number; name: string };
  sourceLabel: string;
  sourceType: "PAYMENT";
};

type RecentOtherIncome = {
  id: number;
  category: string;
  categoryLabel: string;
  source: string;
  sourceLabel: string;
  amount: number;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  taxTreatment: string;
  taxTreatmentLabel: string;
  receivedAt: string | Date;
  notes: string | null;
  isRecurring: boolean;
  recurrenceTemplateId?: number | null;
  repeatEvery?: number | null;
  repeatUnit?: string | null;
  nextScheduledAt?: string | Date | null;
  sourceType: "OTHER_INCOME";
};

type TaxYearOption = { value: number; label: string };
type MonthViewData = Awaited<ReturnType<typeof getAccountingMonth>>;
type RepeatUnit = "DAY" | "WEEK" | "MONTH" | "YEAR";
type QuickAddMode = "expense" | "income";

const REPEAT_UNIT_OPTIONS: Array<{ value: RepeatUnit; label: string }> = [
  { value: "DAY", label: "days" },
  { value: "WEEK", label: "weeks" },
  { value: "MONTH", label: "months" },
  { value: "YEAR", label: "years" },
];

function toCsvValue(value: string | number) {
  let raw = String(value ?? "");
  // Stop Excel treating text as a formula (=, +, -, @).
  if (/^[=+\-@\t\r]/.test(raw) && !/^-?\d+(\.\d+)?$/.test(raw)) raw = `'${raw}`;
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function defaultDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatRepeatSummary(entry: { isRecurring: boolean; repeatEvery?: number | null; repeatUnit?: string | null; nextScheduledAt?: string | Date | null }) {
  if (!entry.isRecurring || !entry.repeatEvery || !entry.repeatUnit) return null;
  const unitLabel = REPEAT_UNIT_OPTIONS.find((option) => option.value === entry.repeatUnit)?.label ?? entry.repeatUnit.toLowerCase();
  const nextDate = entry.nextScheduledAt ? new Date(entry.nextScheduledAt).toLocaleDateString("en-GB") : null;
  return `Every ${entry.repeatEvery} ${unitLabel}${nextDate ? ` · next ${nextDate}` : ""}`;
}

type ScheduleFormState = {
  isRecurring: boolean;
  repeatEvery: string;
  repeatUnit: RepeatUnit;
  repeatAnchorDate: string;
  repeatEndsAt: string;
};

function RecurringFields({
  form,
  onChange,
  noun,
}: {
  form: ScheduleFormState;
  onChange: (patch: Partial<ScheduleFormState>) => void;
  noun: string;
}) {
  return (
    <>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.isRecurring} onChange={(event) => onChange({ isRecurring: event.target.checked })} />
        Repeat this {noun}
      </label>
      {form.isRecurring && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Repeat every</label>
            <input type="number" min="1" value={form.repeatEvery} onChange={(event) => onChange({ repeatEvery: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Unit</label>
            <select value={form.repeatUnit} onChange={(event) => onChange({ repeatUnit: event.target.value as RepeatUnit })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              {REPEAT_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Anchor date</label>
            <input type="date" value={form.repeatAnchorDate} onChange={(event) => onChange({ repeatAnchorDate: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Optional end date</label>
            <input type="date" value={form.repeatEndsAt} onChange={(event) => onChange({ repeatEndsAt: event.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
          </div>
        </div>
      )}
    </>
  );
}

export function AccountingClient({
  openingFigures,
  monthlySummaries,
  recentExpenses,
  recentPayments,
  recentOtherIncome,
  totals,
  expenseCategories,
  otherIncomeCategories,
  taxTreatmentOptions,
  selectedTaxYearStart,
  selectedTaxYearLabel,
  activeDateFrom,
  activeDateTo,
  availableTaxYears,
  exportGeneratedAt,
  initialAction,
  monthView,
  vehicles = [],
}: {
  monthlySummaries: MonthlySummary[];
  recentExpenses: RecentExpense[];
  recentPayments: RecentPayment[];
  recentOtherIncome: RecentOtherIncome[];
  totals: { income: number; expenses: number; net: number; incomeVat: number; expenseVat: number };
  expenseCategories: ExpenseCategoryDefinition[];
  otherIncomeCategories: OtherIncomeCategoryDefinition[];
  taxTreatmentOptions: TaxTreatmentDefinition[];
  selectedTaxYearStart: number;
  selectedTaxYearLabel: string;
  activeDateFrom: string;
  activeDateTo: string;
  availableTaxYears: TaxYearOption[];
  exportGeneratedAt: string;
  initialAction?: string | null;
  openingFigures?: React.ReactNode;
  monthView: MonthViewData;
  vehicles?: Array<{ id: number; name: string; method: string; businessPct: number }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>("expense");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [editingIncomeId, setEditingIncomeId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState({ start: activeDateFrom, end: activeDateTo });
  const [expenseForm, setExpenseForm] = useState({
    businessPct: "100",
    vehicleId: "",
    category: "",
    supplier: "",
    amount: "",
    taxTreatment: taxTreatmentOptions[0]?.value ?? "NO_VAT",
    expenseDate: defaultDateString(),
    notes: "",
    isRecurring: false,
    repeatEvery: "1",
    repeatUnit: "MONTH" as RepeatUnit,
    repeatAnchorDate: defaultDateString(),
    repeatEndsAt: "",
  });
  const [incomeForm, setIncomeForm] = useState({
    category: otherIncomeCategories[0]?.value ?? "OTHER",
    source: "",
    amount: "",
    taxTreatment: taxTreatmentOptions[0]?.value ?? "NO_VAT",
    receivedAt: defaultDateString(),
    notes: "",
    isRecurring: false,
    repeatEvery: "1",
    repeatUnit: "MONTH" as RepeatUnit,
    repeatAnchorDate: defaultDateString(),
    repeatEndsAt: "",
  });

  useEffect(() => {
    setFormError(null);
    setFormSuccess(null);
  }, [quickAddMode, quickAddOpen]);

  useEffect(() => {
    setDateRange({ start: activeDateFrom, end: activeDateTo });
  }, [activeDateFrom, activeDateTo]);

  useEffect(() => {
    if (initialAction === "new-expense") {
      setQuickAddMode("expense");
      setQuickAddOpen(true);
    }
    if (initialAction === "new-income") {
      setQuickAddMode("income");
      setQuickAddOpen(true);
    }
  }, [initialAction]);

  const updateTaxYear = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taxYear", String(value));
    router.push(`${pathname}?${params.toString()}`);
  };

  const applyDateRange = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("taxYear", String(selectedTaxYearStart));
    if (dateRange.start) params.set("start", dateRange.start);
    else params.delete("start");
    if (dateRange.end) params.set("end", dateRange.end);
    else params.delete("end");
    router.push(`${pathname}?${params.toString()}`);
  };

  const clearDateRange = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("start");
    params.delete("end");
    router.push(`${pathname}?${params.toString()}`);
  };

  const exportMonthlySummary = () => {
    downloadCsv(`accounting-tax-year-${selectedTaxYearStart}-summary.csv`, [
      ["Tax Year", selectedTaxYearLabel],
      ["Date Range", `${activeDateFrom} to ${activeDateTo}`],
      ["Month", "Income", "Income VAT", "Expenses", "Expense VAT", "Net", "Income Entries", "Expense Entries"],
      ...monthlySummaries.map((month) => [month.monthLabel, month.income.toFixed(2), month.incomeVat.toFixed(2), month.expenses.toFixed(2), month.expenseVat.toFixed(2), month.net.toFixed(2), month.paymentCount, month.expenseCount]),
    ]);
  };

  const exportExpenses = () => {
    downloadCsv(`accounting-tax-year-${selectedTaxYearStart}-expenses.csv`, [
      ["Tax Year", selectedTaxYearLabel],
      ["Date Range", `${activeDateFrom} to ${activeDateTo}`],
      ["Date", "Supplier", "Category", "HMRC Category", "Gross Amount", "Net Amount", "VAT Amount", "VAT Rate", "Tax Treatment", "Recurring", "Repeat Every", "Repeat Unit", "Notes", "Generated At"],
      ...recentExpenses.map((expense) => [
        new Date(expense.expenseDate).toISOString().slice(0, 10),
        expense.supplier,
        expense.categoryLabel,
        expense.hmrcLabel,
        expense.amount.toFixed(2),
        expense.netAmount.toFixed(2),
        expense.vatAmount.toFixed(2),
        expense.vatRate.toFixed(2),
        expense.taxTreatmentLabel,
        expense.isRecurring ? "Yes" : "No",
        expense.repeatEvery ?? "",
        expense.repeatUnit ?? "",
        expense.notes ?? "",
        exportGeneratedAt,
      ]),
    ]);
  };

  const submitExpense = () => {
    if (!expenseForm.category) {
      setFormError("Please select a category.");
      return;
    }
    const amount = Number(expenseForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an expense amount above zero.");
      return;
    }
    startTransition(async () => {
      try {
        { const why = await lockedReason([expenseForm.expenseDate]); if (why) { setFormError(why); return; } }
        await createExpense({
          category: expenseForm.category,
          supplier: expenseForm.supplier,
          amount,
          businessPct: Number(expenseForm.businessPct) || 0,
          vehicleId: expenseForm.vehicleId ? Number(expenseForm.vehicleId) : null,
          taxTreatment: expenseForm.taxTreatment,
          expenseDate: new Date(expenseForm.expenseDate),
          notes: expenseForm.notes,
          isRecurring: expenseForm.isRecurring,
          repeatEvery: expenseForm.isRecurring ? Number(expenseForm.repeatEvery) : null,
          repeatUnit: expenseForm.isRecurring ? expenseForm.repeatUnit : null,
          repeatAnchorDate: expenseForm.isRecurring ? new Date(expenseForm.repeatAnchorDate) : null,
          repeatEndsAt: expenseForm.isRecurring && expenseForm.repeatEndsAt ? new Date(expenseForm.repeatEndsAt) : null,
        });
        setExpenseForm(blankExpense());
        setFormSuccess("Expense saved.");
        setQuickAddOpen(false);
        setEditingExpenseId(null);
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save the expense.");
      }
    });
  };

  const submitOtherIncome = () => {
    const amount = Number(incomeForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an income amount above zero.");
      return;
    }
    startTransition(async () => {
      try {
        { const why = await lockedReason([incomeForm.receivedAt]); if (why) { setFormError(why); return; } }
        await createOtherIncome({
          category: incomeForm.category,
          source: incomeForm.source,
          amount,
          taxTreatment: incomeForm.taxTreatment,
          receivedAt: new Date(incomeForm.receivedAt),
          notes: incomeForm.notes,
          isRecurring: incomeForm.isRecurring,
          repeatEvery: incomeForm.isRecurring ? Number(incomeForm.repeatEvery) : null,
          repeatUnit: incomeForm.isRecurring ? incomeForm.repeatUnit : null,
          repeatAnchorDate: incomeForm.isRecurring ? new Date(incomeForm.repeatAnchorDate) : null,
          repeatEndsAt: incomeForm.isRecurring && incomeForm.repeatEndsAt ? new Date(incomeForm.repeatEndsAt) : null,
        });
        setIncomeForm({
          category: otherIncomeCategories[0]?.value ?? "OTHER",
          source: "",
          amount: "",
          taxTreatment: taxTreatmentOptions[0]?.value ?? "NO_VAT",
          receivedAt: defaultDateString(),
          notes: "",
          isRecurring: false,
          repeatEvery: "1",
          repeatUnit: "MONTH",
          repeatAnchorDate: defaultDateString(),
          repeatEndsAt: "",
        });
        setFormSuccess("Income saved.");
        setQuickAddOpen(false);
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save the income entry.");
      }
    });
  };

  const removeExpense = (expenseId: number) => {
    if (!window.confirm("Delete this expense entry?")) return;
    setDeletingEntryId(`expense-${expenseId}`);
    startTransition(async () => {
      try {
        const found = [...recentExpenses, ...monthView.expenses].find((e) => e.id === expenseId);
        if (found) { const why = await lockedReason([new Date(found.expenseDate).toISOString().slice(0, 10)]); if (why) { setFormError(why); return; } }
        await deleteExpense(expenseId);
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not delete the expense.");
      } finally {
        setDeletingEntryId(null);
      }
    });
  };

  const removeOtherIncome = (incomeId: number) => {
    if (!window.confirm("Delete this income entry?")) return;
    setDeletingEntryId(`income-${incomeId}`);
    startTransition(async () => {
      try {
        const found = [...recentOtherIncome, ...monthView.otherIncome].find((e) => e.id === incomeId);
        if (found) { const why = await lockedReason([new Date(found.receivedAt).toISOString().slice(0, 10)]); if (why) { setFormError(why); return; } }
        await deleteOtherIncome(incomeId);
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not delete the income entry.");
      } finally {
        setDeletingEntryId(null);
      }
    });
  };

  const mergedIncome = [...recentOtherIncome, ...recentPayments]
    .sort((a, b) => new Date("receivedAt" in a ? a.receivedAt : a.paidAt).getTime() - new Date("receivedAt" in b ? b.receivedAt : b.paidAt).getTime())
    .reverse()
    .slice(0, 30);

  const openEditExpense = (expense: RecentExpense) => {
    setEditingExpenseId(expense.id);
    setExpenseForm({
      businessPct: String(expense.businessPct ?? 100),
      vehicleId: expense.vehicleId ? String(expense.vehicleId) : "",
      category: expense.category,
      supplier: expense.supplier,
      amount: String(expense.amount),
      taxTreatment: expense.taxTreatment,
      expenseDate: new Date(expense.expenseDate).toISOString().slice(0, 10),
      notes: expense.notes ?? "",
      isRecurring: expense.isRecurring,
      repeatEvery: String(expense.repeatEvery ?? "1"),
      repeatUnit: (expense.repeatUnit ?? "MONTH") as RepeatUnit,
      repeatAnchorDate: defaultDateString(),
      repeatEndsAt: "",
    });
    setQuickAddMode("expense");
    setQuickAddOpen(true);
  };

  const submitEditExpense = () => {
    if (!editingExpenseId) return;
    if (!expenseForm.category) {
      setFormError("Please select a category.");
      return;
    }
    const amount = Number(expenseForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an expense amount above zero.");
      return;
    }
    startTransition(async () => {
      try {
        { const why = await lockedReason([expenseForm.expenseDate, recentExpenses.find((e) => e.id === editingExpenseId)?.expenseDate ? new Date(recentExpenses.find((e) => e.id === editingExpenseId)!.expenseDate).toISOString().slice(0, 10) : expenseForm.expenseDate]); if (why) { setFormError(why); return; } }
        await updateExpense(editingExpenseId, {
          category: expenseForm.category,
          supplier: expenseForm.supplier,
          amount,
          businessPct: Number(expenseForm.businessPct) || 0,
          vehicleId: expenseForm.vehicleId ? Number(expenseForm.vehicleId) : null,
          taxTreatment: expenseForm.taxTreatment,
          expenseDate: new Date(expenseForm.expenseDate),
          notes: expenseForm.notes,
        });
        setFormSuccess("Expense updated.");
        setEditingExpenseId(null);
        setQuickAddOpen(false);
        setExpenseForm(blankExpense());
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not update the expense.");
      }
    });
  };

  const blankIncome = () => ({
    category: otherIncomeCategories[0]?.value ?? "OTHER", source: "", amount: "", taxTreatment: taxTreatmentOptions[0]?.value ?? "NO_VAT",
    receivedAt: defaultDateString(), notes: "", isRecurring: false, repeatEvery: "1", repeatUnit: "MONTH" as RepeatUnit, repeatAnchorDate: defaultDateString(), repeatEndsAt: "",
  });
  const blankExpense = () => ({
    businessPct: "100", vehicleId: "",
    category: "", supplier: "", amount: "", taxTreatment: taxTreatmentOptions[0]?.value ?? "NO_VAT",
    expenseDate: defaultDateString(), notes: "", isRecurring: false, repeatEvery: "1", repeatUnit: "MONTH" as RepeatUnit, repeatAnchorDate: defaultDateString(), repeatEndsAt: "",
  });
  /** Show the add/edit form: the side panel on wide screens, the sheet on phones. */
  const showForm = () => {
    setQuickAddOpen(true);
    setTimeout(() => document.getElementById("quick-add")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  /** New entry from the month view, dated in that month (today if it's this month). */
  const addFromMonth = (mode: QuickAddMode, month: string) => {
    const today = defaultDateString();
    const date = today.startsWith(month) ? today : `${month}-01`;
    setEditingExpenseId(null);
    setEditingIncomeId(null);
    if (mode === "expense") setExpenseForm({ ...blankExpense(), expenseDate: date });
    else setIncomeForm({ ...blankIncome(), receivedAt: date });
    setQuickAddMode(mode);
    showForm();
  };
  const openEditIncome = (entry: RecentOtherIncome) => {
    setEditingExpenseId(null);
    setEditingIncomeId(entry.id);
    setIncomeForm({
      ...blankIncome(),
      category: entry.category, source: entry.source, amount: String(entry.amount), taxTreatment: entry.taxTreatment,
      receivedAt: new Date(entry.receivedAt).toISOString().slice(0, 10), notes: entry.notes ?? "",
    });
    setQuickAddMode("income");
    showForm();
  };
  const submitEditIncome = () => {
    if (!editingIncomeId) return;
    const amount = Number(incomeForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setFormError("Enter an income amount above zero."); return; }
    startTransition(async () => {
      try {
        { const why = await lockedReason([incomeForm.receivedAt]); if (why) { setFormError(why); return; } }
        await updateOtherIncome(editingIncomeId, {
          category: incomeForm.category, source: incomeForm.source, amount, taxTreatment: incomeForm.taxTreatment,
          receivedAt: new Date(incomeForm.receivedAt), notes: incomeForm.notes,
        });
        setFormSuccess("Income updated.");
        setEditingIncomeId(null);
        setQuickAddOpen(false);
        setIncomeForm(blankIncome());
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not update the income entry.");
      }
    });
  };
  const goToMonth = (month: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", month);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const quickAddPanel = (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button type="button" onClick={() => setQuickAddMode("expense")} className={cn("flex-1 rounded-lg px-3 py-2 text-sm font-medium", quickAddMode === "expense" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>Expense</button>
        <button type="button" onClick={() => setQuickAddMode("income")} className={cn("flex-1 rounded-lg px-3 py-2 text-sm font-medium", quickAddMode === "income" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}>Other income</button>
      </div>

      {quickAddMode === "expense" ? (
        <div className="space-y-3">
          {/* ── Expense fields ── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Category</label>
              <select value={expenseForm.category} onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))} className={cn("w-full rounded-lg border px-3 py-2 text-sm", expenseForm.category ? "border-slate-200" : "border-slate-200 text-slate-400")}><option value="" disabled>Select a category…</option>{expenseCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
              <input type="date" value={expenseForm.expenseDate} onChange={(event) => setExpenseForm((prev) => ({ ...prev, expenseDate: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Supplier</label>
              <input type="text" value={expenseForm.supplier} onChange={(event) => setExpenseForm((prev) => ({ ...prev, supplier: event.target.value }))} placeholder="e.g. Screwfix" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Amount (£)</label>
              <input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Business use %</label>
              <input type="number" min="0" max="100" step="1" value={expenseForm.businessPct} onChange={(event) => setExpenseForm((prev) => ({ ...prev, businessPct: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <p className="mt-0.5 text-[11px] text-slate-400">Under 100 if partly personal (e.g. phone 70%).</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Vehicle</label>
              <select value={expenseForm.vehicleId} onChange={(event) => { const v = vehicles.find((x) => String(x.id) === event.target.value); setExpenseForm((prev) => ({ ...prev, vehicleId: event.target.value, businessPct: v && v.method === "ACTUAL" ? String(v.businessPct) : prev.businessPct })); }} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">Not for a vehicle</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.method === "MILEAGE" ? " (mileage rate)" : ` (${v.businessPct}% business)`}</option>)}
              </select>
              {vehicles.find((x) => String(x.id) === expenseForm.vehicleId)?.method === "MILEAGE" && ["FUEL", "VEHICLE_MAINTENANCE", "VEHICLE_COSTS"].includes(expenseForm.category) && <p className="mt-0.5 text-[11px] text-amber-700">This vehicle uses the mileage rate, so this cost isn&apos;t claimed (parking and tolls still are).</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">Tax / VAT treatment</label>
              <select value={expenseForm.taxTreatment} onChange={(event) => setExpenseForm((prev) => ({ ...prev, taxTreatment: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">{taxTreatmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
            <textarea value={expenseForm.notes} onChange={(event) => setExpenseForm((prev) => ({ ...prev, notes: event.target.value }))} rows={2} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <RecurringFields form={expenseForm} onChange={(patch) => setExpenseForm((prev) => ({ ...prev, ...patch }))} noun="expense" />
          <button type="button" onClick={editingExpenseId ? submitEditExpense : submitExpense} disabled={isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{isPending ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}{editingExpenseId ? "Update expense" : "Save expense"}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Income type</label>
              <select value={incomeForm.category} onChange={(event) => setIncomeForm((prev) => ({ ...prev, category: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">{otherIncomeCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
              <input type="date" value={incomeForm.receivedAt} onChange={(event) => setIncomeForm((prev) => ({ ...prev, receivedAt: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Source</label>
              <input type="text" value={incomeForm.source} onChange={(event) => setIncomeForm((prev) => ({ ...prev, source: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Amount</label>
              <input type="number" min="0" step="0.01" value={incomeForm.amount} onChange={(event) => setIncomeForm((prev) => ({ ...prev, amount: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">Tax / VAT treatment</label>
              <select value={incomeForm.taxTreatment} onChange={(event) => setIncomeForm((prev) => ({ ...prev, taxTreatment: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">{taxTreatmentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
            <textarea value={incomeForm.notes} onChange={(event) => setIncomeForm((prev) => ({ ...prev, notes: event.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          {!editingIncomeId && <RecurringFields form={incomeForm} onChange={(patch) => setIncomeForm((prev) => ({ ...prev, ...patch }))} noun="income" />}
          <button type="button" onClick={editingIncomeId ? submitEditIncome : submitOtherIncome} disabled={isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">{isPending ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}{editingIncomeId ? "Update income" : "Save income"}</button>
          {editingIncomeId && <button type="button" onClick={() => { setEditingIncomeId(null); setIncomeForm(blankIncome()); }} className="w-full text-xs text-slate-500 hover:text-slate-800">Cancel editing</button>}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl min-w-0 space-y-5 overflow-x-hidden px-4 py-5 pb-28 xl:pb-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Accounting</h1>
          <p className="mt-1 text-sm text-slate-500">Track profit by UK tax year and use quick add for recurring expenses or other income.</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          <select value={selectedTaxYearStart} onChange={(event) => updateTaxYear(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">{availableTaxYears.map((option) => <option key={option.value} value={option.value}>Tax year {option.label}</option>)}</select>
          <input type="date" value={dateRange.start} onChange={(event) => setDateRange((prev) => ({ ...prev, start: event.target.value }))} className="min-w-0 flex-1 basis-[9rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:flex-none" />
          <input type="date" value={dateRange.end} onChange={(event) => setDateRange((prev) => ({ ...prev, end: event.target.value }))} className="min-w-0 flex-1 basis-[9rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:flex-none" />
          <button type="button" onClick={applyDateRange} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Apply range</button>
          <button type="button" onClick={clearDateRange} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Reset range</button>
          <button type="button" onClick={exportMonthlySummary} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Download size={14} />Export summary CSV</button>
          <Link href="/accounting/mtd" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">MTD &amp; tax</Link>
          <Link href="/accounting/import" className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100"><Upload size={14} />Import expenses</Link>
          <button type="button" onClick={exportExpenses} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Receipt size={14} />Export expenses CSV</button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">Viewing tax year {selectedTaxYearLabel} with a filtered range of {activeDateFrom} to {activeDateTo}. Income includes customer payments plus manual and generated recurring other-income entries.</div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp size={14} className="text-green-600" />Income</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-slate-800">{fmtCurrency(totals.income)}</p><p className="mt-1 text-xs text-slate-500">Customer payments and other income in {selectedTaxYearLabel}</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown size={14} className="text-red-600" />Expenses</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-slate-800">{fmtCurrency(totals.expenses)}</p><p className="mt-1 text-xs text-slate-500">Manual and recurring expenditure in the selected tax year</p></CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wallet size={14} className="text-blue-600" />Net</CardTitle></CardHeader><CardContent><p className={cn("text-2xl font-bold", totals.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(totals.net)}</p><p className="mt-1 text-xs text-slate-500">Profit view for the selected tax year</p></CardContent></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>VAT On Income</CardTitle></CardHeader><CardContent><p className="text-xl font-bold text-slate-800">{fmtCurrency(totals.incomeVat)}</p><p className="mt-1 text-xs text-slate-500">Output VAT inside the selected filter range</p></CardContent></Card>
        <Card><CardHeader><CardTitle>VAT On Expenses</CardTitle></CardHeader><CardContent><p className="text-xl font-bold text-slate-800">{fmtCurrency(totals.expenseVat)}</p><p className="mt-1 text-xs text-slate-500">Input VAT inside the selected filter range</p></CardContent></Card>
      </div>

      {openingFigures}

      {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}
      {formSuccess && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{formSuccess}</p>}

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <MonthView
            data={monthView}
            onMonth={goToMonth}
            onAdd={(mode) => addFromMonth(mode, monthView.month)}
            onEditExpense={(e) => { setEditingIncomeId(null); openEditExpense(e); showForm(); }}
            onDeleteExpense={removeExpense}
            onEditIncome={openEditIncome}
            onDeleteIncome={removeOtherIncome}
            deletingEntryId={deletingEntryId}
          />
          <Card>
            <CardHeader><CardTitle>Monthly Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {monthlySummaries.map((month) => (
                <div key={month.monthKey} role="button" tabIndex={0} title="Open this month day by day" onClick={() => goToMonth(month.monthKey)} onKeyDown={(e) => { if (e.key === "Enter") goToMonth(month.monthKey); }} className={cn("cursor-pointer rounded-xl border bg-slate-50 p-3 hover:border-blue-300", month.monthKey === monthView.month ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200")}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{month.monthLabel}</p>
                      <p className="text-xs text-slate-500">{month.paymentCount} income entr{month.paymentCount === 1 ? "y" : "ies"} · {month.expenseCount} expense{month.expenseCount === 1 ? "" : "s"}</p>
                    </div>
                    <p className={cn("text-sm font-bold", month.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(month.net)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Income</p><p className="mt-1 font-semibold text-slate-800">{fmtCurrency(month.income)}</p><p className="text-[11px] text-slate-400">VAT {fmtCurrency(month.incomeVat)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Expenses</p><p className="mt-1 font-semibold text-slate-800">{fmtCurrency(month.expenses)}</p><p className="text-[11px] text-slate-400">VAT {fmtCurrency(month.expenseVat)}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Net</p><p className={cn("mt-1 font-semibold", month.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(month.net)}</p><p className="text-[11px] text-slate-400">Gross view</p></div>
                  </div>
                  {Object.keys(month.categoryBreakdown).length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{Object.entries(month.categoryBreakdown).map(([category, amount]) => { const definition = expenseCategories.find((entry) => entry.value === category); return <span key={category} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">{definition?.label ?? category}: {fmtCurrency(amount)}</span>; })}</div>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Income</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {mergedIncome.length === 0 ? <p className="text-sm text-slate-500">No income logged yet.</p> : mergedIncome.map((entry) => {
                const isOtherIncome = "receivedAt" in entry;
                const date = isOtherIncome ? entry.receivedAt : entry.paidAt;
                const label = isOtherIncome ? entry.sourceLabel : entry.customer.name;
                const subtitle = isOtherIncome ? `${entry.categoryLabel} · ${entry.taxTreatmentLabel}${formatRepeatSummary(entry) ? ` · ${formatRepeatSummary(entry)}` : ""}` : entry.method;
                return (
                  <div key={`${entry.sourceType}-${entry.id}`} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{label}</p>
                        <p className="text-xs text-slate-500">{new Date(date).toLocaleDateString("en-GB")} · {subtitle}</p>
                        {isOtherIncome && entry.notes && <p className="mt-1 text-xs text-slate-500">{entry.notes}</p>}
                        {isOtherIncome && entry.vatAmount > 0 && <p className="mt-1 text-[11px] text-slate-500">VAT {fmtCurrency(entry.vatAmount)} on {fmtCurrency(entry.netAmount)} net</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-bold text-green-700">{fmtCurrency(entry.amount)}</span>
                        {isOtherIncome && <button type="button" onClick={() => removeOtherIncome(entry.id)} disabled={deletingEntryId === `income-${entry.id}`} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50">{deletingEntryId === `income-${entry.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}Delete</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <div id="quick-add" className="hidden scroll-mt-4 xl:block"><Card><CardHeader><CardTitle>{editingExpenseId ? "Edit expense" : editingIncomeId ? "Edit income" : "Quick Add"}</CardTitle></CardHeader><CardContent>{quickAddPanel}</CardContent></Card></div>

          <Card>
            <CardHeader><CardTitle>Recent Expenses</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {recentExpenses.length === 0 ? <p className="text-sm text-slate-500">No expenses logged yet.</p> : recentExpenses.map((expense) => {
                const repeatSummary = formatRepeatSummary(expense);
                return (
                  <div key={expense.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{expense.supplier || expense.categoryLabel}</p>
                        <p className="text-xs text-slate-500">{new Date(expense.expenseDate).toLocaleDateString("en-GB")} · {expense.categoryLabel} · {expense.hmrcLabel}</p>
                        {expense.notes && <p className="mt-1 text-xs text-slate-500">{expense.notes}</p>}
                        {repeatSummary && <p className="mt-1 text-[11px] font-medium text-blue-700">{repeatSummary}</p>}
                        <p className="mt-1 text-[11px] text-slate-500">{expense.taxTreatmentLabel}{expense.vatAmount > 0 ? ` · VAT ${fmtCurrency(expense.vatAmount)} on ${fmtCurrency(expense.netAmount)} net` : ""}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-bold text-red-600">{fmtCurrency(expense.amount)}</span>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => openEditExpense(expense)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600"><Pencil size={12} />Edit</button>
                          <button type="button" onClick={() => removeExpense(expense.id)} disabled={deletingEntryId === `expense-${expense.id}`} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50">{deletingEntryId === `expense-${expense.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}Delete</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      <button type="button" onClick={() => setQuickAddOpen(true)} className="fixed bottom-20 right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 xl:hidden" aria-label="Add expense or income"><Plus size={24} /></button>

      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/40 xl:hidden">
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-slate-800">{editingExpenseId ? "Edit expense" : editingIncomeId ? "Edit income" : "Quick add"}</p>
                <p className="text-xs text-slate-500">{editingExpenseId || editingIncomeId ? "Update the details below." : "Add an expense or income."}</p>
              </div>
              <button type="button" onClick={() => { setQuickAddOpen(false); setEditingExpenseId(null); setEditingIncomeId(null); }} className="rounded-full border border-slate-200 p-2 text-slate-500"><X size={16} /></button>
            </div>
            {quickAddPanel}
          </div>
        </div>
      )}

    </div>
  );
}
/** One month, day by day: money in and out in date order. Customer payments come from cleans and are read only. */
function MonthView({ data, onMonth, onAdd, onEditExpense, onDeleteExpense, onEditIncome, onDeleteIncome, deletingEntryId }: {
  data: MonthViewData;
  onMonth: (month: string) => void;
  onAdd: (mode: QuickAddMode) => void;
  onEditExpense: (expense: RecentExpense) => void;
  onDeleteExpense: (id: number) => void;
  onEditIncome: (income: RecentOtherIncome) => void;
  onDeleteIncome: (id: number) => void;
  deletingEntryId: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const shift = (by: number) => {
    const [y, m] = data.month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    onMonth(d.toISOString().slice(0, 7));
  };
  const days = [...new Set([...data.payments.map((p) => p.date), ...data.otherIncome.map((o) => o.date), ...data.expenses.map((e) => e.date)])].sort();
  // Formatted by hand so the server and the browser print exactly the same text.
  const dayLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
  };
  const methodLabel = (m: string) => (m === "BACS" ? "bank" : m.toLowerCase());

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><ChevronLeft size={14} /></button>
            <CardTitle className="min-w-[9rem] text-center">{data.label}</CardTitle>
            <button type="button" onClick={() => shift(1)} aria-label="Next month" className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><ChevronRight size={14} /></button>
          </div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onAdd("expense")} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"><Plus size={12} /> Expense</button>
            <button type="button" onClick={() => onAdd("income")} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"><Plus size={12} /> Income</button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Money in</p><p className="mt-0.5 text-sm font-bold text-green-700">{fmtCurrency(data.totals.income)}</p><p className="text-[11px] text-slate-400">{fmtCurrency(data.totals.jobIncome)} from cleans</p></div>
          <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Money out</p><p className="mt-0.5 text-sm font-bold text-red-700">{fmtCurrency(data.totals.expenses)}</p><p className="text-[11px] text-slate-400">{data.expenses.length} expense{data.expenses.length === 1 ? "" : "s"}</p></div>
          <div className="rounded-lg border border-slate-200 bg-white px-2 py-2"><p className="text-slate-400">Net</p><p className={cn("mt-0.5 text-sm font-bold", data.totals.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(data.totals.net)}</p></div>
        </div>

        {days.length === 0 ? <p className="text-sm text-slate-500">Nothing in {data.label} yet.</p> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {days.map((day) => {
              const pays = data.payments.filter((p) => p.date === day);
              const incomes = data.otherIncome.filter((o) => o.date === day);
              const costs = data.expenses.filter((e) => e.date === day);
              const dayIn = pays.reduce((s, p) => s + p.amount, 0) + incomes.reduce((s, o) => s + o.amount, 0);
              const dayOut = costs.reduce((s, e) => s + e.amount, 0);
              const expanded = open.has(day);
              return (
                <div key={day} className="px-3 py-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                    <span>{dayLabel(day)}</span>
                    <span>{dayIn > 0 && <span className="text-green-700">+{fmtCurrency(dayIn)}</span>}{dayIn > 0 && dayOut > 0 && " · "}{dayOut > 0 && <span className="text-red-700">−{fmtCurrency(dayOut)}</span>}</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {pays.length > 0 && (
                      <div className="rounded-lg bg-green-50/60 px-2 py-1.5">
                        <button type="button" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(day)) n.delete(day); else n.add(day); return n; })} className="flex w-full items-center justify-between gap-2 text-left text-sm">
                          <span className="flex items-center gap-1.5 text-slate-700"><Lock size={11} className="text-slate-400" /> Customer payments ({pays.length}) <span className="text-[11px] text-slate-400">{expanded ? "hide" : "show"}</span></span>
                          <span className="font-semibold text-green-700">{fmtCurrency(pays.reduce((s, p) => s + p.amount, 0))}</span>
                        </button>
                        {expanded && (
                          <ul className="mt-1 space-y-0.5 border-t border-green-100 pt-1">
                            {pays.map((p) => (
                              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                                <Link href={`/customers/${p.customerId}`} className="truncate text-slate-700 hover:underline">{p.customerName} <span className="text-slate-400">· {methodLabel(p.method)}</span></Link>
                                <span className="tabular-nums text-slate-700">{fmtCurrency(p.amount)}</span>
                              </li>
                            ))}
                            <li className="pt-0.5 text-[11px] text-slate-400">From cleans: change these on the customer or in Payments.</li>
                          </ul>
                        )}
                      </div>
                    )}
                    {incomes.map((o) => (
                      <div key={`i${o.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                        <span className="min-w-0 truncate text-slate-700">{o.sourceLabel} <span className="text-xs text-slate-400">· {o.categoryLabel}</span></span>
                        <span className="flex flex-shrink-0 items-center gap-2">
                          <span className="font-semibold text-green-700">+{fmtCurrency(o.amount)}</span>
                          <button type="button" onClick={() => onEditIncome({ ...o, receivedAt: o.receivedAt })} className="text-slate-400 hover:text-blue-600" aria-label="Edit income"><Pencil size={12} /></button>
                          <button type="button" onClick={() => onDeleteIncome(o.id)} disabled={deletingEntryId === `income-${o.id}`} className="text-slate-400 hover:text-red-600" aria-label="Delete income"><Trash2 size={12} /></button>
                        </span>
                      </div>
                    ))}
                    {costs.map((e) => (
                      <div key={`e${e.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                        <span className="min-w-0 truncate text-slate-700">{e.supplier || e.categoryLabel} <span className="text-xs text-slate-400">· {e.categoryLabel}</span></span>
                        <span className="flex flex-shrink-0 items-center gap-2">
                          <span className="font-semibold text-red-700">−{fmtCurrency(e.amount)}</span>
                          <button type="button" onClick={() => onEditExpense(e)} className="text-slate-400 hover:text-blue-600" aria-label="Edit expense"><Pencil size={12} /></button>
                          <button type="button" onClick={() => onDeleteExpense(e.id)} disabled={deletingEntryId === `expense-${e.id}`} className="text-slate-400 hover:text-red-600" aria-label="Delete expense"><Trash2 size={12} /></button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
