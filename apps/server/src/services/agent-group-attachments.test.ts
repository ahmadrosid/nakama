import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGroupSharedDir } from "@nakama/core";
import { setupTestConfigDir } from "../test-config-dir";
import { readGroupDocuments } from "./agent-group-service";
import { closeAgentGroupDatabases } from "./agent-group-store";
import { ORG_ID, setup, USER_ID } from "./agent-group-test-setup";

// Before the config dir cleanup, which Windows refuses while a file is open.
afterEach(closeAgentGroupDatabases);

setupTestConfigDir("nakama-agent-group-attachments-");

describe("group attachments", () => {
  test("an attached document reaches the agent, and the client sees only its name", async () => {
    const contexts: string[] = [];

    const { service } = setup(({ context }) => {
      contexts.push(context ?? "");

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const documents = await readGroupDocuments(ORG_ID, USER_ID, group.id, [
      {
        data: Buffer.from("Q3 revenue was 42").toString("base64"),
        filename: "notes.txt",
        mediaType: "text/plain",
      },
    ]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "",
      documents
    );

    await run;

    expect(contexts[0]).toContain("Q3 revenue was 42");

    const [message] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      session.id
    ).messages;

    expect(message?.files).toEqual(["notes.txt"]);
    expect(JSON.stringify(message)).not.toContain("Q3 revenue");
  });

  test("a pasted image is saved in the group folder for the agents to open", async () => {
    const contexts: string[] = [];

    const { service } = setup(({ context }) => {
      contexts.push(context ?? "");

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const documents = await readGroupDocuments(ORG_ID, USER_ID, group.id, [
      {
        data: png.toString("base64"),
        filename: "image.png",
        mediaType: "image/png",
      },
    ]);

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "what is this?",
      documents
    );

    await run;

    const path = contexts[0]?.match(/Image saved at (\S+\.png)/)?.[1] ?? "";

    expect(
      path.startsWith(join(getGroupSharedDir(ORG_ID, group.id), "uploads"))
    ).toBe(true);
    expect(readFileSync(path)).toEqual(png);

    const [message] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      session.id
    ).messages;

    expect(message?.files).toBeUndefined();
    expect(
      message?.images?.map((image) =>
        join(getGroupSharedDir(ORG_ID, group.id), image)
      )
    ).toEqual([path]);
  });

  test("an image for a group the user cannot open is not saved", async () => {
    await expect(
      readGroupDocuments(ORG_ID, "someone-else", "missing", [
        { data: "AAAA", filename: "image.png", mediaType: "image/png" },
      ])
    ).rejects.toThrow();
    expect(existsSync(getGroupSharedDir(ORG_ID, "missing"))).toBe(false);
  });

  test("a document of an unsupported type is rejected", async () => {
    await expect(
      readGroupDocuments(ORG_ID, USER_ID, "g", [
        {
          data: "AAAA",
          filename: "run.exe",
          mediaType: "application/x-msdownload",
        },
      ])
    ).rejects.toThrow();
  });
});
