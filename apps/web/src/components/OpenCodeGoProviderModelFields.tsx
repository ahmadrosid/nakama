import type { ProviderModelOption } from "@nakama/core/contract";
import type { ModelListRow } from "@/components/ModelListEditor";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";

interface OpenCodeGoProviderModelFieldsProps {
  customModels: ModelListRow[];
  catalogModels?: ProviderModelOption[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
}

export function OpenCodeGoProviderModelFields(props: OpenCodeGoProviderModelFieldsProps) {
  return <CatalogProviderModelFields provider="opencode_go" {...props} />;
}
