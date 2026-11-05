import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useQuery } from "@tanstack/react-query";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { OpenRouterProviderModelFields } from "@/components/OpenRouterProviderModelFields";
import { ShortlistBrowseProviderModelFields } from "@/components/ShortlistBrowseProviderModelFields";
import {
  ProviderCompatibleEditDialog,
  ProviderManageModelsDialog,
  ProviderReconnectDialog,
  ProviderRemoveDialog,
  ProviderReplaceKeyDialog,
} from "@/components/settings/provider-instance-dialogs";
import { useProviderInstanceCard } from "@/components/settings/use-provider-instance-card";
import { isShortlistBrowseProvider } from "@/components/shortlist-browse-providers.shared";
import {
  CHATGPT_SIGN_IN,
  XAI_SIGN_IN,
} from "@/components/subscription-sign-in.shared";
import {
  useImageGenerationSettings,
  useModelsQuery,
  useTranscriptionSettings,
  useVisionSettings,
} from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import {
  decodeModelSelection,
  groupModelsByProvider,
  profileModelSelectionValue,
} from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";

function ProviderActionButton({
  label,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={
        destructive ? "text-destructive hover:text-destructive" : undefined
      }
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
    </Button>
  );
}

function canManageProviderModels(card: {
  isCompatibleLike: boolean;
  isOpenRouter: boolean;
  isShortlistBrowse: boolean;
  isCatalogShortlist: boolean;
}): boolean {
  return (
    card.isCompatibleLike ||
    card.isOpenRouter ||
    card.isShortlistBrowse ||
    card.isCatalogShortlist
  );
}

function providerModelCountLabel(modelCount: number): string {
  return modelCount === 1 ? "1 model" : `${modelCount} models`;
}

function compatibleRemoteProvider(
  card: ReturnType<typeof useProviderInstanceCard>
): "ollama" | "netra" | "openai_compatible" {
  if (card.isOllama) {
    return "ollama";
  }

  if (card.providerType === "netra") {
    return "netra";
  }

  return "openai_compatible";
}

function providerKeyActionLabel(
  card: ReturnType<typeof useProviderInstanceCard>,
  hasApiKey: boolean
): string {
  if (card.isXaiOAuth) {
    return hasApiKey ? "Reconnect Grok" : "Connect Grok";
  }

  if (card.isChatgpt) {
    return hasApiKey ? "Reconnect ChatGPT" : "Connect ChatGPT";
  }

  return hasApiKey ? "Update key" : "Add key";
}

function ProviderCheckStatus({
  enabled,
  instance,
}: {
  enabled: boolean;
  instance: ProviderInstanceSummary;
}) {
  // A live check, so a key the provider stopped taking shows here and not
  // first in a chat. Once per provider every 10 minutes.
  const {
    data: check,
    isFetching: checking,
    refetch: checkAgain,
  } = useQuery({
    // Local and custom endpoints can be checked without a key.
    enabled,
    queryFn: () => client.checkProvider(instance.id),
    queryKey: queryKeys.providerCheck(instance.id),
    staleTime: 10 * 60_000,
  });

  if (!(check?.status === "rejected" || check?.status === "unreachable")) {
    return null;
  }

  return (
    <>
      {check.status === "rejected" ? (
        <span className="text-destructive">Key rejected</span>
      ) : (
        <span className="text-amber-700 dark:text-amber-300">
          Cannot reach {instance.label}
        </span>
      )}
      <button
        className="text-foreground underline underline-offset-2 disabled:opacity-50"
        disabled={checking}
        onClick={() => void checkAgain()}
        type="button"
      >
        {checking ? "Checking…" : "Check again"}
      </button>
    </>
  );
}

