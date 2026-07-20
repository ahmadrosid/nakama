import styles from "./ThinkingState.module.css";
import { cn } from "@/lib/utils";

interface ThinkingStateProps {
  className?: string;
  label?: string;
}

export function ThinkingState({ className, label = "Thinking" }: ThinkingStateProps) {
  return (
    <span className={cn(styles.shimmer, className)} role="status" aria-live="polite">
      {label}
    </span>
  );
}
