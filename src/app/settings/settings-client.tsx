"use client";

import { useState, useTransition, useRef, useCallback, useEffect } from "react";
import {
  Save, Upload, X, Building2, Mail, Eye, EyeOff,
  Tag as TagIcon, Plus, Trash2, MessageSquare, Send,
  Loader2, CheckCircle2, AlertCircle, FileText,
  ExternalLink, ShieldCheck, ChevronDown, ChevronUp,
  Users, UserX, Link2, RefreshCw, KeyRound, Database } from "lucide-react";
import { updateBusinessSettings, createTag, deleteTag } from "@/lib/actions";
import { runPaymentRemindersNow } from "@/lib/text-actions";
import { DataTab, type DataCounts } from "./data-tab";
import { AUTO_SMS_ENABLED } from "@/lib/features";
import { createInvite, listTeamMembers, listPendingInvites, revokeInvite, removeTeamMember, updateWorkerPermissions, changePassword, resetWorkerPassword } from "@/lib/auth-actions";
import { ROLE_PRESETS, ALL_PERMISSIONS, PERMISSION_LABELS, DEFAULT_WORKER_PERMISSIONS, type Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Settings {
  businessName: string; ownerName: string; phone: string; email: string;
  address: string; bankDetails: string; vatNumber: string;
  invoicePrefix: string; nextInvoiceNum: number; invoiceNumbersStarted: boolean; logoBase64: string | null;
  goCardlessEnvironment: string; goCardlessReferencePrefix: string;
  goCardlessAccessTokenConfigured: boolean; goCardlessLastSyncedAt: string | null;
  smtpProvider: string; smtpHost: string; smtpPort: number;
  smtpUser: string; smtpFromName: string; smtpPassConfigured: boolean;
  voodooSender: string; voodooApiKeyConfigured: boolean;
  messagingProvider: string; twilioAccountSid: string;
  twilioAuthTokenConfigured: boolean; twilioFromNumber: string;
  metaPhoneNumberId: string; metaAccessTokenConfigured: boolean; metaWabaId: string;
  tmplCleaningReminder: string; tmplJobComplete: string;
  tmplPaymentReminder1: string; tmplPaymentReminder2: string;
  tmplPaymentReminder3: string; tmplPaymentReceived: string;
  tmplJobAndPayment: string; tmplInvoiceNote: string;
  tmplCleanedBank: string;
  textSendMethod: string;
  textsTestMode: boolean; textCleanedEnabled: boolean; textSkipCleanedIfPaid: boolean;
  textPaymentReminderDays: number; textPaymentReminder2Days: number; textsServerLive: boolean;
  runDueWindowDays: number | null;
  canManageProviderSettings: boolean;
}

interface BroadcastCustomer {
  id: number; name: string; phone: string | null;
  address: string; area: { name: string } | null;
}

type Tag = { id: number; name: string; color: string };

type TeamMember = { id: string; name: string | null; email: string; role: "OWNER" | "WORKER"; joinedAt: Date; permissions: string[] };
type PendingInvite = { id: number; email: string; expiresAt: Date; createdAt: Date };

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ["general", "email", "messaging", "templates", "broadcast", "tags", "team", "data", "security"] as const;
type Tab = (typeof TABS)[number];
const ROLLOUT_DISABLED_TABS: Tab[] = ["email"];
const RESTRICTED_TABS: Tab[] = ["team", "data"];

const TAB_META: Record<Tab, { label: string; icon: React.ReactNode }> = {
  general:   { label: "Business",   icon: <Building2 size={13} /> },
  email:     { label: "Email",      icon: <Mail size={13} /> },
  messaging: { label: "Messaging",  icon: <MessageSquare size={13} /> },
  templates: { label: "Templates",  icon: <FileText size={13} /> },
  broadcast: { label: "Broadcast",  icon: <Send size={13} /> },
  tags:      { label: "Tags",       icon: <TagIcon size={13} /> },
  team:      { label: "Team",       icon: <Users size={13} /> },
  data:      { label: "Data",       icon: <Database size={13} /> },
  security:  { label: "Security",   icon: <ShieldCheck size={13} /> },
};

const MESSAGING_PROVIDERS = [
  { value: "voodoosms",       label: "VoodooSMS"           },
  { value: "twilio_sms",      label: "Twilio (SMS)"        },
  { value: "twilio_whatsapp", label: "Twilio (WhatsApp)"   },
  { value: "meta_whatsapp",   label: "Meta WhatsApp Cloud" },
  { value: "none",            label: "Disabled"            },
];

const SMTP_PROVIDERS = [
  { value: "gmail",        label: "Gmail",          host: "smtp.gmail.com",      port: 587 },
  { value: "icloud",       label: "iCloud Mail",    host: "smtp.mail.me.com",    port: 587 },
  { value: "microsoft365", label: "Microsoft 365",  host: "smtp.office365.com",  port: 587 },
  { value: "custom",       label: "Custom SMTP",    host: "",                    port: 587 },
];

const APP_PW_LINKS: Record<string, { url: string; label: string }> = {
  gmail:        { url: "https://myaccount.google.com/apppasswords",  label: "Create Gmail App Password →" },
  icloud:       { url: "https://appleid.apple.com/account/manage",   label: "Create iCloud App-Specific Password →" },
  microsoft365: { url: "https://aka.ms/mfasetup",                    label: "Microsoft account security settings →" },
};

const PLACEHOLDER_CHIPS = [
  { label: "Customer name",  value: "{{customerName}}"      },
  { label: "First name",     value: "{{customerFirstName}}" },
  { label: "Area",           value: "{{areaName}}"          },
  { label: "Job date",       value: "{{jobDate}}"           },
  { label: "Job price",      value: "{{jobPrice}}"          },
  { label: "Amount due",     value: "{{amountDue}}"         },
  { label: "Biz name",       value: "{{businessName}}"      },
  { label: "Biz phone",      value: "{{businessPhone}}"     },
  { label: "Cleaner",        value: "{{workerName}}"        },
  { label: "Next due date",  value: "{{nextDueDate}}"       },
  { label: "Address",        value: "{{customerAddress}}"   },
  { label: "Bank details",   value: "{{bankDetails}}"       },
  { label: "Pay reference",  value: "{{paymentReference}}"  },
];

type TmplKey =
  | "tmplCleaningReminder" | "tmplJobComplete"
  | "tmplPaymentReminder1" | "tmplPaymentReminder2" | "tmplPaymentReminder3"
  | "tmplPaymentReceived"  | "tmplJobAndPayment"     | "tmplInvoiceNote"
  | "tmplCleanedBank";

const TEMPLATE_DEFS: { key: TmplKey; label: string; desc: string }[] = [
  { key: "tmplCleaningReminder",  label: "Day Reminder",                  desc: "Default text for day reminders (you can edit it each time you send)" },
  { key: "tmplCleanedBank",       label: "Cleaned — how to pay",          desc: "Sent when an area is completed. Bank details come from Settings → Business; the reference is the first line of the address" },
  { key: "tmplJobComplete",       label: "Job Completion Notice",         desc: "Sent right after completing a clean" },
  { key: "tmplPaymentReminder1",  label: "Payment Reminder — 1st",        desc: "Friendly first payment chaser" },
  { key: "tmplPaymentReminder2",  label: "Payment Reminder — 2nd",        desc: "Second chaser, more urgent" },
  { key: "tmplPaymentReminder3",  label: "Payment Reminder — 3rd",        desc: "Final notice before escalation" },
  { key: "tmplPaymentReceived",   label: "Payment Received",              desc: "Confirmation message once paid" },
  { key: "tmplJobAndPayment",     label: "Job Complete + Payment Due",    desc: "Job done and balance outstanding together" },
  { key: "tmplInvoiceNote",       label: "Additional Invoice Note",       desc: "Extra text shown at the bottom of every invoice (optional)" },
];

// ── Placeholder chips component ───────────────────────────────────────────────

function PlaceholderChips({ onInsert }: { onInsert: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {PLACEHOLDER_CHIPS.map((chip) => (
        <button
          key={chip.value}
          type="button"
          onClick={() => onInsert(chip.value)}
          className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors"
        >
          + {chip.label}
        </button>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SettingsClient({
  settings,
  canManageProviderSettings,
  tags: initialTags,
  customers,
  initialTeam,
  initialInvites,
  dataCounts = null,
}: {
  settings: Settings;
  canManageProviderSettings: boolean;
  tags: Tag[];
  customers: BroadcastCustomer[];
  initialTeam: TeamMember[];
  initialInvites: PendingInvite[];
  dataCounts?: DataCounts | null;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const visibleTabs = TABS.filter(
    (value) => !ROLLOUT_DISABLED_TABS.includes(value) && (canManageProviderSettings || !RESTRICTED_TABS.includes(value))
  );

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    businessName: settings.businessName, ownerName: settings.ownerName,
    phone: settings.phone, email: settings.email, address: settings.address,
    bankDetails: settings.bankDetails, vatNumber: settings.vatNumber,
    invoicePrefix: settings.invoicePrefix,
    nextInvoiceNum: String(settings.nextInvoiceNum),
    runDueWindowDays: settings.runDueWindowDays == null ? "" : String(settings.runDueWindowDays),
  });

  const [smtp, setSmtp] = useState({
    smtpProvider: settings.smtpProvider || "gmail",
    smtpHost: settings.smtpHost || "",
    smtpPort: settings.smtpPort || 587,
    smtpUser: settings.smtpUser || "",
    smtpPass: "",
    smtpFromName: settings.smtpFromName || "",
  });

  const [messaging, setMessaging] = useState({
    messagingProvider: settings.messagingProvider || "voodoosms",
    voodooApiKey: "",
    voodooSender: settings.voodooSender || "VoodooSMS",
    twilioAccountSid: settings.twilioAccountSid || "",
    twilioAuthToken: "",
    twilioFromNumber: settings.twilioFromNumber || "",
    metaPhoneNumberId: settings.metaPhoneNumberId || "",
    metaAccessToken: "",
    metaWabaId: settings.metaWabaId || "",
  });

  const [goCardless, setGoCardless] = useState({
    environment: settings.goCardlessEnvironment || "live",
    accessToken: "",
    referencePrefix: settings.goCardlessReferencePrefix || "WD",
  });

  const [templates, setTemplates] = useState<Record<TmplKey, string>>({
    tmplCleaningReminder: settings.tmplCleaningReminder || "",
    tmplJobComplete:      settings.tmplJobComplete      || "",
    tmplPaymentReminder1: settings.tmplPaymentReminder1 || "",
    tmplPaymentReminder2: settings.tmplPaymentReminder2 || "",
    tmplPaymentReminder3: settings.tmplPaymentReminder3 || "",
    tmplPaymentReceived:  settings.tmplPaymentReceived  || "",
    tmplJobAndPayment:    settings.tmplJobAndPayment    || "",
    tmplInvoiceNote:      settings.tmplInvoiceNote      || "",
    tmplCleanedBank:      settings.tmplCleanedBank      || "",
  });

  // Automatic texts
  const [autoTexts, setAutoTexts] = useState({
    textSendMethod: settings.textSendMethod === "VOODOO" ? "VOODOO" : "PHONE",
    textsTestMode: settings.textsTestMode ?? true,
    textCleanedEnabled: settings.textCleanedEnabled ?? false,
    textSkipCleanedIfPaid: settings.textSkipCleanedIfPaid ?? true,
    textPaymentReminderDays: settings.textPaymentReminderDays ?? 0,
    textPaymentReminder2Days: settings.textPaymentReminder2Days ?? 0,
  });
  const [reminderRun, setReminderRun] = useState<string | null>(null);

  const templateRefs = useRef<Partial<Record<TmplKey, HTMLTextAreaElement | null>>>({});

  const [logo, setLogo] = useState<string | null>(settings.logoBase64 ?? null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Save state ────────────────────────────────────────────────────────────
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showVoodooKey, setShowVoodooKey] = useState(false);
  const [showTwilioAuth, setShowTwilioAuth] = useState(false);
  const [showMetaToken, setShowMetaToken] = useState(false);
  const [showGoCardlessToken, setShowGoCardlessToken] = useState(false);
  const [metaGuideOpen, setMetaGuideOpen] = useState(false);
  type MetaVerify = { status: "idle" | "checking" | "ok" | "error"; displayNumber?: string; verifiedName?: string; qualityRating?: string; verificationStatus?: string; error?: string; };
  const [metaVerify, setMetaVerify] = useState<MetaVerify>({ status: "idle" });

  const handleVerifyMeta = async () => {
    setMetaVerify({ status: "checking" });
    try {
      const r = await fetch("/api/messaging/verify-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumberId: messaging.metaPhoneNumberId, accessToken: messaging.metaAccessToken }),
      });
      const data = await r.json();
      if (!r.ok || data.error) setMetaVerify({ status: "error", error: data.error ?? "Verification failed" });
      else setMetaVerify({ status: "ok", displayNumber: data.displayNumber, verifiedName: data.verifiedName, qualityRating: data.qualityRating, verificationStatus: data.verificationStatus });
    } catch (e) { setMetaVerify({ status: "error", error: String(e) }); }
  };

  // ── Tags ──────────────────────────────────────────────────────────────────
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3B82F6");
  const [tagPending, startTagTransition] = useTransition();

  // ── Team ──────────────────────────────────────────────────────────────────
  const [team, setTeam] = useState<TeamMember[]>(initialTeam);
  const [invites, setInvites] = useState<PendingInvite[]>(initialInvites);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailedTo, setInviteEmailedTo] = useState<string | null>(null);
  const [invitePending, startInviteTransition] = useTransition();
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [teamRefreshing, setTeamRefreshing] = useState(false);
  const [invitePermissions, setInvitePermissions] = useState<string[]>(DEFAULT_WORKER_PERMISSIONS);
  const [editingPermsMemberId, setEditingPermsMemberId] = useState<string | null>(null);
  const [pendingMemberPerms, setPendingMemberPerms] = useState<string[]>([]);
  const [permSaving, startPermSaveTransition] = useTransition();

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    setInviteLink(null);
    startInviteTransition(async () => {
      const res = await createInvite(inviteEmail.trim(), invitePermissions as Permission[]);
      if (res.ok) {
        setInviteLink(res.link);
        setInviteEmailedTo(res.emailed ? inviteEmail.trim() : null);
        setInviteEmail("");
        setInvitePermissions(DEFAULT_WORKER_PERMISSIONS);
        setInvites((prev) => [...prev, { id: Date.now(), email: inviteEmail.trim(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: new Date() }]);
      } else {
        setInviteError(res.error);
      }
    });
  };

  const handleRevokeInvite = async (id: number) => {
    await revokeInvite(id);
    setInvites((prev) => prev.filter((i) => i.id !== id));
  };

  const [resetMemberId, setResetMemberId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetResult, setResetResult] = useState<{ password?: string; error?: string } | null>(null);

  const handleRemoveMember = async (id: string) => {
    const res = await removeTeamMember(id);
    if (res.ok) setTeam((prev) => prev.filter((m) => m.id !== id));
    else alert(res.error);
  };

  const handleUpdatePermissions = (memberId: string, perms: string[]) => {
    startPermSaveTransition(async () => {
      const res = await updateWorkerPermissions(memberId, perms as Permission[]);
      if (res.ok) {
        setTeam((prev) => prev.map((m) => m.id === memberId ? { ...m, permissions: perms } : m));
        setEditingPermsMemberId(null);
      } else {
        alert(res.error ?? "Failed to update permissions");
      }
    });
  };

  const refreshTeam = async () => {
    setTeamRefreshing(true);
    try {
      const [members, pending] = await Promise.all([listTeamMembers(), listPendingInvites()]);
      setTeam(members);
      setInvites(pending);
    } finally {
      setTeamRefreshing(false);
    }
  };

  // ── Broadcast ─────────────────────────────────────────────────────────────
  const [bcSearch, setBcSearch] = useState("");
  const [bcSelected, setBcSelected] = useState<Set<number>>(new Set());
  const [bcMessage, setBcMessage] = useState("");
  const [bcSending, setBcSending] = useState(false);
  const [bcResults, setBcResults] = useState<{ id: number; name: string; success: boolean; error?: string }[] | null>(null);
  const bcMsgRef = useRef<HTMLTextAreaElement>(null);

  // ── Change password ──────────────────────────────────────────────────────────────────────────────
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [showPwFields, setShowPwFields] = useState(false);
  const [pwStatus, setPwStatus] = useState<"idle" | "success" | "error">("idle");
  const [pwMessage, setPwMessage] = useState("");
  const [pwPending, startPwTransition] = useTransition();

  const handleChangePassword = () => {
    setPwMessage("");
    setPwStatus("idle");
    if (pwNew !== pwConfirm) { setPwStatus("error"); setPwMessage("New passwords do not match."); return; }
    if (pwNew.length < 8) { setPwStatus("error"); setPwMessage("New password must be at least 8 characters."); return; }
    startPwTransition(async () => {
      const res = await changePassword(pwCurrent, pwNew);
      if (res.ok) {
        setPwStatus("success");
        setPwMessage("Password updated successfully.");
        setPwCurrent(""); setPwNew(""); setPwConfirm("");
      } else {
        setPwStatus("error");
        setPwMessage(res.error ?? "Failed to change password.");
      }
    });
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(bcSearch.toLowerCase()) ||
      c.address.toLowerCase().includes(bcSearch.toLowerCase()) ||
      (c.area?.name ?? "").toLowerCase().includes(bcSearch.toLowerCase())
  );

  // ── Helpers ───────────────────────────────────────────────────────────────

  const insertInto = useCallback(
    (ta: HTMLTextAreaElement | null | undefined, current: string, ph: string, setter: (v: string) => void) => {
      if (!ta) { setter(current + ph); return; }
      const s = ta.selectionStart ?? current.length;
      const e = ta.selectionEnd ?? current.length;
      const next = current.slice(0, s) + ph + current.slice(e);
      setter(next);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s + ph.length, s + ph.length); }, 0);
    },
    []
  );

  const handleSave = () => {
    setSaveError(null);
    startTransition(async () => {
      try {
        const { runDueWindowDays: windowText, nextInvoiceNum: invoiceStartText, ...formRest } = form;
        const payload: Record<string, unknown> = {
          ...formRest,
          ...(settings.invoiceNumbersStarted ? {} : { nextInvoiceNum: Math.max(1, Math.floor(Number(invoiceStartText) || 1)) }),
          logoBase64: logo,
          runDueWindowDays: windowText.trim() === "" ? null : Math.max(0, Math.min(90, Number(windowText) || 0)),
        };

        if (canManageProviderSettings) {
          Object.assign(payload, {
            goCardlessEnvironment: goCardless.environment,
            goCardlessReferencePrefix: goCardless.referencePrefix.trim() || "WD",
            smtpProvider: smtp.smtpProvider,
            smtpHost: smtp.smtpHost,
            smtpPort: smtp.smtpPort,
            smtpUser: smtp.smtpUser,
            smtpFromName: smtp.smtpFromName,
            voodooSender: messaging.voodooSender,
            messagingProvider: messaging.messagingProvider,
            twilioAccountSid: messaging.twilioAccountSid,
            twilioFromNumber: messaging.twilioFromNumber,
            metaPhoneNumberId: messaging.metaPhoneNumberId,
            metaWabaId: messaging.metaWabaId,
            ...templates,
            ...autoTexts,
          });

          if (smtp.smtpPass.trim()) payload.smtpPass = smtp.smtpPass.trim();
          if (goCardless.accessToken.trim()) payload.goCardlessAccessToken = goCardless.accessToken.trim();
          if (messaging.voodooApiKey.trim()) payload.voodooApiKey = messaging.voodooApiKey.trim();
          if (messaging.twilioAuthToken.trim()) payload.twilioAuthToken = messaging.twilioAuthToken.trim();
          if (messaging.metaAccessToken.trim()) payload.metaAccessToken = messaging.metaAccessToken.trim();
        }

        await updateBusinessSettings(payload);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setSaveError(String(e));
      }
    });
  };

  const handleBroadcast = async () => {
    if (bcSelected.size === 0 || !bcMessage.trim()) return;
    setBcSending(true); setBcResults(null);
    try {
      const r = await fetch("/api/messaging/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds: [...bcSelected], message: bcMessage }),
      });
      const data = await r.json();
      setBcResults(data.results ?? [{ id: 0, name: "Error", success: false, error: data.error ?? "Unknown error" }]);
    } catch (e) {
      setBcResults([{ id: 0, name: "Error", success: false, error: String(e) }]);
    } finally { setBcSending(false); }
  };

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    startTagTransition(async () => {
      await createTag({ name: newTagName.trim(), color: newTagColor });
      setTags((prev) => [...prev, { id: Date.now(), name: newTagName.trim(), color: newTagColor }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName(""); setNewTagColor("#3B82F6");
    });
  };

  const setS = (k: keyof typeof smtp) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = k === "smtpPort" ? Number(e.target.value) : e.target.value;
    if (k === "smtpProvider" && e.target.value !== "custom") {
      const preset = SMTP_PROVIDERS.find((p) => p.value === e.target.value);
      if (preset) { setSmtp((s) => ({ ...s, smtpProvider: e.target.value, smtpHost: preset.host, smtpPort: preset.port })); return; }
    }
    setSmtp((s) => ({ ...s, [k]: val }));
  };

  // Broadcast preview for first selected customer
  const firstSelected = [...bcSelected][0];
  const previewCust = customers.find((c) => c.id === firstSelected);
  const previewMsg = previewCust
    ? bcMessage
        .replaceAll("{{customerName}}", previewCust.name)
        .replaceAll("{{customerFirstName}}", previewCust.name.split(" ")[0])
        .replaceAll("{{customerAddress}}", previewCust.address)
        .replaceAll("{{areaName}}", previewCust.area?.name ?? "")
        .replaceAll("{{businessName}}", form.businessName)
        .replaceAll("{{businessPhone}}", form.phone)
    : null;

  const inp = "w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const lbl = "block text-sm font-medium text-slate-700 mb-1";
  const smtpPreset = SMTP_PROVIDERS.find((p) => p.value === smtp.smtpProvider);
  const appPwLink = APP_PW_LINKS[smtp.smtpProvider];
  const showSave = tab !== "broadcast" && tab !== "tags" && tab !== "team" && tab !== "data";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">

      {!canManageProviderSettings && (
        <div className="bg-slate-50 border border-slate-200 text-slate-600 text-sm px-4 py-3 rounded-lg">
          Provider credentials and team management are restricted to owners and admins.
        </div>
      )}

      {AUTO_SMS_ENABLED && <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-lg">
        {settings.textsServerLive && !autoTexts.textsTestMode
          ? "Texts are LIVE: customers will receive them."
          : "Texts are in test mode: nothing is sent to customers. Every text is written to the message log (Texts page) so you can check it."}
        {" "}Invoice emails are still switched off.
      </div>}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Settings</h1>
        {showSave && (
          <Button onClick={handleSave} disabled={isPending}>
            <Save size={14} />
            {isPending ? "Saving…" : saved ? "Saved!" : "Save Changes"}
          </Button>
        )}
      </div>

      {saveError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{saveError}</div>}
      {saved && !saveError && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg">Settings saved successfully.</div>}

      {/* Tab bar */}
      {/* Wraps onto a second line instead of scrolling sideways, so every tab is always visible. */}
      <div role="tablist" aria-label="Settings sections" className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-[#1E2840] dark:bg-[#131929]">
        {visibleTabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              tab === t ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-[#1E2840]")}>
            {TAB_META[t].icon}{TAB_META[t].label}
          </button>
        ))}
      </div>

      {/* ── BUSINESS ─────────────────────────────────────────────────────── */}
      {tab === "general" && (
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle><Building2 size={16} className="inline mr-2 text-blue-600" />Business Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className={lbl}>Logo</label>
                <div className="flex items-center gap-3">
                  {logo ? (
                    <div className="relative w-20 h-20 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={logo} alt="logo" className="max-w-full max-h-full object-contain" />
                      <button onClick={() => setLogo(null)} className="absolute top-0.5 right-0.5 bg-white rounded-full p-0.5 shadow text-slate-500 hover:text-red-500"><X size={12} /></button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-slate-300"><Building2 size={28} /></div>
                  )}
                  <div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => setLogo(ev.target?.result as string); r.readAsDataURL(f); }} />
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload size={13} />{logo ? "Change logo" : "Upload logo"}</Button>
                    <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG — shown on invoices</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className={lbl}>Business name *</label><input className={inp} value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} placeholder="My Window Cleaning" /></div>
                <div><label className={lbl}>Owner / trader name</label><input className={inp} value={form.ownerName} onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))} placeholder="John Smith" /></div>
                <div><label className={lbl}>Phone</label><input className={inp} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="07700 900 123" /></div>
                <div className="col-span-2"><label className={lbl}>Email</label><input type="email" className={inp} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="hello@mybusiness.co.uk" /></div>
                <div className="col-span-2"><label className={lbl}>Business address</label><textarea className={cn(inp, "resize-none")} rows={3} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder={"123 High Street\nYour Town\nAB1 2CD"} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Scheduling</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <label className={lbl}>Keep areas together: include customers due up to</label>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={90} className={cn(inp, "w-40")} value={form.runDueWindowDays}
                  placeholder="Half the frequency"
                  onChange={(e) => setForm((f) => ({ ...f, runDueWindowDays: e.target.value }))} />
                <span className="text-sm text-slate-600">days after the run</span>
              </div>
              <p className="text-xs text-slate-500">
                When an area&apos;s run is booked, everyone due by then, or within this many days after, goes on it. Bigger
                means nobody waits an extra cycle (at most they&apos;re cleaned a little early). Leave blank for half the
                area&apos;s frequency, e.g. 14 days for 4-weekly. Each area can have its own number in Areas.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Invoice Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Invoice prefix</label><input className={inp} value={form.invoicePrefix} onChange={(e) => setForm((f) => ({ ...f, invoicePrefix: e.target.value }))} placeholder="INV" /><p className="text-xs text-slate-400 mt-1">e.g. INV → INV-0001</p></div>
                {settings.invoiceNumbersStarted ? (
                  <div><label className={lbl}>Next invoice #</label><input className={cn(inp, "bg-slate-50 text-slate-500")} value={settings.nextInvoiceNum} disabled readOnly /><p className="text-xs text-slate-400 mt-1">Locked: invoices have been issued. Goes up by one each time.</p></div>
                ) : (
                  <div><label className={lbl} htmlFor="inv-start">First invoice number</label><input id="inv-start" type="number" min={1} step={1} className={inp} value={form.nextInvoiceNum} onChange={(e) => setForm((f) => ({ ...f, nextInvoiceNum: e.target.value }))} /><p className="text-xs text-slate-400 mt-1">Carry on from your old numbering. Locks once your first invoice is issued.</p></div>
                )}
                <div><label className={lbl}>VAT number</label><input className={inp} value={form.vatNumber} onChange={(e) => setForm((f) => ({ ...f, vatNumber: e.target.value }))} placeholder="GB123456789 (optional)" /></div>
              </div>
              <div>
                <label className={lbl}>Bank / payment details</label>
                <textarea className={cn(inp, "resize-none")} rows={4} value={form.bankDetails} onChange={(e) => setForm((f) => ({ ...f, bankDetails: e.target.value }))} placeholder={"Bank: Lloyds\nAccount name: J Smith Window Cleaning\nSort code: 12-34-56\nAccount: 12345678"} />
                <p className="text-xs text-slate-400 mt-1">Shown at the bottom of every invoice</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle><Link2 size={16} className="inline mr-2 text-blue-600" />GoCardless</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                Store one GoCardless access token per Wyndos account, then sync confirmed payments into the Payments page. Matching works best when each customer has a saved GoCardless reference or mandate ID in their customer profile.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Environment</label>
                  <select
                    value={goCardless.environment}
                    onChange={(e) => setGoCardless((current) => ({ ...current, environment: e.target.value }))}
                    className={cn(inp, "bg-white")}
                  >
                    <option value="live">Live</option>
                    <option value="sandbox">Sandbox</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Reference prefix</label>
                  <input
                    className={inp}
                    value={goCardless.referencePrefix}
                    onChange={(e) => setGoCardless((current) => ({ ...current, referencePrefix: e.target.value.toUpperCase() }))}
                    placeholder="WD"
                  />
                  <p className="mt-1 text-xs text-slate-400">Suggested customer ref format: {`${goCardless.referencePrefix.trim() || "WD"}-C123`}</p>
                </div>
              </div>
              <div>
                <label className={lbl}>Access token</label>
                <div className="relative">
                  <input
                    type={showGoCardlessToken ? "text" : "password"}
                    className={cn(inp, "pr-9")}
                    value={goCardless.accessToken}
                    onChange={(e) => setGoCardless((current) => ({ ...current, accessToken: e.target.value }))}
                    placeholder={settings.goCardlessAccessTokenConfigured ? "Configured - enter a new token to replace it" : "Paste your GoCardless access token"}
                  />
                  <button type="button" onClick={() => setShowGoCardlessToken((value) => !value)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showGoCardlessToken ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {settings.goCardlessAccessTokenConfigured ? "A token is already stored. Leave this blank to keep the current token." : "Use a GoCardless access token for the relevant live or sandbox account."}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
                <p>To link payments reliably, set the same customer reference in both systems, or save the customer&apos;s GoCardless mandate ID in Wyndos.</p>
                <p>Last sync: {settings.goCardlessLastSyncedAt ? new Date(settings.goCardlessLastSyncedAt).toLocaleString("en-GB") : "Never"}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── EMAIL ─────────────────────────────────────────────────────────── */}
      {tab === "email" && (
        <Card>
          <CardHeader><CardTitle><Mail size={16} className="inline mr-2 text-blue-600" />Email (for sending invoices)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className={lbl}>Email provider</label>
              <select value={smtp.smtpProvider} onChange={setS("smtpProvider")} className={cn(inp, "bg-white")}>
                {SMTP_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {appPwLink && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                <strong>{smtpPreset?.label}</strong> requires an app password.{" "}
                <a href={appPwLink.url} target="_blank" rel="noreferrer" className="underline font-medium">{appPwLink.label}</a>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Username / email</label><input type="email" className={inp} value={smtp.smtpUser} onChange={setS("smtpUser")} placeholder="you@gmail.com" /></div>
              <div>
                <label className={lbl}>{smtp.smtpProvider === "custom" ? "Password" : "App password"}</label>
                <div className="relative">
                  <input type={showSmtpPass ? "text" : "password"} className={cn(inp, "pr-9")} value={smtp.smtpPass} onChange={setS("smtpPass")} placeholder={settings.smtpPassConfigured ? "Configured - enter a new password to replace it" : "Enter app password"} />
                  <button type="button" onClick={() => setShowSmtpPass((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showSmtpPass ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                </div>
                <p className="text-xs text-slate-400 mt-1">{settings.smtpPassConfigured ? "A password is already stored. Leave this blank to keep the current value." : "Stored passwords are never shown after saving."}</p>
              </div>
              <div>
                <label className={lbl}>From name (optional)</label>
                <input className={inp} value={smtp.smtpFromName} onChange={setS("smtpFromName")} placeholder={form.businessName || "My Window Cleaning"} />
                <p className="text-xs text-slate-400 mt-1">Shown in customer&apos;s inbox as sender name</p>
              </div>
              {smtp.smtpProvider === "custom" ? (
                <>
                  <div><label className={lbl}>SMTP host</label><input className={inp} value={smtp.smtpHost} onChange={setS("smtpHost")} placeholder="smtp.example.com" /></div>
                  <div><label className={lbl}>Port</label><input type="number" className={inp} value={smtp.smtpPort} onChange={setS("smtpPort")} placeholder="587" /></div>
                </>
              ) : (
                <div><label className={cn(lbl, "text-slate-400")}>SMTP host (auto)</label><input className={cn(inp, "bg-slate-50 text-slate-400")} value={smtp.smtpHost || smtpPreset?.host || ""} disabled readOnly /></div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── MESSAGING ─────────────────────────────────────────────────────── */}
      {tab === "messaging" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle><Send size={16} className="inline mr-2 text-blue-600" />Automatic texts</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!AUTO_SMS_ENABLED && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Texts go from your own phone, free on your plan: each one opens in Messages ready to send. Automatic texts below wait on the Texts page until you send them.
                </p>
              )}
              {AUTO_SMS_ENABLED && <>
              <div className="space-y-1.5">
                <p className="font-semibold text-slate-800">How texts are sent</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ["PHONE", "From my phone", "Free on your phone plan. Each text opens in Messages; tap Send and the next one is ready. Automatic texts wait on the Texts page until you send them."],
                    ["VOODOO", "Automatically (VoodooSMS)", "Sent for you, no tapping. Pay VoodooSMS per text. Needs your API key below."],
                  ] as const).map(([key, label, hint]) => (
                    <button key={key} type="button" onClick={() => setAutoTexts((a) => ({ ...a, textSendMethod: key }))}
                      className={cn("rounded-lg border p-3 text-left", autoTexts.textSendMethod === key ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-blue-300")}>
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block text-xs text-slate-500">{hint}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">You can still pick the other way each time you send.</p>
              </div>

              <label className={cn("flex items-start gap-3", autoTexts.textSendMethod === "PHONE" && "opacity-50")}>
                <input type="checkbox" className="mt-1" checked={autoTexts.textsTestMode}
                  onChange={(e) => setAutoTexts((a) => ({ ...a, textsTestMode: e.target.checked }))} />
                <span>
                  <span className="font-semibold text-slate-800">Test mode</span>
                  <span className="block text-xs text-slate-500">
                    Nothing is sent: texts only go in the log.
                    {!settings.textsServerLive && " (The server also has live texts switched off, so nothing can be sent yet either way.)"}
                  </span>
                </span>
              </label>
              </>}

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <label className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1" checked={autoTexts.textCleanedEnabled}
                    onChange={(e) => setAutoTexts((a) => ({ ...a, textCleanedEnabled: e.target.checked }))} />
                  <span>
                    <span className="font-semibold text-slate-800">&ldquo;Windows cleaned, here&apos;s how to pay&rdquo;</span>
                    <span className="block text-xs text-slate-500">Sent when you complete an area. Uses the <em>Cleaned — how to pay</em> template. Direct Debit customers are never sent it.</span>
                  </span>
                </label>
                <label className={cn("ml-7 flex items-start gap-3", !autoTexts.textCleanedEnabled && "opacity-50")}>
                  <input type="checkbox" className="mt-1" disabled={!autoTexts.textCleanedEnabled} checked={autoTexts.textSkipCleanedIfPaid}
                    onChange={(e) => setAutoTexts((a) => ({ ...a, textSkipCleanedIfPaid: e.target.checked }))} />
                  <span>
                    <span className="font-semibold text-slate-800">Don&apos;t text people who paid on the day</span>
                    <span className="block text-xs text-slate-500">If the visit was marked paid before the area was completed, no text.</span>
                  </span>
                </label>
              </div>

              <div className="border-t border-slate-100 pt-3 space-y-2">
                <p className="font-semibold text-slate-800">Payment reminders</p>
                <p className="text-xs text-slate-500">Counted from the oldest unpaid clean. 0 = off. Each reminder goes once per unpaid clean. Direct Debit customers are never chased.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>1st reminder after (days)</label>
                    <input type="number" min={0} className={inp} value={autoTexts.textPaymentReminderDays}
                      onChange={(e) => setAutoTexts((a) => ({ ...a, textPaymentReminderDays: Math.max(0, Number(e.target.value) || 0) }))} />
                  </div>
                  <div>
                    <label className={lbl}>2nd reminder after (days)</label>
                    <input type="number" min={0} className={inp} value={autoTexts.textPaymentReminder2Days}
                      onChange={(e) => setAutoTexts((a) => ({ ...a, textPaymentReminder2Days: Math.max(0, Number(e.target.value) || 0) }))} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={isPending}
                    onClick={() => startTransition(async () => {
                      try {
                        const r = await runPaymentRemindersNow();
                        setReminderRun(r.skipped === "off"
                          ? "Payment reminders are off (both set to 0). Save first if you just changed them."
                          : `${r.logged} reminder${r.logged === 1 ? "" : "s"} ${r.phone ? "ready to send from your phone (Texts page)" : r.test ? "logged (test mode, not sent)" : "sent"}.`);
                      } catch (e) { setReminderRun(String(e)); }
                    })}>
                    Run reminders now
                  </Button>
                  <a href="/messages?tab=log" className="text-xs font-medium text-blue-600 hover:underline">Open the text log →</a>
                </div>
                {reminderRun && <p className="text-xs text-slate-600">{reminderRun}</p>}
                <p className="text-[11px] text-slate-400">{AUTO_SMS_ENABLED ? "Once live, they run automatically every day." : "Each day, any that are due are added to the Texts page, ready to send from your phone."}</p>
              </div>
            </CardContent>
          </Card>
          {AUTO_SMS_ENABLED && <>
          <Card>
            <CardHeader><CardTitle><MessageSquare size={16} className="inline mr-2 text-blue-600" />Messaging Provider</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Choose how messages (reminders, notifications, broadcasts) are sent to customers.</p>
              <div className="grid grid-cols-2 gap-2">
                {MESSAGING_PROVIDERS.map((p) => (
                  <button key={p.value} type="button" onClick={() => setMessaging((m) => ({ ...m, messagingProvider: p.value }))}
                    className={cn("py-2.5 rounded-lg border text-sm font-semibold transition-colors",
                      messaging.messagingProvider === p.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {messaging.messagingProvider === "voodoosms" && (
            <Card>
              <CardHeader><CardTitle>VoodooSMS Credentials</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  Get your API key from the{" "}
                  <a href="https://www.voodoosms.com/portal/api_sms/restful_api/" target="_blank" rel="noreferrer" className="underline font-medium">VoodooSMS Portal → Send SMS → API SMS → RESTful API</a>.
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={lbl}>API Key</label>
                    <div className="relative">
                      <input type={showVoodooKey ? "text" : "password"} className={cn(inp, "pr-9")} value={messaging.voodooApiKey}
                        onChange={(e) => setMessaging((m) => ({ ...m, voodooApiKey: e.target.value }))} placeholder={settings.voodooApiKeyConfigured ? "Configured - enter a new API key to replace it" : "Paste your VoodooSMS API key"} />
                      <button type="button" onClick={() => setShowVoodooKey((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showVoodooKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{settings.voodooApiKeyConfigured ? "An API key is already stored. Leave this blank to keep the current value." : "Stored API keys are never shown after saving."}</p>
                  </div>
                  <div>
                    <label className={lbl}>Sender name</label>
                    <input className={inp} value={messaging.voodooSender} onChange={(e) => setMessaging((m) => ({ ...m, voodooSender: e.target.value }))} placeholder="VoodooSMS" maxLength={11} />
                    <p className="text-xs text-slate-400 mt-1">Alphanumeric, max 11 chars</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {messaging.messagingProvider === "meta_whatsapp" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Meta WhatsApp Cloud API
                  {metaVerify.status === "ok" && <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full"><ShieldCheck size={11} /> Verified</span>}
                  {metaVerify.status === "error" && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full"><AlertCircle size={11} /> Error</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* ── Collapsible step-by-step guide ── */}
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <button type="button" onClick={() => setMetaGuideOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-sm font-semibold text-slate-700">
                    <span>📋 Step-by-step setup guide</span>
                    {metaGuideOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {metaGuideOpen && (
                    <div className="px-4 py-3 space-y-4 text-xs text-slate-700 bg-white">

                      {/* Step 1 */}
                      <div className="space-y-1">
                        <p className="font-bold text-slate-800">Step 1 — Create a Meta Developer App</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-blue-600 underline font-medium">developers.facebook.com/apps <ExternalLink size={10} className="inline mb-0.5" /></a></li>
                          <li>Click <strong>Create App</strong></li>
                          <li>Select use case: <strong>Other</strong> → then type: <strong>Business</strong></li>
                          <li>Give it a name (e.g. &quot;My Window Cleaning&quot;), link your Facebook Business account</li>
                          <li>Click <strong>Create App</strong> — you&apos;ll land on the app dashboard</li>
                        </ol>
                        <p className="text-[11px] text-slate-400 mt-1">✔ You should now see an app dashboard with a green &quot;App ID&quot; in the top-left.</p>
                      </div>

                      {/* Step 2 */}
                      <div className="space-y-1 border-t border-slate-100 pt-3">
                        <p className="font-bold text-slate-800">Step 2 — Add the WhatsApp Product</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>In the left sidebar click <strong>Add Product</strong> (or scroll to &quot;Add products to your app&quot;)</li>
                          <li>Find <strong>WhatsApp</strong> and click <strong>Set Up</strong></li>
                          <li>Accept the WhatsApp Business Terms of Service if prompted</li>
                          <li>You&apos;ll be taken to the <strong>WhatsApp → Quickstart</strong> page</li>
                        </ol>
                        <p className="text-[11px] text-slate-400 mt-1">✔ &quot;WhatsApp&quot; should now appear under your app in the left sidebar.</p>
                      </div>

                      {/* Step 3 */}
                      <div className="space-y-1 border-t border-slate-100 pt-3">
                        <p className="font-bold text-slate-800">Step 3 — Get your Phone Number ID &amp; WABA ID</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>In the left sidebar go to <strong>WhatsApp → API Setup</strong></li>
                          <li>Under <strong>Step 1 — Select phone numbers</strong>, you&apos;ll see a test number and a dropdown</li>
                          <li>Copy the <strong>Phone Number ID</strong> (long numeric string below the number)</li>
                          <li>Copy the <strong>WhatsApp Business Account ID</strong> shown on the same page</li>
                          <li>Paste both into the fields below</li>
                        </ol>
                        <p className="text-[11px] text-slate-400 mt-1">✔ Phone Number ID looks like: <code className="bg-slate-100 px-1 rounded">123456789012345</code> (15 digits). WABA ID is similar.</p>
                      </div>

                      {/* Step 4 */}
                      <div className="space-y-1 border-t border-slate-100 pt-3">
                        <p className="font-bold text-slate-800">Step 4 — Add your real business phone number</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>On the <strong>API Setup</strong> page click <strong>Add phone number</strong></li>
                          <li>Enter your business display name (e.g. &quot;Smith Window Cleaning&quot;)</li>
                          <li>Choose a category (e.g. <strong>Home Improvement</strong>)</li>
                          <li>Enter your WhatsApp Business phone number in E.164 format (e.g. <code className="bg-slate-100 px-1 rounded">+441234567890</code>)</li>
                          <li>Verify via SMS or phone call — enter the 6-digit code</li>
                          <li>Copy the <strong>new Phone Number ID</strong> for your real number and replace the test one above</li>
                        </ol>
                        <p className="text-[11px] text-slate-400 mt-1">✔ Your number should show <strong>Connected</strong> status on the API Setup page.</p>
                      </div>

                      {/* Step 5 */}
                      <div className="space-y-1 border-t border-slate-100 pt-3">
                        <p className="font-bold text-slate-800">Step 5 — Create a permanent access token</p>
                        <p className="text-slate-500 mb-1">The temporary token on the API Setup page expires in 24 hours — you need a permanent one.</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>Go to <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer" className="text-blue-600 underline font-medium">Meta Business Suite → Settings → System Users <ExternalLink size={10} className="inline mb-0.5" /></a></li>
                          <li>Click <strong>Add</strong> → give the user a name (e.g. &quot;Window Cleaning Bot&quot;) → Role: <strong>Employee</strong></li>
                          <li>Click <strong>Add assets</strong> → select your WhatsApp Business Account → enable <strong>Manage</strong></li>
                          <li>Back on the System User page, click <strong>Generate new token</strong></li>
                          <li>Choose your app, set expiry to <strong>Never</strong></li>
                          <li>Tick permission: <strong>whatsapp_business_messaging</strong> (also tick <strong>whatsapp_business_management</strong> for template access)</li>
                          <li>Click <strong>Generate token</strong> — copy it immediately, it won&apos;t be shown again</li>
                          <li>Paste the token into the <strong>Permanent Access Token</strong> field below</li>
                        </ol>
                        <p className="text-[11px] text-slate-400 mt-1">✔ Token starts with <code className="bg-slate-100 px-1 rounded">EAA…</code> and is very long (~200+ chars).</p>
                      </div>

                      {/* Step 6 */}
                      <div className="space-y-1 border-t border-slate-100 pt-3">
                        <p className="font-bold text-slate-800">Step 6 — About message templates (for outbound messages)</p>
                        <p className="text-slate-600">WhatsApp requires <strong>pre-approved templates</strong> for businesses messaging customers first. Your templates in the <strong>Templates</strong> tab will need to be submitted to Meta.</p>
                        <ol className="list-decimal list-inside space-y-1 ml-1 text-slate-600">
                          <li>Go to <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer" className="text-blue-600 underline font-medium">Meta Business Suite → WhatsApp → Message Templates <ExternalLink size={10} className="inline mb-0.5" /></a></li>
                          <li>Click <strong>Create template</strong> for each message type (reminders, job complete, etc.)</li>
                          <li>Category: <strong>Utility</strong> for reminders/notifications, <strong>Marketing</strong> for promotions</li>
                          <li>Approval typically takes <strong>a few minutes to a few hours</strong></li>
                          <li>Once approved, your saved templates here will be sent via the template API automatically</li>
                        </ol>
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                          <p className="text-amber-800">⚠️ Until templates are approved, you can only reply to customers who message you first (within 24h window). Click <strong>Verify below</strong> to confirm your credentials work, then set up templates.</p>
                        </div>
                      </div>

                    </div>
                  )}
                </div>

                {/* ── Credentials ── */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={lbl}>Phone Number ID</label>
                    <input className={inp} value={messaging.metaPhoneNumberId}
                      onChange={(e) => { setMessaging((m) => ({ ...m, metaPhoneNumberId: e.target.value })); setMetaVerify({ status: "idle" }); }}
                      placeholder="e.g. 123456789012345" />
                    <p className="text-xs text-slate-400 mt-1">Found in Meta Developer Console → WhatsApp → API Setup (below the phone number dropdown)</p>
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Permanent Access Token</label>
                    <div className="relative">
                      <input type={showMetaToken ? "text" : "password"} className={cn(inp, "pr-9")}
                        value={messaging.metaAccessToken}
                        onChange={(e) => { setMessaging((m) => ({ ...m, metaAccessToken: e.target.value })); setMetaVerify({ status: "idle" }); }}
                        placeholder={settings.metaAccessTokenConfigured ? "Configured - enter a new token to replace it" : "EAAxxxxxxxx…"} />
                      <button type="button" onClick={() => setShowMetaToken((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {showMetaToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{settings.metaAccessTokenConfigured ? "A token is already stored. Leave this blank to keep the current value." : "Create a System User permanent token — not the 24-hour temporary token from API Setup."}</p>
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>WhatsApp Business Account ID <span className="font-normal text-slate-400">(optional)</span></label>
                    <input className={inp} value={messaging.metaWabaId}
                      onChange={(e) => setMessaging((m) => ({ ...m, metaWabaId: e.target.value }))}
                      placeholder="e.g. 987654321098765" />
                    <p className="text-xs text-slate-400 mt-1">From Meta Business Suite → Settings → WhatsApp accounts. Used for template management.</p>
                  </div>
                </div>

                {/* ── Verify button + result ── */}
                <div className="space-y-2">
                  <Button type="button" variant="outline"
                    disabled={metaVerify.status === "checking" || !messaging.metaPhoneNumberId.trim() || !messaging.metaAccessToken.trim()}
                    onClick={handleVerifyMeta}
                    className="w-full border-blue-300 text-blue-700 hover:bg-blue-50">
                    {metaVerify.status === "checking"
                      ? <><Loader2 size={14} className="mr-2 animate-spin" />Verifying credentials…</>
                      : <><ShieldCheck size={14} className="mr-2" />Verify Connection</>}
                  </Button>

                  {metaVerify.status === "ok" && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 space-y-1">
                      <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5"><CheckCircle2 size={15} /> Connection verified!</p>
                      {metaVerify.verifiedName && <p className="text-xs text-green-700"><strong>Business name:</strong> {metaVerify.verifiedName}</p>}
                      {metaVerify.displayNumber && <p className="text-xs text-green-700"><strong>Phone number:</strong> {metaVerify.displayNumber}</p>}
                      {metaVerify.qualityRating && <p className="text-xs text-green-700"><strong>Quality rating:</strong> {metaVerify.qualityRating}</p>}
                      {metaVerify.verificationStatus && <p className="text-xs text-green-700"><strong>Verification status:</strong> {metaVerify.verificationStatus}</p>}
                      <p className="text-[11px] text-green-600 pt-1">✔ Save your settings above, then set up message templates in Meta Business Suite and in the Templates tab.</p>
                    </div>
                  )}

                  {metaVerify.status === "error" && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
                      <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5"><AlertCircle size={15} /> Verification failed</p>
                      <p className="text-xs text-red-600">{metaVerify.error}</p>
                      <p className="text-[11px] text-red-500 pt-1">Check your Phone Number ID and that the token has the <code className="bg-red-100 px-1 rounded">whatsapp_business_messaging</code> permission.</p>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>
          )}

          {(messaging.messagingProvider === "twilio_sms" || messaging.messagingProvider === "twilio_whatsapp") && (
            <Card>
              <CardHeader>
                <CardTitle>{messaging.messagingProvider === "twilio_whatsapp" ? "Twilio — WhatsApp Credentials" : "Twilio — SMS Credentials"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  {messaging.messagingProvider === "twilio_whatsapp" ? (
                    <>Sign up at <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="underline font-medium">console.twilio.com</a>, then go to <strong>Messaging → Try it out → Send a WhatsApp message</strong> to connect your WhatsApp Business number. Copy your Account SID and Auth Token from the console homepage.</>
                  ) : (
                    <>Sign up at <a href="https://console.twilio.com" target="_blank" rel="noreferrer" className="underline font-medium">console.twilio.com</a>. Get your <strong>Account SID</strong>, <strong>Auth Token</strong> (both on the console homepage), and purchase a <strong>phone number</strong> via Messaging → Phone Numbers.</>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={lbl}>Account SID</label>
                    <input className={inp} value={messaging.twilioAccountSid} onChange={(e) => setMessaging((m) => ({ ...m, twilioAccountSid: e.target.value }))} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Auth Token</label>
                    <div className="relative">
                      <input type={showTwilioAuth ? "text" : "password"} className={cn(inp, "pr-9")} value={messaging.twilioAuthToken}
                        onChange={(e) => setMessaging((m) => ({ ...m, twilioAuthToken: e.target.value }))} placeholder={settings.twilioAuthTokenConfigured ? "Configured - enter a new token to replace it" : "Your Twilio Auth Token"} />
                      <button type="button" onClick={() => setShowTwilioAuth((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{showTwilioAuth ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{settings.twilioAuthTokenConfigured ? "An auth token is already stored. Leave this blank to keep the current value." : "Stored auth tokens are never shown after saving."}</p>
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>{messaging.messagingProvider === "twilio_whatsapp" ? "WhatsApp-enabled number" : "Twilio phone number"}</label>
                    <input className={inp} value={messaging.twilioFromNumber} onChange={(e) => setMessaging((m) => ({ ...m, twilioFromNumber: e.target.value }))}
                      placeholder={messaging.messagingProvider === "twilio_whatsapp" ? "+14155238886" : "+441234567890"} />
                    <p className="text-xs text-slate-400 mt-1">E.164 format e.g. +441234567890</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {messaging.messagingProvider === "none" && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-6 text-center text-sm text-slate-400">
              Messaging is disabled. Choose a provider above to enable sending messages to customers.
            </div>
          )}
          </>}
        </div>
      )}

      {/* ── TEMPLATES ─────────────────────────────────────────────────────── */}
      {tab === "templates" && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
            <strong>Placeholders</strong> like <code className="bg-blue-100 px-1 rounded">{"{{customerFirstName}}"}</code> are replaced with real customer/job data when a message is sent. Click a chip to insert at cursor.
          </div>
          {TEMPLATE_DEFS.map((def) => (
            <Card key={def.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{def.label}</CardTitle>
                <p className="text-xs text-slate-400 -mt-1">{def.desc}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  ref={(el) => { templateRefs.current[def.key] = el; }}
                  rows={def.key === "tmplInvoiceNote" ? 3 : 4}
                  className={cn(inp, "resize-none text-sm leading-relaxed")}
                  value={templates[def.key]}
                  onChange={(e) => setTemplates((p) => ({ ...p, [def.key]: e.target.value }))}
                  placeholder={def.key === "tmplInvoiceNote" ? "Optional extra text shown on every invoice…" : `Enter your ${def.label.toLowerCase()} message…`}
                />
                <PlaceholderChips onInsert={(ph) => insertInto(templateRefs.current[def.key], templates[def.key], ph, (v) => setTemplates((p) => ({ ...p, [def.key]: v })))} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── BROADCAST ─────────────────────────────────────────────────────── */}
      {tab === "broadcast" && (
        <Card>
          <CardHeader><CardTitle><Send size={16} className="inline mr-2 text-blue-600" />Bulk texts</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>Send one message to many customers, picked by area, tag or who owes money, with placeholders filled in for each person.</p>
            <a href="/messages" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Send size={14} /> Open Texts
            </a>
          </CardContent>
        </Card>
      )}

      {/* ── TEAM ──────────────────────────────────────────────────────────── */}
      {tab === "team" && (
        <div className="space-y-4">
          {/* Invite form */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span><Users size={16} className="inline mr-2 text-blue-600" />Invite a Worker</span>
                <button type="button" onClick={refreshTeam} disabled={teamRefreshing} className="text-slate-400 hover:text-slate-600 p-1 rounded">
                  <RefreshCw size={14} className={teamRefreshing ? "animate-spin" : ""} />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Send an invite link to a worker. They&apos;ll create their own password and be linked to your account automatically.</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="worker@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                />
              </div>

              {/* Role presets */}
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-1.5">Role:</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  {ROLE_PRESETS.map((preset) => {
                    const active = preset.permissions.length === invitePermissions.length
                      && preset.permissions.every((perm) => invitePermissions.includes(perm));
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => setInvitePermissions(preset.permissions)}
                        className={cn(
                          "rounded-lg border px-2.5 py-2 text-left transition-colors",
                          active ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                        )}
                      >
                        <p className="text-xs font-semibold text-slate-800">{preset.label}</p>
                        <p className="text-[10px] leading-snug text-slate-500">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Permission checkboxes */}
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">Custom permissions</summary>
              <div className="mt-2">
                <p className="text-xs font-semibold text-slate-700 mb-1.5">Permissions for this worker:</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {ALL_PERMISSIONS.map((perm) => (
                    <label key={perm} className={cn(
                      "flex items-start gap-2 border rounded-lg px-2.5 py-2 cursor-pointer transition-colors",
                      invitePermissions.includes(perm)
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 hover:border-slate-300"
                    )}>
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={invitePermissions.includes(perm)}
                        onChange={(e) => {
                          setInvitePermissions((prev) =>
                            e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm)
                          );
                        }}
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800 capitalize">{PERMISSION_LABELS[perm].label}</p>
                        <p className="text-[10px] text-slate-500 leading-snug">{PERMISSION_LABELS[perm].description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              </details>

              <Button onClick={handleInvite} disabled={invitePending || !inviteEmail.trim()} className="w-full">
                {invitePending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Send Invite
              </Button>
              {inviteError && <p className="text-xs text-red-600">{inviteError}</p>}
              {inviteLink && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-green-800 flex items-center gap-1"><CheckCircle2 size={13} /> {inviteEmailedTo ? `Invite emailed to ${inviteEmailedTo}. You can also share this link:` : "Invite created! Email isn't set up, so share this link:"}</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-white border border-green-200 rounded px-2 py-1 text-green-700 truncate">{inviteLink}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteLink)}
                      className="text-xs text-green-700 hover:text-green-900 font-medium flex items-center gap-1"
                    >
                      <Link2 size={12} /> Copy
                    </button>
                  </div>
                  <p className="text-[11px] text-green-600">Expires in 7 days.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending invites */}
          {invites.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Pending Invites</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{inv.email}</p>
                      <p className="text-xs text-slate-400">Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                    </div>
                    <button onClick={() => handleRevokeInvite(inv.id)} className="text-slate-400 hover:text-red-500 p-1 rounded" title="Revoke invite">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Team members */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Team Members</CardTitle>
              <a href="/reports/workers" className="text-xs font-semibold text-blue-600 hover:underline">Worker pay report →</a>
            </CardHeader>
            <CardContent className="space-y-2">
              {team.length === 0 && <p className="text-sm text-slate-400">No team members yet.</p>}
              {team.map((member) => (
                <div key={member.id} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{member.name ?? member.email}</p>
                      {member.name && <p className="text-xs text-slate-400 truncate">{member.email}</p>}
                      <span className={cn(
                        "inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
                        member.role === "OWNER" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                      )}>{member.role === "OWNER" ? "Owner" : "Worker"}</span>
                      {member.role === "WORKER" && member.permissions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {member.permissions.map((perm) => (
                            <span key={perm} className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium capitalize">
                              {PERMISSION_LABELS[perm as Permission]?.label ?? perm}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {member.role === "WORKER" && (
                      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                        <button
                          onClick={() => {
                            if (editingPermsMemberId === member.id) {
                              setEditingPermsMemberId(null);
                            } else {
                              setEditingPermsMemberId(member.id);
                              setPendingMemberPerms(member.permissions);
                            }
                          }}
                          className="text-slate-400 hover:text-blue-500 p-1 rounded"
                          title="Edit permissions"
                        >
                          <ShieldCheck size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setResetMemberId(resetMemberId === member.id ? null : member.id);
                            setResetPassword("");
                            setResetResult(null);
                          }}
                          className="text-slate-400 hover:text-blue-500 p-1 rounded"
                          title="Reset password"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Remove ${member.name ?? member.email} from your team?`)) handleRemoveMember(member.id); }}
                          className="text-slate-400 hover:text-red-500 p-1 rounded"
                          title="Remove member"
                        >
                          <UserX size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Reset a worker's password */}
                  {resetMemberId === member.id && (
                    <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-700">Set a new password for {member.name ?? member.email}</p>
                      {resetResult?.password ? (
                        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                          New password: <strong className="select-all font-mono text-sm">{resetResult.password}</strong>
                          <span className="block mt-1">Give this to them. They can change it in Settings → Security after signing in.</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              placeholder="Leave blank to make one up for you"
                              className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs"
                            />
                            <button
                              type="button"
                              disabled={permSaving}
                              onClick={() => startPermSaveTransition(async () => {
                                const res = await resetWorkerPassword(member.id, resetPassword || undefined);
                                setResetResult(res.ok ? { password: res.password } : { error: res.error });
                              })}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Set password
                            </button>
                          </div>
                          {resetResult?.error && <p className="text-xs text-red-600">{resetResult.error}</p>}
                        </>
                      )}
                    </div>
                  )}

                  {/* Inline permission editor */}
                  {editingPermsMemberId === member.id && (
                    <div className="border-t border-slate-100 bg-slate-50 px-3 py-3 space-y-2">
                      <p className="text-xs font-semibold text-slate-700">Edit permissions:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {ALL_PERMISSIONS.map((perm) => (
                          <label key={perm} className={cn(
                            "flex items-start gap-2 border rounded-lg px-2 py-1.5 cursor-pointer transition-colors bg-white",
                            pendingMemberPerms.includes(perm)
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 hover:border-slate-300"
                          )}>
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={pendingMemberPerms.includes(perm)}
                              onChange={(e) => {
                                setPendingMemberPerms((prev) =>
                                  e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm)
                                );
                              }}
                            />
                            <div>
                              <p className="text-xs font-semibold text-slate-800 capitalize">{PERMISSION_LABELS[perm].label}</p>
                              <p className="text-[10px] text-slate-500 leading-snug">{PERMISSION_LABELS[perm].description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingPermsMemberId(null)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleUpdatePermissions(member.id, pendingMemberPerms)}
                          disabled={permSaving}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {permSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── TAGS ──────────────────────────────────────────────────────────── */}
      {tab === "tags" && (
        <Card>
          <CardHeader><CardTitle><TagIcon size={16} className="inline mr-2 text-blue-600" />Customer Tags</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {tags.length === 0 && <p className="text-sm text-slate-400">No tags yet. Add one below.</p>}
              {tags.map((tag) => (
                <span key={tag.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold text-white" style={{ backgroundColor: tag.color }}>
                  {tag.name}
                  <button onClick={() => { startTagTransition(async () => { await deleteTag(tag.id); setTags((p) => p.filter((t) => t.id !== tag.id)); }); }} disabled={tagPending} className="hover:opacity-70 transition-opacity"><Trash2 size={12} /></button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Tag name (e.g. VIP, New)" value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 p-1 cursor-pointer" title="Pick tag colour" />
              <Button onClick={handleAddTag} disabled={tagPending || !newTagName.trim()} size="sm"><Plus size={14} />Add</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── SECURITY ──────────────────────────────────────────────────────── */}
      {tab === "data" && canManageProviderSettings && <DataTab counts={dataCounts} />}

      {tab === "security" && (
        <div className="space-y-6 max-w-md">
          <Card>
            <CardHeader>
              <CardTitle><ShieldCheck size={16} className="inline mr-2 text-blue-600" />Change Password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-500">
                Update your sign-in password. Minimum 8 characters.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Current password</label>
                <div className="relative">
                  <input
                    type={showPwFields ? "text" : "password"}
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="button" onClick={() => setShowPwFields((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPwFields ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">New password</label>
                <input
                  type={showPwFields ? "text" : "password"}
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Confirm new password</label>
                <input
                  type={showPwFields ? "text" : "password"}
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {pwStatus === "error" && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0" />{pwMessage}
                </div>
              )}
              {pwStatus === "success" && (
                <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">
                  <CheckCircle2 size={14} className="flex-shrink-0" />{pwMessage}
                </div>
              )}

              <Button
                onClick={handleChangePassword}
                disabled={pwPending || !pwCurrent || !pwNew || !pwConfirm}
                size="sm"
              >
                {pwPending ? <><Loader2 size={13} className="animate-spin" />Updating…</> : <><Save size={13} />Update Password</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
