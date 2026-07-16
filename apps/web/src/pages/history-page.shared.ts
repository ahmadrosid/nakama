import type { SessionSummary } from "@nakama/core/contract";

export function formatSessionTitle(session: SessionSummary): string {
  return session.title?.trim() || "Untitled";
}

export function groupSessionsByDate(sessions: SessionSummary[]): Array<{
  label: string;
  sessions: SessionSummary[];
}> {
  const order = ["Today", "Yesterday", "This week", "Earlier"] as const;
  const buckets = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    const label = getDateGroupLabel(session.updatedAt);
    const existing = buckets.get(label) ?? [];
    existing.push(session);
    buckets.set(label, existing);
  }

  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({
      label,
      sessions: buckets.get(label)!,
    }));
}

function getDateGroupLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Earlier";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const sessionDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (sessionDay >= startOfToday) {
    return "Today";
  }

  if (sessionDay >= startOfYesterday) {
    return "Yesterday";
  }

  if (sessionDay >= startOfWeek) {
    return "This week";
  }

  return "Earlier";
}
