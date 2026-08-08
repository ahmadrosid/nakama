export const BUILTIN_TOOL_IDS = {
  delete_file: "tool_delete_file",
  edit_file: "tool_edit_file",
  email: "tool_email",
  extract_document_text: "tool_extract_document_text",
  knowledge_base_search: "tool_knowledge_base_search",
  read_file: "tool_read_file",
  search_files: "tool_search_files",
  web_fetch: "tool_web_fetch",
  web_search: "tool_web_search",
  write_docx: "tool_write_docx",
  write_file: "tool_write_file",
} as const;

export const BASH_TOOL_ID = "tool_bash";
export const SUB_AGENT_TOOL_ID = "tool_sub_agent";
export const GENERATE_IMAGE_TOOL_ID = "tool_generate_image";

export const PROTECTED_TOOL_IDS = new Set<string>([
  ...Object.values(BUILTIN_TOOL_IDS),
  BASH_TOOL_ID,
  SUB_AGENT_TOOL_ID,
  GENERATE_IMAGE_TOOL_ID,
]);

export function isProtectedToolId(toolId: string): boolean {
  return PROTECTED_TOOL_IDS.has(toolId);
}
