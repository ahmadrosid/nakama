export const BUILTIN_TOOL_IDS = {
  write_file: "tool_write_file",
  delete_file: "tool_delete_file",
  search_workspace: "tool_search_workspace",
  web_search: "tool_web_search",
} as const;

export const BASH_TOOL_ID = "tool_bash";

export const PROTECTED_TOOL_IDS = new Set<string>([
  ...Object.values(BUILTIN_TOOL_IDS),
  BASH_TOOL_ID,
]);

export function isProtectedToolId(toolId: string): boolean {
  return PROTECTED_TOOL_IDS.has(toolId);
}
