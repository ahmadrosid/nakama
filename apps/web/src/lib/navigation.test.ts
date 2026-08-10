import { describe, expect, test } from "bun:test";
import {
  agentWorkTabFromSearchParams,
  agentWorkTabPath,
  pageIdFromPath,
  pathForPage,
} from "./navigation";

describe("agent work navigation", () => {
  test("defaults the unified page to automations", () => {
    expect(agentWorkTabFromSearchParams(new URLSearchParams())).toBe(
      "automations"
    );
    expect(
      agentWorkTabFromSearchParams(new URLSearchParams("tab=unknown"))
    ).toBe("automations");
  });

  test("reads the tasks tab from the URL", () => {
    expect(agentWorkTabFromSearchParams(new URLSearchParams("tab=tasks"))).toBe(
      "tasks"
    );
  });

  test("builds canonical tab URLs", () => {
    expect(agentWorkTabPath("automations")).toBe(
      "/automations?tab=automations"
    );
    expect(agentWorkTabPath("tasks")).toBe("/automations?tab=tasks");
  });

  test("maps the legacy tasks path to the unified page", () => {
    expect(pageIdFromPath("/tasks")).toBe("automations");
    expect(pageIdFromPath("/automations")).toBe("automations");
  });

  test("registers the Files page", () => {
    expect(pageIdFromPath("/files")).toBe("files");
    expect(pathForPage("files")).toBe("/files");
  });
});
