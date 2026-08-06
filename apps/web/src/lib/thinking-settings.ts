import type { ThinkingEffort, ThinkingSettings } from "@nakama/core/contract";

export const DEFAULT_THINKING_EFFORT: ThinkingEffort = "medium";

export const THINKING_EFFORT_OPTIONS: Array<{ value: ThinkingEffort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function thinkingEffortLabel(effort: ThinkingEffort): string {
  return THINKING_EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? effort;
}

export function shouldShowThinkingEffort(
  activeModelSupportsThinking: boolean | undefined,
): boolean {
  return activeModelSupportsThinking === true;
}

/** Same gate as effort picker — thinking UI only when model explicitly supports reasoning. */
export const shouldShowThinkingBlocks = shouldShowThinkingEffort;

export function buildAutoEnableThinkingPayload(
  settings: Pick<ThinkingSettings, "effort">,
): ThinkingSettings {
  return {
    enabled: true,
    effort: settings.effort ?? DEFAULT_THINKING_EFFORT,
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
  },
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

export function shouldBlockThinkingEffortChange(busy: boolean): boolean {
  return busy;
}
