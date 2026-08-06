import type { CustomModelEntry } from "@nakama/core";
import { formatHttpErrorBody } from "../shared";

export const FIREWORKS_GATEWAY_BASE_URL = "https://api.fireworks.ai/v1";
export const FIREWORKS_GATEWAY_ACCOUNT = "fireworks";

interface MoneyAmount {
  currencyCode?: string;
  units?: string;
  nanos?: number;
}

interface SkuInfo {
  sku?: string;
  amount?: MoneyAmount;
  unit?: string;
}

interface ServerlessMode {
  skuInfos?: SkuInfo[];
}

interface GatewayModel {
  name?: string;
  displayName?: string;
  kind?: string;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsReasoning?: boolean;
  conversationConfig?: unknown;
  serverlessModes?: ServerlessMode[];
  deprecationDate?: unknown;
  baseModelDetails?: {
    parameterCount?: string;
  };
}

interface ListModelsResponse {
  models?: GatewayModel[];
  nextPageToken?: string;
}

function moneyToPerMillion(amount: MoneyAmount | undefined): number | undefined {
  if (!amount) {
    return undefined;
  }

  const units = Number.parseInt(amount.units ?? "0", 10);
  const nanos = amount.nanos ?? 0;

  if (!Number.isFinite(units) || !Number.isFinite(nanos)) {
    return undefined;
  }

  return units + nanos / 1_000_000_000;
}

function parseSkuPricing(modes: ServerlessMode[] | undefined): {
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
} {
  const skuInfos = modes?.flatMap((mode) => mode.skuInfos ?? []) ?? [];

  let inputPerMillionUsd: number | undefined;
  let outputPerMillionUsd: number | undefined;

  for (const sku of skuInfos) {
    const label = sku.sku?.toLowerCase() ?? "";
    const perMillion = moneyToPerMillion(sku.amount);

    if (perMillion === undefined) {
      continue;
    }

    if (label.includes("input") && !label.includes("cached")) {
      inputPerMillionUsd = perMillion;
    }

    if (label.includes("output")) {
      outputPerMillionUsd = perMillion;
    }
  }

  return { inputPerMillionUsd, outputPerMillionUsd };
}

function modelIdFromGatewayName(name: string | undefined): string | null {
  const trimmed = name?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("accounts/")) {
    return trimmed;
  }

  return `accounts/${FIREWORKS_GATEWAY_ACCOUNT}/models/${trimmed}`;
}

function isChatModel(model: GatewayModel): boolean {
  if (model.kind === "EMBEDDING_MODEL") {
    return false;
  }

  if (model.conversationConfig !== undefined && model.conversationConfig !== null) {
    return true;
  }

  const id = model.name?.toLowerCase() ?? "";

  if (id.includes("embed")) {
    return false;
  }

  return true;
}

function inferReasoning(model: GatewayModel, modelId: string): boolean {
  if (model.supportsReasoning === true) {
    return true;
  }

  const slug = modelId.toLowerCase();

  return (
    slug.includes("gpt-oss") ||
    slug.includes("glm") ||
    slug.includes("kimi") ||
    slug.includes("deepseek") ||
    slug.includes("qwen")
  );
}

export function normalizeGatewayModel(model: GatewayModel): CustomModelEntry | null {
  const id = modelIdFromGatewayName(model.name);

  if (!id || !isChatModel(model)) {
    return null;
  }

  const pricing = parseSkuPricing(model.serverlessModes);

  return {
    id,
    name: model.displayName?.trim() || id.split("/").pop() || id,
    supportsThinking: inferReasoning(model, id),
    supportsVision: model.supportsImageInput === true,
    ...(pricing.inputPerMillionUsd !== undefined &&
    pricing.outputPerMillionUsd !== undefined
      ? {
          inputPerMillionUsd: pricing.inputPerMillionUsd,
          outputPerMillionUsd: pricing.outputPerMillionUsd,
        }
      : {}),
  };
}

export async function fetchFireworksGatewayModels(apiKey: string): Promise<CustomModelEntry[]> {
  const key = apiKey.trim();

  if (!key) {
    throw new Error("API key is required to discover Fireworks models.");
  }

  const entries: CustomModelEntry[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${FIREWORKS_GATEWAY_BASE_URL}/accounts/${FIREWORKS_GATEWAY_ACCOUNT}/models`,
    );
    url.searchParams.set("filter", "supports_serverless=true");
    url.searchParams.set("pageSize", "200");

    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatHttpErrorBody("Fireworks", response.status, body));
    }

    const payload = (await response.json()) as ListModelsResponse;
    const models = payload.models ?? [];

    for (const model of models) {
      const entry = normalizeGatewayModel(model);

      if (!entry || seen.has(entry.id)) {
        continue;
      }

      seen.add(entry.id);
      entries.push(entry);
    }

    pageToken = payload.nextPageToken?.trim() || undefined;
  } while (pageToken);

  entries.sort((left, right) => left.id.localeCompare(right.id));

  return entries;
}
