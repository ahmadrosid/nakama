import { BrowsableModelFields } from "@/components/BrowsableModelFields";
import { CerebrasModelsBrowseList } from "@/components/CerebrasModelsBrowseList";
import { CloudflareModelsBrowseList } from "@/components/CloudflareModelsBrowseList";
import { FireworksModelsBrowseList } from "@/components/FireworksModelsBrowseList";
import type { ModelListRow } from "@/components/ModelListEditor";
import { capabilityBrowseRowToModelListRow } from "@/components/model-browse-utils";
import {
  SHORTLIST_BROWSE_COPY,
  type ShortlistBrowseProvider,
} from "@/components/shortlist-browse-providers.shared";

interface ShortlistBrowseProviderModelFieldsProps {
  apiKey?: string;
  /** Cloudflare only: the account's Workers AI URL before the provider is saved. */
  baseUrl?: string;
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
  baseUrl,
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
      renderBrowse={({ multiSelect, onAddMany, onSelect }) =>
        provider === "cerebras" ? (
          <CerebrasModelsBrowseList
            className="h-72 rounded-md border border-border"
            multiSelect={multiSelect}
            onAddMany={onAddMany}
            onSelect={onSelect}
          />
        ) : provider === "cloudflare" ? (
          <CloudflareModelsBrowseList
            apiKey={apiKey}
            baseUrl={baseUrl}
            className="h-72 rounded-md border border-border"
            multiSelect={multiSelect}
            onAddMany={onAddMany}
            onSelect={onSelect}
            providerId={providerId}
          />
        ) : (
          <FireworksModelsBrowseList
            apiKey={apiKey}
            className="h-72 rounded-md border border-border"
            multiSelect={multiSelect}
            onAddMany={onAddMany}
            onSelect={onSelect}
            providerId={providerId}
          />
        )
      }
      // The Cloudflare client sends no thinking options.
      showThinking={provider !== "cloudflare"}
      showVision
      toModelRow={capabilityBrowseRowToModelListRow}
    />
  );
}
