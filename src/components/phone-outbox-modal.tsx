"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { discardPhoneTexts, getPhoneOutbox } from "@/lib/text-actions";
import { PhoneSendQueue, type PhoneText } from "@/components/phone-send-queue";

/** Send texts that are waiting to go from this phone, one tap each. */
export function PhoneOutboxModal({
  open,
  onClose,
  filter,
  title = "Send from your phone",
}: {
  open: boolean;
  onClose: () => void;
  filter?: { workDayIds?: number[]; ids?: number[] };
  title?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<PhoneText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filter ?? {});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setItems(null);
    getPhoneOutbox(JSON.parse(filterKey))
      .then((list) => !cancelled && setItems(list))
      .catch((issue) => !cancelled && setError(issue instanceof Error ? issue.message : "Could not load texts."));
    return () => { cancelled = true; };
  }, [open, filterKey]);

  const close = () => {
    onClose();
    router.refresh();
  };

  return (
    <Modal open={open} onClose={close} title={title}>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : items === null ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nothing waiting to send.</p>
      ) : (
        <div className="space-y-3">
          <PhoneSendQueue items={items} onFinished={() => {}} />
          <button
            type="button"
            onClick={async () => {
              if (!confirm(`Delete the ${items.length} text(s) in this list without sending?`)) return;
              await discardPhoneTexts(items.map((i) => i.id));
              close();
            }}
            className="w-full text-center text-xs text-slate-400 hover:text-red-600"
          >
            Don&apos;t send these
          </button>
        </div>
      )}
    </Modal>
  );
}
