import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { getOrgConfigDir } from "@nakama/core";
import { setupTestConfigDir } from "../test-config-dir";
import {
  appendAgentGroupMessage,
  closeAgentGroupDatabases,
  createAgentGroup,
  createGroupSession,
  deleteAgentGroup,
  deleteAgentGroupAvatar,
  deleteGroupSession,
  getAgentGroup,
  getAgentGroupAvatar,
  getGroupSession,
  listAgentGroupMessages,
  listAgentGroups,
  listGroupSessions,
  listRailPins,
  setAgentGroupAvatar,
  setRailPin,
  updateAgentGroup,
  updateGroupSession,
} from "./agent-group-store";

const ORG_ID = "org_test";

// Before the config dir cleanup, which Windows refuses while a file is open.
afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-agent-group-store-");

describe("agent group store", () => {
  test("only the owner sees a group, its sessions, and its image", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);
    const session = createGroupSession(ORG_ID, group.id, "Kickoff");

    expect(getAgentGroup(ORG_ID, "u2", group.id)).toBeNull();
    expect(listAgentGroups(ORG_ID, "u2")).toEqual([]);
    expect(listGroupSessions(ORG_ID, "u2", group.id)).toEqual([]);
    expect(getGroupSession(ORG_ID, "u2", group.id, session.id)).toBeNull();
    expect(updateAgentGroup(ORG_ID, "u2", group.id, "X", ["p1", "p2"])).toBe(
      false
    );
    expect(
      setAgentGroupAvatar(
        ORG_ID,
        "u2",
        group.id,
        "image/png",
        new Uint8Array([1])
      )
    ).toBe(false);
    expect(deleteGroupSession(ORG_ID, "u2", group.id, session.id)).toBe(false);
    expect(deleteAgentGroup(ORG_ID, "u2", group.id)).toBe(false);
  });

  test("renames a group and swaps its members", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);

    expect(updateAgentGroup(ORG_ID, "u1", group.id, "Ship", ["p2", "p3"])).toBe(
      true
    );
    expect(getAgentGroup(ORG_ID, "u1", group.id)).toMatchObject({
      memberIds: ["p2", "p3"],
      name: "Ship",
    });
  });

  test("keeps a group's brief across create and update", () => {
    const group = createAgentGroup(
      ORG_ID,
      "u1",
      "Launch",
      ["p1", "p2"],
      "Ship v2"
    );

    expect(getAgentGroup(ORG_ID, "u1", group.id)?.brief).toBe("Ship v2");

    updateAgentGroup(ORG_ID, "u1", group.id, "Launch", ["p1", "p2"], "Ship v3");

    expect(getAgentGroup(ORG_ID, "u1", group.id)?.brief).toBe("Ship v3");
  });

  test("keeps each session's messages apart and lists the latest session first", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);
    const first = createGroupSession(ORG_ID, group.id, "First");
    const second = createGroupSession(ORG_ID, group.id, "Second");

    appendAgentGroupMessage(ORG_ID, second, null, "two");
    appendAgentGroupMessage(ORG_ID, first, null, "one");
    appendAgentGroupMessage(ORG_ID, first, "p1", "reply");

    expect(
      listAgentGroupMessages(ORG_ID, first.id).map((m) => m.content)
    ).toEqual(["one", "reply"]);
    expect(listAgentGroupMessages(ORG_ID, second.id, 1)[0]?.content).toBe(
      "two"
    );
    expect(listGroupSessions(ORG_ID, "u1", group.id).map((s) => s.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  test("renames and pins a session, and deleting it drops its messages", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);
    const session = createGroupSession(ORG_ID, group.id, "Kickoff");
    appendAgentGroupMessage(ORG_ID, session, null, "hello");

    expect(
      updateGroupSession(ORG_ID, "u1", group.id, session.id, { pinned: true })
    ).toBe(true);
    expect(
      updateGroupSession(ORG_ID, "u1", group.id, session.id, { title: "Plan" })
    ).toBe(true);
    expect(getGroupSession(ORG_ID, "u1", group.id, session.id)).toMatchObject({
      pinned: true,
      title: "Plan",
    });

    expect(deleteGroupSession(ORG_ID, "u1", group.id, session.id)).toBe(true);
    expect(listAgentGroupMessages(ORG_ID, session.id)).toEqual([]);
    expect(() =>
      appendAgentGroupMessage(ORG_ID, session, "p1", "late")
    ).toThrow();
  });

  test("stores, replaces, and removes the group image", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);

    expect(group.avatarVersion).toBeNull();
    setAgentGroupAvatar(
      ORG_ID,
      "u1",
      group.id,
      "image/png",
      new Uint8Array([7])
    );
    expect(getAgentGroupAvatar(ORG_ID, "u1", group.id)).toEqual({
      bytes: new Uint8Array([7]),
      mediaType: "image/png",
    });
    expect(getAgentGroup(ORG_ID, "u1", group.id)?.avatarVersion).toBeString();

    expect(deleteAgentGroupAvatar(ORG_ID, "u1", group.id)).toBe(true);
    expect(getAgentGroup(ORG_ID, "u1", group.id)?.avatarVersion).toBeNull();
  });

  test("keeps rail pins per user, latest first, and drops a deleted group's pin", () => {
    const group = createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);

    setRailPin(ORG_ID, "u1", "agent-a", true);
    setRailPin(ORG_ID, "u1", group.id, true);
    setRailPin(ORG_ID, "u2", "agent-b", true);

    expect(listRailPins(ORG_ID, "u1")).toEqual([group.id, "agent-a"]);

    setRailPin(ORG_ID, "u1", "agent-a", false);
    deleteAgentGroup(ORG_ID, "u1", group.id);

    expect(listRailPins(ORG_ID, "u1")).toEqual([]);
    expect(listRailPins(ORG_ID, "u2")).toEqual(["agent-b"]);
  });

  test("reads the file on disk again once its handle is closed", () => {
    createAgentGroup(ORG_ID, "u1", "Launch", ["p1", "p2"]);
    closeAgentGroupDatabases();

    // Replaced as a data restore would. A kept handle would still read the
    // old file on POSIX, and Windows refuses to delete an open one.
    rmSync(join(getOrgConfigDir(ORG_ID), "agent-groups.sqlite"));

    expect(listAgentGroups(ORG_ID, "u1")).toEqual([]);
  });
});
