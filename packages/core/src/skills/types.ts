export interface SkillFrontmatter {
  description: string;
  /** When true, the skill only activates on explicit invocation (e.g. /skill name). */
  disableModelInvocation?: boolean;
  /** When true, auto-matched skills include full body text in the prompt. */
  includeBodyOnMatch?: boolean;
  name: string;
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
  skillFilePath: string;
  toolPath: string | null;
}

export interface SkillMatchOptions {
  explicitOnly?: boolean;
}
