import styles from "./ThinkingState.module.css";
import { cn } from "@/lib/utils";

interface ThinkingStateProps {
  className?: string;
}

export function ThinkingState({ className }: ThinkingStateProps) {
  return <span className={cn(styles.shimmer, className)}>Thinking</span>;
}
