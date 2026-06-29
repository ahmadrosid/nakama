import { mkdir } from "node:fs/promises";
import { writePrivateTextFileIfMissing } from "../../fs";
import { getGlobalSkillsDir, SKILL_FILE_NAME } from "../paths";
import { BUNDLED_SKILL_NAMES, readBundledSkillMarkdown } from "./index";

export async function ensureBundledSkillFiles(): Promise<string[]> {
  const created: string[] = [];
  const skillsRoot = getGlobalSkillsDir();
  await mkdir(skillsRoot, { recursive: true });

  for (const name of BUNDLED_SKILL_NAMES) {
    const directory = `${skillsRoot}/${name}`;
    const skillFilePath = `${directory}/${SKILL_FILE_NAME}`;
    const content = await readBundledSkillMarkdown(name);

    if (await writePrivateTextFileIfMissing(skillFilePath, content)) {
      created.push(name);
    }
  }

  return created;
}
