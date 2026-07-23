export interface CapabilityBrowseRow {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  deprecated?: boolean;
  preview?: boolean;
  vision?: boolean;
  tools?: boolean;
  reasoning?: boolean;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export function formatBrowseCapabilities(row: {
  tools?: boolean;
  vision?: boolean;
  reasoning?: boolean;
}): Array<"tools" | "vision" | "reasoning"> {
  const capabilities: Array<"tools" | "vision" | "reasoning"> = [];
  if (row.tools) capabilities.push("tools");
  if (row.vision) capabilities.push("vision");
  if (row.reasoning) capabilities.push("reasoning");
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
    ...(row.inputPerMillionUsd !== undefined
      ? { inputPerMillionUsd: row.inputPerMillionUsd }
      : {}),
    ...(row.outputPerMillionUsd !== undefined
      ? { outputPerMillionUsd: row.outputPerMillionUsd }
      : {}),
  };
}

export function filterRowsBySearch<T extends { id: string; name: string; description?: string }>(
  rows: T[],
  search: string,
): T[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return rows;
  }

  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(query) ||
      row.id.toLowerCase().includes(query) ||
      (row.description?.toLowerCase().includes(query) ?? false),
  );
}

export function filterCapabilityBrowseRows(
  rows: CapabilityBrowseRow[],
  options: { search: string; hideDeprecated: boolean },
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
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    contextLength: row.contextLength,
    badges: [
      ...(row.preview ? [{ label: "preview", tone: "amber" as const }] : []),
      ...(row.deprecated ? [{ label: "deprecated", tone: "amber" as const }] : []),
    ],
    capabilities: formatBrowseCapabilities(row),
  };
}
