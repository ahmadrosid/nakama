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
  provider: ShortlistBrowseProvider;
  customModels: ModelListRow[];
  disabled?: boolean;
  density?: "default" | "compact";
  modelsError?: string | null;
  onCustomModelsChange: (models: ModelListRow[]) => void;
  apiKey?: string;
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
      fieldId={`${provider}-provider-models`}
      customModels={customModels}
      disabled={disabled}
      density={density}
      modelsError={modelsError}
      browseLabel={copy.browseLabel}
      footerHint={copy.footerHint}
      onCustomModelsChange={onCustomModelsChange}
      toModelRow={capabilityBrowseRowToModelListRow}
      renderBrowse={(onSelect) =>
        provider === "cerebras" ? (
          <CerebrasModelsBrowseList
            onSelect={onSelect}
            className="h-72 rounded-md border border-border"
          />
        ) : (
          <FireworksModelsBrowseList
            onSelect={onSelect}
            className="h-72 rounded-md border border-border"
            apiKey={apiKey}
            providerId={providerId}
          />
        )
      }
    />
  );
}