function ProviderInstanceRow({
  instance,
  card,
  canManage,
  isDefault,
}: {
  instance: ProviderInstanceSummary;
  card: ReturnType<typeof useProviderInstanceCard>;
  canManage: boolean;
  isDefault: boolean;
}) {
  const endpoint = instance.baseUrl?.trim() || null;

  const connected =
    instance.hasApiKey || instance.secretSource === "environment";

  // Compatible providers edit name, URL and models in one dialog.
  const opensEdit = card.isCompatibleLike;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-[1_1_14rem]">
        <p className="flex min-w-0 items-center gap-2 font-medium text-foreground text-sm">
          <span className="truncate">{instance.label}</span>
          {isDefault ? (
            <span className="shrink-0 rounded-md border border-border px-1.5 font-normal text-muted-foreground text-xs">
              Default provider
            </span>
          ) : null}
        </p>
        <p className="flex min-w-0 flex-wrap gap-x-2 text-muted-foreground text-xs">
          <span>{providerModelCountLabel(instance.modelCount)}</span>
          {endpoint ? (
            <span className="min-w-0 truncate font-mono" title={endpoint}>
              {endpoint}
            </span>
          ) : null}
          {connected ? null : (
            <span className="text-destructive">Not connected</span>
          )}
          <ProviderCheckStatus
            enabled={connected || card.isCompatibleLike}
            instance={instance}
          />
        </p>
      </div>
      <div className="-ml-2 flex flex-wrap items-center gap-0.5 sm:ml-0">
        {opensEdit || canManage ? (
          <ProviderActionButton
            label="Manage"
            onClick={opensEdit ? card.openEdit : card.openManage}
          />
        ) : null}
        <ProviderActionButton
          disabled={instance.secretSource === "environment"}
          label={
            instance.secretSource === "environment"
              ? `Key from ${instance.secretEnvName}`
              : providerKeyActionLabel(card, instance.hasApiKey)
          }
          onClick={() => card.setReplaceKeyOpen(true)}
        />
        <ProviderActionButton
          destructive
          disabled={card.busy}
          label="Remove"
          onClick={() => card.setDeleteOpen(true)}
        />
      </div>
    </li>
  );
}

function ProviderManageModelsFields({
  card,
  instance,
}: {
  card: ReturnType<typeof useProviderInstanceCard>;
  instance: ProviderInstanceSummary;
}) {
  return (
    <>
      {card.isOpenRouter ? (
        <OpenRouterProviderModelFields
          customModels={card.manageModels}
          disabled={card.busy}
          modelsError={card.dialogError}
          onCustomModelsChange={card.handleManageModelsChange}
          onRoutingChange={card.setOpenRouterRouting}
          routing={card.openRouterRouting}
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
            card.providerType === "fireworks" ||
            card.providerType === "cloudflare"
              ? instance.id
              : undefined
          }
        />
      ) : null}
      {isCatalogShortlistProvider(card.providerType) ? (
        <CatalogProviderModelFields
          catalogModels={card.catalogModelsForType}
          customModels={card.manageModels}
          disabled={card.busy}
          modelsError={card.dialogError}
          onCustomModelsChange={card.handleManageModelsChange}
          provider={card.providerType}
          providerInstanceId={instance.id}
        />
      ) : null}
    </>
  );
}

function ProviderKeyDialog({
  card,
  instance,
}: {
  card: ReturnType<typeof useProviderInstanceCard>;
  instance: ProviderInstanceSummary;
}) {
  return card.isChatgpt ? (
    <ProviderReconnectDialog
      busy={card.busy}
      dialogError={card.dialogError}
      instance={instance}
      onConnected={(chatgptOAuth) => void card.reconnect({ chatgptOAuth })}
      onOpenChange={card.setReplaceKeyOpen}
      open={card.replaceKeyOpen}
      signIn={CHATGPT_SIGN_IN}
    />
  ) : card.isXaiOAuth ? (
    <ProviderReconnectDialog
      busy={card.busy}
      dialogError={card.dialogError}
      instance={instance}
      onConnected={(xaiOAuth) => void card.reconnect({ xaiOAuth })}
      onOpenChange={card.setReplaceKeyOpen}
      open={card.replaceKeyOpen}
      signIn={XAI_SIGN_IN}
    />
  ) : (
    <ProviderReplaceKeyDialog
      apiKey={card.apiKey}
      busy={card.busy}
      dialogError={card.dialogError}
      instance={instance}
      onApiKeyChange={card.setApiKey}
      onManage={(action) => void card.handleManageKey(action)}
      onOpenChange={card.setReplaceKeyOpen}
      onSave={() => void card.handleReplaceKey()}
      onToggleShowApiKey={() => card.setShowApiKey((current) => !current)}
      open={card.replaceKeyOpen}
      providerType={card.providerType}
      showApiKey={card.showApiKey}
    />
  );
}

