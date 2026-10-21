import { describe, expect, test } from "bun:test";
import type { ProfileService } from "../services/profile-service";
import { SuperNakamaSessionState } from "../services/super-nakama-session-state";
import { createSuperNakamaTools } from "./super-nakama-tools";

describe("super nakama list_tools", () => {
  test("returns only what reuse and assignment need", async () => {
    const tools = createSuperNakamaTools(
      asProfileService({
        async listTools() {
          return {
            tools: [
              {
                createdAt: "2026-01-01T00:00:00.000Z",
                description: "Count words in text. Splits on whitespace.",
                handlerConfig: { modulePath: "word_count.js" },
                handlerType: "javascript",
                id: "tool_word_count",
                name: "word_count",
                updatedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          };
        },
      }),
      new SuperNakamaSessionState()
    );

    const listTools = tools.find((tool) => tool.name === "list_tools")!;

    expect(await listTools.run({}, { orgId: "org_test" })).toEqual({
      tools: [
        {
          description: "Count words in text.",
          handlerType: "javascript",
          id: "tool_word_count",
          name: "word_count",
        },
      ],
    });
  });
});

function asProfileService(
  mock: Partial<Pick<ProfileService, "listTools">>
): ProfileService {
  // SAFETY: The test provides every ProfileService method that list_tools invokes.
  return mock as ProfileService;
}
