export interface SkillFrontmatter {
  name: string;
  description: string;
  /** When true, the skill only activates on explicit invocation (e.g. /skill name). */
  disableModelInvocation?: boolean;
  /** When true, auto-matched skills include full body text in the prompt. */
  includeBodyOnMatch?: boolean;
}

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
  sourcePath: string;
}

export interface DiscoveredSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
  includeBodyOnMatch: boolean;
  directory: string;
  skillFilePath: string;
  body: string;
  hasTool: boolean;
  toolPath: string | null;
}

export interface SkillMatchOptions {
  explicitOnly?: boolean;
}
