import type { ProfileSummary, SessionSummary } from "@tinyclaw/core/contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, Trash2Icon } from "lucide-react";
import { client, formatError } from "@/lib/client";
import { formatSessionTimestamp, type RequestedChatSession } from "@/lib/chat-history";
import type { PageId } from "@/lib/navigation";

const sectionClass = "rounded-md border border-border bg-card p-4";

interface HistoryPageProps {
  onNavigate: (page: PageId) => void;
  onOpenSession: (session: RequestedChatSession) => void;
}

export function HistoryPage({ onNavigate, onOpenSession }: HistoryPageProps) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [profileId, setProfileId] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId),
    [profiles, profileId],
  );

  const loadProfiles = useCallback(async () => {
    try {
      const response = await client.listProfiles();
      setProfiles(response.profiles);

      if (!profileId && response.profiles.length > 0) {
        const defaultProfile =
          response.profiles.find((profile) => profile.id === "profile_default") ??
          response.profiles[0]!;
        setProfileId(defaultProfile.id);
      }
    } catch (err) {
      setError(formatError(err));
    }
  }, [profileId]);

  const loadSessions = useCallback(async (nextProfileId: string) => {
    if (!nextProfileId) {
      setSessions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await client.listSessions(nextProfileId, "web");
      setSessions(response.sessions);
    } catch (err) {
      setError(formatError(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (profileId) {
      void loadSessions(profileId);
    }
  }, [profileId, loadSessions]);

  async function handleDelete(session: SessionSummary) {
    if (
      !window.confirm(
        `Delete this chat permanently? This removes ${session.messageCount} messages.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const chatSession = client.createChatSession(session.id, "web");
      await chatSession.purge();
      await loadSessions(profileId);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleOpen(session: SessionSummary) {
    onOpenSession({
      profileId: session.profileId,
      sessionId: session.id,
    });
    onNavigate("chat");
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className={cn(sectionClass, "p-5")}>
        <h2 className="text-sm font-semibold text-foreground">Browse history</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Past web chat sessions are stored in SQLite. Open one to continue the conversation in
          Chat.
        </p>

        <div className="mt-5 space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Profile</label>
          <Select
            value={profileId}
            disabled={busy || profiles.length === 0}
            onValueChange={(value) => setProfileId(value != null ? String(value) : "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.isSuper ? " (super)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="button" className="mt-5 w-full" onClick={() => onNavigate("chat")}>
          <MessageSquareIcon />
          Back to Chat
        </Button>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Saved sessions</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeProfile
                ? `Showing web chats for ${activeProfile.name}.`
                : "Select a profile to view sessions."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || busy || !profileId}
            onClick={() => void loadSessions(profileId)}
          >
            Refresh
          </Button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No saved chats yet for this profile. Start a conversation in Chat.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {sessions.map((session) => (
              <li key={session.id} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition hover:bg-muted/50"
                  onClick={() => handleOpen(session)}
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {session.preview?.trim() || "Untitled conversation"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatSessionTimestamp(session.updatedAt)} · {session.messageCount} messages
                  </p>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label="Delete session"
                  onClick={() => void handleDelete(session)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
