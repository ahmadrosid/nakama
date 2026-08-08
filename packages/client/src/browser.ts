export function readBrowserOrigin(): string | undefined {
  const location = (
    globalThis as typeof globalThis & {
      location?: { origin?: string };
    }
  ).location;

  return location?.origin;
}

export function readCookie(name: string): string | null {
  const cookie = (
    globalThis as typeof globalThis & {
      document?: { cookie?: string };
    }
  ).document?.cookie;

  if (!cookie) {
    return null;
  }

  const prefix = `${name}=`;
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length) || null;
    }
  }

  return null;
}
