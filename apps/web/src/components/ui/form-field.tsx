import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FormFieldProps = {
  id?: string;
  label: ReactNode;
  children: ReactNode;
  className?: string;
  density?: "default" | "compact";
  /** Helper text, validation errors, etc. — spaced below the control, not the label. */
  footer?: ReactNode;
};

/** Label + control with consistent vertical rhythm. */
export function FormField({
  id,
  label,
  children,
  className,
  density = "default",
  footer,
}: FormFieldProps) {
  const compact = density === "compact";

  return (
    <div className={cn(className)}>
      <div className="flex flex-col gap-2.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {children}
      </div>
      {footer ? (
        <div className={cn(compact ? "mt-3 space-y-2" : "mt-2.5 space-y-2.5")}>{footer}</div>
      ) : null}
    </div>
  );
}
