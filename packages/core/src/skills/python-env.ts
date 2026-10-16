import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getUserConfigDir } from "../user-config";

/** Where a skill lists the Python packages it needs. */
export const SKILL_REQUIREMENTS_FILE = "requirements.txt";

/**
 * A skill's own Python environment. It lives under the config dir so it
 * survives restarts and image upgrades, and outside the skill so the skill's
 * own files (which an agent can write) cannot plant an interpreter.
 */
export function getSkillPythonEnvDir(skillDirectory: string): string {
  let resolved = skillDirectory;

  try {
    resolved = realpathSync(skillDirectory);
  } catch {
    // A missing directory still gets a stable key.
  }

  const key = createHash("sha256").update(resolved).digest("hex").slice(0, 16);

  return path.join(getUserConfigDir(), "python-envs", key);
}

export function getSkillPythonEnvBin(skillDirectory: string): string {
  const envDir = getSkillPythonEnvDir(skillDirectory);

  return process.platform === "win32"
    ? path.join(envDir, "Scripts", "python.exe")
    : path.join(envDir, "bin", "python");
}

/** Top level module names importable from the skill's environment. */
export async function listSkillPythonModules(
  skillDirectory: string
): Promise<Set<string>> {
  const envDir = getSkillPythonEnvDir(skillDirectory);

  const sitePackages =
    process.platform === "win32"
      ? [path.join(envDir, "Lib", "site-packages")]
      : (await readdir(path.join(envDir, "lib")).catch(() => []))
          .filter((name) => name.startsWith("python"))
          .map((name) => path.join(envDir, "lib", name, "site-packages"));

  const modules = new Set<string>();

  for (const root of sitePackages) {
    for (const entry of await readdir(root).catch(() => [])) {
      // `numpy/`, `six.py`, `_cffi_backend.cpython-312-x86_64-linux-gnu.so`.
      // dist-info folders carry a dash and never match a module name.
      const name = entry.split(".")[0] ?? "";

      if (/^[A-Za-z_]\w*$/u.test(name)) {
        modules.add(name);
      }
    }
  }

  return modules;
}
