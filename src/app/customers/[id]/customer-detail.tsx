"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Edit2, CalendarDays, PoundSterling, CheckCircle2, SkipForward, FileText, Download, Mail, MapPin, Tag as TagIcon, MessageSquare, ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import { getCustomer, getAreas, updateCustomer, rescheduleCustomer, logPayment, logPaymentForSelectedJobs, setCustomerTags, updateJobPrice, updatePayment, deletePayment } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { fmtDate, fmtCurrency, cn } from "@/lib/utils";

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;
type Area = Awaited<ReturnType<typeof getAreas>>[0];
type TagRow = { id: number; name: string; color: string };

interface Props {
  customer: Customer;
  areas: Area[];
  balance: number;
  allTags: TagRow[];
  hidePrices?: boolean;
}

type JobBalance = {
  paid: number;
  due: number;
  settled: boolean;
};

function buildJobBalanceMap(jobs: Customer["jobs"], totalPayments: number) {
  const applicableJobs = [...jobs]
    .filter((job) => job.status === "COMPLETE" || job.status === "OUTSTANDING")
    .sort((left, right) => new Date(left.workDay.date).getTime() - new Date(right.workDay.date).getTime() || left.id - right.id);

  const balanceMap = new Map<number, JobBalance>();
  let remainingPayments = totalPayments;

  for (const job of applicableJobs) {
    const paid = Math.min(job.price, Math.max(0, remainingPayments));
    remainingPayments = Math.max(0, remainingPayments - paid);
    const due = Math.max(0, Number((job.price - paid).toFixed(2)));
    balanceMap.set(job.id, {
      paid: Number(paid.toFixed(2)),
      due,
      settled: due <= 0,
    });
  }

  return balanceMap;
}
export function CustomerDetail({ customer, areas, balance, allTags, hidePrices = false }: Props) {
  const JOB_HISTORY_PREVIEW_COUNT = 6;
  const [editOpen, setEditOpen] = useState(false);
  const [changeAreaOpen, setChangeAreaOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [logPayMode, setLogPayMode] = useState<"jobs" | "amount">("jobs");
  const [logPayJobIds, setLogPayJobIds] = useState<Set<number>>(new Set());
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsTo, setSmsTo] = useState(customer.phone ?? "");
  const [smsMsg, setSmsMsg] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [editingJob, setEditingJob] = useState<Customer["jobs"][number] | null>(null);
  const [editingJobPrice, setEditingJobPrice] = useState("");
  const [editingPayment, setEditingPayment] = useState<Customer["payments"][number] | null>(null);
  const [editPayForm, setEditPayForm] = useState({ amount: "", method: "CASH" as "CASH" | "BACS" | "CARD", paidAt: "", notes: "" });
  const [isPending, startTransition] = useTransition();
  const [tagPending, startTagTransition] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasBack = searchParams.get("back") === "1";

  // Tag state ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â local copy of which tags are assigned
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(
    new Set(customer.tags.map((t) => t.tagId))
  );

  // Edit form state
  const [form, setForm] = useState({
    name: customer.name,
    address: customer.address,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    areaId: String(customer.areaId),
    price: String(customer.price),
    notes: customer.notes ?? "",
    active: customer.active,
    jobName: customer.jobName ?? "Window Cleaning",
    advanceNotice: customer.advanceNotice ?? false,
    preferredPaymentMethod: customer.preferredPaymentMethod ?? "",
  });

  // Invoice state
  const totalCustomerPayments = customer.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const jobBalanceMap = buildJobBalanceMap(customer.jobs, totalCustomerPayments);
  const invoiceableJobs = customer.jobs.filter(
    (j) => j.status === "COMPLETE" || j.status === "OUTSTANDING"
  );
  const unpaidJobIds = new Set(
    invoiceableJobs
      .filter((j) => (jobBalanceMap.get(j.id)?.due ?? 0) > 0)
      .map((j) => j.id)
  );
  const unpaidJobs = invoiceableJobs.filter((j) => unpaidJobIds.has(j.id));
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set(unpaidJobIds));
  const [invoiceJobFilter, setInvoiceJobFilter] = useState<"unpaid" | "complete" | "all">("unpaid");
  const [invoiceStatus, setInvoiceStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [invoiceMsg, setInvoiceMsg] = useState("");
  const visibleInvoiceJobs = invoiceableJobs.filter((j) => {
    if (invoiceJobFilter === "unpaid") return unpaidJobIds.has(j.id);
    if (invoiceJobFilter === "complete") return j.status === "COMPLETE";
    return true;
  });

  const visibleJobs = showAllJobs ? customer.jobs : customer.jobs.slice(0, JOB_HISTORY_PREVIEW_COUNT);

  const toggleJob = useCallback((id: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const invoiceTotal = invoiceableJobs
    .filter((j) => selectedJobIds.has(j.id))
    .reduce((s, j) => s + j.price, 0);

  const invoiceDue = invoiceableJobs
    .filter((j) => selectedJobIds.has(j.id))
    .reduce((s, j) => {
      const paid = j.payments.reduce((ps, p) => ps + p.amount, 0);
      return s + (jobBalanceMap.get(j.id)?.due ?? 0);
    }, 0);

  const handleSendSms = async () => {
    if (!smsTo.trim() || !smsMsg.trim()) return;
    setSmsSending(true);
    setSmsResult(null);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, to: smsTo.trim(), message: smsMsg }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSmsResult({ ok: false, msg: data.error ?? "Failed to send" });
      } else {
        setSmsResult({ ok: true, msg: "SMS sent successfully!" });
        setSmsMsg("");
        router.refresh();
      }
    } catch (e) {
      setSmsResult({ ok: false, msg: String(e) });
    } finally {
      setSmsSending(false);
    }
  };

  const handleSaveTags = () => {
    startTagTransition(async () => {
      await setCustomerTags(customer.id, Array.from(selectedTagIds));
      setTagsOpen(false);
      router.refresh();
    });
  };

  const handleInvoiceAction = async (action: "pdf" | "email") => {
    const jobIds = Array.from(selectedJobIds);
    if (!jobIds.length) return;
    setInvoiceStatus("loading");
    setInvoiceMsg("");
    try {
      const res = await fetch(`/api/invoice/${action === "pdf" ? "pdf" : "email"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer.id, jobIds }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Request failed");
      }
      if (action === "pdf") {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const disp = res.headers.get("Content-Disposition") ?? "";
        const match = disp.match(/filename="(.+?)"/);
        a.href = url;
        a.download = match?.[1] ?? "invoice.pdf";
        a.click();
        URL.revokeObjectURL(url);
        setInvoiceStatus("success");
        setInvoiceMsg("PDF downloaded.");
      } else {
        const data = await res.json();
        setInvoiceStatus("success");
        setInvoiceMsg(`Invoice ${data.invoiceNumber} sent to ${customer.email}.`);
      }
    } catch (e) {
      setInvoiceStatus("error");
      setInvoiceMsg(String(e));
    }
  };

  const [newDueDate, setNewDueDate] = useState(
    customer.nextDueDate
      ? new Date(customer.nextDueDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
  );

  const [payForm, setPayForm] = useState({
    amount: String(Math.max(0, balance).toFixed(2)),
    method: "CASH" as "CASH" | "BACS" | "CARD",
    notes: "",
  });

  const handleSaveEdit = () => {
    startTransition(async () => {
      await updateCustomer(customer.id, {
        name: form.name,
        address: form.address,
        email: form.email,
        phone: form.phone,
        areaId: Number(form.areaId),
        price: Number(form.price),
        notes: form.notes || undefined,
        active: form.active,
        jobName: form.jobName || undefined,
        advanceNotice: form.advanceNotice,
        preferredPaymentMethod: form.preferredPaymentMethod || undefined,
      });
      setEditOpen(false);
      setChangeAreaOpen(false);
      router.refresh();
    });
  };

  const handleReschedule = () => {
    startTransition(async () => {
      await rescheduleCustomer(customer.id, new Date(newDueDate));
      setReschedOpen(false);
      router.refresh();
    });
  };

  const handleLogPayment = () => {
    startTransition(async () => {
      if (logPayMode === "jobs") {
        if (logPayJobIds.size === 0) return;
        await logPaymentForSelectedJobs({
          customerId: customer.id,
          jobIds: Array.from(logPayJobIds),
          method: payForm.method,
          notes: payForm.notes || undefined,
        });
      } else {
        await logPayment({
          customerId: customer.id,
          amount: Number(payForm.amount),
          method: payForm.method,
          notes: payForm.notes || undefined,
        });
      }
      setPayOpen(false);
      setPayForm({ amount: "0.00", method: "CASH", notes: "" });
      router.refresh();
    });
  };

  const handleSaveJobPrice = () => {
    if (!editingJob || !editingJobPrice || Number(editingJobPrice) < 0) return;
    startTransition(async () => {
      await updateJobPrice(editingJob.id, Number(editingJobPrice));
      setEditingJob(null);
      setEditingJobPrice("");
      router.refresh();
    });
  };

  const openEditPayment = (p: Customer["payments"][number]) => {
    setEditingPayment(p);
    setEditPayForm({
      amount: p.amount.toFixed(2),
      method: p.method as "CASH" | "BACS" | "CARD",
      paidAt: new Date(p.paidAt).toISOString().slice(0, 10),
      notes: p.notes ?? "",
    });
  };

  const handleSaveEditPayment = () => {
    if (!editingPayment) return;
    const amt = Number(editPayForm.amount);
    if (isNaN(amt) || amt <= 0) return;
    startTransition(async () => {
      await updatePayment(editingPayment.id, customer.id, {
        amount: amt,
        method: editPayForm.method,
        paidAt: new Date(editPayForm.paidAt),
        notes: editPayForm.notes || undefined,
      });
      setEditingPayment(null);
      router.refresh();
    });
  };

  const handleDeletePayment = (paymentId: number) => {
    if (!confirm("Delete this payment? This cannot be undone.")) return;
    startTransition(async () => {
      await deletePayment(paymentId, customer.id);
      router.refresh();
    });
  };

  const isOverdue = customer.nextDueDate && new Date(customer.nextDueDate) < new Date(new Date().setHours(0, 0, 0, 0));

  return (
    <div className="max-w-lg mx-auto">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-sm px-4 py-3 flex items-center gap-3">
        {hasBack ? (
          <button onClick={() => router.back()} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronLeft size={20} />
          </button>
        ) : (
          <Link href="/customers" className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <ChevronLeft size={20} />
          </Link>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-slate-800 truncate">{customer.name}</h1>
          <p className="text-xs text-slate-500 truncate">{customer.address}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>
          <Edit2 size={15} />
          Edit
        </Button>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Key info */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-3">
              <p className="text-xs text-slate-500 mb-0.5">Price</p>
              <p className="text-lg font-bold text-slate-800">{hidePrices ? "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“" : fmtCurrency(customer.price)}</p>
              {!customer.area.isSystemArea && (
                <p className="text-xs text-slate-400">every {customer.frequencyWeeks}w (area schedule)</p>
              )}
            </CardContent>
          </Card>
          <Card className={balance > 0 ? "border-red-200" : balance < 0 ? "border-green-200" : ""}>
            <CardContent className="py-3">
              <p className="text-xs text-slate-500 mb-0.5">Balance</p>
              <p className={`text-lg font-bold ${balance > 0 ? "text-red-600" : balance < 0 ? "text-green-600" : "text-slate-800"}`}>
                {hidePrices ? "ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“" : (balance > 0 ? `Owes ${fmtCurrency(balance)}` : balance < 0 ? `Credit ${fmtCurrency(-balance)}` : "Settled")}
              </p>
              {balance > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-slate-500">
                    {unpaidJobs.length} unpaid job{unpaidJobs.length !== 1 ? "s" : ""}
                  </p>
                  <button onClick={() => { setLogPayMode("jobs"); setLogPayJobIds(new Set(unpaidJobIds)); setPayOpen(true); }} className="text-xs text-blue-600 hover:underline">Log payment</button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Next due date ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â hidden for one-off customers */}
        {!customer.area.isSystemArea && (
        <Card>
          <CardContent className="flex items-center justify-between py-3">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Next due</p>
              <p className={`text-sm font-semibold ${isOverdue ? "text-red-600" : "text-slate-800"}`}>
                {fmtDate(customer.nextDueDate)}
                {isOverdue && " ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â overdue"}
              </p>
              {customer.lastCompletedDate && (
                <p className="text-xs text-slate-400 mt-0.5">
                  Last done: {fmtDate(customer.lastCompletedDate)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        )}

        {/* Area & notes */}
        <Card>
          <CardContent className="py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Area</span>
              {customer.area.isSystemArea ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                  One-off Customer
                </span>
              ) : (
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: customer.area.color || "#3B82F6" }}
                >
                  {customer.area.name}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Address</span>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(customer.address)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <MapPin size={11} />
                Open in Maps
              </a>
            </div>
            {customer.notes && (
              <div>
                <span className="text-xs text-slate-500 block mb-0.5">Notes</span>
                <p className="text-sm text-slate-700">{customer.notes}</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Status</span>
              <Badge variant={customer.active ? "success" : "muted"}>
                {customer.active ? "Active" : "Inactive"}
              </Badge>
            </div>
            {/* Tags row */}
            <div className="flex items-start justify-between gap-2 pt-1">
              <span className="text-xs text-slate-500 mt-1">Tags</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {customer.tags.length === 0 && (
                  <span className="text-xs text-slate-400">None</span>
                )}
                {customer.tags.map((ct) => (
                  <span
                    key={ct.tagId}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                    style={{ backgroundColor: ct.tag.color }}
                  >
                    {ct.tag.name}
                  </span>
                ))}
                <button
                  onClick={() => setTagsOpen(true)}
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600"
                >
                  <TagIcon size={10} />
                  Edit
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button onClick={() => { setLogPayMode("jobs"); setLogPayJobIds(new Set(unpaidJobIds)); setPayOpen(true); }} variant="outline" className="flex-1">
            <PoundSterling size={15} />
            Log Payment
          </Button>
          <Button onClick={() => setChangeAreaOpen(true)} variant="outline" className="flex-1">
            <ArrowLeftRight size={15} />
            Change Area
          </Button>
          <Button onClick={() => { setInvoiceStatus("idle"); setInvoiceMsg(""); setInvoiceOpen(true); }} variant="outline" className="flex-1">
            <FileText size={15} />
            Invoice
          </Button>
          <Button onClick={() => { setSmsTo(customer.phone ?? ""); setSmsMsg(""); setSmsResult(null); setSmsOpen(true); }} variant="outline" className="flex-1">
            <MessageSquare size={15} />
            SMS
          </Button>
        </div>

        {/* Job history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Job History</CardTitle>
              {customer.jobs.length > JOB_HISTORY_PREVIEW_COUNT && (
                <button
                  onClick={() => setShowAllJobs((prev) => !prev)}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  {showAllJobs ? "Show less" : `View all (${customer.jobs.length})`}
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {customer.jobs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-500">No jobs yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visibleJobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{(job as { name?: string }).name || "Window Cleaning"}</p>
                      <p className="text-xs text-slate-500">{fmtDate(job.workDay.date)}{job.isOneOff ? " ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· one-off" : ""}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded-full font-medium",
                          job.status === "COMPLETE" ? "bg-green-100 text-green-700" :
                          job.status === "OUTSTANDING" ? "bg-red-100 text-red-700" :
                          job.status === "SKIPPED" ? "bg-gray-100 text-gray-600" :
                          "bg-slate-100 text-slate-600"
                        )}>
                          {job.status}
                        </span>
                        {job.payments.length > 0 && !hidePrices && (
                          <span className="text-xs text-green-600">
                            Paid {fmtCurrency(job.payments.reduce((s, p) => s + p.amount, 0))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                      {job.status === "SKIPPED" ? (
                        <span className="text-xs font-medium text-slate-400">No charge</span>
                      ) : (
                        <>
                          <span className="text-sm font-semibold text-slate-700">{hidePrices ? null : fmtCurrency(job.price)}</span>
                          <button
                            onClick={() => {
                              setEditingJob(job);
                              setEditingJobPrice(job.price.toFixed(2));
                            }}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Edit price
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Payment history */}
        {customer.payments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100">
                {customer.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">{fmtDate(p.paidAt)}</p>
                      <p className="text-xs text-slate-500">{p.method}{p.notes ? ` · ${p.notes}` : ""}</p>
                    </div>
                    <span className="text-sm font-semibold text-green-700 flex-shrink-0">{hidePrices ? null : `+${fmtCurrency(p.amount)}`}</span>
                    <button
                      onClick={() => openEditPayment(p)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors flex-shrink-0"
                      title="Edit payment"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDeletePayment(p.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                      title="Undo / delete payment"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Edit Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Customer">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
            <input type="text" value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="07700 900 123"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="customer@example.com"
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Area</label>
              <select value={form.areaId} onChange={(e) => setForm(f => ({ ...f, areaId: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {customer.area.isSystemArea && (
                  <option value={String(customer.areaId)}>One-off Customer (no schedule)</option>
                )}
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Price (ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£)</label>
              <input type="number" min="0" step="0.50" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Job Type / Name</label>
            <input type="text" value={form.jobName} onChange={(e) => setForm(f => ({ ...f, jobName: e.target.value }))}
              placeholder="Window Cleaning"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Preferred Payment</label>
              <select value={form.preferredPaymentMethod} onChange={(e) => setForm(f => ({ ...f, preferredPaymentMethod: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ No preference ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“</option>
                <option value="CASH">Cash</option>
                <option value="BACS">BACS</option>
                <option value="CARD">Card</option>
              </select>
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div className="relative">
                  <input type="checkbox" checked={form.advanceNotice} onChange={(e) => setForm(f => ({ ...f, advanceNotice: e.target.checked }))} className="sr-only peer" />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer-checked:bg-blue-500 transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                </div>
                <span className="text-sm font-medium text-slate-700 leading-tight">Advance notice<br /><span className="text-xs text-slate-400 font-normal">required</span></span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={form.active} onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))} className="rounded" />
            <label htmlFor="active" className="text-sm text-slate-700">Active customer</label>
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSaveEdit} disabled={isPending} className="flex-1">{isPending ? "Saving..." : "Save Changes"}</Button>
            <Button variant="outline" onClick={() => setEditOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Change Area Modal */}
      <Modal open={changeAreaOpen} onClose={() => setChangeAreaOpen(false)} title="Change Area">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Move <strong>{customer.name}</strong> to a different area. Their schedule frequency will update to match the new area.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New Area</label>
            <select value={form.areaId} onChange={(e) => setForm(f => ({ ...f, areaId: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveEdit} disabled={isPending} className="flex-1">{isPending ? "Saving..." : "Move to Area"}</Button>
            <Button variant="outline" onClick={() => setChangeAreaOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Reschedule Modal */}
      <Modal open={reschedOpen} onClose={() => setReschedOpen(false)} title="Reschedule Customer">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Set a new next-due date for <strong>{customer.name}</strong>. This overrides the rolling schedule for this adjustment only.</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">New due date</label>
            <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleReschedule} disabled={isPending} className="flex-1">{isPending ? "Saving..." : "Set Date"}</Button>
            <Button variant="outline" onClick={() => setReschedOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Log Payment Modal */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Log Payment">
        <div className="space-y-3">
          {balance > 0 && !hidePrices && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800">
              Balance owed: <strong>{fmtCurrency(balance)}</strong>
            </div>
          )}
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setLogPayMode("jobs"); setLogPayJobIds(new Set(unpaidJobIds)); }}
              className={cn("py-2 rounded-lg border text-sm font-medium transition-colors",
                logPayMode === "jobs" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300")}>
              Specific jobs
            </button>
            <button type="button" onClick={() => setLogPayMode("amount")}
              className={cn("py-2 rounded-lg border text-sm font-medium transition-colors",
                logPayMode === "amount" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300")}>
              Amount only
            </button>
          </div>
          {logPayMode === "jobs" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700">Which jobs are being paid</label>
                <div className="flex gap-3 text-xs">
                  <button type="button" onClick={() => setLogPayJobIds(new Set(unpaidJobIds))} className="text-blue-600 hover:underline">Select all</button>
                  <button type="button" onClick={() => setLogPayJobIds(new Set())} className="text-slate-400 hover:underline">Clear</button>
                </div>
              </div>
              {unpaidJobs.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">No unpaid completed jobs found.</div>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {unpaidJobs.map((j) => {
                    const checked = logPayJobIds.has(j.id);
                    const due = jobBalanceMap.get(j.id)?.due ?? 0;
                    return (
                      <button key={j.id} type="button"
                        onClick={() => setLogPayJobIds(prev => { const next = new Set(prev); next.has(j.id) ? next.delete(j.id) : next.add(j.id); return next; })}
                        className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors",
                          checked ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-slate-300 bg-white")}>
                        {checked
                          ? <CheckCircle2 size={16} className="text-blue-600 flex-shrink-0" />
                          : <div className="w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700 truncate">{(j as { name?: string }).name || "Window Cleaning"}</p>
                          <p className="text-xs text-slate-400">{fmtDate(j.workDay.date)}{j.isOneOff ? " · one-off" : ""}</p>
                        </div>
                        {!hidePrices && (
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs text-slate-400">{fmtCurrency(j.price)}</p>
                            <p className="text-sm font-semibold text-red-600">{fmtCurrency(due)} due</p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <p className="text-sm text-slate-600">{logPayJobIds.size} job{logPayJobIds.size !== 1 ? "s" : ""} selected</p>
                {!hidePrices && <p className="text-sm font-bold text-slate-800">{fmtCurrency(unpaidJobs.filter(j => logPayJobIds.has(j.id)).reduce((s, j) => s + (jobBalanceMap.get(j.id)?.due ?? 0), 0))}</p>}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Amount (GBP)</label>
              <input type="number" min="0" step="0.50" value={payForm.amount} onChange={(e) => setPayForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "BACS", "CARD"] as const).map((m) => (
                <button key={m} onClick={() => setPayForm(f => ({ ...f, method: m }))}
                  className={cn("py-2 rounded-lg border text-sm font-medium transition-colors",
                    payForm.method === m ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"
                  )}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <input type="text" placeholder="e.g. Paid at door" value={payForm.notes} onChange={(e) => setPayForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleLogPayment}
              disabled={isPending || (logPayMode === "jobs" ? logPayJobIds.size === 0 : (!payForm.amount || Number(payForm.amount) <= 0))}
              className="flex-1">
              {isPending ? "Logging..." : "Log Payment"}
            </Button>
            <Button variant="outline" onClick={() => setPayOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editingJob}
        onClose={() => {
          setEditingJob(null);
          setEditingJobPrice("");
        }}
        title="Edit Job Price"
      >
        <div className="space-y-3">
          {editingJob && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
              <p className="text-sm font-semibold text-slate-800">{(editingJob as { name?: string }).name || "Window Cleaning"}</p>
              <p className="text-xs text-slate-500 mt-0.5">{fmtDate(editingJob.workDay.date)} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· {editingJob.status}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Price (ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={editingJobPrice}
              onChange={(e) => setEditingJobPrice(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSaveJobPrice} disabled={isPending || !editingJobPrice} className="flex-1">
              {isPending ? "Saving..." : "Save Price"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingJob(null);
                setEditingJobPrice("");
              }}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Payment Modal */}
      <Modal open={!!editingPayment} onClose={() => setEditingPayment(null)} title="Edit Payment">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Amount (£)</label>
            <input
              type="number" min="0.01" step="0.01"
              value={editPayForm.amount}
              onChange={(e) => setEditPayForm((f) => ({ ...f, amount: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {(["CASH", "BACS", "CARD"] as const).map((m) => (
                <button key={m} onClick={() => setEditPayForm((f) => ({ ...f, method: m }))}
                  className={cn("py-2 rounded-lg border text-sm font-medium transition-colors",
                    editPayForm.method === m ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"
                  )}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Date paid</label>
            <input
              type="date"
              value={editPayForm.paidAt}
              onChange={(e) => setEditPayForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={editPayForm.notes}
              onChange={(e) => setEditPayForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="e.g. Paid at door"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSaveEditPayment}
              disabled={isPending || !editPayForm.amount || Number(editPayForm.amount) <= 0 || !editPayForm.paidAt}
              className="flex-1"
            >
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button variant="outline" onClick={() => setEditingPayment(null)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Invoice Modal */}
      <Modal open={invoiceOpen} onClose={() => setInvoiceOpen(false)} title={`Invoice ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ${customer.name}`}>
        <div className="space-y-4">
          {/* Filter tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            {(["unpaid", "complete", "all"] as const).map((f) => (
              <button key={f} onClick={() => setInvoiceJobFilter(f)}
                className={cn("flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                  invoiceJobFilter === f ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                {f === "unpaid" ? "Unpaid" : f === "complete" ? "Completed" : "All jobs"}
              </button>
            ))}
          </div>

          {/* Job list */}
          {visibleInvoiceJobs.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No jobs in this filter.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setSelectedJobIds(new Set(visibleInvoiceJobs.map(j => j.id)))}
                  className="text-xs text-blue-600 hover:underline">Select all</button>
                <button onClick={() => setSelectedJobIds(new Set())}
                  className="text-xs text-slate-400 hover:underline">Clear</button>
              </div>
              {visibleInvoiceJobs.map((job) => {
                const jobBalance = jobBalanceMap.get(job.id) ?? { paid: 0, due: job.price, settled: false };
                const checked = selectedJobIds.has(job.id);
                return (
                  <label key={job.id} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                    checked ? "border-blue-300 bg-blue-50" : "border-slate-100 hover:border-slate-200"
                  )}>
                    <input type="checkbox" checked={checked} onChange={() => toggleJob(job.id)} className="rounded accent-blue-600" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">{fmtDate(job.workDay.date)}</p>
                      <p className="text-xs text-slate-400">
                        {job.status}{job.isOneOff ? " ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· one-off" : ""}
                        {jobBalance.paid > 0 ? ` Â· paid ${fmtCurrency(jobBalance.paid)}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-700">{fmtCurrency(job.price)}</p>
                      {jobBalance.due > 0 ? <p className="text-xs text-red-500">{fmtCurrency(jobBalance.due)} due</p> : <p className="text-xs text-green-600">Settled</p>}
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Summary */}
          {selectedJobIds.size > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-slate-600">{selectedJobIds.size} job{selectedJobIds.size !== 1 ? "s" : ""} ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· {fmtCurrency(invoiceTotal)} total</p>
              <p className="text-sm font-bold text-red-600">{fmtCurrency(invoiceDue)} due</p>
            </div>
          )}

          {/* Status message */}
          {invoiceMsg && (
            <div className={cn("text-sm px-3 py-2 rounded-lg border",
              invoiceStatus === "error" ? "bg-red-50 border-red-200 text-red-700" :
              "bg-green-50 border-green-200 text-green-700")}>
              {invoiceMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              onClick={() => handleInvoiceAction("pdf")}
              disabled={invoiceStatus === "loading" || selectedJobIds.size === 0}
              className="flex-1">
              <Download size={14} />
              {invoiceStatus === "loading" ? "GeneratingÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦" : "Download PDF"}
            </Button>
            <Button
              onClick={() => handleInvoiceAction("email")}
              disabled={invoiceStatus === "loading" || selectedJobIds.size === 0 || !customer.email}
              variant="outline"
              className="flex-1"
              title={!customer.email ? "Add an email address to this customer first" : ""}>
              <Mail size={14} />
              {!customer.email ? "No email" : "Send email"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Tags Modal */}
      <Modal open={tagsOpen} onClose={() => setTagsOpen(false)} title={`Tags ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ${customer.name}`}>
        <div className="space-y-4">
          {allTags.length === 0 ? (
            <p className="text-sm text-slate-500">No tags defined yet. Go to Settings ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ Customer Tags to create some.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {allTags.map((tag) => {
                const active = selectedTagIds.has(tag.id);
                return (
                  <label key={tag.id} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                    active ? "border-blue-300 bg-blue-50" : "border-slate-100 hover:border-slate-200"
                  )}>
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => setSelectedTagIds((prev) => {
                        const next = new Set(prev);
                        next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id);
                        return next;
                      })}
                      className="rounded accent-blue-600"
                    />
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button onClick={handleSaveTags} disabled={tagPending} className="flex-1">
              {tagPending ? "SavingÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦" : "Save Tags"}
            </Button>
            <Button variant="outline" onClick={() => setTagsOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* SMS Modal */}
      <Modal open={smsOpen} onClose={() => setSmsOpen(false)} title={`Send SMS ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ${customer.name}`}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">To (phone number)</label>
            <input
              type="tel"
              value={smsTo}
              onChange={(e) => setSmsTo(e.target.value)}
              placeholder="e.g. 07700 900123 or 447700900123"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Include country code (e.g. 447700...) or local format with 0 ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â we'll strip spaces.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Message
              <span className="ml-2 text-slate-400 font-normal">{smsMsg.length}/160</span>
            </label>
            <textarea
              value={smsMsg}
              onChange={(e) => setSmsMsg(e.target.value)}
              rows={4}
              maxLength={918}
              placeholder="Type your message here..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          {smsResult && (
            <div className={cn(
              "text-sm px-3 py-2 rounded-lg border",
              smsResult.ok
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            )}>
              {smsResult.msg}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSendSms}
              disabled={smsSending || !smsTo.trim() || !smsMsg.trim()}
              className="flex-1"
            >
              <MessageSquare size={14} />
              {smsSending ? "SendingÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦" : "Send SMS"}
            </Button>
            <Button variant="outline" onClick={() => setSmsOpen(false)} className="flex-1">Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
