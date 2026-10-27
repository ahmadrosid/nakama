import { CLOUDFLARE_API_ROOT, type CustomModelEntry } from "@nakama/core";
import { z } from "zod";
import { buildProviderHttpError } from "../shared";

const SEARCH_PAGE_SIZE = 100;

// Guards against an API that keeps answering with full pages.
const SEARCH_MAX_PAGES = 20;

const ACCOUNT_ID_IN_URL = /\/accounts\/([^/]+)\//;

const searchModelSchema = z.object({
  name: z.string(),
  properties: z
    .array(z.object({ property_id: z.string(), value: z.unknown() }))
    .default([]),
});

const searchResponseSchema = z.object({
  result: z.array(searchModelSchema).default([]),
});

const contextWindowSchema = z.coerce.number().int().positive();

const flagSchema = z.enum(["true", "false"]);

const pricesSchema = z.array(z.object({ price: z.number(), unit: z.string() }));

type SearchModel = z.infer<typeof searchModelSchema>;

function readProperty<Value>(
  model: SearchModel,
  id: string,
  schema: z.ZodType<Value>
): Value | undefined {
  const property = model.properties.find((entry) => entry.property_id === id);
  const parsed = schema.safeParse(property?.value);

  return parsed.success ? parsed.data : undefined;
}

function cloudflareAccountIdFromBaseUrl(baseUrl: string): string | null {
  return ACCOUNT_ID_IN_URL.exec(baseUrl)?.[1] ?? null;
}

function normalizeCloudflareSearchModel(
  model: SearchModel
): CustomModelEntry | null {
  const id = model.name.trim();

  if (!(id.startsWith("@cf/") || id.startsWith("@hf/"))) {
    return null;
  }

  const entry: CustomModelEntry = {
    id,
    name: id.split("/").pop() || id,
    // The Cloudflare client sends no thinking options, so a reasoning flag
    // here would only show a toggle that does nothing.
    supportsThinking: false,
    supportsVision: readProperty(model, "vision", flagSchema) === "true",
  };

  const contextWindow = readProperty(
    model,
    "context_window",
    contextWindowSchema
  );

  if (contextWindow !== undefined) {
    entry.contextWindow = contextWindow;
  }

  const prices = readProperty(model, "price", pricesSchema) ?? [];
  const input = prices.find((price) => price.unit === "per M input tokens");
  const output = prices.find((price) => price.unit === "per M output tokens");

  if (input && output) {
    entry.inputPerMillionUsd = input.price;
    entry.outputPerMillionUsd = output.price;
  }

  return entry;
}

/** Text generation models the account can run, from the Workers AI search API.
 * The OpenAI-compatible `/ai/v1` root has no GET /models, so this reads the
 * account-scoped `/ai/models/search` instead. */
export async function fetchCloudflareWorkersAiModels(
  baseUrl: string,
  apiKey: string
): Promise<CustomModelEntry[]> {
  const key = apiKey.trim();

  if (!key) {
    throw new Error("API key is required to discover Cloudflare models.");
  }

  const accountId = cloudflareAccountIdFromBaseUrl(baseUrl);

  if (!accountId) {
    throw new Error(
      "Cloudflare model discovery needs a Workers AI URL that contains the account ID."
    );
  }

  const entries: CustomModelEntry[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
    const url = new URL(`${CLOUDFLARE_API_ROOT}/${accountId}/ai/models/search`);
    url.searchParams.set("task", "Text Generation");
    url.searchParams.set("per_page", String(SEARCH_PAGE_SIZE));
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw buildProviderHttpError("Cloudflare", response.status, body);
    }

    const payload = searchResponseSchema.safeParse(await response.json());

    if (!payload.success) {
      throw new Error("Cloudflare returned a model list in an unknown format.");
    }

    for (const model of payload.data.result) {
      const entry = normalizeCloudflareSearchModel(model);

      if (!entry || seen.has(entry.id)) {
        continue;
      }

      seen.add(entry.id);
      entries.push(entry);
    }

    if (payload.data.result.length < SEARCH_PAGE_SIZE) {
      break;
    }
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));

  return entries;
}
