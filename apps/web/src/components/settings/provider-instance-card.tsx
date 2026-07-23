import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { CerebrasProviderModelFields } from "@/components/CerebrasProviderModelFields";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import {
  ProviderCompatibleEditDialog,
  ProviderManageModelsDialog,
  ProviderReplaceKeyDialog,
} from "@/components/settings/provider-instance-dialogs";
import { useProviderInstanceCard } from "@/components/settings/use-provider-instance-card";
import type { CatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";

export function ProviderInstanceCard({
  instance,
  catalog,
  onUpdate,
  onDelete,
  onError,
}: {
  instance: ProviderInstanceSummary;
  catalog: ProviderModelOption[];
  onUpdate: (providerId: string, request: UpdateProviderRequest) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const card = useProviderInstanceCard({
    instance,
    catalog,
    onUpdate,
    onDelete,
    onError,
  });

  const canManage =
    card.isCompatibleLike ||
    card.isOpenRouter ||
    card.isCerebras ||
    card.isCatalogShortlist;

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{instance.label}</p>
        <p className="text-xs text-muted-foreground">{card.description}</p>
        {card.isCompatibleLike && instance.baseUrl ? (
          <p className="font-mono text-[11px] text-foreground/80">{instance.baseUrl}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {card.isCompatibleLike ? (
          <Button type="button" size="sm" variant="outline" onClick={card.openEdit}>
            Edit
          </Button>
        ) : null}
        {canManage ? (
          <Button type="button" size="sm" variant="outline" onClick={card.openManage}>
            Manage
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => card.setReplaceKeyOpen(true)}
        >
          {instance.hasApiKey ? "Update key" : "Add key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={card.busy}
          onClick={() => void card.handleDelete()}
        >
          Remove
        </Button>
      </div>

      <ProviderReplaceKeyDialog
        open={card.replaceKeyOpen}
        instance={instance}
        providerType={card.providerType}
        apiKey={card.apiKey}
        showApiKey={card.showApiKey}
        busy={card.busy}
        dialogError={card.dialogError}
        onOpenChange={card.setReplaceKeyOpen}
        onApiKeyChange={card.setApiKey}
        onToggleShowApiKey={() => card.setShowApiKey((current) => !current)}
        onSave={() => void card.handleReplaceKey()}
      />

      {card.isCompatibleLike ? (
        <ProviderCompatibleEditDialog
          open={card.editOpen}
          busy={card.busy}
          dialogError={card.dialogError}
          editLabel={card.editLabel}
          editBaseUrl={card.editBaseUrl}
          manageModels={card.editManageModels}
          onOpenChange={card.setEditOpen}
          onDisplayNameChange={card.setEditLabel}
          onBaseUrlChange={card.setEditBaseUrl}
          onCustomModelsChange={card.handleManageModelsChange}
          onSave={() => void card.saveCompatible()}
        />
      ) : null}

      {canManage ? (
        <ProviderManageModelsDialog
          open={card.manageOpen}
          busy={card.busy}
          dialogError={card.isCompatibleLike ? card.dialogError : null}
          onOpenChange={card.setManageOpen}
          onSave={() => void card.saveManageModels()}
        >
          {card.isCompatibleLike ? (
            <CustomProviderFields
              displayName={instance.label}
              baseUrl={instance.baseUrl ?? ""}
              apiKey=""
              customModels={card.manageModels}
              disabled={card.busy}
              identityReadOnly
              showThinkingToggle
              displayNameError={null}
              baseUrlError={null}
              modelsError={null}
              onDisplayNameChange={() => {}}
              onBaseUrlChange={() => {}}
              onCustomModelsChange={card.handleManageModelsChange}
            />
          ) : null}
          {card.isOpenRouter ? (
            <OpenRouterProviderModelFields
              customModels={card.manageModels}
              disabled={card.busy}
              modelsError={card.dialogError}
              onCustomModelsChange={card.handleManageModelsChange}
            />
          ) : null}
          {card.isCerebras ? (
            <CerebrasProviderModelFields
              customModels={card.manageModels}
              disabled={card.busy}
              modelsError={card.dialogError}
              onCustomModelsChange={card.handleManageModelsChange}
            />
          ) : null}
          {card.isCatalogShortlist ? (
            <CatalogProviderModelFields
              provider={card.providerType as CatalogShortlistProvider}
              providerInstanceId={instance.id}
              customModels={card.manageModels}
              catalogModels={card.catalogModelsForType}
              disabled={card.busy}
              modelsError={card.dialogError}
              onCustomModelsChange={card.handleManageModelsChange}
            />
          ) : null}
        </ProviderManageModelsDialog>
      ) : null}
    </div>
  );
}
