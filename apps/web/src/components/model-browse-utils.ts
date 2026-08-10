export interface CapabilityBrowseRow {
  contextLength?: number;
  deprecated?: boolean;
  description?: string;
  id: string;
  inputPerMillionUsd?: number;
  name: string;
  outputPerMillionUsd?: number;
  preview?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  vision?: boolean;
}

export function formatBrowseCapabilities(row: {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}): Array<"tools" | "vision" | "reasoning"> {
  const capabilities: Array<"tools" | "vision" | "reasoning"> = [];
  if (row.tools) {
    capabilities.push("tools");
  }
  if (row.vision) {
    capabilities.push("vision");
  }
  if (row.reasoning) {
    capabilities.push("reasoning");
  }
  return capabilities;
}

export function capabilityBrowseRowToModelListRow(row: CapabilityBrowseRow): {
  id: string;
  name: string;
  supportsThinking: boolean;
  supportsVision: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
} {
  return {
    id: row.id,
    name: row.name,
    supportsThinking: row.reasoning === true,
    supportsVision: row.vision === true,
    ...(row.inputPerMillionUsd === undefined
      ? {}
      : { inputPerMillionUsd: row.inputPerMillionUsd }),
    ...(row.outputPerMillionUsd === undefined
      ? {}
      : { outputPerMillionUsd: row.outputPerMillionUsd }),
  };
}

export function filterRowsBySearch<
  T extends { id: string; name: string; description?: string },
>(rows: T[], search: string): T[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return rows;
  }

  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(query) ||
      row.id.toLowerCase().includes(query) ||
      (row.description?.toLowerCase().includes(query) ?? false)
  );
}

export function filterCapabilityBrowseRows(
  rows: CapabilityBrowseRow[],
  options: { search: string; hideDeprecated: boolean }
): CapabilityBrowseRow[] {
  let result = rows;

  if (options.hideDeprecated) {
    result = result.filter((row) => !row.deprecated);
  }

  return filterRowsBySearch(result, options.search);
}

export function capabilityBrowseRowToDisplayRow(row: CapabilityBrowseRow): {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  badges: Array<{ label: string; tone: "amber" }>;
  capabilities: ReturnType<typeof formatBrowseCapabilities>;
} {
  return {
    badges: [
      ...(row.preview ? [{ label: "preview", tone: "amber" as const }] : []),
      ...(row.deprecated
        ? [{ label: "deprecated", tone: "amber" as const }]
        : []),
    ],
    capabilities: formatBrowseCapabilities(row),
    contextLength: row.contextLength,
    description: row.description || undefined,
    id: row.id,
    name: row.name,
  };
}
