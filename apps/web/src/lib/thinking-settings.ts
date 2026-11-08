import type {
  ProviderModelOption,
  ThinkingEffort,
  ThinkingSettings,
} from "@nakama/core/contract";
import { extraThinkingEfforts } from "@nakama/core/thinking-effort";

export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

export const THINKING_EFFORT_OPTIONS: Array<{
  value: ThinkingEffort;
  label: string;
}> = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

const EXTRA_THINKING_EFFORT_LABELS = { max: "Max", xhigh: "X-High" };

/** Low/medium/high plus the higher levels the active model accepts. */
export function thinkingEffortOptionsFor(
  model: Pick<ProviderModelOption, "id" | "provider"> | undefined
): Array<{ label: string; value: ThinkingEffort }> {
  const extra = model ? extraThinkingEfforts(model.id, model.provider) : [];

  return [
    ...THINKING_EFFORT_OPTIONS,
    ...extra.map((value) => ({
      label: EXTRA_THINKING_EFFORT_LABELS[value],
      value,
    })),
  ];
}

export function shouldShowThinkingEffort(
  activeModelSupportsThinking: boolean | undefined
): boolean {
  return activeModelSupportsThinking === true;
}

export function buildAutoEnableThinkingPayload(
  settings: Pick<ThinkingSettings, "effort">
): ThinkingSettings {
  return {
    effort: settings.effort ?? DEFAULT_THINKING_EFFORT,
    enabled: true,
  };
}

export function shouldAutoEnableThinking(
  settings: ThinkingSettings | undefined,
  activeModelSupportsThinking: boolean | undefined,
  busy: boolean,
  alreadyMigrated: boolean,
  options?: {
    hasProfileId?: boolean;
    hasRouteSession?: boolean;
    hasSession?: boolean;
    hasMessages?: boolean;
  }
): boolean {
  if (alreadyMigrated || busy || !settings || settings.enabled !== false) {
    return false;
  }

  if (options?.hasProfileId === false) {
    return false;
  }

  if (options?.hasRouteSession || options?.hasSession || options?.hasMessages) {
    return false;
  }

  return activeModelSupportsThinking === true;
}
