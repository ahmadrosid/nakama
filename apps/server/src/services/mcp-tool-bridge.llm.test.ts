import { expect, test } from "bun:test";
import { isDeepStrictEqual } from "node:util";
import { createAgentChatSession } from "@nakama/agent";
import {
  applyChatgptOAuthToInstance,
  loadUserConfig,
  type ProviderInstance,
  saveUserConfig,
} from "@nakama/core";
import type { StoredMcpServerRecord } from "@nakama/db";
import { z } from "zod";
import { createProviderForInstance } from "../providers/create";
import { withMswCassette } from "../testing/llm-msw-cassette";
import { buildMcpToolDefinitions } from "./mcp-tool-bridge";

// Only explicit record mode reads credentials or permits provider network calls.
// PowerShell: $env:LLM_VCR_MODE="record"; bun test ./apps/server/src/services/mcp-tool-bridge.llm.test.ts
// Uses a connected ChatGPT instance in loadUserConfig(); no OPENAI_API_KEY.
const record = process.env.LLM_VCR_MODE === "record";

const url = "https://chatgpt.com/backend-api/codex/responses";

const requestSchema = z.object({ instructions: z.string() }).passthrough();

function normalizeRequest(body: z.infer<ReturnType<typeof z.json>>) {
  const request = requestSchema.parse(body);

  // The session adds today's date. Everything else, including tools, schemas,
  // messages, tool results, model and reasoning settings, must match the tape.
  return {
    ...request,
    instructions: request.instructions.replace(
      /Today is [^\n]+/g,
      "Today is <date>."
    ),
  };
}

const catalogs = [
  {
    domain: "current documents",
    extras: ["list_folders", "rename", "delete", "get_permissions"],
    id: "documentId",
    name: "drive",
    read: "read",
  },
  {
    domain: "archived documents and old invoices",
    extras: ["restore", "delete", "list_versions", "get_metadata"],
    id: "archiveId",
    name: "archive",
    read: "read",
  },
  {
    domain: "current invoices and billing receipts",
    extras: ["get_invoice", "void_invoice", "send_reminder", "list_customers"],
    id: "invoiceId",
    name: "billing",
    read: "get_receipt",
  },
  {
    domain: "meetings and calendar events",
    extras: [
      "create_event",
      "cancel_event",
      "list_calendars",
      "get_availability",
    ],
    id: "eventId",
    name: "calendar",
    read: "get_event",
  },
];

const servers: StoredMcpServerRecord[] = catalogs.map((catalog) => ({
  cachedTools: [
    {
      description: `Search ${catalog.domain}`,
      inputSchema: {
        properties: { query: { type: "string" } },
        required: ["query"],
        type: "object",
      },
      name: "search",
    },
    {
      description: `Read ${catalog.domain} by identifier`,
      inputSchema: {
        properties: { [catalog.id]: { type: "string" } },
        required: [catalog.id],
        type: "object",
      },
      name: catalog.read,
    },
    ...catalog.extras.map((name) => ({
      description: `${name.replaceAll("_", " ")} for ${catalog.domain}`,
      inputSchema: {
        properties: { id: { type: "string" } },
        required: ["id"],
        type: "object",
      },
      name,
    })),
  ],
  config: { url: "https://example.invalid/mcp" },
  createdAt: "2026-01-01T00:00:00.000Z",
  enabled: true,
  id: catalog.name,
  lastError: null,
  name: catalog.name,
  status: "connected",
  transport: "http",
  updatedAt: "2026-01-01T00:00:00.000Z",
}));

