import { join } from "node:path";
import { getUserConfigDir } from "../user-config";

/** Agent-authored tool modules live under ~/.tinyclaw/tools/ by default. */
export function getCustomToolsDir(): string {
  const override = process.env.TINYCLAW_TOOLS_DIR?.trim();

  if (override) {
    return override;
  }

  return join(getUserConfigDir(), "tools");
}
