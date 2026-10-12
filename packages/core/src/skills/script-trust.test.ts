import { describe, expect, test } from "bun:test";
import { getGlobalSkillsDir, getProfileSkillsDir } from "./paths";
import {
  createBlockedSkillCodeTool,
  resolveSkillCodeExecutionPolicy,
} from "./script-trust";

const ORG_ID = "org_a";

const PROFILE_ID = "profile_a";

function policy(directory: string, memberAuthoredCodeApproved = false) {
  return resolveSkillCodeExecutionPolicy({
    directory,
    memberAuthoredCodeApproved,
    orgId: ORG_ID,
    profileId: PROFILE_ID,
  });
}

describe("resolveSkillCodeExecutionPolicy", () => {
  test("a profile's own skill code is inert until the org reviews its writes", () => {
    const result = policy(getProfileSkillsDir(ORG_ID, PROFILE_ID) + "/notes");

    expect(result.executable).toBe(false);
    expect(result.reason).toContain("skill write approval");
  });

  test("the same skill runs once write approval is on", () => {
    expect(
      policy(getProfileSkillsDir(ORG_ID, PROFILE_ID) + "/notes", true)
    ).toEqual({ executable: true, reason: null });
  });

  test("a server-shipped global skill runs either way", () => {
    const directory = `${getGlobalSkillsDir()}/manage-skills`;

    expect(policy(directory)).toEqual({ executable: true, reason: null });
    expect(policy(directory, true)).toEqual({ executable: true, reason: null });
  });

  test.skipIf(process.platform !== "win32")(
    "a differently cased path to a profile's own skill stays inert on Windows",
    () => {
      // NTFS runs the same files whatever the casing, so a casing mismatch
      // must not read as "not member-authored" and let the code run.
      const directory = `${getProfileSkillsDir(ORG_ID, PROFILE_ID)}/notes`;

      expect(policy(directory.toUpperCase()).executable).toBe(false);
      expect(policy(directory.replace(/skills/g, "Skills")).executable).toBe(
        false
      );
    }
  );

  test("another profile's skills are not treated as this profile's", () => {
    const otherProfile = getProfileSkillsDir(ORG_ID, "profile_b");

    expect(policy(`${otherProfile}/notes`)).toEqual({
      executable: true,
      reason: null,
    });
  });
});

describe("createBlockedSkillCodeTool", () => {
  test("answers with the refusal instead of running anything", async () => {
    const tool = createBlockedSkillCodeTool({
      description: "notes",
      name: "notes",
      reason: "not approved",
    });

    expect(tool.name).toBe("notes");
    // SAFETY: The blocked tool ignores context and rejects before reading its arguments.
    expect(await tool.run({}, {} as never)).toEqual({ error: "not approved" });
  });
});
