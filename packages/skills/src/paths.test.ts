import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import path from "node:path";
import { resolveSkillDiscoveryDirs } from "./paths";

describe("skill paths", () => {
  afterEach(() => {
    delete process.env.TINYCLAW_CONFIG_DIR;
  });

  test("resolveSkillDiscoveryDirs defaults to ~/.tinyclaw/agent/skills", () => {
    expect(resolveSkillDiscoveryDirs()).toEqual([
      path.join(homedir(), ".tinyclaw", "agent", "skills"),
    ]);
  });

  test("resolveSkillDiscoveryDirs includes profile skills dir", () => {
    expect(resolveSkillDiscoveryDirs({ profileId: "profile_default" })).toEqual([
      path.join(homedir(), ".tinyclaw", "agent", "skills"),
      path.join(homedir(), ".tinyclaw", "profiles", "profile_default", "skills"),
    ]);
  });
});
