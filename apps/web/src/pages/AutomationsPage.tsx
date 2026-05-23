import type { AutomationDefinition } from "@tinyclaw/core/contract";
import { useState } from "react";
import { client, formatError } from "@/lib/client";

export function AutomationsPage() {
  const [prompt, setPrompt] = useState("");
  const [automation, setAutomation] = useState<AutomationDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDraft(event: React.FormEvent) {
    event.preventDefault();

    const text = prompt.trim();

    if (!text || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      setAutomation(await client.draftAutomation(text, "web"));
    } catch (err) {
      setError(formatError(err));
      setAutomation(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="panel p-5">
        <h2 className="text-sm font-semibold text-zinc-100">Draft automation</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Describe what you want in plain language. The server returns a JSON automation definition.
          Execution and scheduling are not wired up yet.
        </p>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleDraft(event)}>
          <div>
            <label className="label" htmlFor="automation-prompt">
              Prompt
            </label>
            <textarea
              id="automation-prompt"
              className="input min-h-32"
              placeholder="Every morning, log the weather and post a summary…"
              value={prompt}
              disabled={busy}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={busy || !prompt.trim()}>
            Draft automation
          </button>
        </form>
      </div>

      {error ? (
        <div className="panel border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      {automation ? (
        <div className="panel overflow-hidden">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-zinc-100">{automation.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{automation.description}</p>
          </div>

          <div className="grid gap-4 border-b border-zinc-800 px-5 py-4 sm:grid-cols-3">
            <Meta label="ID" value={automation.id} mono />
            <Meta label="Trigger" value={formatTrigger(automation)} />
            <Meta label="Steps" value={String(automation.steps.length)} />
          </div>

          {automation.steps.length > 0 ? (
            <div className="space-y-3 px-5 py-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Steps</h3>
              {automation.steps.map((step, index) => (
                <div
                  key={step.id}
                  className="rounded-lg border border-zinc-800 bg-surface-850 px-4 py-3"
                >
                  <p className="text-sm font-medium text-zinc-100">
                    {index + 1}. {step.tool}
                  </p>
                  <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-zinc-400">
                    {JSON.stringify(step.input, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : null}

          <pre className="overflow-x-auto border-t border-zinc-800 bg-surface-950 px-5 py-4 font-mono text-xs leading-relaxed text-zinc-300">
            {JSON.stringify(automation, null, 2)}
          </pre>
        </div>
      ) : (
        <div className="panel flex min-h-48 items-center justify-center p-8 text-sm text-zinc-500">
          Draft results will appear here as JSON.
        </div>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-sm text-zinc-200 ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function formatTrigger(automation: AutomationDefinition): string {
  if (automation.trigger.type === "manual") {
    return "manual";
  }

  return `schedule (${automation.trigger.cron})`;
}
