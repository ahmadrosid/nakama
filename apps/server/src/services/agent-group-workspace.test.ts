import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GROUP_MEMORY_CHARS, groupWorkspace } from "./agent-group-workspace";

let root = "";

let sharedDir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nakama-group-workspace-"));
  sharedDir = join(root, "group", "shared");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

test("a save replaces the memory the editor opened", () => {
  const { memory } = groupWorkspace(sharedDir);
  memory.replace("- noir", "");

  expect(memory.replace("- noir\n- Mara", "- noir\n")).toBe("- noir\n- Mara");
});

test("a save over a fact an agent added since is refused and keeps it", () => {
  const { memory } = groupWorkspace(sharedDir);
  memory.replace("- noir", "");
  memory.addFact("Mara");

  expect(() => memory.replace("", "- noir")).toThrow(
    expect.objectContaining({ status: 409 })
  );
  expect(memory.read()).toBe("- noir\n- Mara");
});

test("facts are added, replaced and removed, and a repeat is skipped", () => {
  const { memory } = groupWorkspace(sharedDir);

  memory.addFact("Genre is noir");
  memory.addFact("- Lead is\nMara");
  memory.addFact("Genre is noir");

  expect(memory.read()).toBe("- Genre is noir\n- Lead is Mara");

  memory.addFact("Genre is sci-fi", "Genre is noir");
  memory.addFact("", "- Lead is Mara");

  expect(memory.read()).toBe("- Genre is sci-fi");
  expect(() => memory.addFact("x", "Genre is horror")).toThrow();
  expect(() => memory.addFact("")).toThrow();
});

test("memory past the cap cannot grow but may shrink, and reaches agents cut", () => {
  const { memory } = groupWorkspace(sharedDir);
  const long = "a".repeat(GROUP_MEMORY_CHARS);
  memory.replace(`- short\n- ${long}`, "");

  expect(memory.forPrompt()).toBe("- short\n[truncated]");
  expect(() => memory.addFact("one more")).toThrow();

  memory.addFact("tiny", long);

  expect(memory.read()).toBe("- short\n- tiny");
  expect(memory.forPrompt()).toBe("- short\n- tiny");
});

test("an image is saved under uploads, a document is kept, and the image is removed by its path", () => {
  const workspace = groupWorkspace(sharedDir);
  const [image, note] = workspace.saveImages([
    { filename: "photo.jpg", image: Buffer.from("img") },
    { filename: "notes.txt", text: "hi" },
  ]);

  const path = image?.path ?? "";

  expect(path).toMatch(/^uploads\/\w+\.jpg$/);
  expect(image?.text).toContain(join(sharedDir, path));
  expect(note).toEqual({ filename: "notes.txt", text: "hi" });
  expect(readFileSync(join(sharedDir, path), "utf8")).toBe("img");

  workspace.removeImages([path, "../memory.md", "plan.md"]);

  expect(existsSync(join(sharedDir, path))).toBe(false);
});

test("remove deletes the shared folder and the memory", () => {
  const workspace = groupWorkspace(sharedDir);
  workspace.open();
  workspace.memory.addFact("noir");

  workspace.remove();

  expect(existsSync(join(root, "group"))).toBe(false);
  expect(existsSync(root)).toBe(true);
});
