import { expect, mock, test } from "bun:test";
import type { PluginExecutionContext } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import type { AgentService } from "./agent-service";
import type { ComposioService } from "./composio-service";
import { createPluginAgentHost } from "./plugin-agent-host";

test("Meet recording host access is limited to the matching plugin action and actor", async () => {
  const listMeetRecordings = mock(async (orgId: string, userId: string) => ({
    orgId,
    recordings: [],
    userId,
  }));
  const host = createPluginAgentHost(
    createInMemoryDatabaseAdapter(),
    {} as AgentService,
    { listMeetRecordings } as unknown as ComposioService
  );
  const context: PluginExecutionContext = {
    actionKey: "recordings",
    actor: { id: "member", role: "member" },
    apiVersion: 1,
    dataDir: "/tmp/unused",
    invocationId: "test",
    orgId: "org",
    pluginId: "google-meet",
    pluginVersion: "0.1.2",
  };
  expect(await host({ op: "meet_recordings" }, context)).toEqual({
    orgId: "org",
    recordings: [],
    userId: "member",
  });
  expect(listMeetRecordings).toHaveBeenCalledTimes(1);
  for (const denied of [
    { ...context, pluginId: "another-plugin" },
    { ...context, actionKey: "upload" },
    { ...context, actor: { id: "viewer", role: "viewer" as const } },
  ]) {
    await expect(host({ op: "meet_recordings" }, denied)).rejects.toThrow();
  }
  await expect(
    host(
      { fileId: "bad", messageId: "msg", op: "import_meet_recording" },
      {
        ...context,
        actionKey: "import-recording",
      }
    )
  ).rejects.toThrow("Invalid recording selection");
  expect(listMeetRecordings).toHaveBeenCalledTimes(1);
});
