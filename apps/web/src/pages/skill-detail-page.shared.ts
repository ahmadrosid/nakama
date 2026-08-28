import { formatError } from "@/lib/client";
import { toast } from "@/lib/toast";

/** Formats a skill save failure, pushes a global toast, and returns the message for inline UI. */
export function reportSkillSaveError(
  error: unknown,
  notify: (message: string) => void = toast
): string {
  const message = formatError(error);
  notify(message);
  return message;
}
