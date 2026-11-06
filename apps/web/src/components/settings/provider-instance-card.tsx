import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { TableCell, TableRow } from "@nakama/ui/table";
import { useQuery } from "@tanstack/react-query";
import {
  Delete02Icon,
  Key01Icon,
  RefreshIcon,
  Settings02Icon,
  StarIcon,
} from "hugeicons-react";
import { type ComponentType, useEffect, useMemo, useRef } from "react";
import { CatalogProviderModelFields } from "@/components/CatalogProviderModelFields";
import { isCatalogShortlistProvider } from "@/components/catalog-provider-model-fields.shared";
import { ModelUsageContext } from "@/components/model-list-editor.shared";
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
  icon: Icon,
  disabled,
  destructive,
  onClick,
}: {
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={
        destructive
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground hover:text-foreground"
      }
      disabled={disabled}
      onClick={onClick}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon aria-hidden className="size-4" />
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

function providerAuthLabel(
  card: ReturnType<typeof useProviderInstanceCard>,
  instance: ProviderInstanceSummary
): string {
  if (instance.secretSource === "environment") {
    return `Env ${instance.secretEnvName}`;
  }

  if (card.isChatgpt || card.isXaiOAuth) {
    return "Sign-in";
  }

  return instance.hasApiKey ? "API key" : "None";
}

function providerCheckWarning(
  status: string | undefined,
  label: string
): string | null {
  switch (status) {
    case "error":
      return "Could not check";
    case "rejected":
      return "Key rejected";
    case "needs-key":
      return "Needs a key";
    case "unreachable":
      return `Cannot reach ${label}`;
    default:
      return null;
  }
}

function ProviderConnectedBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${
        ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"
      }`}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${ok ? "bg-emerald-500" : "bg-destructive"}`}
      />
      {ok ? "Connected" : "Not connected"}
    </span>
  );
}

function ProviderStatus({
  checkable,
  connected,
  instance,
}: {
  checkable: boolean;
  connected: boolean;
  instance: ProviderInstanceSummary;
}) {
  // A live check, so a key the provider stopped taking shows here and not
  // first in a chat. Once per provider every 10 minutes.
  const {
    data: check,
    isError,
    isFetching: checking,
    refetch: checkAgain,
  } = useQuery({
    // Local and custom endpoints can be checked without a key.
    enabled: checkable,
    queryFn: () => client.checkProvider(instance.id),
    queryKey: queryKeys.providerCheck(instance.id),
    staleTime: 10 * 60_000,
  });

  const status = isError ? "error" : check?.status;
  const warning = providerCheckWarning(status, instance.label);

  if (!warning) {
    return <ProviderConnectedBadge ok={connected || status === "ok"} />;
  }

  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <span
        className={
          status === "error" || status === "unreachable"
            ? "text-amber-700 dark:text-amber-300"
            : "text-destructive"
        }
        role="status"
      >
        {warning}
      </span>
      <button
        className="text-foreground underline underline-offset-2 disabled:opacity-50"
        disabled={checking}
        onClick={() => void checkAgain()}
        type="button"
      >
        {checking ? "Checking…" : "Check again"}
      </button>
    </span>
  );
}

