import { cn } from "@/lib/utils";
import styles from "./ThinkingState.module.css";

interface ThinkingStateProps {
  className?: string;
  label?: string;
}

export function ThinkingState({
  className,
  label = "Thinking",
}: ThinkingStateProps) {
  return (
    <span
      aria-live="polite"
      className={cn(styles.shimmer, className)}
      role="status"
    >
      {label}
    </span>
  );
}
