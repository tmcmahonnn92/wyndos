"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={cn(
          "relative z-10 w-full bg-white dark:bg-[#131929] rounded-t-2xl sm:rounded-2xl shadow-xl",
          "max-h-[90vh] overflow-y-auto",
          "sm:max-w-lg sm:mx-4",
          className
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 dark:border-[#1E2840] sticky top-0 bg-white dark:bg-[#131929] z-10">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 dark:text-[#4A5568] hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#0A0E1A] transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  , document.body);
}
