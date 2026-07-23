import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import {
  KeyRoundIcon,
  ListIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { ShortlistBrowseProviderModelFields } from "@/components/ShortlistBrowseProviderModelFields";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import {
  ProviderCompatibleEditDialog,
  ProviderManageModelsDialog,
  ProviderReplaceKeyDialog,
} from "@/components/settings/provider-instance-dialogs";
import { useProviderInstanceCard } from "@/components/settings/use-provider-instance-card";
import type { CatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function ProviderActionButton({
  label,
  disabled,
  destructive,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={label}
            className={
              destructive
                ? "text-muted-foreground hover:text-destructive"
                : "text-muted-foreground"
            }
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

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
    card.isShortlistBrowse ||
    card.isCatalogShortlist;

  const endpoint = instance.baseUrl?.trim() || null;
  const modelLabel =
    instance.modelCount === 1 ? "1 model" : `${instance.modelCount} models`;

  return (
    <>
      <tr>
        <td className="px-3 py-2.5 align-middle">
          <p className="truncate text-sm font-medium text-foreground">{instance.label}</p>
        </td>
        <td className="px-3 py-2.5 align-middle">
          {endpoint ? (
            <p className="max-w-[18rem] truncate font-mono text-[11px] text-foreground/80" title={endpoint}>
              {endpoint}
            </p>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
          <span className="text-sm text-muted-foreground">{modelLabel}</span>
        </td>
        <td className="px-3 py-2.5 align-middle">
          <div className="flex items-center justify-end gap-0.5">
            {card.isCompatibleLike ? (
              <ProviderActionButton label="Edit" onClick={card.openEdit}>
                <PencilIcon className="size-3.5" />
              </ProviderActionButton>
            ) : null}
            {canManage ? (
              <ProviderActionButton label="Manage models" onClick={card.openManage}>
                <ListIcon className="size-3.5" />
              </ProviderActionButton>
            ) : null}
            <ProviderActionButton
              label={instance.hasApiKey ? "Update key" : "Add key"}
              onClick={() => card.setReplaceKeyOpen(true)}
            >
              <KeyRoundIcon className="size-3.5" />
            </ProviderActionButton>
            <ProviderActionButton
              label="Remove"
              destructive
              disabled={card.busy}
              onClick={() => void card.handleDelete()}
            >
              <Trash2Icon className="size-3.5" />
            </ProviderActionButton>
          </div>
        </td>
      </tr>

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
          providerInstanceId={instance.id}
          remoteProvider={card.isOllama ? "ollama" : "openai_compatible"}
          hostMode={instance.hostMode ?? undefined}
          browseLabel={card.isOllama ? "Ollama" : undefined}
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
              browseSource="remote"
              remoteProvider={card.isOllama ? "ollama" : "openai_compatible"}
              providerInstanceId={instance.id}
              hostMode={instance.hostMode ?? undefined}
              browseLabel={card.isOllama ? "Ollama" : undefined}
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
          {isShortlistBrowseProvider(card.providerType) ? (
            <ShortlistBrowseProviderModelFields
              provider={card.providerType}
              customModels={card.manageModels}
              disabled={card.busy}
              modelsError={card.dialogError}
              providerId={card.providerType === "fireworks" ? instance.id : undefined}
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
    </>
  );
}
