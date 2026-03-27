"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCustomer } from "@/lib/actions";
import { cn } from "@/lib/utils";

export function CustomerActiveToggle({
  customerId,
  active,
}: {
  customerId: number;
  active: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await updateCustomer(customerId, { active: !active });
      router.refresh();
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      title={active ? "Active — click to deactivate" : "Inactive — click to activate"}
      className={cn(
        "relative w-8 h-4.5 rounded-full border-2 inline-flex items-center transition-colors flex-shrink-0 disabled:opacity-60",
        active ? "bg-green-500 border-green-600" : "bg-red-300 border-red-400"
      )}
    >
      <span
        className={cn(
          "absolute w-3 h-3 rounded-full bg-white shadow transition-transform duration-150",
          active ? "translate-x-3.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
