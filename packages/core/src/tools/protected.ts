export const BUILTIN_TOOL_IDS = {
  write_file: "tool_write_file",
  delete_file: "tool_delete_file",
  edit_file: "tool_edit_file",
  read_file: "tool_read_file",
  save_artifact: "tool_save_artifact",
  search_files: "tool_search_files",
  knowledge_base_search: "tool_knowledge_base_search",
  web_search: "tool_web_search",
  web_fetch: "tool_web_fetch",
  update_profile_memory: "tool_update_profile_memory",
  archive_profile_memory: "tool_archive_profile_memory",
  email: "tool_email",
} as const;

export const BASH_TOOL_ID = "tool_bash";

export const PROTECTED_TOOL_IDS = new Set<string>([
  ...Object.values(BUILTIN_TOOL_IDS),
  BASH_TOOL_ID,
]);

export function isProtectedToolId(toolId: string): boolean {
  return PROTECTED_TOOL_IDS.has(toolId);
}