test("live MCP discovery matches eager reads, follow-up and unavailable-action outcomes", async () => {
  let config = record ? await loadUserConfig() : null;

  const instance: ProviderInstance | undefined = record
    ? config?.providers.find((provider) => provider.type === "chatgpt")
    : {
        apiKey: "",
        chatgptAccessToken: "offline-placeholder",
        chatgptAccountId: "offline-placeholder",
        chatgptRefreshToken: "offline-placeholder",
        chatgptTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "offline",
        label: "Offline cassette",
        type: "chatgpt",
      };

  if (!instance) {
    throw new Error("Connect ChatGPT in Nakama before recording.");
  }

  const provider = createProviderForInstance(
    instance,
    "gpt-6.1-sol",
    {},
    {
      async onChatgptTokenRefresh(id, oauth) {
        const latest = await loadUserConfig();

        if (!latest) {
          throw new Error("User config disappeared during token refresh.");
        }

        config = {
          ...latest,
          providers: latest.providers.map((item) =>
            item.id === id ? applyChatgptOAuthToInstance(item, oauth) : item
          ),
        };
        await saveUserConfig(config);
      },
      resolveInstance: (id) =>
        config?.providers.find((item) => item.id === id) ?? instance,
    }
  );

  if (!provider) {
    throw new Error("ChatGPT provider is not configured.");
  }

  const measurements = [];

  for (const lazy of [false, true]) {
    const calls: Array<{ name: string; args: unknown }> = [];

    const tools = buildMcpToolDefinitions(
      servers,
      {
        async callTool(server, name, args) {
          const qualified = `${server.name}__${name}`;
          calls.push({ args, name: qualified });

          if (qualified === "drive__search") {
            return {
              documents: [{ documentId: "DOC-17", title: "Launch checklist" }],
            };
          }

          if (qualified === "drive__read" && args.documentId === "DOC-17") {
            return {
              content: "Launch checklist: verification code LIME-7319.",
            };
          }

          if (qualified === "billing__search") {
            return {
              invoices: [
                { customer: "Sora", invoiceId: "INV-42", month: "September" },
              ],
            };
          }

          if (
            qualified === "billing__get_receipt" &&
            args.invoiceId === "INV-42"
          ) {
            return {
              amount: 73,
              currency: "USD",
              receipt: "RECEIPT-8842",
              status: "paid",
            };
          }

          return { error: "Not available in this synthetic fixture." };
        },
      },
      {
        async getMcpServer(id) {
          return servers.find((server) => server.id === id) ?? null;
        },
      },
      "org_synthetic",
      "profile_synthetic",
      lazy ? async () => true : undefined
    );

    let requests = 0;
    let inputTokens = 0;

    const session = createAgentChatSession(
      {
        provider: {
          ...provider,
          async generateChat(input) {
            requests += 1;

            if (requests === 1) {
              expect(input.tools).toHaveLength(lazy ? 1 : 24);

              if (lazy) {
                expect(input.tools?.[0]?.name).toBe("find_tools");
              }
            }

            if (requests > 24) {
              throw new Error("Synthetic comparison request cap exceeded.");
            }

            const result = await provider.generateChat({
              ...input,
              providerOptions: { thinking: { effort: "low", enabled: true } },
            });

            inputTokens += result.usage?.inputTokens ?? 0;

            return result;
          },
        },
        tools,
      },
      {
        compaction: { contextWindow: 200_000, maxOutputTokens: 1000 },
        systemPrompt:
          "Use tools to look up facts. Never invent identifiers or results. Do not mutate data. If an action is unavailable, explain that it cannot be done with the available tools.",
      }
    );

    const initialDefinitionTokens =
      session.getContextUsage()!.breakdown!.toolDefinitions;

    await withMswCassette(
      `mcp-discovery-chatgpt-${lazy ? "lazy" : "eager"}`,
      async () => {
        const send = (message: string) =>
          session.send(message, { signal: AbortSignal.timeout(90_000) });

        const document = await send(
          "Find the current Launch checklist document and read its verification code. Do not use an archived copy."
        );

        expect(document).toContain("LIME-7319");
        expect(calls).toContainEqual({
          args: { documentId: "DOC-17" },
          name: "drive__read",
        });
        expect(calls.some((call) => call.name === "drive__search")).toBe(true);

        const historyLength = session.getHistory().length;
        const callCount = calls.length;

        const followup = await send(
          "Read that same document again using its identifier and confirm the verification code."
        );

        expect(followup).toContain("LIME-7319");
        expect(calls.slice(callCount)).toContainEqual({
          args: { documentId: "DOC-17" },
          name: "drive__read",
        });
        expect(
          session
            .getHistory()
            .slice(historyLength)
            .some(
              (message) =>
                message.role === "tool" && message.name === "find_tools"
            )
        ).toBe(false);

        const receipt = await send(
          "Cari kuitansi pembayaran Sora untuk September di sistem billing saat ini. Sebutkan nomor kuitansi, jumlah, dan mata uangnya."
        );

        expect(receipt).toContain("RECEIPT-8842");
        expect(receipt).toContain("73");
        expect(receipt).toContain("USD");
        expect(calls).toContainEqual({
          args: { invoiceId: "INV-42" },
          name: "billing__get_receipt",
        });
        expect(calls.some((call) => call.name === "billing__search")).toBe(
          true
        );

        const refund = await send(
          'Refund invoice INV-42 if a refund tool is available. Do not void it or use any substitute action. Reply with a JSON object only: {"status":"completed" or "unavailable"}, according to what you could actually do.'
        );

        const refundResult = z
          .object({ status: z.enum(["completed", "unavailable"]) })
          .parse(JSON.parse(refund));

        expect(refundResult.status).toBe("unavailable");

        // Extra read-only lookups are allowed; mutations and wrong-domain reads are not.
        expect(
          calls.every((call) =>
            [
              "drive__search",
              "drive__read",
              "billing__search",
              "billing__get_receipt",
            ].includes(call.name)
          )
        ).toBe(true);
      },
      {
        matchRequest: (actual, recorded) =>
          isDeepStrictEqual(
            normalizeRequest(actual),
            normalizeRequest(recorded)
          ),
        mode: record ? "record" : "replay",
        // These account-derived fields are unused by the provider parser.
        // Preserve all model output, tool arguments and usage unchanged.
        redactResponse: (body) =>
          z
            .string()
            .parse(body)
            .replace(
              /("(?:safety_identifier|prompt_cache_key|user)"\s*:)\s*"[^"\r\n]*"/g,
              "$1null"
            ),
        url,
      }
    );
    measurements.push({
      initialDefinitionTokens,
      inputTokens,
      mode: lazy ? "lazy" : "eager",
      requests,
    });
  }

  expect(measurements[1]!.initialDefinitionTokens).toBeLessThan(
    measurements[0]!.initialDefinitionTokens
  );
  console.info(
    "MCP synthetic comparison (recorded usage, not replay timing)",
    measurements
  );
}, 300_000);
