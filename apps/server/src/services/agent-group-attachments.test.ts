import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGroupSharedDir } from "@nakama/core";
import { strToU8, type Zippable, zipSync } from "fflate";
import { setupTestConfigDir } from "../test-config-dir";
import { closeAgentGroupDatabases } from "./agent-group-store";
import { ORG_ID, setup, USER_ID } from "./agent-group-test-setup";
import { readGroupDocuments } from "./agent-group-turn";
import { groupWorkspace } from "./agent-group-workspace";

const PNG = {
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
  filename: "image.png",
  mediaType: "image/png",
};

const uploadsOf = (groupId: string) =>
  join(getGroupSharedDir(ORG_ID, groupId), "uploads");

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

    const documents = await readGroupDocuments([
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

    const documents = await readGroupDocuments([
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

  test("a data URL attachment is read as its bytes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const text = Buffer.from("Q3 revenue was 42").toString("base64");

    const [image, document] = await readGroupDocuments([
      {
        data: `data:image/png;base64,${png.toString("base64")}`,
        filename: "image.png",
        mediaType: "image/png",
      },
      {
        data: `data:text/plain;base64,${text}`,
        filename: "notes.txt",
        mediaType: "text/plain",
      },
    ]);

    expect(image).toEqual({ filename: "image.png", image: png });
    expect(document).toMatchObject({ filename: "notes.txt" });
    expect(document && "text" in document && document.text).toContain(
      "Q3 revenue was 42"
    );
  });

  test("an image posted to a missing session is not saved", async () => {
    const { service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const documents = await readGroupDocuments([PNG]);

    expect(() =>
      service.post(ORG_ID, USER_ID, group.id, "missing", "hi", documents)
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(() =>
      service.postThread(
        ORG_ID,
        USER_ID,
        group.id,
        "missing",
        1,
        "hi",
        documents
      )
    ).toThrow(expect.objectContaining({ status: 404 }));
    expect(existsSync(uploadsOf(group.id))).toBe(false);
  });

  test("deleting a session removes its images and keeps the rest of the folder", async () => {
    const { service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const first = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "one",
      await readGroupDocuments([PNG])
    );

    const second = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "two",
      await readGroupDocuments([PNG])
    );

    await Promise.all([first.run, second.run]);
    writeFileSync(join(getGroupSharedDir(ORG_ID, group.id), "plan.md"), "x");

    service.deleteSession(ORG_ID, USER_ID, group.id, first.session.id);

    const [kept] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      second.session.id
    ).messages;

    expect(readdirSync(uploadsOf(group.id))).toEqual(
      (kept?.images ?? []).map((path) => path.replace("uploads/", ""))
    );
    expect(
      existsSync(join(getGroupSharedDir(ORG_ID, group.id), "plan.md"))
    ).toBe(true);
  });

  test("deleting a group removes its folder and memory", async () => {
    const { chat, service } = setup(() => "ok");
    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);
    const sharedDir = getGroupSharedDir(ORG_ID, group.id);

    await chat(group.id, "hi");
    groupWorkspace(sharedDir).memory.replace("- noir", "");
    writeFileSync(join(sharedDir, "plan.md"), "x");

    service.delete(ORG_ID, USER_ID, group.id);

    expect(existsSync(dirname(sharedDir))).toBe(false);
  });

  test("a ZIP's files are saved for the agents, its documents reach them, and deleting the session removes them", async () => {
    const contexts: string[] = [];

    const { service } = setup(({ context }) => {
      contexts.push(context ?? "");

      return "ok";
    });

    const group = await service.create(ORG_ID, USER_ID, "Team", ["a", "b"]);

    const zip = zipSync({
      "__MACOSX/._notes.txt": strToU8("junk"),
      "notes.txt": strToU8("Q3 revenue was 42"),
      "src/run.py": strToU8("print(1)"),
    });

    const { run, session } = service.start(
      ORG_ID,
      USER_ID,
      group.id,
      "check this",
      await readGroupDocuments([
        {
          data: Buffer.from(zip).toString("base64"),
          filename: "project.zip",
          mediaType: "application/zip",
        },
      ])
    );

    await run;

    const folder = contexts[0]?.match(/Files saved in (\S+)\./)?.[1] ?? "";

    expect(contexts[0]).toContain("Q3 revenue was 42");
    expect(dirname(folder)).toBe(uploadsOf(group.id));
    expect(readFileSync(join(folder, "src/run.py"), "utf8")).toBe("print(1)");
    expect(existsSync(join(folder, "__MACOSX"))).toBe(false);

    const [message] = service.session(
      ORG_ID,
      USER_ID,
      group.id,
      session.id
    ).messages;

    expect(message?.files).toEqual(["project.zip"]);
    expect(message?.images).toBeUndefined();

    service.deleteSession(ORG_ID, USER_ID, group.id, session.id);

    expect(existsSync(folder)).toBe(false);
  });

  test("a ZIP with a path outside its folder or a file in place of a folder is rejected", async () => {
    const archives: Zippable[] = [
      { "../escape.txt": strToU8("x") },
      { notes: strToU8("x"), "notes/a.txt": strToU8("y") },
    ];

    for (const files of archives) {
      await expect(
        readGroupDocuments([
          {
            data: Buffer.from(zipSync(files)).toString("base64"),
            filename: "bad.zip",
            mediaType: "application/zip",
          },
        ])
      ).rejects.toMatchObject({ status: 400 });
    }
  });

  test("a document of an unsupported type is rejected", async () => {
    await expect(
      readGroupDocuments([
        {
          data: "AAAA",
          filename: "run.exe",
          mediaType: "application/x-msdownload",
        },
      ])
    ).rejects.toThrow();
  });
});
