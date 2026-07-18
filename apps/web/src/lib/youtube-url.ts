const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

function isValidYoutubeId(id: string | null | undefined): id is string {
  return typeof id === "string" && YOUTUBE_ID_RE.test(id);
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

/** Extract an 11-char YouTube video id from common watch / share / embed URLs. */
export function parseYoutubeVideoId(url: string | undefined | null): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = normalizeHost(parsed.hostname);

  if (host === "youtu.be") {
    const id = parsed.pathname.split("/").filter(Boolean)[0]?.split("?")[0];
    return isValidYoutubeId(id) ? id : null;
  }

  if (!YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
    const id = parsed.searchParams.get("v");
    return isValidYoutubeId(id) ? id : null;
  }

  const match = parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
  if (match && isValidYoutubeId(match[1])) {
    return match[1];
  }

  return null;
}

export function youtubeEmbedSrc(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}
