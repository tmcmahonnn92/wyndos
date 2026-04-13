"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Download,
  Loader2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Trash2,
  Wallet,
} from "lucide-react";
import { createExpense, deleteExpense } from "@/lib/actions";
import type { ExpenseCategoryDefinition } from "@/lib/accounting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

type MonthlySummary = {
  monthKey: string;
  monthLabel: string;
  income: number;
  expenses: number;
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
  expenseDate: string | Date;
  notes: string | null;
  isRecurring: boolean;
  receiptImage: string | null;
  receiptFilename: string | null;
};

type RecentPayment = {
  id: number;
  amount: number;
  paidAt: string | Date;
  method: string;
  customer: { id: number; name: string };
};

function toCsvValue(value: string | number) {
  const raw = String(value ?? "");
  return /[",\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
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

export function AccountingClient({
  monthlySummaries,
  recentExpenses,
  recentPayments,
  totals,
  expenseCategories,
  exportGeneratedAt,
}: {
  monthlySummaries: MonthlySummary[];
  recentExpenses: RecentExpense[];
  recentPayments: RecentPayment[];
  totals: { income: number; expenses: number; net: number };
  expenseCategories: ExpenseCategoryDefinition[];
  exportGeneratedAt: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expenseForm, setExpenseForm] = useState({
    category: expenseCategories[0]?.value ?? "OTHER",
    supplier: "",
    amount: "",
    expenseDate: new Date().toISOString().slice(0, 10),
    notes: "",
    isRecurring: false,
    receiptImage: "",
    receiptFilename: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<number | null>(null);
  const receiptInputRef = useRef<HTMLInputElement | null>(null);

  const exportMonthlySummary = () => {
    downloadCsv("accounting-monthly-summary.csv", [
      ["Month", "Income", "Expenses", "Net", "Payments", "Expenses Logged"],
      ...monthlySummaries.map((month) => [
        month.monthLabel,
        month.income.toFixed(2),
        month.expenses.toFixed(2),
        month.net.toFixed(2),
        month.paymentCount,
        month.expenseCount,
      ]),
    ]);
  };

  const exportExpenses = () => {
    downloadCsv("accounting-expenses.csv", [
      ["Date", "Supplier", "Category", "HMRC Category", "Amount", "Recurring", "Notes", "Receipt Filename", "Generated At"],
      ...recentExpenses.map((expense) => [
        new Date(expense.expenseDate).toISOString().slice(0, 10),
        expense.supplier,
        expense.categoryLabel,
        expense.hmrcLabel,
        expense.amount.toFixed(2),
        expense.isRecurring ? "Yes" : "No",
        expense.notes ?? "",
        expense.receiptFilename ?? "",
        exportGeneratedAt,
      ]),
    ]);
  };

  const handleReceiptSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("Receipt upload must be an image.");
      return;
    }
    if (file.size > 2_500_000) {
      setFormError("Receipt image is too large. Keep it below roughly 2.5MB.");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the receipt image."));
      reader.readAsDataURL(file);
    });

    setExpenseForm((prev) => ({
      ...prev,
      receiptImage: dataUrl,
      receiptFilename: file.name,
    }));
    setFormError(null);
  };

  const submitExpense = () => {
    const amount = Number(expenseForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Enter an expense amount above zero.");
      return;
    }

    setFormError(null);
    setFormSuccess(null);

    startTransition(async () => {
      try {
        await createExpense({
          category: expenseForm.category,
          supplier: expenseForm.supplier,
          amount,
          expenseDate: new Date(expenseForm.expenseDate),
          notes: expenseForm.notes,
          isRecurring: expenseForm.isRecurring,
          receiptImage: expenseForm.receiptImage || null,
          receiptFilename: expenseForm.receiptFilename || null,
        });
        setExpenseForm({
          category: expenseCategories[0]?.value ?? "OTHER",
          supplier: "",
          amount: "",
          expenseDate: new Date().toISOString().slice(0, 10),
          notes: "",
          isRecurring: false,
          receiptImage: "",
          receiptFilename: "",
        });
        if (receiptInputRef.current) receiptInputRef.current.value = "";
        setFormSuccess("Expense saved.");
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not save the expense.");
      }
    });
  };

  const removeExpense = (expenseId: number) => {
    if (!window.confirm("Delete this expense entry?")) return;
    setDeletingExpenseId(expenseId);
    startTransition(async () => {
      try {
        await deleteExpense(expenseId);
        router.refresh();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : "Could not delete the expense.");
      } finally {
        setDeletingExpenseId(null);
      }
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Accounting</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monthly income versus expenditure, expense capture, and CSV exports aimed at UK bookkeeping workflows.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportMonthlySummary}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download size={14} />
            Export monthly CSV
          </button>
          <button
            type="button"
            onClick={exportExpenses}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Receipt size={14} />
            Export expenses CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        This gives you an MTD-friendly starting point by exporting month-by-month income and categorised expenses, but it is not a direct HMRC filing integration.
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp size={14} className="text-green-600" />Income</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-800">{fmtCurrency(totals.income)}</p>
            <p className="mt-1 text-xs text-slate-500">Payments logged across the last 12 months</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown size={14} className="text-red-600" />Expenses</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-800">{fmtCurrency(totals.expenses)}</p>
            <p className="mt-1 text-xs text-slate-500">Manual expenses and receipt-backed costs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet size={14} className="text-blue-600" />Net</CardTitle></CardHeader>
          <CardContent>
            <p className={cn("text-2xl font-bold", totals.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(totals.net)}</p>
            <p className="mt-1 text-xs text-slate-500">Income minus recorded expenditure</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {monthlySummaries.map((month) => (
                <div key={month.monthKey} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{month.monthLabel}</p>
                      <p className="text-xs text-slate-500">{month.paymentCount} payment{month.paymentCount !== 1 ? "s" : ""} · {month.expenseCount} expense{month.expenseCount !== 1 ? "s" : ""}</p>
                    </div>
                    <p className={cn("text-sm font-bold", month.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(month.net)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <p className="text-slate-400">Income</p>
                      <p className="mt-1 font-semibold text-slate-800">{fmtCurrency(month.income)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <p className="text-slate-400">Expenses</p>
                      <p className="mt-1 font-semibold text-slate-800">{fmtCurrency(month.expenses)}</p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-2 border border-slate-200">
                      <p className="text-slate-400">Net</p>
                      <p className={cn("mt-1 font-semibold", month.net >= 0 ? "text-green-700" : "text-red-700")}>{fmtCurrency(month.net)}</p>
                    </div>
                  </div>
                  {Object.keys(month.categoryBreakdown).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(month.categoryBreakdown).map(([category, amount]) => {
                        const definition = expenseCategories.find((entry) => entry.value === category);
                        return (
                          <span key={category} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
                            {definition?.label ?? category}: {fmtCurrency(amount)}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Income</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {recentPayments.length === 0 ? (
                <p className="text-sm text-slate-500">No recent payments logged.</p>
              ) : (
                recentPayments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{payment.customer.name}</p>
                      <p className="text-xs text-slate-500">{new Date(payment.paidAt).toLocaleDateString("en-GB")} · {payment.method}</p>
                    </div>
                    <span className="text-sm font-bold text-green-700">{fmtCurrency(payment.amount)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Log Expense</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">
                Use your phone camera or scanner app to capture a receipt, then categorise it here. Regular monthly costs can be marked so they stay obvious in the ledger.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Category</label>
                  <select
                    value={expenseForm.category}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    {expenseCategories.map((category) => (
                      <option key={category.value} value={category.value}>{category.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Date</label>
                  <input
                    type="date"
                    value={expenseForm.expenseDate}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, expenseDate: event.target.value }))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Supplier</label>
                  <input
                    type="text"
                    value={expenseForm.supplier}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, supplier: event.target.value }))}
                    placeholder="Shell, Screwfix, accountant..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseForm.amount}
                    onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
                <textarea
                  value={expenseForm.notes}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Fuel for van, monthly software subscription, replacement squeegee..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={expenseForm.isRecurring}
                  onChange={(event) => setExpenseForm((prev) => ({ ...prev, isRecurring: event.target.checked }))}
                />
                Regular / repeating expense
              </label>

              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Receipt image</p>
                    <p className="text-xs text-slate-500">On mobile you can choose the camera to scan a receipt straight in.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Camera size={14} />
                    Add receipt
                    <input ref={receiptInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceiptSelected} />
                  </label>
                </div>
                {expenseForm.receiptFilename && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-medium text-slate-700">{expenseForm.receiptFilename}</p>
                    {expenseForm.receiptImage && (
                      <img src={expenseForm.receiptImage} alt="Receipt preview" className="mt-2 max-h-48 rounded-lg border border-slate-200 object-contain" />
                    )}
                  </div>
                )}
              </div>

              {formError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}
              {formSuccess && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{formSuccess}</p>}

              <button
                type="button"
                onClick={submitExpense}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Receipt size={14} />
                Save expense
              </button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Recent Expenses</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {recentExpenses.length === 0 ? (
                <p className="text-sm text-slate-500">No expenses logged yet.</p>
              ) : (
                recentExpenses.map((expense) => (
                  <div key={expense.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{expense.supplier || expense.categoryLabel}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(expense.expenseDate).toLocaleDateString("en-GB")} · {expense.categoryLabel} · {expense.hmrcLabel}
                        </p>
                        {expense.notes && <p className="mt-1 text-xs text-slate-500">{expense.notes}</p>}
                        {expense.isRecurring && <p className="mt-1 text-[11px] font-medium text-blue-700">Marked as regular expense</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="text-sm font-bold text-red-600">{fmtCurrency(expense.amount)}</span>
                        <button
                          type="button"
                          onClick={() => removeExpense(expense.id)}
                          disabled={deletingExpenseId === expense.id}
                          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                        >
                          {deletingExpenseId === expense.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          Delete
                        </button>
                      </div>
                    </div>
                    {expense.receiptImage && (
                      <div className="mt-3">
                        <a href={expense.receiptImage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                          <Download size={12} />
                          View receipt{expense.receiptFilename ? ` · ${expense.receiptFilename}` : ""}
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}