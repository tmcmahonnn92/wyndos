/**
 * Unified messaging library.
 * Supports VoodooSMS, Twilio SMS, and Twilio WhatsApp.
 * Use interpolateTemplate() to fill {{placeholder}} values before sending.
 */

import { prisma } from "@/lib/db";
import { getActiveTenantId } from "@/lib/tenant-context";

// ── Placeholder interpolation ─────────────────────────────────────────────────

export type MessageVars = {
  customerName?: string;
  customerFirstName?: string;
  customerAddress?: string;
  areaName?: string;
  jobDate?: string;
  jobPrice?: string;
  amountDue?: string;
  businessName?: string;
  businessPhone?: string;
  nextDueDate?: string;
};

/** Replace all {{key}} tokens in a template string with provided values. */
export function interpolateTemplate(template: string, vars: MessageVars): string {
  return Object.entries(vars).reduce(
    (str, [key, value]) => str.replaceAll(`{{${key}}}`, value ?? ""),
    template
  );
}

// ── Send message ──────────────────────────────────────────────────────────────

/**
 * Send a message via whichever provider is configured in BusinessSettings.
 * Throws on error so callers can handle gracefully.
 */
export async function sendMessage({ to, message }: { to: string; message: string }) {
  const tenantId = await getActiveTenantId();
  const settings = await prisma.tenantSettings.findFirst({ where: { tenantId } });
  const provider = settings?.messagingProvider ?? "voodoosms";

  if (provider === "none" || !settings) {
    throw new Error("Messaging is disabled. Go to Settings → Messaging to configure it.");
  }

  // ── VoodooSMS ────────────────────────────────────────────────────────────
  if (provider === "voodoosms") {
    if (!settings.voodooApiKey) {
      throw new Error("VoodooSMS API key not configured. Go to Settings → Messaging.");
    }
    const toClean = to.replace(/[\s\-()]/g, "");
    const res = await fetch("https://api.voodoosms.com/sendsms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.voodooApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: toClean,
        from: settings.voodooSender || "VoodooSMS",
        msg: message,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error?.msg ?? data.error ?? "VoodooSMS API error");
    }
    return { provider: "voodoosms" };
  }

  // ── Meta WhatsApp Cloud API ──────────────────────────────────────────────
  if (provider === "meta_whatsapp") {
    const phoneNumberId = settings.metaPhoneNumberId?.trim();
    const accessToken  = settings.metaAccessToken?.trim();

    if (!phoneNumberId || !accessToken) {
      throw new Error("Meta WhatsApp credentials incomplete. Go to Settings → Messaging.");
    }

    // Meta requires E.164 without the leading '+' for the 'to' field
    const toClean = to.replace(/[\s\-()]/g, "").replace(/^\+/, "");

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toClean,
          type: "text",
          text: { preview_url: false, body: message },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(
        data.error?.message ?? `Meta API error ${res.status}`
      );
    }
    return { provider: "meta_whatsapp", messageId: data.messages?.[0]?.id };
  }

  // ── Twilio (SMS or WhatsApp) ─────────────────────────────────────────────
  if (provider === "twilio_sms" || provider === "twilio_whatsapp") {
    const sid = settings.twilioAccountSid?.trim();
    const auth = settings.twilioAuthToken?.trim();
    const fromNum = settings.twilioFromNumber?.trim();

    if (!sid || !auth || !fromNum) {
      throw new Error("Twilio credentials incomplete. Go to Settings → Messaging.");
    }

    const isWhatsApp = provider === "twilio_whatsapp";
    const toClean = to.replace(/[\s\-()]/g, "");
    const From = isWhatsApp ? `whatsapp:${fromNum}` : fromNum;
    const To = isWhatsApp ? `whatsapp:${toClean}` : toClean;

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ From, To, Body: message }).toString(),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error_code) {
      throw new Error(data.message ?? `Twilio error ${data.error_code ?? res.status}`);
    }
    return { provider, sid: data.sid };
  }

  throw new Error(`Unknown messaging provider: ${provider}`);
}
