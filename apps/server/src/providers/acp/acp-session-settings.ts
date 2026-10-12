import type * as acp from "@agentclientprotocol/sdk";
import type { AcpSessionSetting } from "@nakama/core";

/**
 * Keeps the settings the composer can change: select lists such as the model
 * and reasoning effort. Boolean settings are not shown yet.
 */
export function toAcpSessionSettings(
  configOptions: acp.SessionConfigOption[]
): AcpSessionSetting[] {
  return configOptions.flatMap((option) => {
    if (option.type !== "select") {
      return [];
    }

    return [
      {
        category: option.category ?? null,
        currentValue: option.currentValue,
        id: option.id,
        name: option.name,
        options: option.options.flatMap((entry) =>
          "options" in entry
            ? entry.options.map((item) => ({
                name: item.name,
                value: item.value,
              }))
            : [{ name: entry.name, value: entry.value }]
        ),
      },
    ];
  });
}
