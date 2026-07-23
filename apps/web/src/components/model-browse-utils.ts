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
