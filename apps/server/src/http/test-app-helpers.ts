import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
import { AgentGroupService } from "../services/agent-group-service";
import { AuthService } from "../services/auth-service";
import { OrgService } from "../services/org-service";
import { SkillCuratorService } from "../services/skill-curator-service";
import { SkillsService } from "../services/skills-service";
import { createHonoApp } from "./app";
import type { ServerOptions } from "./context";

const defaultAgent = {
  listProfiles: async () => ({ profiles: [{ id: "default" }] }),
};

const defaultSystemStatus = {
  getStatus: async () => ({ ok: true }),
};

export type CreateMinimalHonoAppOverrides = {
  agent?: ServerOptions["agent"] | object;
  authService?: AuthService;
  automationService?: ServerOptions["automationService"] | object;
  composioService?: ServerOptions["composioService"];
  databaseAdapter?: DatabaseAdapter;
  mcpService?: ServerOptions["mcpService"] | object;
  onBeforeDataRestore?: ServerOptions["onBeforeDataRestore"];
  onDataRestored?: ServerOptions["onDataRestored"];
  orgMemoryService?: ServerOptions["orgMemoryService"];
  orgService?: ServerOptions["orgService"];
  pluginService?: ServerOptions["pluginService"];
  skillCuratorService?: ServerOptions["skillCuratorService"];
  skillProposalService?: ServerOptions["skillProposalService"];
  skillSuggestionService?: ServerOptions["skillSuggestionService"];
  systemStatus?: ServerOptions["systemStatus"] | object;
  webDistDir?: ServerOptions["webDistDir"];
  workerManager?: ServerOptions["workerManager"] | object;
};

export function createMinimalHonoApp(
  overrides: CreateMinimalHonoAppOverrides = {}
) {
  const databaseAdapter =
    overrides.databaseAdapter ?? createInMemoryDatabaseAdapter();

  const authService = overrides.authService ?? new AuthService();

  const orgService =
    overrides.orgService ?? new OrgService(databaseAdapter, authService);

  const skillCuratorService =
    overrides.skillCuratorService ??
    new SkillCuratorService(
      databaseAdapter,
      new SkillsService(databaseAdapter)
    );

  const agent = overrides.agent ?? { ...defaultAgent };

  // Group routes read the agent's one group service; a stub without one gets
  // a service on itself, so replies use the stub.
  if (!("groups" in agent)) {
    // SAFETY: Route tests stub the agent methods their group requests call.
    Object.assign(agent, {
      groups: new AgentGroupService(databaseAdapter, agent as never),
    });
  }

  // SAFETY: Route tests provide every service method their requests call.
  const app = createHonoApp({
    agent: agent as ServerOptions["agent"],
    authService,
    automationService: (overrides.automationService ??
      {}) as ServerOptions["automationService"],
    composioService: overrides.composioService,
    databaseAdapter,
    mcpService: (overrides.mcpService ?? {}) as ServerOptions["mcpService"],
    onBeforeDataRestore: overrides.onBeforeDataRestore,
    onDataRestored: overrides.onDataRestored,
    orgMemoryService: overrides.orgMemoryService,
    orgService,
    pluginService: overrides.pluginService,
    skillCuratorService,
    skillProposalService: overrides.skillProposalService,
    skillSuggestionService: overrides.skillSuggestionService,
    systemStatus: (overrides.systemStatus ??
      defaultSystemStatus) as ServerOptions["systemStatus"],
    webDistDir:
      overrides.webDistDir === undefined ? null : overrides.webDistDir,
    workerManager: (overrides.workerManager ??
      {}) as ServerOptions["workerManager"],
  });

  return {
    app,
    authService,
    composioService: overrides.composioService,
    databaseAdapter,
    orgMemoryService: overrides.orgMemoryService,
    orgService,
    skillProposalService: overrides.skillProposalService,
    skillSuggestionService: overrides.skillSuggestionService,
  };
}
