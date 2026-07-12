import type { DatabaseAdapter } from "@nakama/db";
import type { ProviderClient, UserConfig } from "@nakama/core";
import { createProviderForInstance } from "../providers/create";
import { resolveProfileProviderSelection } from "../services/provider-instance-helpers";
import {
  anthropicRequestToGenerateChatInput,
  buildAnthropicMessageResponse,
  createAnthropicStreamResponse,
  parseAnthropicMessagesRequest,
  type AnthropicMessagesRequest,
} from "../inference/anthropic-messages";
import { isInferenceGatewayEnabled } from "./inference-gateway-config";

export interface InferenceGatewayContext {
  orgId: string;
  profileId?: string | null;
}

export async function handleAnthropicMessagesRequest(
  options: {
    db: DatabaseAdapter;
    userConfig: UserConfig | null;
    context: InferenceGatewayContext;
    body: unknown;
    provider?: ProviderClient;
  },
): Promise<Response> {
  if (!isInferenceGatewayEnabled()) {
    return Response.json({ error: "Inference gateway is disabled." }, { status: 503 });
  }

  let request: AnthropicMessagesRequest;

  try {
    request = parseAnthropicMessagesRequest(options.body);
  } catch (error) {
    return Response.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: error instanceof Error ? error.message : "Invalid request.",
        },
      },
      { status: 400 },
    );
  }

  const profile = await resolveInferenceProfile(
    options.db,
    options.context.orgId,
    options.context.profileId,
  );

  if (!profile) {
    return Response.json(
      {
        type: "error",
        error: {
          type: "not_found_error",
          message: "No profile available for inference routing.",
        },
      },
      { status: 404 },
    );
  }

  const provider =
    options.provider ?? resolveProviderForProfile(options.userConfig, profile.model);

  if (!provider) {
    return Response.json(
      {
        type: "error",
        error: {
          type: "api_error",
          message: "No provider is configured for this profile.",
        },
      },
      { status: 503 },
    );
  }

  const input = anthropicRequestToGenerateChatInput(request);

  if (request.stream) {
    return createAnthropicStreamResponse(request, async (handlers) =>
      provider.streamChat(input, handlers),
    );
  }

  const result = await provider.generateChat(input);

  return Response.json(buildAnthropicMessageResponse(request, result));
}

async function resolveInferenceProfile(
  db: DatabaseAdapter,
  orgId: string,
  profileId?: string | null,
) {
  const trimmedProfileId = profileId?.trim();

  if (trimmedProfileId) {
    const profile = await db.getProfileForOrg(trimmedProfileId, orgId);

    if (profile) {
      return profile;
    }
  }

  return (await db.getDefaultProfileForOrg(orgId)) ?? null;
}

function resolveProviderForProfile(
  userConfig: UserConfig | null,
  profileModel: string | null | undefined,
): ProviderClient | null {
  const resolved = resolveProfileProviderSelection({
    providers: userConfig?.providers ?? [],
    defaultProviderId: userConfig?.defaultProviderId,
    profileModel,
  });

  if (!resolved) {
    return null;
  }

  return createProviderForInstance(resolved.instance, resolved.model);
}
