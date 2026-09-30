import type { SkillScriptIssue, SkillScriptTool } from "./script-tools";

export interface SkillFrontmatter {
  description: string;
  /** When true, the skill only activates on explicit invocation (e.g. /skill name). */
  disableModelInvocation?: boolean;
  /** When true, auto-matched skills include full body text in the prompt. */
  includeBodyOnMatch?: boolean;
  name: string;
  /** Paths, relative to the skill directory, that become callable tools. */
  scripts?: string[];
}

export interface ParsedSkillFile {
  body: string;
  frontmatter: SkillFrontmatter;
  sourcePath: string;
}

export interface DiscoveredSkill {
  body: string;
  description: string;
  directory: string;
  disableModelInvocation: boolean;
  hasTool: boolean;
  includeBodyOnMatch: boolean;
  name: string;
  /** Shipped scripts nothing will run, with the reason. Empty when all is well. */
  scriptIssues: SkillScriptIssue[];
  /** Scripts declared in frontmatter that resolved into callable tools. */
  scriptTools: SkillScriptTool[];
  skillFilePath: string;
  toolPath: string | null;
}

export interface SkillMatchOptions {
  explicitOnly?: boolean;
}
