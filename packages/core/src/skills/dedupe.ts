import path from "node:path";
import { getGlobalSkillsDir } from "./paths";

export interface SkillNameKeyed {
  name: string;
  sourcePath: string;
}

export function isGlobalSkillSourcePath(sourcePath: string): boolean {
  const globalRoot = path.resolve(getGlobalSkillsDir());
  const resolved = path.resolve(sourcePath);
  return resolved === globalRoot || resolved.startsWith(`${globalRoot}${path.sep}`);
}

export function pickPreferredSkillSourcePath(
  left: string,
  right: string,
): string {
  const leftIsGlobal = isGlobalSkillSourcePath(left);
  const rightIsGlobal = isGlobalSkillSourcePath(right);

  if (leftIsGlobal && !rightIsGlobal) {
    return left;
  }

  if (rightIsGlobal && !leftIsGlobal) {
    return right;
  }

  return left;
}

export function dedupeSkillsByName<T extends SkillNameKeyed>(skills: T[]): T[] {
  const byName = new Map<string, T>();

  for (const skill of skills) {
    const existing = byName.get(skill.name);

    if (!existing) {
      byName.set(skill.name, skill);
      continue;
    }

    const preferredSourcePath = pickPreferredSkillSourcePath(
      existing.sourcePath,
      skill.sourcePath,
    );

    if (preferredSourcePath === skill.sourcePath) {
      byName.set(skill.name, skill);
    }
  }

  return Array.from(byName.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}
