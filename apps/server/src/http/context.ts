import type { DatabaseAdapter } from "@nakama/db";
import type { AgentService } from "../services/agent-service";
import type { AuthService } from "../services/auth-service";
import type { AutomationService } from "../services/automation-service";
import type { ComposioService } from "../services/composio-service";
import type { McpService } from "../services/mcp-service";
import type { OrgMemoryService } from "../services/org-memory-service";
import type { OrgService } from "../services/org-service";
import type { SkillCuratorService } from "../services/skill-curator-service";
import type { SkillProposalService } from "../services/skill-proposal-service";
import type { SkillSuggestionService } from "../services/skill-suggestion-service";
import type { SystemStatusService } from "../services/system-status-service";
import type { WorkerManagerService } from "../services/worker-manager-service";
import type { WorkflowService } from "../services/workflow-service";

export interface ServerOptions {
  agent: AgentService;
  authService?: AuthService | null;
  automationService: AutomationService;
  composioService?: ComposioService | null;
  databaseAdapter?: DatabaseAdapter | null;
  mcpService: McpService;
  /** Close/reopen SQLite and reload config after a data-root restore. */
  onDataRestored?: () => Promise<void>;
  orgMemoryService?: OrgMemoryService | null;
  orgService?: OrgService | null;
  skillCuratorService?: SkillCuratorService | null;
  skillProposalService?: SkillProposalService | null;
  skillSuggestionService?: SkillSuggestionService | null;
  systemStatus: SystemStatusService;
  webDistDir?: string | null;
  workerManager: WorkerManagerService;
  workflowService: WorkflowService;
}
