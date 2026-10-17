import { Button } from "@nakama/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@nakama/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { Spinner } from "@nakama/ui/spinner";
import { ViewIcon, ViewOffIcon } from "hugeicons-react";
import { useState } from "react";
import {
  useAgentBrowserSettings,
  useSaveAgentBrowserSettings,
} from "@/hooks/use-agent-browser-settings";
import { formatError } from "@/lib/client";

const LOCAL_VALUE = "__browser_local__";

const KERNEL_VALUE = "kernel";

export function BrowserRuntimeSettingsCard() {
  const { data: settings } = useAgentBrowserSettings();
  const saveMutation = useSaveAgentBrowserSettings();
  // undefined follows the server; a string is the unsaved selection.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selected =
    draft ?? (settings?.provider === "kernel" ? KERNEL_VALUE : LOCAL_VALUE);

  const keyAlreadySaved =
    settings?.provider === "kernel" && Boolean(settings.apiKeyMasked);

  function save(request: Parameters<typeof saveMutation.mutate>[0]) {
    setFormError(null);
    saveMutation.mutate(request, {
      onError: (error) => setFormError(formatError(error)),
      onSuccess: () => {
        setDraft(undefined);
        setApiKey("");
      },
    });
  }

  function select(value: string | null) {
    if (!value) {
      return;
    }

    setFormError(null);
    setApiKey("");

    if (value === LOCAL_VALUE) {
      setDraft(LOCAL_VALUE);
      save({ provider: null });

      return;
    }

    setDraft(KERNEL_VALUE);
  }

  return (
    <div className="space-y-3 px-4 py-3" id="browser-runtime-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-foreground text-sm">Browser runtime</p>
        <div className="w-full min-w-0 sm:w-56">
          <Select
            disabled={saveMutation.isPending}
            onValueChange={select}
            value={selected}
          >
            <SelectTrigger
              aria-label="Browser runtime"
              className="h-9 w-full"
              id="browser-runtime-provider"
            >
              <SelectValue>
                {selected === KERNEL_VALUE
                  ? "Kernel"
                  : "Local Chrome (default)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value={LOCAL_VALUE}>
                Local Chrome (default)
              </SelectItem>
              <SelectItem value={KERNEL_VALUE}>Kernel</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected === KERNEL_VALUE ? (
        <div className="space-y-2">
          <label
            className="block font-medium text-foreground text-xs"
            htmlFor="browser-runtime-api-key"
          >
            Kernel API key
          </label>
          <div className="flex items-center gap-2">
            <InputGroup className="h-9 min-w-0 flex-1">
              <InputGroupInput
                autoComplete="off"
                disabled={saveMutation.isPending}
                id="browser-runtime-api-key"
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setFormError(null);
                }}
                placeholder={
                  keyAlreadySaved
                    ? `Saved (${settings?.apiKeyMasked})`
                    : "Paste API key"
                }
                type={showApiKey ? "text" : "password"}
                value={apiKey}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  onClick={() => setShowApiKey((current) => !current)}
                  size="icon-xs"
                  type="button"
                >
                  {showApiKey ? (
                    <ViewOffIcon className="size-4" />
                  ) : (
                    <ViewIcon className="size-4" />
                  )}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Button
              className="min-w-[4.5rem] shrink-0"
              disabled={
                saveMutation.isPending || !(apiKey.trim() || keyAlreadySaved)
              }
              onClick={() => {
                const trimmed = apiKey.trim();
                save(
                  trimmed
                    ? { apiKey: trimmed, provider: "kernel" }
                    : { provider: "kernel" }
                );
              }}
              size="sm"
              type="button"
            >
              {saveMutation.isPending ? <Spinner className="size-4" /> : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <p className="text-destructive text-xs" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
