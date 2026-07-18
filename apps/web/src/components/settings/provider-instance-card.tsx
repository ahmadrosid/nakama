import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { Button } from "@/components/ui/button";
import {
  ProviderCatalogManageDialog,
  ProviderCerebrasManageDialog,
  ProviderCompatibleEditDialog,
  ProviderCompatibleManageDialog,
  ProviderOpenRouterManageDialog,
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

  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{instance.label}</p>
        <p className="text-xs text-muted-foreground">{card.description}</p>
        {card.isCompatible && instance.baseUrl ? (
          <p className="font-mono text-[11px] text-foreground/80">{instance.baseUrl}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {card.isCompatible ? (
          <Button type="button" size="sm" variant="outline" onClick={card.openEdit}>
            Edit
          </Button>
        ) : null}
        {card.isCompatible || card.isOpenRouter || card.isCerebras || card.isCatalogShortlist ? (
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

      {card.isCompatible ? (
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

      {card.isCompatible ? (
        <ProviderCompatibleManageDialog
          open={card.manageOpen}
          busy={card.busy}
          dialogError={card.dialogError}
          instance={instance}
          manageModels={card.manageModels}
          onOpenChange={card.setManageOpen}
          onCustomModelsChange={card.handleManageModelsChange}
          onSave={() => void card.saveCompatibleManage()}
        />
      ) : null}

      {card.isOpenRouter ? (
        <ProviderOpenRouterManageDialog
          open={card.manageOpen}
          busy={card.busy}
          dialogError={card.dialogError}
          manageModels={card.manageModels}
          onOpenChange={card.setManageOpen}
          onCustomModelsChange={card.handleManageModelsChange}
          onSave={() => void card.saveOpenRouter()}
        />
      ) : null}

      {card.isCerebras ? (
        <ProviderCerebrasManageDialog
          open={card.manageOpen}
          busy={card.busy}
          dialogError={card.dialogError}
          manageModels={card.manageModels}
          onOpenChange={card.setManageOpen}
          onCustomModelsChange={card.handleManageModelsChange}
          onSave={() => void card.saveCerebras()}
        />
      ) : null}

      {card.isCatalogShortlist ? (
        <ProviderCatalogManageDialog
          open={card.manageOpen}
          busy={card.busy}
          dialogError={card.dialogError}
          providerType={card.providerType as CatalogShortlistProvider}
          instanceId={instance.id}
          manageModels={card.manageModels}
          catalogModelsForType={card.catalogModelsForType}
          onOpenChange={card.setManageOpen}
          onCustomModelsChange={card.handleManageModelsChange}
          onSave={() => void card.saveCatalogShortlist()}
        />
      ) : null}
    </div>
  );
}
