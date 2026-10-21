import { describe, expect, test } from "bun:test";
import { getModelsForProviderInstance } from "../providers/compatible-models";
import {
  buildProviderInstanceFromCreateRequest,
  modelExistsOnInstance,
  resolveProfileProviderSelection,
} from "./provider-instance-helpers";

describe("Netra provider setup", () => {
  test("keeps the exact selected model and its saved organization rates", () => {
    const instance = buildProviderInstanceFromCreateRequest(
      {
        apiKey: "netra-key",
        customModels: [
          {
            cachedInputPerMillionUsd: 0.01,
            default: true,
            id: "deepseek/deepseek-v4.1-flash",
            inputPerMillionUsd: 0.1,
            outputPerMillionUsd: 0.25,
            supportsThinking: true,
          },
        ],
        type: "netra",
      },
      []
    );

    expect(instance.customModels?.[0]?.id).toBe("deepseek/deepseek-v4.1-flash");
    expect(getModelsForProviderInstance(instance)[0]?.provider).toBe("netra");
    expect(
      modelExistsOnInstance(instance, "deepseek/deepseek-v4.1-flash")
    ).toBe(true);
    expect(instance.customModels?.[0]?.cachedInputPerMillionUsd).toBe(0.01);
  });

  test("rejects the unsupported Responses API", () => {
    expect(() =>
      buildProviderInstanceFromCreateRequest(
        {
          apiKey: "netra-key",
          model: "deepseek/deepseek-v4.1-flash",
          type: "netra",
          wireApi: "responses",
        },
        []
      )
    ).toThrow();
  });
});

test("saved Netra profile selections retain their provider and migrate the model", () => {
  const instance = buildProviderInstanceFromCreateRequest(
    {
      apiKey: "test-key",
      customModels: [{ default: true, id: "deepseek/deepseek-v4-flash-0731" }],
      type: "netra",
    },
    []
  );

  for (const profileModel of [
    "deepseek/deepseek-v4-flash-0731",
    `${instance.id}::deepseek/deepseek-v4-flash-0731`,
  ]) {
    const resolved = resolveProfileProviderSelection({
      defaultProviderId: instance.id,
      profileModel,
      providers: [instance],
    });

    expect(resolved?.instance.id).toBe(instance.id);
    expect(resolved?.model).toBe("deepseek/deepseek-v4.1-flash");
  }

  expect(instance.customModels?.[0]?.id).toBe(
    "deepseek/deepseek-v4-flash-0731"
  );
});
