/** Discord: Unknown interaction (expired or already handled). */
const UNKNOWN_INTERACTION = 10_062;
/** Discord: Interaction has already been acknowledged. */
const ALREADY_ACKNOWLEDGED = 40_060;

export function getDiscordErrorCode(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "number"
  ) {
    return (error as { code: number }).code;
  }

  return null;
}

export function isIgnorableInteractionError(error: unknown): boolean {
  const code = getDiscordErrorCode(error);
  return code === UNKNOWN_INTERACTION || code === ALREADY_ACKNOWLEDGED;
}
