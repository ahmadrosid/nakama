import type { CustomModelEntry, ProviderModelOption } from "@tinyclaw/core/contract";
import type { ReactNode } from "react";
import type { ModelListRow } from "@/components/ModelListEditor";

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function InlineField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-24 shrink-0 text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function seedManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  configuredModels: ProviderModelOption[],
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      default: model.default,
      supportsThinking: model.supportsThinking,
      inputPerMillionUsd: model.inputPerMillionUsd,
      outputPerMillionUsd: model.outputPerMillionUsd,
    }));
  }

  return configuredModels.map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    default: model.default,
    supportsThinking: model.supportsThinking,
    inputPerMillionUsd: model.inputPerMillionUsd,
    outputPerMillionUsd: model.outputPerMillionUsd,
  }));
}

export function seedOpenRouterManageModelRows(
  customModels: CustomModelEntry[] | undefined,
  currentModel?: string | null,
  currentModelName?: string | null,
): ModelListRow[] {
  if (customModels?.length) {
    return customModels.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      default: model.default,
      supportsThinking: model.supportsThinking,
      inputPerMillionUsd: model.inputPerMillionUsd,
      outputPerMillionUsd: model.outputPerMillionUsd,
    }));
  }

  const trimmed = currentModel?.trim();
  if (trimmed) {
    return [
      {
        id: trimmed,
        name: currentModelName?.trim() || trimmed,
        default: true,
      },
    ];
  }

  return [{ id: "", name: "" }];
}
