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
      const payload = JSON.parse(trimmed) as {
        from?: { id?: unknown; username?: unknown };
        message?: { from?: { id?: unknown; username?: unknown } };
      };
      const user = payload.message?.from ?? payload.from;
      if (typeof user?.id !== "number" || !Number.isFinite(user.id)) {
        throw new Error("Paste valid Telegram JSON with a numeric user ID.");
      }

      const id = String(user.id);
      const username =
        typeof user?.username === "string" ? user.username.trim() : "";

      if (!/^[1-9]\d*$/.test(id)) {
        throw new Error("Paste valid Telegram JSON with a numeric user ID.");
      }

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
