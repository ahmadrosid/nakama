import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import {
  Delete02Icon,
  Edit03Icon,
  Key01Icon,
  ListViewIcon,
} from "hugeicons-react";
import type { ReactNode } from "react";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { CustomProviderFields } from "@/components/CustomProviderFields";
import type { CatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { ShortlistBrowseProviderModelFields } from "@/components/ShortlistBrowseProviderModelFields";
import {
  ProviderCompatibleEditDialog,
  ProviderManageModelsDialog,
  ProviderReplaceKeyDialog,
} from "@/components/settings/provider-instance-dialogs";
import { useProviderInstanceCard } from "@/components/settings/use-provider-instance-card";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
            aria-label={label}
            className={
              destructive
                ? "text-muted-foreground hover:text-destructive"
                : "text-muted-foreground"
            }
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
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
  onUpdate: (
    providerId: string,
    request: UpdateProviderRequest
  ) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onError: (error: string | null) => void;
}) {
  const card = useProviderInstanceCard({
    catalog,
    instance,
    onDelete,
    onError,
    onUpdate,
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
          <p className="truncate font-medium text-foreground text-sm">
            {instance.label}
          </p>
        </td>
        <td className="px-3 py-2.5 align-middle">
          {endpoint ? (
            <p
              className="max-w-[18rem] truncate font-mono text-2xs text-foreground/80"
              title={endpoint}
            >
              {endpoint}
            </p>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 align-middle">
          <span className="text-muted-foreground text-sm">{modelLabel}</span>
        </td>
        <td className="px-3 py-2.5 align-middle">
          <div className="flex items-center justify-end gap-0.5">
            {card.isCompatibleLike ? (
              <ProviderActionButton label="Edit" onClick={card.openEdit}>
                <Edit03Icon className="size-3.5" />
              </ProviderActionButton>
            ) : null}
            {canManage ? (
              <ProviderActionButton
                label="Manage models"
                onClick={card.openManage}
              >
                <ListViewIcon className="size-3.5" />
              </ProviderActionButton>
            ) : null}
            <ProviderActionButton
              label={instance.hasApiKey ? "Update key" : "Add key"}
              onClick={() => card.setReplaceKeyOpen(true)}
            >
              <Key01Icon className="size-3.5" />
            </ProviderActionButton>
            <ProviderActionButton
              destructive
              disabled={card.busy}
              label="Remove"
              onClick={() => void card.handleDelete()}
            >
              <Delete02Icon className="size-3.5" />
            </ProviderActionButton>
          </div>
        </td>
      </tr>

      <ProviderReplaceKeyDialog
        apiKey={card.apiKey}
        busy={card.busy}
        dialogError={card.dialogError}
        instance={instance}
        onApiKeyChange={card.setApiKey}
        onOpenChange={card.setReplaceKeyOpen}
        onSave={() => void card.handleReplaceKey()}
        onToggleShowApiKey={() => card.setShowApiKey((current) => !current)}
        open={card.replaceKeyOpen}
        providerType={card.providerType}
        showApiKey={card.showApiKey}
      />

      {card.isCompatibleLike ? (
        <ProviderCompatibleEditDialog
          browseLabel={card.isOllama ? "Ollama" : undefined}
          busy={card.busy}
          dialogError={card.dialogError}
          editBaseUrl={card.editBaseUrl}
          editLabel={card.editLabel}
          hostMode={instance.hostMode ?? undefined}
          manageModels={card.editManageModels}
          onBaseUrlChange={card.setEditBaseUrl}
          onCustomModelsChange={card.handleManageModelsChange}
          onDisplayNameChange={card.setEditLabel}
          onOpenChange={card.setEditOpen}
          onSave={() => void card.saveCompatible()}
          open={card.editOpen}
          providerInstanceId={instance.id}
          remoteProvider={card.isOllama ? "ollama" : "openai_compatible"}
        />
      ) : null}

      {canManage ? (
        <ProviderManageModelsDialog
          busy={card.busy}
          dialogError={card.isCompatibleLike ? card.dialogError : null}
          onOpenChange={card.setManageOpen}
          onSave={() => void card.saveManageModels()}
          open={card.manageOpen}
        >
          {card.isCompatibleLike ? (
            <CustomProviderFields
              apiKey=""
              baseUrl={instance.baseUrl ?? ""}
              baseUrlError={null}
              browseLabel={card.isOllama ? "Ollama" : undefined}
              browseSource="remote"
              customModels={card.manageModels}
              disabled={card.busy}
              displayName={instance.label}
              displayNameError={null}
              hostMode={instance.hostMode ?? undefined}
              identityReadOnly
              modelsError={null}
              onBaseUrlChange={() => {}}
              onCustomModelsChange={card.handleManageModelsChange}
              onDisplayNameChange={() => {}}
              providerInstanceId={instance.id}
              remoteProvider={card.isOllama ? "ollama" : "openai_compatible"}
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
              customModels={card.manageModels}
              disabled={card.busy}
              modelsError={card.dialogError}
              onCustomModelsChange={card.handleManageModelsChange}
              provider={card.providerType}
              providerId={
                card.providerType === "fireworks" ? instance.id : undefined
              }
            />
          ) : null}
          {card.isCatalogShortlist ? (
            <CatalogProviderModelFields
              catalogModels={card.catalogModelsForType}
              customModels={card.manageModels}
              disabled={card.busy}
              modelsError={card.dialogError}
              onCustomModelsChange={card.handleManageModelsChange}
              provider={card.providerType as CatalogShortlistProvider}
              providerInstanceId={instance.id}
            />
          ) : null}
        </ProviderManageModelsDialog>
      ) : null}
    </>
  );
}
