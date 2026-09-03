import {
  createInMemoryDatabaseAdapter,
  type DatabaseAdapter,
} from "@nakama/db";
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
  workflowService?: ServerOptions["workflowService"] | object;
  composioService?: ServerOptions["composioService"];
  databaseAdapter?: DatabaseAdapter;
  mcpService?: ServerOptions["mcpService"] | object;
  onDataRestored?: ServerOptions["onDataRestored"];
  orgMemoryService?: ServerOptions["orgMemoryService"];
  orgService?: ServerOptions["orgService"];
  skillCuratorService?: ServerOptions["skillCuratorService"];
  skillProposalService?: ServerOptions["skillProposalService"];
  skillSuggestionService?: ServerOptions["skillSuggestionService"];
  systemStatus?: ServerOptions["systemStatus"] | object;
  taskService?: ServerOptions["taskService"] | object;
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

  const app = createHonoApp({
    agent: (overrides.agent ?? defaultAgent) as ServerOptions["agent"],
    authService,
    automationService: (overrides.automationService ??
      {}) as ServerOptions["automationService"],
    composioService: overrides.composioService,
    databaseAdapter,
    mcpService: (overrides.mcpService ?? {}) as ServerOptions["mcpService"],
    onDataRestored: overrides.onDataRestored,
    orgMemoryService: overrides.orgMemoryService,
    orgService,
    skillCuratorService,
    skillProposalService: overrides.skillProposalService,
    skillSuggestionService: overrides.skillSuggestionService,
    systemStatus: (overrides.systemStatus ??
      defaultSystemStatus) as ServerOptions["systemStatus"],
    taskService: (overrides.taskService ?? {}) as ServerOptions["taskService"],
    webDistDir:
      overrides.webDistDir === undefined ? null : overrides.webDistDir,
    workerManager: (overrides.workerManager ??
      {}) as ServerOptions["workerManager"],
    workflowService: (overrides.workflowService ??
      {}) as ServerOptions["workflowService"],
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
