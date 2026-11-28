import { Button } from "@nakama/ui/button";
import { Card } from "@nakama/ui/card";
import { Input } from "@nakama/ui/input";
import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OrganizationPanel } from "@/components/system/OrganizationPanel";
import { useAuth } from "@/context/use-auth";

function SessionRecordingEntry() {
  const { activeOrg, user } = useAuth();
  const navigate = useNavigate();
  const formId = useId();
  const [sessionId, setSessionId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!(user?.isPlatformAdmin && activeOrg)) {
    return null;
  }

  const orgId = activeOrg.id;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextSessionId = sessionId.trim();

    if (!nextSessionId) {
      setError("Enter a session ID.");

      return;
    }

    setError(null);
    navigate(
      `/organization/${encodeURIComponent(orgId)}/sessions/${encodeURIComponent(nextSessionId)}/steps`
    );
  }

  return (
    <Card className="shadow-none">
      <form className="space-y-3 p-4" onSubmit={submit}>
        <h2 className="font-medium text-sm">Session recording</h2>
        <div className="space-y-1 text-sm">
          <label className="block font-medium" htmlFor={`${formId}-session`}>
            Session ID
          </label>
          <Input
            className="h-10 rounded-xl"
            id={`${formId}-session`}
            onChange={(event) => setSessionId(event.target.value)}
            required
            value={sessionId}
          />
        </div>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <Button type="submit">Open recording</Button>
      </form>
    </Card>
  );
}

export function OrganizationPage() {
  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-6">
      <SessionRecordingEntry />
      <OrganizationPanel />
    </section>
  );
}