function ProviderInstanceRow({
  instance,
  card,
  canManage,
  isDefault,
  autoFocus,
  onMakeDefault,
}: {
  instance: ProviderInstanceSummary;
  card: ReturnType<typeof useProviderInstanceCard>;
  canManage: boolean;
  isDefault: boolean;
  autoFocus: boolean;
  onMakeDefault?: () => void;
}) {
  // A provider just added takes focus, so a keyboard user lands on it.
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (autoFocus) {
      rowRef.current?.focus();
    }
  }, [autoFocus]);

  const endpoint = instance.baseUrl?.trim() || null;

  const connected =
    instance.hasApiKey || instance.secretSource === "environment";

  // Compatible providers edit name, URL and models in one dialog.
  const opensEdit = card.isCompatibleLike;
  const signsIn = card.isChatgpt || card.isXaiOAuth;

  return (
    <TableRow
      className="outline-none focus-visible:bg-muted"
      ref={rowRef}
      tabIndex={-1}
    >
      <TableCell className="max-w-64">
        <p className="flex min-w-0 items-center gap-2 font-medium text-foreground">
          <span className="truncate">{instance.label}</span>
          {isDefault ? (
            <span className="shrink-0 rounded-md border border-border px-1.5 font-normal text-muted-foreground text-xs">
              Default
            </span>
          ) : null}
        </p>
        {endpoint ? (
          <p
            className="truncate font-mono text-muted-foreground text-xs"
            title={endpoint}
          >
            {endpoint}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {providerAuthLabel(card, instance)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {providerModelCountLabel(instance.modelCount)}
      </TableCell>
      <TableCell>
        <ProviderStatus
          checkable={connected || card.isCompatibleLike}
          connected={connected}
          instance={instance}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap py-1.5 pr-2 text-right">
        {opensEdit || canManage ? (
          <ProviderActionButton
            icon={Settings02Icon}
            label={`Manage ${instance.label}`}
            onClick={opensEdit ? card.openEdit : card.openManage}
          />
        ) : null}
        <ProviderActionButton
          disabled={instance.secretSource === "environment"}
          icon={signsIn ? RefreshIcon : Key01Icon}
          label={
            instance.secretSource === "environment"
              ? `Key from ${instance.secretEnvName}`
              : providerKeyActionLabel(card, instance.hasApiKey)
          }
          onClick={() => card.setReplaceKeyOpen(true)}
        />
        {onMakeDefault && !isDefault ? (
          <ProviderActionButton
            disabled={card.busy}
            icon={StarIcon}
            label={`Make ${instance.label} default`}
            onClick={onMakeDefault}
          />
        ) : null}
        <ProviderActionButton
          destructive
          disabled={card.busy}
          icon={Delete02Icon}
          label={`Remove ${instance.label}`}
          onClick={() => card.setDeleteOpen(true)}
        />
      </TableCell>
    </TableRow>
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

// The Defaults settings that use this provider, for Remove and Manage.
function useProviderSettingUsage(instance: ProviderInstanceSummary) {
  const { data: modelsResponse } = useModelsQuery();
  const { data: vision } = useVisionSettings();
  const { data: transcription } = useTranscriptionSettings();
  const { data: imageGeneration } = useImageGenerationSettings();

  return useMemo(() => {
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

    // Manage marks the model each setting uses.
    const modelUsage: Record<string, string[]> = {};

    for (const [name, model] of settingModels) {
      const resolved = model
        ? decodeModelSelection(profileModelSelectionValue(model, groups))
        : null;

      if (resolved?.providerId === instance.id) {
        modelUsage[resolved.modelId] = [
          ...(modelUsage[resolved.modelId] ?? []),
          name.replace(/ model$/, ""),
        ];
      }
    }

    const usedBy = settingModels.flatMap(([name, model]) => {
      if (!model) {
        return name === "Image generation model" && lastChatgpt ? [name] : [];
      }

      const resolved = decodeModelSelection(
        profileModelSelectionValue(model, groups)
      );

      return resolved?.providerId === instance.id ? [name] : [];
    });

    return { modelUsage, usedBy };
  }, [
    imageGeneration?.model,
    instance.id,
    instance.type,
    modelsResponse?.models,
    transcription?.model,
    vision?.model,
  ]);
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
  const { modelUsage, usedBy } = useProviderSettingUsage(instance);

  return (
    <ModelUsageContext.Provider value={modelUsage}>
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
          saveSummary={card.saveSummary}
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
          saveSummary={card.saveSummary}
          title={`Manage ${instance.label}`}
        >
          <ProviderManageModelsFields card={card} instance={instance} />
        </ProviderManageModelsDialog>
      ) : null}
    </ModelUsageContext.Provider>
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
  autoFocus = false,
  onMakeDefault,
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
  autoFocus?: boolean;
  onMakeDefault?: () => void;
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
        autoFocus={autoFocus}
        canManage={canManage}
        card={card}
        instance={instance}
        isDefault={isDefault}
        onMakeDefault={onMakeDefault}
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
