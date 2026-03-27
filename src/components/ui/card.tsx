import { cn } from "@/lib/utils";
import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}
interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}
interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}
interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn("bg-white dark:bg-[#131929] rounded-xl border border-slate-200 dark:border-[#1E2840] shadow-sm", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn("px-4 py-3 border-b border-slate-100 dark:border-[#1E2840]", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: CardTitleProps) {
  return (
    <h3 className={cn("text-sm font-semibold text-slate-700 dark:text-slate-100", className)} {...props}>
      {children}
    </h3>
  );
}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn("px-4 py-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: CardFooterProps) {
  return (
    <div
      className={cn("px-4 py-3 border-t border-slate-100 dark:border-[#1E2840] bg-slate-50 dark:bg-[#0A0E1A] rounded-b-xl", className)}
      {...props}
    >
      {children}
    </div>
  );
}
