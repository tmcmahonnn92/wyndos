"use client";

import { PhoneSendQueue, type PhoneText } from "@/components/phone-send-queue";

export function SendQueuePage({ items }: { items: PhoneText[] }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <PhoneSendQueue items={items} onFinished={() => {}} />
    </div>
  );
}
