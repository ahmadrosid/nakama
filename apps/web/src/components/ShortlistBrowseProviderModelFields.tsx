import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import { CerebrasModelsBrowseList } from "@/components/CerebrasModelsBrowseList";
import { FireworksModelsBrowseList } from "@/components/FireworksModelsBrowseList";
import type { ModelListRow } from "@/components/ModelListEditor";
import { capabilityBrowseRowToModelListRow } from "@/components/model-browse-utils";
import {
  SHORTLIST_BROWSE_COPY,
  type ShortlistBrowseProvider,
} from "@/components/shortlist-browse-providers.shared";

interface ShortlistBrowseProviderModelFieldsProps {
  apiKey?: string;
  customModels: ModelListRow[];
  density?: "default" | "compact";
  disabled?: boolean;
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  provider: ShortlistBrowseProvider;
  providerId?: string;
}

export function ShortlistBrowseProviderModelFields({
  provider,
  customModels,
  disabled,
  density = "default",
  modelsError,
  onCustomModelsChange,
  apiKey,
  providerId,
}: ShortlistBrowseProviderModelFieldsProps) {
  const copy = SHORTLIST_BROWSE_COPY[provider];

  return (
    <BrowsableModelFields
      browseLabel={copy.browseLabel}
      customModels={customModels}
      density={density}
      disabled={disabled}
      fieldId={`${provider}-provider-models`}
      footerHint={copy.footerHint}
      modelsError={modelsError}
      onCustomModelsChange={onCustomModelsChange}
      renderBrowse={(onSelect) =>
        provider === "cerebras" ? (
          <CerebrasModelsBrowseList
            className="h-72 rounded-md border border-border"
            onSelect={onSelect}
          />
        ) : (
          <FireworksModelsBrowseList
            apiKey={apiKey}
            className="h-72 rounded-md border border-border"
            onSelect={onSelect}
            providerId={providerId}
          />
        )
      }
      toModelRow={capabilityBrowseRowToModelListRow}
    />
  );
}
