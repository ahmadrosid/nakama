import { expect, test } from "bun:test";
import { capabilityBrowseRowToModelListRow } from "./model-browse-utils";

test("keeps the browsed context window on the saved row", () => {
  expect(
    capabilityBrowseRowToModelListRow({
      contextLength: 24_000,
      id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      name: "llama-3.3-70b-instruct-fp8-fast",
    })
  ).toEqual({
    contextWindow: 24_000,
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "llama-3.3-70b-instruct-fp8-fast",
    supportsThinking: false,
    supportsVision: false,
  });
});
