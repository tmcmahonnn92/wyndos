import { cn } from "@/lib/utils";
import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline";
  size?: "sm" | "md" | "lg";
}

const variantClasses: Record<string, string> = {
  primary:   "bg-[#3D8EF5] text-white hover:bg-[#2170D8] active:bg-[#1860C0]",
  secondary: "bg-slate-600 dark:bg-[#1E2840] text-white hover:opacity-90 active:opacity-80",
  danger:    "bg-red-600 text-white hover:bg-red-700 active:bg-red-800",
  ghost:     "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1E2840] active:bg-slate-200 dark:active:bg-[#131929]",
  outline:   "border border-slate-300 dark:border-[#1E2840] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#131929] active:bg-slate-100 dark:active:bg-[#0A0E1A]",
};

const sizeClasses: Record<string, string> = {
  sm: "px-3 py-1.5 text-sm rounded-md",
  md: "px-4 py-2 text-sm rounded-lg",
  lg: "px-5 py-3 text-base rounded-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-[#3D8EF5] focus:ring-offset-1",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
