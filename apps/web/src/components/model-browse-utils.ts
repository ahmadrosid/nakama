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
