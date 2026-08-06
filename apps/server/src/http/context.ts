import type { AgentService } from "../services/agent-service";
import type { AutomationService } from "../services/automation-service";
import type { McpService } from "../services/mcp-service";
import type { TaskService } from "../services/task-service";
import { SystemStatusService } from "../services/system-status-service";
import type { WorkerManagerService } from "../services/worker-manager-service";
import type { AuthService } from "../services/auth-service";
import type { OrgService } from "../services/org-service";
import type { OrgMemoryService } from "../services/org-memory-service";
import type { SkillProposalService } from "../services/skill-proposal-service";
import type { SkillSuggestionService } from "../services/skill-suggestion-service";
import type { ComposioService } from "../services/composio-service";
import type { DatabaseAdapter } from "@nakama/db";

export interface ServerOptions {
  agent: AgentService;
  automationService: AutomationService;
  taskService: TaskService;
  systemStatus: SystemStatusService;
  workerManager: WorkerManagerService;
  mcpService: McpService;
  composioService?: ComposioService | null;
  authService?: AuthService | null;
  orgService?: OrgService | null;
  orgMemoryService?: OrgMemoryService | null;
  skillProposalService?: SkillProposalService | null;
  skillSuggestionService?: SkillSuggestionService | null;
  databaseAdapter?: DatabaseAdapter | null;
  webDistDir?: string | null;
  /** Close/reopen SQLite and reload config after a data-root restore. */
  onDataRestored?: () => Promise<void>;
}
