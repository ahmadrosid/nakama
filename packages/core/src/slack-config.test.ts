import { describe, expect, test } from "bun:test";
import { withTempHome } from "./channel-test-helpers";
import { parseSlackMemberIdInput } from "./contract";
import {
  isSlackWorkspaceMember,
  loadSlackSettingsPublic,
  parseSlackUserIds,
  saveSlackConfig,
  toSlackSettingsPublic,
  verifyAndPairSlackUser,
} from "./slack-config";

const OWNER_AGENT = { orgId: "org_a", profileId: "alpha" };

describe("slack config", () => {
  test("member IDs are upper-cased, deduped and validated", () => {
    expect(parseSlackUserIds(" u01abcdef, U01ABCDEF ,W02XYZ123")).toEqual([
      "U01ABCDEF",
      "W02XYZ123",
    ]);
    expect(() => parseSlackUserIds("@someone")).toThrow();
  });

  test("one Slack app serves one agent connection", async () => {
    await withTempHome("nakama-slack-claims-", async () => {
      const alpha = { orgId: "org_a", profileId: "alpha" };
      const beta = { orgId: "org_b", profileId: "beta" };
      await saveSlackConfig(alpha, {
        appToken: "xapp-1-A0APPONE-1-secret",
        botToken: "xoxb-one",
      });

      expect((await loadSlackSettingsPublic(alpha)).configured).toBe(true);
      expect((await loadSlackSettingsPublic(beta)).configured).toBe(false);

      // The same app through a second app-level token is still that app.
      await expect(
        saveSlackConfig(beta, {
          appToken: "xapp-1-A0APPONE-2-other",
          botToken: "xoxb-two",
        })
      ).rejects.toThrow("already in use by another agent");

      // Moving alpha to another app frees the first one for beta.
      await saveSlackConfig(alpha, {
        appToken: "xapp-1-A0APPTWO-1-secret",
        botToken: "xoxb-three",
      });
      await saveSlackConfig(beta, {
        appToken: "xapp-1-A0APPONE-2-other",
        botToken: "xoxb-two",
      });
      expect((await loadSlackSettingsPublic(beta)).configured).toBe(true);
    });
  });

  test("only a real true turns the workspace gate on", async () => {
    await withTempHome("nakama-slack-truthy-", async () => {
      const saved = await saveSlackConfig(OWNER_AGENT, {
        allowWorkspace: "false" as unknown as boolean,
        appToken: "xapp-1-A0APPONE-1-secret",
        botToken: "xoxb-one",
      });
      expect(saved.allowWorkspace).toBe(false);
    });
  });

  test("typed or pasted member IDs split into valid IDs and rejects", () => {
    expect(
      parseSlackMemberIdInput(" u01abcdef,U01ABCDEF\nW02XYZ123  @bob U1")
    ).toEqual({ ids: ["U01ABCDEF", "W02XYZ123"], invalid: ["@bob", "U1"] });
    expect(parseSlackMemberIdInput(" , \n ")).toEqual({ ids: [], invalid: [] });
  });

  test("workspace gate admits only full members of the bot's team", () => {
    const team = "T0HOME01";
    expect(isSlackWorkspaceMember({ team_id: team }, team)).toBe(true);
    for (const member of [
      { team_id: "T0OTHER1" },
      { is_restricted: true, team_id: team },
      { is_ultra_restricted: true, team_id: team },
      { is_stranger: true, team_id: team },
      { is_bot: true, team_id: team },
      { deleted: true, team_id: team },
      {},
    ]) {
      expect(isSlackWorkspaceMember(member, team)).toBe(false);
    }
  });

  test("is configured only once both tokens are saved", () => {
    const base = {
      allowedUserIds: [],
      allowWorkspace: false,
      botToken: "xoxb-1",
      handshakeCode: null,
      orgId: null,
      pairedUserIds: [],
      profileId: "default",
    };
    expect(toSlackSettingsPublic({ ...base, appToken: "" }).configured).toBe(
      false
    );
    expect(
      toSlackSettingsPublic({ ...base, appToken: "xapp-1" }).configured
    ).toBe(true);
  });

  test("first save needs both tokens and issues a pairing code", async () => {
    await withTempHome("nakama-slack-config-", async () => {
      await expect(
        saveSlackConfig(OWNER_AGENT, { botToken: "xoxb-1" })
      ).rejects.toThrow();

      const saved = await saveSlackConfig(OWNER_AGENT, {
        appToken: "xapp-1",
        botToken: "xoxb-1",
      });
      expect(saved.handshakeCode).toMatch(/^[0-9A-F]{8}$/);

      // Paired members are part of the same list: omitting one revokes it.
      await verifyAndPairSlackUser(
        OWNER_AGENT,
        saved.handshakeCode!,
        "U0PAIRED1"
      );
      await saveSlackConfig(OWNER_AGENT, { allowedUserIds: "U0PAIRED1" });
      expect(
        (await loadSlackSettingsPublic(OWNER_AGENT)).pairedUserIds
      ).toEqual(["U0PAIRED1"]);
      await saveSlackConfig(OWNER_AGENT, { allowedUserIds: "" });
      expect(
        (await loadSlackSettingsPublic(OWNER_AGENT)).pairedUserIds
      ).toEqual([]);

      // Later saves keep the stored tokens when the fields are left blank.
      await saveSlackConfig(OWNER_AGENT, { allowedUserIds: "U01ABCDEF" });
      const reloaded = await loadSlackSettingsPublic(OWNER_AGENT);
      expect(reloaded.configured).toBe(true);
      expect(reloaded.allowedUserIds).toEqual(["U01ABCDEF"]);
    });
  });
});
