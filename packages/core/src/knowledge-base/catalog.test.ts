import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { composeKnowledgeBaseCatalog } from "./catalog";
import { NAKAMA_DOCS_LLMS_URL } from "./sources";

describe("knowledge base catalog", () => {
  let tempConfigDir = "";
  const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;

  afterEach(async () => {
    process.env.NAKAMA_CONFIG_DIR = previousConfigDir;

    if (tempConfigDir) {
      await rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  test("includes inherited Nakama documentation source with llms.txt entry point", async () => {
    tempConfigDir = await mkdtemp(path.join(os.tmpdir(), "nakama-kb-catalog-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const catalog = await composeKnowledgeBaseCatalog("org_test", "profile_test");

    expect(catalog).toContain("# Nakama documentation (inherited)");
    expect(catalog).toContain("Nakama Documentation");
    expect(catalog).toContain(NAKAMA_DOCS_LLMS_URL);
    expect(catalog).toContain("Do not use knowledge_base_search");
    expect(catalog).toContain("web_fetch");
    expect(catalog).toContain("llms.txt");
  });
});
