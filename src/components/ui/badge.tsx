import { cn } from "@/lib/utils";
import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
}

const variantClasses: Record<string, string> = {
  default: "bg-slate-100 dark:bg-[#1E2840] text-slate-700 dark:text-slate-200",
  success: "bg-green-100 dark:bg-green-900/25 text-green-800 dark:text-green-400",
  warning: "bg-yellow-100 dark:bg-yellow-900/25 text-yellow-800 dark:text-yellow-300",
  danger:  "bg-red-100 dark:bg-red-900/25 text-red-800 dark:text-red-400",
  info:    "bg-blue-100 dark:bg-[#3D8EF5]/20 text-blue-800 dark:text-[#3D8EF5]",
  muted:   "bg-gray-100 dark:bg-[#131929] text-gray-500 dark:text-[#4A5568]",
};

export function Badge({ variant = "default", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
