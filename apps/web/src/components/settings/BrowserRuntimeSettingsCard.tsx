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

function useBrowserRuntimeForm() {
  const { data: settings } = useAgentBrowserSettings();
  const saveMutation = useSaveAgentBrowserSettings();
  // undefined follows the server; a string is the unsaved selection.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const savedKernel = settings?.provider === "kernel";
  const selected = draft ?? (savedKernel ? KERNEL_VALUE : LOCAL_VALUE);

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
    setDraft(value === LOCAL_VALUE ? LOCAL_VALUE : KERNEL_VALUE);

    if (value === LOCAL_VALUE) {
      save({ provider: null });
    }
  }

  function saveKey() {
    const trimmed = apiKey.trim();

    save(
      trimmed ? { apiKey: trimmed, provider: "kernel" } : { provider: "kernel" }
    );
  }

  return {
    apiKey,
    formError,
    keyAlreadySaved: savedKernel && Boolean(settings?.apiKeyMasked),
    maskedKey: settings?.apiKeyMasked ?? null,
    pending: saveMutation.isPending,
    saveKey,
    select,
    selected,
    setApiKey: (value: string) => {
      setApiKey(value);
      setFormError(null);
    },
  };
}

function KernelApiKeyFields({
  apiKey,
  keyAlreadySaved,
  maskedKey,
  onApiKeyChange,
  onSave,
  pending,
}: {
  apiKey: string;
  keyAlreadySaved: boolean;
  maskedKey: string | null;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  pending: boolean;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
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
            disabled={pending}
            id="browser-runtime-api-key"
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={
              keyAlreadySaved ? `Saved (${maskedKey})` : "Paste API key"
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
          disabled={pending || !(apiKey.trim() || keyAlreadySaved)}
          onClick={onSave}
          size="sm"
          type="button"
        >
          {pending ? <Spinner className="size-4" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function BrowserRuntimeSettingsCard() {
  const form = useBrowserRuntimeForm();
  const kernel = form.selected === KERNEL_VALUE;

  return (
    <div className="space-y-3 px-4 py-3" id="browser-runtime-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium text-foreground text-sm">Browser runtime</p>
        <div className="w-full min-w-0 sm:w-56">
          <Select
            disabled={form.pending}
            onValueChange={form.select}
            value={form.selected}
          >
            <SelectTrigger
              aria-label="Browser runtime"
              className="h-9 w-full"
              id="browser-runtime-provider"
            >
              <SelectValue>
                {kernel ? "Kernel" : "Local Chrome (default)"}
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

      {kernel ? (
        <KernelApiKeyFields
          apiKey={form.apiKey}
          keyAlreadySaved={form.keyAlreadySaved}
          maskedKey={form.maskedKey}
          onApiKeyChange={form.setApiKey}
          onSave={form.saveKey}
          pending={form.pending}
        />
      ) : null}

      {form.formError ? (
        <p className="text-destructive text-xs" role="alert">
          {form.formError}
        </p>
      ) : null}
    </div>
  );
}
