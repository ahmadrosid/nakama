export interface AllowedTelegramUser {
  id: string;
  username?: string;
}

export function parseAllowedTelegramUsers(
  input: string
): AllowedTelegramUser[] {
  const trimmed = input.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{")) {
    try {
      // SAFETY: JSON.parse returns the values checked by the validation that follows.
      const payload = JSON.parse(trimmed) as {
        from?: { id?: unknown; username?: unknown };
        message?: { from?: { id?: unknown; username?: unknown } };
      };

      const user = payload.message?.from ?? payload.from;

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
      if (typeof user?.id !== "number" || !Number.isFinite(user.id)) {
        throw new Error("Paste valid Telegram JSON with a numeric user ID.");
      }

      const id = String(user.id);

      const username =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
        typeof user?.username === "string" ? user.username.trim() : "";

      if (!/^[1-9]\d*$/.test(id)) {
        throw new Error("Paste valid Telegram JSON with a numeric user ID.");
      }

      // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
      return [{ id, ...(username ? { username } : {}) }];
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Paste valid Telegram JSON or a numeric user ID.");
      }

      throw error;
    }
  }

  return trimmed
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      if (!/^[1-9]\d*$/.test(id)) {
        throw new Error("Telegram user IDs must be positive numbers.");
      }

      return { id };
    });
}