function ProviderInstanceCardDialogs({
  card,
  instance,
  isDefault,
  isSole,
  canManage,
  nextDefaultLabel,
}: {
  card: ReturnType<typeof useProviderInstanceCard>;
  instance: ProviderInstanceSummary;
  isDefault: boolean;
  isSole: boolean;
  canManage: boolean;
  nextDefaultLabel?: string;
}) {
  const { data: modelsResponse } = useModelsQuery();
  const { data: vision } = useVisionSettings();
  const { data: transcription } = useTranscriptionSettings();
  const { data: imageGeneration } = useImageGenerationSettings();
  const groups = groupModelsByProvider(modelsResponse?.models ?? []);

  // Settings that pick a model from this provider lose it on remove.
  const settingModels: Array<[string, string | null | undefined]> = [
    ["Image parsing model", vision?.model],
    ["Audio transcription model", transcription?.model],
    ["Image generation model", imageGeneration?.model],
  ];

  // With no model saved, images come from a connected ChatGPT. Removing the
  // last one leaves image generation with no provider.
  const lastChatgpt =
    instance.type === "chatgpt" &&
    !groups.some(
      (group) =>
        group.providerId !== instance.id &&
        group.models.some((model) => model.provider === "chatgpt")
    );

  const usedBy = settingModels.flatMap(([name, model]) => {
    if (!model) {
      return name === "Image generation model" && lastChatgpt ? [name] : [];
    }

    const resolved = decodeModelSelection(
      profileModelSelectionValue(model, groups)
    );

    return resolved?.providerId === instance.id ? [name] : [];
  });

  return (
    <>
      <ProviderRemoveDialog
        busy={card.busy}
        isDefault={isDefault}
        isSole={isSole}
        label={instance.label}
        nextDefaultLabel={nextDefaultLabel}
        onConfirm={() => void card.handleDelete()}
        onOpenChange={card.setDeleteOpen}
        open={card.deleteOpen}
        usedBy={usedBy}
      />

      <ProviderKeyDialog card={card} instance={instance} />

      {card.isCompatibleLike ? (
        <ProviderCompatibleEditDialog
          browseLabel={card.isOllama ? "Ollama" : undefined}
          busy={card.busy}
          dialogError={card.dialogError}
          dirty={card.dirty}
          editBaseUrl={card.editBaseUrl}
          editLabel={card.editLabel}
          fieldErrors={card.editFieldErrors}
          hideIdentity={card.providerType === "netra"}
          hostMode={instance.hostMode ?? undefined}
          manageModels={card.editManageModels}
          onBaseUrlChange={card.setEditBaseUrl}
          onCustomModelsChange={card.handleManageModelsChange}
          onDisplayNameChange={card.setEditLabel}
          onOpenChange={card.setEditOpen}
          onSave={() => void card.saveCompatible()}
          onWireApiChange={
            card.isOllama || card.providerType === "netra"
              ? undefined
              : card.setEditWireApi
          }
          open={card.editOpen}
          providerInstanceId={instance.id}
          remoteProvider={compatibleRemoteProvider(card)}
          title={`Manage ${instance.label}`}
          wireApi={card.editWireApi}
        />
      ) : null}

      {canManage && !card.isCompatibleLike ? (
        <ProviderManageModelsDialog
          busy={card.busy}
          dialogError={card.isCompatibleLike ? card.dialogError : null}
          dirty={card.dirty}
          onOpenChange={card.setManageOpen}
          onSave={() => void card.saveManageModels()}
          open={card.manageOpen}
          title={`Manage ${instance.label}`}
        >
          <ProviderManageModelsFields card={card} instance={instance} />
        </ProviderManageModelsDialog>
      ) : null}
    </>
  );
}

export function ProviderInstanceCard({
  instance,
  catalog,
  onUpdate,
  onDelete,
  onManage,
  onError,
  isDefault = false,
  isSole = false,
  nextDefaultLabel,
}: {
  instance: ProviderInstanceSummary;
  catalog: ProviderModelOption[];
  onUpdate: (
    providerId: string,
    request: UpdateProviderRequest
  ) => Promise<void>;
  onDelete: (providerId: string) => Promise<void>;
  onManage?: (
    providerId: string,
    action: "clear" | "use-stored"
  ) => Promise<void>;
  onError: (error: string | null) => void;
  isDefault?: boolean;
  isSole?: boolean;
  nextDefaultLabel?: string;
}) {
  const card = useProviderInstanceCard({
    catalog,
    instance,
    onDelete,
    onError,
    onManage,
    onUpdate,
  });

  const canManage = canManageProviderModels(card);

  return (
    <>
      <ProviderInstanceRow
        canManage={canManage}
        card={card}
        instance={instance}
        isDefault={isDefault}
      />
      <ProviderInstanceCardDialogs
        canManage={canManage}
        card={card}
        instance={instance}
        isDefault={isDefault}
        isSole={isSole}
        nextDefaultLabel={nextDefaultLabel}
      />
    </>
  );
}
