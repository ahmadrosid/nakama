import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createEmailOutboundAdapter,
  type EmailOutboundAdapter,
  ensureDir,
  generateTemporaryPassword,
  getKnowledgeBaseDir,
  getKnowledgeBaseManifestPath,
  getKnowledgeBaseStoredDocumentPath,
  getOrgConfigDir,
  getOrgKnowledgeBaseDir,
  getProfileSoulDir,
  getUserConfigDir,
  guardFilePath,
  initSoulDirectory,
  knowledgeBaseMutationLock,
  listOrganizationKnowledgeBaseDocuments,
  loadUserConfig,
  NakamaApiError,
  parseSkillMarkdown,
  readProfileManifestForReference,
  resolveProfileSkillDirectory,
  resolveWebPublicUrl,
  SKILL_FILE_NAME,
  SOUL_FILES,
  type SoulStackFiles,
} from "@nakama/core";
import { createChatLock } from "@nakama/core/channel-chat-lock";
import {
  listChannelOwners,
  removeChannelConnection,
} from "@nakama/core/channel-config-shared";
import type {
  AcceptOrgInviteRequest,
  AddOrgMemberResponse,
  AuthUserResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  CreateTeamRequest,
  ListOrgInvitesResponse,
  ListOrgMembersResponse,
  ListOrgSharedResourcesResponse,
  ListUserOrgsResponse,
  OrganizationOverviewResponse,
  OrganizationSummary,
  OrgInviteCreatedResponse,
  OrgInviteSummary,
  OrgMemberResponse,
  OrgMemberSummary,
  OrgRole,
  PublishOrgSharedResourceRequest,
  RequestPasswordResetResponse,
  ResetPasswordRequest,
  UpdateOrganizationRequest,
  UpdateOrgMemberRequest,
} from "@nakama/core/contract";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import type {
  DatabaseAdapter,
  StoredMcpServerRecord,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredOrgSharedResourceRecord,
  StoredPasswordResetTokenRecord,
  StoredProfileRecord,
  StoredToolRecord,
  StoredUserRecord,
} from "@nakama/db";
import {
  ensureLocalClientAccess,
  ORG_INVITE_EXPIRY_DAYS,
  ORG_ROLES,
  seedOrgDefaultProfile,
  seedOrgSuperNakamaProfile,
} from "@nakama/db";
import { isTenantBashEnabled } from "../tools/bash-config";
import type { AuthService } from "./auth-service";
import {
  deleteOrgToolCredentials,
  loadToolApiKey,
  loadToolEnv,
  readHandlerConfig,
} from "./custom-tool-shared";
import { namespacedMcpToolName } from "./mcp-tool-bridge";
import { loadMfaPolicy } from "./mfa-config";
import {
  modelExistsOnInstance,
  providerPublicationLock,
  resolveConfiguredModelInstance,
} from "./provider-instance-helpers";

const teamCreationLock = createChatLock();

const LAST_MEMBERSHIP_MESSAGE =
  "Cannot archive your last remaining organization.";

const LAST_ORGANIZATION_MESSAGE =
  "Cannot archive the last remaining organization.";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITE_DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const PHONE_PATTERN = /^[+0-9()\-\s]{6,32}$/;

const MAX_MEMBER_NAME_LENGTH = 120;

const PASSWORD_RESET_EXPIRY_MINUTES = 60;

const MEMBER_NAME_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** Path `userId` for org member routes — matches minted ids (`user_` + hex) and seeded ones. */
const ORG_MEMBER_USER_ID_PATTERN = /^user_[A-Za-z0-9_]{1,64}$/;

function assertOrgMemberUserId(userId: string): void {
  if (!ORG_MEMBER_USER_ID_PATTERN.test(userId)) {
    throw new NakamaApiError("Invalid user id.", 400);
  }
}

export class OrgService {
  beforeArchiveChannels?: (orgId: string) => Promise<() => void>;
  constructor(
    private readonly databaseAdapter: DatabaseAdapter,
    private readonly authService: AuthService,
    private readonly email: EmailOutboundAdapter = createEmailOutboundAdapter(),
    private readonly getWebPublicUrl: () =>
      | string
      | undefined = resolveWebPublicUrl
  ) {}

  async listOrganizations(): Promise<OrganizationSummary[]> {
    const organizations = await this.databaseAdapter.listOrganizations();

    return organizations
      .filter((org) => !org.setupPending)
      .map(toOrganizationSummary);
  }

  async getOrganization(orgId: string): Promise<OrganizationSummary | null> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);

    return org ? toOrganizationSummary(org) : null;
  }

  private async requireActiveOrganization(
    orgId: string
  ): Promise<StoredOrganizationRecord> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);

    if (!org || org.archivedAt || org.setupPending) {
      throw new NakamaApiError("Not found", 404);
    }

    return org;
  }

  private async requireParentAdmin(
    orgId: string,
    userId: string
  ): Promise<StoredOrganizationRecord> {
    const parent = await this.requireActiveOrganization(orgId);

    if (parent.parentOrgId) {
      throw new NakamaApiError("Requires a root organization.", 409);
    }

    const user = await this.databaseAdapter.getUserById(userId);
    const membership = await this.databaseAdapter.getOrgMember(orgId, userId);

    if (
      !user ||
      user.disabledAt ||
      (!user.isPlatformAdmin && membership?.role !== "admin")
    ) {
      throw new NakamaApiError("Forbidden", 403);
    }

    return parent;
  }

  async publishSharedResource(
    parentOrgId: string,
    request: PublishOrgSharedResourceRequest,
    actorUserId: string
  ): Promise<StoredOrgSharedResourceRecord> {
    await this.requireParentAdmin(parentOrgId, actorUserId);

    const publish = async () => {
      const { resourceId } = await this.validateSharedResourceSource(
        parentOrgId,
        request
      );

      const now = new Date().toISOString();

      return this.databaseAdapter.publishOrgSharedResource({
        createdAt: now,
        id: `publication_${crypto.randomUUID().replace(/-/g, "")}`,
        orgId: parentOrgId,
        resourceId,
        resourceKind: request.resourceKind,
        updatedAt: now,
      });
    };

    if (request.resourceKind === "knowledge") {
      return knowledgeBaseMutationLock.withLock(
        getOrgConfigDir(parentOrgId),
        publish
      );
    }

    if (request.resourceKind === "model") {
      return providerPublicationLock.withLock("providers", publish);
    }

    return publish();
  }

  async listSharedResources(
    orgId: string,
    actorUserId: string
  ): Promise<ListOrgSharedResourcesResponse> {
    const org = await this.requireActiveOrganization(orgId);

    const [user, membership] = await Promise.all([
      this.databaseAdapter.getUserById(actorUserId),
      this.databaseAdapter.getOrgMember(orgId, actorUserId),
    ]);

    if (!user || user.disabledAt || !(user.isPlatformAdmin || membership)) {
      throw new NakamaApiError("Not found", 404);
    }

    const parent = org.parentOrgId
      ? await this.requireActiveOrganization(org.parentOrgId)
      : org;

    if (parent.parentOrgId) {
      throw new NakamaApiError("Not found", 404);
    }

    const publications = await this.databaseAdapter.listOrgSharedResources(
      parent.id
    );

    const resources: ListOrgSharedResourcesResponse["resources"] = [];

    for (const publication of publications) {
      let label = publication.resourceId;

      let readiness: ListOrgSharedResourcesResponse["resources"][number]["readiness"] =
        "ready";

      try {
        ({ label } = await this.validateSharedResourceSource(
          parent.id,
          publication
        ));

        if (publication.resourceKind === "tool") {
          const tool = await this.databaseAdapter.getTool(
            publication.resourceId
          );

          if (tool && ["javascript", "python"].includes(tool.handlerType)) {
            const config = readHandlerConfig(tool.handlerConfig);

            if (!config) {
              throw new NakamaApiError(
                "Tool configuration is unavailable.",
                404
              );
            }

            const [apiKey, env] = await Promise.all([
              loadToolApiKey(orgId, tool.id),
              loadToolEnv(orgId, tool.id),
            ]);

            if (
              (config.requiresApiKey === true && !apiKey) ||
              config.env.some((entry) => !env[entry.name])
            ) {
              readiness = "requires_setup";
            }
          }
        }
      } catch (error) {
        if (
          !(
            error instanceof NakamaApiError &&
            [400, 404, 409].includes(error.status)
          )
        ) {
          throw error;
        }

        readiness = "unavailable";
      }

      resources.push({
        ...publication,
        label,
        readiness,
        sourceOrganization: { id: parent.id, name: parent.name },
      });
    }

    return { resources };
  }

  async getOrganizationOverview(
    orgId: string,
    actorUserId: string
  ): Promise<OrganizationOverviewResponse> {
    const { resources } = await this.listSharedResources(orgId, actorUserId);
    const org = await this.requireActiveOrganization(orgId);

    const parent = org.parentOrgId
      ? await this.requireActiveOrganization(org.parentOrgId)
      : org;

    const [user, memberships, organizations] = await Promise.all([
      this.databaseAdapter.getUserById(actorUserId),
      this.databaseAdapter.listUserOrganizations(actorUserId),
      this.databaseAdapter.listOrganizations(),
    ]);

    if (!user || user.disabledAt) {
      throw new NakamaApiError("Not found", 404);
    }

    const membershipByOrg = new Map(
      memberships.map((entry) => [entry.organization.id, entry.role])
    );

    if (!(user.isPlatformAdmin || membershipByOrg.has(orgId))) {
      throw new NakamaApiError("Not found", 404);
    }

    const canReadAllTeams =
      user.isPlatformAdmin || membershipByOrg.get(parent.id) === "admin";

    const teams: OrganizationOverviewResponse["teams"] = [];

    for (const team of organizations) {
      if (
        team.parentOrgId !== parent.id ||
        team.archivedAt ||
        team.setupPending ||
        !(canReadAllTeams || membershipByOrg.has(team.id))
      ) {
        continue;
      }

      const counts = await this.databaseAdapter.getOrganizationResourceCounts(
        team.id
      );

      if (!counts) {
        continue;
      }

      const knowledgeDir = getOrgKnowledgeBaseDir(team.id);
      let knowledgeCount: number;

      try {
        await guardFilePath(knowledgeDir, null, undefined, {
          allowedDirs: [getOrgConfigDir(team.id)],
        });
        await guardFilePath(
          getKnowledgeBaseManifestPath(knowledgeDir),
          null,
          undefined,
          {
            allowedDirs: [knowledgeDir],
          }
        );
        knowledgeCount = (await listOrganizationKnowledgeBaseDocuments(team.id))
          .length;
      } catch {
        throw new NakamaApiError("Team summary is unavailable.", 500);
      }

      teams.push({
        canSwitch: Boolean(
          user.isPlatformAdmin || membershipByOrg.has(team.id)
        ),
        id: team.id,
        isCurrent: team.id === orgId,
        localResourceCounts: {
          agents: counts.agents,
          knowledge: knowledgeCount,
          skills: counts.skills,
          tools: counts.tools,
        },
        memberCount: counts.members,
        name: team.name,
        slug: team.slug,
      });
    }

    return {
      activeOrgId: orgId,
      canManageOrganization: Boolean(orgId === parent.id && canReadAllTeams),
      organization: { id: parent.id, name: parent.name },
      sharedResources: resources,
      teams,
    };
  }

  async createSharedAgentInstance(
    teamOrgId: string,
    publicationId: string,
    actorUserId: string
  ): Promise<StoredProfileRecord> {
    const team = await this.requireActiveOrganization(teamOrgId);

    const [user, membership] = await Promise.all([
      this.databaseAdapter.getUserById(actorUserId),
      this.databaseAdapter.getOrgMember(teamOrgId, actorUserId),
    ]);

    if (!user || user.disabledAt || !(membership || user.isPlatformAdmin)) {
      throw new NakamaApiError("Not found", 404);
    }

    if (
      !membership ||
      (membership.role !== "admin" && membership.role !== "member")
    ) {
      throw new NakamaApiError("Forbidden", 403);
    }

    if (!team.parentOrgId) {
      throw new NakamaApiError("Shared agents require a team.", 409);
    }

    const parent = await this.requireActiveOrganization(team.parentOrgId);

    if (parent.parentOrgId) {
      throw new NakamaApiError("Not found", 404);
    }

    const publication = await this.databaseAdapter.getOrgSharedResource(
      parent.id,
      publicationId
    );

    if (publication?.resourceKind !== "agent") {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    await this.validateSharedResourceSource(parent.id, publication);

    const profile = await this.databaseAdapter.createSharedAgentInstance(
      team.id,
      publication.id,
      `profile_${crypto.randomUUID().replace(/-/g, "")}`,
      new Date().toISOString()
    );

    try {
      const soulDir = getProfileSoulDir(team.id, profile.id);

      const { resolved } = await guardFilePath(soulDir, null, undefined, {
        allowedDirs: [getOrgConfigDir(team.id)],
      });

      await ensureDir(resolved);
    } catch {
      // Keep the stable source link so a retry cannot replace existing team work.
      throw new NakamaApiError(
        "Team workspace setup failed. Retry the selection.",
        500
      );
    }

    return profile;
  }

  async resolveSharedAgentProfile(
    teamOrgId: string,
    profileId: string
  ): Promise<
    | (StoredProfileRecord & {
        assignedTools: StoredToolRecord[];
        assignedMcpServers: StoredMcpServerRecord[];
        publishedSoul: Pick<SoulStackFiles, "soul" | "style" | "instructions">;
      })
    | null
  > {
    const instance = await this.databaseAdapter.getSharedAgentInstance(
      teamOrgId,
      profileId
    );

    if (!instance) {
      return null;
    }

    const team = await this.requireActiveOrganization(teamOrgId);

    if (team.parentOrgId !== instance.sourceOrgId) {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    const parent = await this.requireActiveOrganization(instance.sourceOrgId);

    const publication = await this.databaseAdapter.getOrgSharedResource(
      parent.id,
      instance.publicationId
    );

    if (
      parent.parentOrgId ||
      publication?.resourceKind !== "agent" ||
      publication.resourceId !== instance.sourceProfileId
    ) {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    await this.validateSharedResourceSource(parent.id, publication);

    const [profile, source] = await Promise.all([
      this.databaseAdapter.getProfileForOrg(profileId, teamOrgId),
      this.databaseAdapter.getProfileForOrg(
        instance.sourceProfileId,
        parent.id
      ),
    ]);

    if (
      !(profile && source) ||
      source.isDefault ||
      source.isSuper ||
      source.acpAgent ||
      source.acpSettings
    ) {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    return {
      ...profile,
      acpAgent: null,
      acpSettings: null,
      assignedMcpServers: await this.databaseAdapter.listMcpServersForProfile(
        source.id
      ),
      assignedTools: await this.databaseAdapter.listToolsForProfile(source.id),
      isDefault: false,
      isSuper: false,
      model: source.model,
      name: source.name,
      publishedSoul: await this.readSharedAgentSoul(parent.id, source.id),
      systemPrompt: source.systemPrompt,
      thinkingEffort: source.thinkingEffort,
      thinkingEnabled: source.thinkingEnabled,
    };
  }

  private async readSharedAgentSoul(
    parentOrgId: string,
    profileId: string
  ): Promise<Pick<SoulStackFiles, "soul" | "style" | "instructions">> {
    const publishedSoul: Pick<
      SoulStackFiles,
      "soul" | "style" | "instructions"
    > = {
      instructions: undefined,
      soul: undefined,
      style: undefined,
    };

    const directory = getProfileSoulDir(parentOrgId, profileId);

    try {
      await guardFilePath(directory, null, undefined, {
        allowedDirs: [getOrgConfigDir(parentOrgId)],
      });

      try {
        const entry = await lstat(directory);

        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw new NakamaApiError("Shared agent is unavailable.", 404);
        }
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }

      for (const key of ["instructions", "soul", "style"] as const) {
        const filePath = join(directory, SOUL_FILES[key]);
        await guardFilePath(filePath, null, undefined, {
          allowedDirs: [directory],
        });

        try {
          if (!(await lstat(filePath)).isFile()) {
            throw new NakamaApiError("Shared agent is unavailable.", 404);
          }

          const handle = await open(filePath, constants.O_NOFOLLOW);

          try {
            if (!(await handle.stat()).isFile()) {
              throw new NakamaApiError("Shared agent is unavailable.", 404);
            }

            publishedSoul[key] =
              (await handle.readFile("utf8")).trim() || undefined;
          } finally {
            await handle.close();
          }
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw error;
          }
        }
      }
    } catch {
      throw new NakamaApiError("Shared agent is unavailable.", 404);
    }

    return publishedSoul;
  }

  private async validateSharedResourceSource(
    parentOrgId: string,
    request: PublishOrgSharedResourceRequest
  ): Promise<{ resourceId: string; label: string }> {
    let resourceId = request.resourceId;
    let label = resourceId;

    if (request.resourceKind === "agent") {
      const profile = await this.databaseAdapter.getProfileForOrg(
        resourceId,
        parentOrgId
      );

      if (!profile || profile.isDefault || profile.isSuper) {
        throw new NakamaApiError("Agent is unavailable.", 404);
      }

      if (profile.acpAgent || profile.acpSettings) {
        throw new NakamaApiError(
          "Agent requires team-local ACP configuration.",
          409
        );
      }

      label = profile.name;
      await this.readSharedAgentSoul(parentOrgId, profile.id);

      const [tools, skills, servers, toolkits, publications] =
        await Promise.all([
          this.databaseAdapter.listToolsForProfile(profile.id),
          this.databaseAdapter.listSkillsForProfile(profile.id),
          this.databaseAdapter.listMcpServersForProfile(profile.id),
          this.databaseAdapter.listProfileComposioToolkits(profile.id),
          this.databaseAdapter.listOrgSharedResources(parentOrgId),
        ]);

      if (
        servers.some((server) => server.orgId || !server.enabled) ||
        toolkits.length > 0
      ) {
        throw new NakamaApiError(
          "Agent requires a team-local integration.",
          409
        );
      }

      const published = new Set(
        publications.map((entry) => `${entry.resourceKind}:${entry.resourceId}`)
      );

      const toolNames = new Set<string>();

      for (const server of servers) {
        for (const tool of server.cachedTools) {
          const name = namespacedMcpToolName(server.name, tool.name);

          if (toolNames.has(name)) {
            throw new NakamaApiError(
              "Agent tool assignments are conflicting.",
              409
            );
          }

          toolNames.add(name);
        }
      }

      for (const tool of tools) {
        if (
          toolNames.has(tool.name) ||
          (tool.orgId && !published.has(`tool:${tool.id}`))
        ) {
          throw new NakamaApiError(
            "Agent tool assignments are unavailable or conflicting.",
            409
          );
        }

        await this.validateSharedResourceSource(parentOrgId, {
          resourceId: tool.id,
          resourceKind: "tool",
        });
        toolNames.add(tool.name);
      }

      const skillNames = new Set<string>();

      for (const skill of skills) {
        if (
          !skill.enabled ||
          skillNames.has(skill.name) ||
          (skill.hasTool && toolNames.has(skill.name)) ||
          (skill.orgId && !published.has(`skill:${skill.id}`))
        ) {
          throw new NakamaApiError(
            "Agent skill assignments are unavailable or conflicting.",
            409
          );
        }

        if (skill.orgId) {
          await this.validateSharedResourceSource(parentOrgId, {
            resourceId: skill.id,
            resourceKind: "skill",
          });
        }

        skillNames.add(skill.name);

        if (skill.hasTool) {
          toolNames.add(skill.name);
        }
      }

      try {
        const soulDir = getProfileSoulDir(parentOrgId, profile.id);
        await guardFilePath(soulDir, null, undefined, {
          allowedDirs: [getOrgConfigDir(parentOrgId)],
        });

        for (const dir of [
          getKnowledgeBaseDir(parentOrgId, profile.id),
          join(soulDir, "data", "knowledge-base"),
        ]) {
          await guardFilePath(dir, null, undefined, { allowedDirs: [soulDir] });
          await guardFilePath(
            getKnowledgeBaseManifestPath(dir),
            null,
            undefined,
            { allowedDirs: [dir] }
          );
        }

        const manifest = await readProfileManifestForReference(
          parentOrgId,
          profile.id
        );

        if (manifest.documents.length > 0) {
          throw new NakamaApiError(
            "Agent requires private profile knowledge.",
            409
          );
        }

        for (const documentId of manifest.sharedDocumentIds ?? []) {
          if (!published.has(`knowledge:${documentId}`)) {
            throw new NakamaApiError(
              "Agent knowledge assignment is unpublished.",
              409
            );
          }

          await this.validateSharedResourceSource(parentOrgId, {
            resourceId: documentId,
            resourceKind: "knowledge",
          });
        }
      } catch (error) {
        if (error instanceof NakamaApiError) {
          throw error;
        }

        throw new NakamaApiError("Agent knowledge is unavailable.", 404);
      }

      if (profile.model) {
        await this.validateSharedResourceSource(parentOrgId, {
          resourceId: profile.model,
          resourceKind: "model",
        });
      }
    } else if (request.resourceKind === "model") {
      const selected = resolveConfiguredModelInstance(
        await loadUserConfig(),
        resourceId,
        {
          invalid: "Select a configured model.",
          missingProvider: "The model provider is unavailable.",
        }
      );

      if (
        !(
          selected && modelExistsOnInstance(selected.instance, selected.modelId)
        )
      ) {
        throw new NakamaApiError("Select a configured model.", 400);
      }

      resourceId = `${selected.instance.id}::${selected.modelId}`;
      label = selected.modelId;
    } else if (request.resourceKind === "tool") {
      const tool = await this.databaseAdapter.getTool(request.resourceId);

      if (!tool || (tool.orgId && tool.orgId !== parentOrgId)) {
        throw new NakamaApiError("Tool is unavailable.", 404);
      }

      label = tool.name;
    } else if (request.resourceKind === "skill") {
      const skill = await this.databaseAdapter.getSkill(request.resourceId);

      if (!(skill && skill.enabled) || skill.orgId !== parentOrgId) {
        throw new NakamaApiError("Skill is unavailable.", 404);
      }

      label = skill.name;

      try {
        const profiles =
          await this.databaseAdapter.listProfilesForOrg(parentOrgId);

        const { resolved: sourcePath } = await guardFilePath(
          skill.sourcePath,
          null,
          undefined,
          {
            allowedDirs: [getOrgConfigDir(parentOrgId)],
          }
        );

        const owner = profiles.find(
          (profile) =>
            sourcePath ===
            resolveProfileSkillDirectory(parentOrgId, profile.id, skill.name)
        );

        if (!owner) {
          throw new NakamaApiError("Skill is unavailable.", 404);
        }

        const { resolved } = await guardFilePath(
          join(skill.sourcePath, SKILL_FILE_NAME),
          null,
          undefined,
          { allowedDirs: [skill.sourcePath] }
        );

        const parsed = parseSkillMarkdown(
          await readFile(resolved, "utf8"),
          resolved
        );

        if (parsed.frontmatter.name !== skill.name) {
          throw new NakamaApiError("Skill is unavailable.", 404);
        }
      } catch {
        throw new NakamaApiError("Skill is unavailable.", 404);
      }
    } else if (request.resourceKind === "knowledge") {
      const dir = getOrgKnowledgeBaseDir(parentOrgId);

      try {
        await guardFilePath(dir, null, undefined, {
          allowedDirs: [getOrgConfigDir(parentOrgId)],
        });
        await guardFilePath(
          getKnowledgeBaseManifestPath(dir),
          null,
          undefined,
          {
            allowedDirs: [dir],
          }
        );

        const documents =
          await listOrganizationKnowledgeBaseDocuments(parentOrgId);

        const document = documents.find(
          (entry) => entry.id === request.resourceId
        );

        if (!document || document.status !== "ready") {
          throw new NakamaApiError("Knowledge document is unavailable.", 404);
        }

        label = document.filename;

        const { resolved } = await guardFilePath(
          getKnowledgeBaseStoredDocumentPath(
            dir,
            document.id,
            document.filename
          ),
          null,
          undefined,
          { allowedDirs: [dir] }
        );

        if (!(await stat(resolved)).isFile()) {
          throw new NakamaApiError("Knowledge document is unavailable.", 404);
        }
      } catch {
        throw new NakamaApiError("Knowledge document is unavailable.", 404);
      }
    } else {
      throw new NakamaApiError("Unsupported publication kind.", 400);
    }

    return { label, resourceId };
  }

  async unpublishSharedResource(
    parentOrgId: string,
    publicationId: string,
    actorUserId: string
  ): Promise<boolean> {
    await this.requireParentAdmin(parentOrgId, actorUserId);

    return this.databaseAdapter.deleteOrgSharedResource(
      parentOrgId,
      publicationId
    );
  }

  async archiveOrganization(
    orgId: string,
    actorUserId?: string
  ): Promise<OrganizationSummary> {
    const org = await this.requireActiveOrganization(orgId);

    if (
      (await this.databaseAdapter.listOrganizations()).some(
        (child) => child.parentOrgId === orgId && !child.archivedAt
      )
    ) {
      throw new NakamaApiError(
        "Archive active teams before archiving their parent.",
        409
      );
    }

    if (actorUserId) {
      const memberships =
        await this.databaseAdapter.listUserOrganizations(actorUserId);

      const onlyMembership =
        memberships.length === 1 && memberships[0]?.organization.id === orgId;

      if (onlyMembership) {
        throw new NakamaApiError(LAST_MEMBERSHIP_MESSAGE, 409);
      }
    }

    const now = new Date().toISOString();

    if (
      (await this.databaseAdapter.listOrganizations()).filter(
        (entry) => !entry.archivedAt
      ).length <= 1
    ) {
      throw new NakamaApiError(LAST_ORGANIZATION_MESSAGE, 409);
    }

    const releaseAdmission = await this.beforeArchiveChannels?.(orgId);

    const archived = await this.databaseAdapter
      .tryMarkOrganizationArchived(orgId, now)
      .finally(() => releaseAdmission?.());

    if (!archived) {
      const current = await this.databaseAdapter.getOrganizationById(orgId);

      if (!current || current.archivedAt) {
        throw new NakamaApiError("Not found", 404);
      }

      throw new NakamaApiError(LAST_ORGANIZATION_MESSAGE, 409);
    }

    return toOrganizationSummary({
      ...org,
      archivedAt: now,
      updatedAt: now,
    });
  }

  async permanentlyDeleteOrganization(orgId: string): Promise<void> {
    const organization = await this.databaseAdapter.getOrganizationById(orgId);

    if (!organization) {
      throw new NakamaApiError("Not found", 404);
    }

    if (!organization.archivedAt) {
      throw new NakamaApiError(
        "Archive the organization before deleting it permanently.",
        409
      );
    }

    if (
      (await this.databaseAdapter.listOrganizations()).some(
        (child) => child.parentOrgId === orgId
      )
    ) {
      throw new NakamaApiError(
        "Delete teams before deleting their parent.",
        409
      );
    }

    for (const platform of [
      "telegram",
      "discord",
      "whatsapp",
      "slack",
      "teams",
    ] as const) {
      for (const owner of await listChannelOwners(platform)) {
        if (owner.orgId === orgId) {
          await removeChannelConnection(platform, owner);
        }
      }
    }

    // Keep the database row available for a safe retry if disk cleanup fails.
    await rm(getOrgConfigDir(orgId), { force: true, recursive: true });
    await deleteOrgToolCredentials(orgId, this.databaseAdapter);
    await rm(join(getUserConfigDir(), "retired-app-users", orgId), {
      force: true,
      recursive: true,
    });
    const deleted = await this.databaseAdapter.deleteOrganization(orgId);

    if (!deleted) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async updateOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationSummary> {
    const org = await this.requireActiveOrganization(orgId);

    const name = request.name === undefined ? org.name : request.name.trim();

    if (request.name !== undefined && !name) {
      throw new NakamaApiError("Organization name is required.", 400);
    }

    const now = new Date().toISOString();

    const monthlyLlmTokenLimit =
      request.monthlyLlmTokenLimit === undefined
        ? (org.monthlyLlmTokenLimit ?? 0)
        : request.monthlyLlmTokenLimit;

    const monthlyLlmTurnLimit =
      request.monthlyLlmTurnLimit === undefined
        ? (org.monthlyLlmTurnLimit ?? 0)
        : request.monthlyLlmTurnLimit;

    const monthlyLlmWarningPercent =
      request.monthlyLlmWarningPercent === undefined
        ? (org.monthlyLlmWarningPercent ?? 80)
        : request.monthlyLlmWarningPercent;

    assertMonthlyLlmTurnLimit(monthlyLlmTokenLimit);
    assertMonthlyLlmTurnLimit(monthlyLlmTurnLimit);

    if (
      !Number.isInteger(monthlyLlmWarningPercent) ||
      monthlyLlmWarningPercent < 1 ||
      monthlyLlmWarningPercent > 99
    ) {
      throw new NakamaApiError(
        "Monthly LLM warning percent must be an integer from 1 to 99.",
        400
      );
    }

    const skillsCuratorStaleAfterDays =
      request.skillsCuratorStaleAfterDays === undefined
        ? (org.skillsCuratorStaleAfterDays ?? 30)
        : request.skillsCuratorStaleAfterDays;

    const skillsCuratorArchiveAfterDays =
      request.skillsCuratorArchiveAfterDays === undefined
        ? (org.skillsCuratorArchiveAfterDays ?? 90)
        : request.skillsCuratorArchiveAfterDays;

    assertSkillCuratorFreshnessClocks(
      skillsCuratorStaleAfterDays,
      skillsCuratorArchiveAfterDays
    );

    const updated: StoredOrganizationRecord = {
      ...org,
      allowedInviteDomains:
        request.allowedInviteDomains === undefined
          ? (org.allowedInviteDomains ?? [])
          : normalizeAllowedInviteDomains(request.allowedInviteDomains),
      monthlyLlmTokenLimit,
      monthlyLlmTurnLimit,
      monthlyLlmWarningPercent,
      name,
      skillsCuratorArchiveAfterDays,
      skillsCuratorConsolidateEnabled:
        request.skillsCuratorConsolidateEnabled === undefined
          ? (org.skillsCuratorConsolidateEnabled ?? false)
          : request.skillsCuratorConsolidateEnabled,
      skillsCuratorEnabled:
        request.skillsCuratorEnabled === undefined
          ? (org.skillsCuratorEnabled ?? false)
          : request.skillsCuratorEnabled,
      skillsCuratorLastRunAt: org.skillsCuratorLastRunAt ?? null,
      skillsCuratorStaleAfterDays,
      skillsPostTurnReview:
        request.skillsPostTurnReview === undefined
          ? (org.skillsPostTurnReview ?? false)
          : request.skillsPostTurnReview,
      skillsWriteApproval:
        request.skillsWriteApproval === undefined
          ? (org.skillsWriteApproval ?? false)
          : request.skillsWriteApproval,
      updatedAt: now,
    };

    await this.databaseAdapter.upsertOrganization(updated);

    return toOrganizationSummary(updated);
  }

  async markSkillsCuratorRan(orgId: string, ranAt: string): Promise<void> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);

    if (!org) {
      throw new NakamaApiError("Not found", 404);
    }

    await this.databaseAdapter.upsertOrganization({
      ...org,
      skillsCuratorLastRunAt: ranAt,
      updatedAt: ranAt,
    });
  }

  async listSkillCuratorOrgs(): Promise<
    Array<{
      id: string;
      skillsCuratorEnabled: boolean;
      skillsCuratorLastRunAt: string | null;
    }>
  > {
    const organizations = await this.databaseAdapter.listOrganizations();

    return organizations
      .filter((org) => org.skillsCuratorEnabled && !org.archivedAt)
      .map((org) => ({
        id: org.id,
        skillsCuratorEnabled: true,
        skillsCuratorLastRunAt: org.skillsCuratorLastRunAt ?? null,
      }));
  }

  async createOrganization(
    request: CreateOrganizationRequest,
    creatorUserId?: string
  ): Promise<CreateOrganizationResponse> {
    const organization = await this.insertOrganization(request);

    if (request.admin) {
      const adminMember = await this.addMember({
        email: request.admin.email,
        name: request.admin.name,
        orgId: organization.id,
        phone: request.admin.phone,
        role: "admin",
      });

      return { adminMember, organization };
    }

    if (creatorUserId) {
      const creator = await this.databaseAdapter.getUserById(creatorUserId);

      if (creator) {
        const now = new Date().toISOString();
        await this.databaseAdapter.upsertOrgMember({
          createdAt: now,
          orgId: organization.id,
          role: "admin",
          userId: creator.id,
        });

        return {
          adminMember: {
            member: toOrgMemberSummary(creator, "admin", now),
            temporaryPassword: null,
          },
          organization,
        };
      }
    }

    return { organization };
  }

  async createTeam(
    parentOrgId: string,
    request: CreateTeamRequest,
    creatorUserId: string
  ): Promise<CreateOrganizationResponse> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId)) {
      throw new NakamaApiError("Invalid team request ID.", 400);
    }

    const name = request.name.trim();
    const slug = request.slug.trim().toLowerCase();

    if (!(name && SLUG_PATTERN.test(slug))) {
      throw new NakamaApiError("Invalid team name or slug.", 400);
    }

    const adminUserId = request.adminUserId ?? creatorUserId;

    const requestHash = createHash("sha256")
      .update(JSON.stringify({ adminUserId, name, slug }))
      .digest("hex");

    return await teamCreationLock.withLock(
      JSON.stringify([parentOrgId, request.requestId]),
      async () => {
        await this.requireParentAdmin(parentOrgId, creatorUserId);

        const previous = await this.databaseAdapter.getOrgTeamCreation(
          parentOrgId,
          request.requestId
        );

        if (
          previous &&
          (previous.requestHash !== requestHash ||
            previous.creatorUserId !== creatorUserId)
        ) {
          throw new NakamaApiError(
            "Team request already has another result.",
            409
          );
        }

        const admin = await this.databaseAdapter.getUserById(adminUserId);

        if (!admin || admin.disabledAt) {
          throw new NakamaApiError("Team admin is unavailable.", 400);
        }

        const organization = previous
          ? await this.databaseAdapter.getOrganizationById(previous.teamOrgId)
          : {
              ...(await this.buildOrganizationRecord({ name, slug })),
              parentOrgId,
            };

        if (!organization || organization.parentOrgId !== parentOrgId) {
          throw new NakamaApiError("Team is unavailable.", 404);
        }

        const pending = await this.databaseAdapter.beginOrgTeamCreation({
          adminUserId,
          creatorUserId,
          organization: { ...organization, parentOrgId },
          requestHash,
          requestId: request.requestId,
        });

        if (!pending.completedAt) {
          try {
            await this.seedOrgProfiles(organization.id);
            await ensureLocalClientAccess(this.databaseAdapter);

            if (
              !(await this.databaseAdapter.completeOrgTeamCreation(
                parentOrgId,
                request.requestId,
                organization.id,
                new Date().toISOString()
              ))
            ) {
              throw new NakamaApiError("Team setup could not complete.", 409);
            }
          } catch (error) {
            // Keep the pending request if disk cleanup fails, so a retry can recover it.
            await rm(getOrgConfigDir(organization.id), {
              force: true,
              recursive: true,
            });
            await deleteOrgToolCredentials(
              organization.id,
              this.databaseAdapter
            );
            await this.databaseAdapter.abortOrgTeamCreation(
              parentOrgId,
              request.requestId,
              organization.id
            );
            throw error;
          }
        }

        const ready = await this.requireActiveOrganization(organization.id);

        return {
          adminMember: {
            member: toOrgMemberSummary(admin, "admin", pending.createdAt),
            temporaryPassword: null,
          },
          organization: toOrganizationSummary(ready),
        };
      }
    );
  }

  async listUserOrgs(userId: string): Promise<ListUserOrgsResponse> {
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);

    return {
      orgs: memberships.map((membership) => ({
        ...toOrganizationSummary(membership.organization),
        role: membership.role,
      })),
    };
  }

  async resolveActiveOrgId(
    userId: string,
    sessionId?: string,
    requestedOrgId?: string | null
  ): Promise<string | null> {
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);

    const user = await this.databaseAdapter.getUserById(userId);
    const trimmed = requestedOrgId?.trim();

    const matched = trimmed
      ? memberships.find((membership) => membership.organization.id === trimmed)
      : undefined;

    const platformOrg =
      !matched && trimmed && user?.isPlatformAdmin
        ? await this.databaseAdapter.getOrganizationById(trimmed)
        : null;

    const activeOrgId =
      matched?.organization.id ??
      (platformOrg && !platformOrg.archivedAt ? platformOrg.id : null) ??
      memberships[0]?.organization.id ??
      (user?.isPlatformAdmin
        ? (await this.databaseAdapter.listOrganizations()).find(
            (org) => !org.archivedAt
          )?.id
        : null) ??
      null;

    if (sessionId && activeOrgId !== (trimmed ?? null)) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(
        sessionId,
        activeOrgId
      );
    }

    return activeOrgId;
  }

  async setActiveOrg(input: {
    userId: string;
    orgId: string;
    sessionId?: string;
  }): Promise<OrganizationSummary & { role?: OrgRole }> {
    const memberships = await this.databaseAdapter.listUserOrganizations(
      input.userId
    );

    const membership = memberships.find(
      (record) => record.organization.id === input.orgId
    );

    const user = await this.databaseAdapter.getUserById(input.userId);

    if (!(membership || user?.isPlatformAdmin)) {
      throw new NakamaApiError("Not found", 404);
    }

    const organization = await this.requireActiveOrganization(input.orgId);

    if (input.sessionId) {
      await this.databaseAdapter.updateBrowserSessionActiveOrgId(
        input.sessionId,
        organization.id
      );
    }

    const summary: OrganizationSummary & { role?: OrgRole } =
      toOrganizationSummary(organization);

    if (membership) {
      summary.role = membership.role;
    }

    return summary;
  }

  async buildAuthUserResponse(
    user: StoredUserRecord,
    sessionId?: string,
    requestedOrgId?: string | null
  ): Promise<AuthUserResponse> {
    const activeOrgId = await this.resolveActiveOrgId(
      user.id,
      sessionId,
      requestedOrgId
    );

    const activeMember = activeOrgId
      ? await this.databaseAdapter.getOrgMember(activeOrgId, user.id)
      : null;

    const mfaPolicy = await loadMfaPolicy();

    const passkeyEnabled =
      (await this.databaseAdapter.listPasskeys(user.id)).length > 0;

    const backupCodesEnabled =
      (await this.databaseAdapter.countUnusedMfaBackupCodes(user.id)) > 0;

    return {
      activeOrgId,
      backupCodesEnabled,
      email: user.email,
      id: user.id,
      isPlatformAdmin: Boolean(user.isPlatformAdmin),
      mfaEnabled: Boolean(user.mfaEnabled),
      mfaEnrolled: Boolean(
        (user.mfaEnabled && user.mfaTotpSecretEnc) || passkeyEnabled
      ),
      // Mirrors isPendingBrowserMfa: platform admins are covered by a required
      // policy even when they hold no membership in the active organization.
      mfaRequired:
        mfaPolicy.enabled &&
        mfaPolicy.required &&
        (Boolean(user.isPlatformAdmin) ||
          (activeMember
            ? mfaPolicy.enforcedRoles.includes(activeMember.role)
            : false)),
      name: user.name ?? null,
      orgId: activeOrgId,
      passkeyEnabled,
      phone: user.phone ?? null,
    };
  }

  async updateOwnProfile(
    userId: string,
    input: {
      currentPassword?: string;
      name?: string | null;
      email?: string;
      phone?: string | null;
    }
  ): Promise<AuthUserResponse> {
    const user = await this.databaseAdapter.getUserById(userId);

    if (!user) {
      throw new NakamaApiError("Authentication required", 401);
    }

    const now = new Date().toISOString();

    const name =
      input.name === undefined
        ? (user.name ?? null)
        : normalizeOptionalName(input.name);

    const phone =
      input.phone === undefined
        ? (user.phone ?? null)
        : normalizeOptionalPhone(input.phone);

    let email = user.email;

    if (input.email !== undefined) {
      email = normalizeEmail(input.email);

      if (!EMAIL_PATTERN.test(email)) {
        throw new NakamaApiError("A valid email address is required.", 400);
      }

      if (email !== user.email) {
        const validPassword = await this.authService.verifyPassword(
          input.currentPassword?.trim() ?? "",
          user.passwordHash
        );

        if (!validPassword) {
          throw new NakamaApiError("Current password is incorrect.", 401);
        }

        const existing = await this.databaseAdapter.getUserByEmail(email);

        if (existing && existing.id !== user.id) {
          throw new NakamaApiError(
            "An account with that email already exists.",
            409
          );
        }
      }
    }

    if (user.name !== name || user.phone !== phone || user.email !== email) {
      const update = { name, phone };

      if (email !== user.email) {
        Object.assign(update, { email });
      }

      await this.databaseAdapter.updateUserProfile(userId, update, now);
    }

    return this.buildAuthUserResponse({
      ...user,
      email,
      name,
      phone,
      updatedAt: now,
    });
  }

  async addMember(input: {
    orgId: string;
    name: string;
    email: string;
    phone: string;
    role: OrgRole;
  }): Promise<AddOrgMemberResponse> {
    await this.requireActiveOrganization(input.orgId);

    const name = input.name.trim();
    const email = normalizeEmail(input.email);
    const phone = normalizeOptionalPhone(input.phone);

    assertMemberName(name);

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    if (!ORG_ROLES.includes(input.role)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const now = new Date().toISOString();
    const existingUser = await this.databaseAdapter.getUserByEmail(email);

    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(
        input.orgId,
        existingUser.id
      );

      if (member) {
        throw new NakamaApiError(
          "User is already a member of this organization.",
          409
        );
      }

      await this.databaseAdapter.upsertOrgMember({
        createdAt: now,
        orgId: input.orgId,
        role: input.role,
        userId: existingUser.id,
      });

      return {
        member: toOrgMemberSummary(existingUser, input.role, now),
        temporaryPassword: null,
      };
    }

    const temporaryPassword = generateTemporaryPassword();

    const user: StoredUserRecord = {
      createdAt: now,
      email,
      id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      passwordHash: await this.authService.hashPassword(temporaryPassword),
      phone,
      updatedAt: now,
    };

    await this.databaseAdapter.createUser(user);
    await this.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: input.orgId,
      role: input.role,
      userId: user.id,
    });

    return {
      member: toOrgMemberSummary(user, input.role, now),
      temporaryPassword,
    };
  }

  async bootstrapInitialSetup(input: {
    organization: { name: string; slug: string };
    admin: {
      name: string;
      email: string;
      phone: string;
      passwordHash: string;
    };
  }): Promise<{ user: StoredUserRecord; organization: OrganizationSummary }> {
    // Validate before the insert: a rejected admin used to leave the org behind,
    // and the retry then failed on the slug it had just taken.
    const name = input.admin.name.trim();
    const email = normalizeEmail(input.admin.email);
    const phone = normalizeOptionalPhone(input.admin.phone);

    if (!name) {
      throw new NakamaApiError("Admin name is required.", 400);
    }

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    const organization = await this.buildOrganizationRecord(input.organization);
    const now = new Date().toISOString();

    const user: StoredUserRecord = {
      createdAt: now,
      email,
      id: "user_admin",
      isPlatformAdmin: true,
      name,
      passwordHash: input.admin.passwordHash,
      phone,
      updatedAt: now,
    };

    // One transaction, so a second concurrent setup that also passed the
    // route's human-user check loses here instead of committing an org it
    // can never become a member of.
    const claimed = await this.databaseAdapter.bootstrapInitialSetup({
      member: {
        createdAt: now,
        orgId: organization.id,
        role: "admin",
        userId: user.id,
      },
      organization,
      user,
    });

    if (!claimed) {
      throw new NakamaApiError("Admin user already exists", 409);
    }

    await this.seedOrgProfiles(organization.id);
    await ensureLocalClientAccess(this.databaseAdapter);

    return { organization: toOrganizationSummary(organization), user };
  }

  async listParentMembers(teamId: string): Promise<ListOrgMembersResponse> {
    const team = await this.requireActiveOrganization(teamId);

    if (!team.parentOrgId) {
      throw new NakamaApiError("Not found", 404);
    }

    const [parent, inTeam] = await Promise.all([
      this.listMembers(team.parentOrgId),
      this.databaseAdapter.listOrgMembers(teamId),
    ]);

    const taken = new Set(inTeam.map((record) => record.userId));

    return {
      members: parent.members
        .filter((member) => !taken.has(member.userId))
        .map((member) => ({ ...member, phone: null })),
    };
  }

  async listMembers(orgId: string): Promise<ListOrgMembersResponse> {
    const org = await this.databaseAdapter.getOrganizationById(orgId);

    if (!org) {
      throw new NakamaApiError("Not found", 404);
    }

    const records = await this.databaseAdapter.listOrgMembers(orgId);
    const members: OrgMemberSummary[] = [];

    for (const record of records) {
      if (record.userId === LOCAL_CLIENT_USER_ID) {
        continue;
      }

      const user = await this.databaseAdapter.getUserById(record.userId);

      if (!user) {
        continue;
      }

      members.push(toOrgMemberSummary(user, record.role, record.createdAt));
    }

    return { members };
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserId(userId);
    await this.requireActiveOrganization(orgId);
    await this.assertCanChangeAdminMembership(orgId, userId);

    const deleted = await this.databaseAdapter.deleteOrgMember(orgId, userId);

    if (!deleted) {
      // The delete carries the last-admin guard, so a concurrent change between
      // the check above and here lands here rather than emptying the org.
      await this.assertCanChangeAdminMembership(orgId, userId);
      throw new NakamaApiError("Not found", 404);
    }

    // The org middleware stops org routes for a non-member, but the cookie stays
    // valid on /v1/auth/* until it expires. Revoke like changePassword does: all
    // of the user's sessions, so a multi-org user re-authenticates rather than
    // keeping a session whose active org they were just removed from.
    await this.databaseAdapter.revokeBrowserSessionsForUser(
      userId,
      new Date().toISOString()
    );
  }

  async disableMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserId(userId);
    await this.requireActiveOrganization(orgId);

    const member = await this.databaseAdapter.getOrgMember(orgId, userId);

    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    // disabled_at is install-wide, not per-org, so this has to check every org
    // the user administers, not just the org named in the URL: a user can be
    // a plain member of orgId while being the sole admin of a different org,
    // and disabling never touches org_members rows, so assertCanChangeAdminMembership
    // (which only looks at one org) would miss that entirely.
    const memberships =
      await this.databaseAdapter.listUserOrganizations(userId);

    const adminMemberships = memberships.filter(
      (membership) => membership.role === "admin"
    );

    for (const membership of adminMemberships) {
      const members = await this.databaseAdapter.listOrgMembers(
        membership.organization.id
      );

      const otherAdmins = members.filter(
        (entry) => entry.role === "admin" && entry.userId !== userId
      );

      const otherAdminUsers = await Promise.all(
        otherAdmins.map((entry) =>
          this.databaseAdapter.getUserById(entry.userId)
        )
      );

      const hasUsableAdmin = otherAdminUsers.some(
        (user) => user && !user.disabledAt
      );

      if (!hasUsableAdmin) {
        throw new NakamaApiError(
          "Cannot disable the last active admin of an organization.",
          409
        );
      }
    }

    // Same shape as the org-admin check: is_platform_admin is also install-wide
    // and unrelated to org membership, so a platform admin who is a plain
    // member (or not a member) everywhere would otherwise slip past the loop
    // above and could be the install's only platform admin.
    const targetUser = await this.databaseAdapter.getUserById(userId);

    if (targetUser?.isPlatformAdmin) {
      const platformAdmins =
        await this.databaseAdapter.listPlatformAdminUsers();

      const hasUsablePlatformAdmin = platformAdmins.some(
        (admin) => admin.id !== userId && !admin.disabledAt
      );

      if (!hasUsablePlatformAdmin) {
        throw new NakamaApiError(
          "Cannot disable the last active platform admin.",
          409
        );
      }
    }

    const now = new Date().toISOString();
    await this.databaseAdapter.disableUser(userId, now);
    await this.databaseAdapter.revokeBrowserSessionsForUser(userId, now);
  }

  async enableMember(orgId: string, userId: string): Promise<void> {
    assertOrgMemberUserId(userId);
    await this.requireActiveOrganization(orgId);

    const member = await this.databaseAdapter.getOrgMember(orgId, userId);

    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    await this.databaseAdapter.enableUser(userId);
  }

  /**
   * Remove login, membership and per-user integration data while retaining an
   * anonymous user anchor. Chat messages and shared artifacts are org records,
   * so they stay intact without retaining the erased person's identity.
   */
  async eraseUser(userId: string, actorUserId: string): Promise<void> {
    assertOrgMemberUserId(userId);

    if (userId === actorUserId) {
      throw new NakamaApiError("You cannot erase your own account.", 409);
    }

    const user = await this.databaseAdapter.getUserById(userId);

    if (!user) {
      throw new NakamaApiError("Not found", 404);
    }

    const updatedAt = new Date().toISOString();

    const erased = await this.databaseAdapter.eraseUser({
      email: `erased-${crypto.randomUUID()}@deleted.invalid`,
      id: userId,
      passwordHash: await this.authService.hashPassword(crypto.randomUUID()),
      updatedAt,
    });

    if (!erased) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async updateMember(
    orgId: string,
    userId: string,
    input: UpdateOrgMemberRequest
  ): Promise<OrgMemberResponse> {
    await this.requireActiveOrganization(orgId);

    const nextRole = input.role;

    if (nextRole !== undefined && !ORG_ROLES.includes(nextRole)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const member = await this.assertCanChangeAdminMembership(
      orgId,
      userId,
      nextRole
    );

    const user = await this.databaseAdapter.getUserById(userId);

    if (!user) {
      throw new NakamaApiError("Not found", 404);
    }

    const now = new Date().toISOString();

    const name =
      input.name === undefined
        ? (user.name ?? null)
        : normalizeOptionalName(input.name);

    const phone =
      input.phone === undefined
        ? (user.phone ?? null)
        : normalizeOptionalPhone(input.phone);

    const role = nextRole ?? member.role;

    if (user.name !== name || user.phone !== phone) {
      await this.databaseAdapter.updateUserProfile(
        userId,
        { name, phone },
        now
      );
    }

    if (member.role !== role) {
      const updated = await this.databaseAdapter.updateOrgMemberRole(
        orgId,
        userId,
        role
      );

      if (!updated) {
        await this.assertCanChangeAdminMembership(orgId, userId, role);
        throw new NakamaApiError("Not found", 404);
      }
    }

    return {
      member: toOrgMemberSummary(
        { ...user, name, phone, updatedAt: now },
        role,
        member.createdAt
      ),
    };
  }

  async createInvite(input: {
    orgId: string;
    email: string;
    role: OrgRole;
    invitedByUserId: string;
  }): Promise<OrgInviteCreatedResponse> {
    const organization = await this.requireActiveOrganization(input.orgId);

    const email = normalizeEmail(input.email);

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    assertAllowedInviteDomain(email, organization);

    if (!ORG_ROLES.includes(input.role)) {
      throw new NakamaApiError("Invalid org role.", 400);
    }

    const existingUser = await this.databaseAdapter.getUserByEmail(email);

    if (existingUser) {
      const member = await this.databaseAdapter.getOrgMember(
        input.orgId,
        existingUser.id
      );

      if (member) {
        throw new NakamaApiError(
          "User is already a member of this organization.",
          409
        );
      }
    }

    const pendingInvite = await this.databaseAdapter.getPendingOrgInvite(
      input.orgId,
      email
    );

    if (pendingInvite) {
      throw new NakamaApiError(
        "An invite is already pending for this email.",
        409
      );
    }

    const now = new Date();
    const token = generateInviteToken();

    const record: StoredOrgInviteRecord = {
      acceptedAt: null,
      createdAt: now.toISOString(),
      email,
      expiresAt: new Date(
        now.getTime() + ORG_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      id: `invite_${crypto.randomUUID().replace(/-/g, "")}`,
      invitedByUserId: input.invitedByUserId,
      orgId: input.orgId,
      revokedAt: null,
      role: input.role,
      tokenHash: this.authService.hashToken(token),
    };

    await this.databaseAdapter.createOrgInvite(record);

    const webPublicUrl = this.getWebPublicUrl();

    const acceptInstruction = webPublicUrl
      ? `Accept your invitation: ${webPublicUrl}/accept-invite?token=${encodeURIComponent(token)}`
      : `Invitation token: ${token}`;

    const delivery = await this.email.send({
      orgId: input.orgId,
      subject: `You're invited to ${organization.name}`,
      text: [
        `You've been invited to join ${organization.name} as ${input.role}.`,
        "",
        acceptInstruction,
        "",
        `This invitation expires on ${record.expiresAt}.`,
      ].join("\n"),
      to: email,
    });

    return {
      delivered: delivery.ok,
      invite: toOrgInviteSummary(record),
      token: delivery.ok ? null : token,
    };
  }

  async listInvites(orgId: string): Promise<ListOrgInvitesResponse> {
    await this.requireActiveOrganization(orgId);

    const records = await this.databaseAdapter.listPendingOrgInvites(
      orgId,
      new Date().toISOString()
    );

    return { invites: records.map(toOrgInviteSummary) };
  }

  async revokeInvite(orgId: string, inviteId: string): Promise<void> {
    await this.requireActiveOrganization(orgId);

    const revoked = await this.databaseAdapter.revokeOrgInvite(
      orgId,
      inviteId,
      new Date().toISOString()
    );

    if (!revoked) {
      throw new NakamaApiError("Not found", 404);
    }
  }

  async acceptInvite(request: AcceptOrgInviteRequest): Promise<{
    user: StoredUserRecord;
    orgId: string;
    role: OrgRole;
  }> {
    const token = request.token?.trim();

    if (!token) {
      throw new NakamaApiError("Invite token is required.", 400);
    }

    const invite = await this.databaseAdapter.getOrgInviteByTokenHash(
      this.authService.hashToken(token)
    );

    if (!invite) {
      throw new NakamaApiError("Not found", 404);
    }

    assertInviteUsable(invite);

    const organization = await this.requireActiveOrganization(invite.orgId);
    assertAllowedInviteDomain(invite.email, organization);

    const password = request.password?.trim();

    if (!password) {
      throw new NakamaApiError(
        "Password is required to accept an invite.",
        400
      );
    }

    assertNewPassword(password);

    const now = new Date().toISOString();
    let user = await this.databaseAdapter.getUserByEmail(invite.email);

    if (user) {
      const valid = await this.authService.verifyPassword(
        password,
        user.passwordHash
      );

      if (!valid) {
        throw new NakamaApiError("Invalid credentials", 401);
      }
    } else {
      user = {
        createdAt: now,
        email: invite.email,
        id: `user_${crypto.randomUUID().replace(/-/g, "")}`,
        passwordHash: await this.authService.hashPassword(password),
        updatedAt: now,
      };
      await this.databaseAdapter.createUser(user);
    }

    const existingMember = await this.databaseAdapter.getOrgMember(
      invite.orgId,
      user.id
    );

    if (existingMember) {
      throw new NakamaApiError(
        "User is already a member of this organization.",
        409
      );
    }

    await this.databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: invite.orgId,
      role: invite.role,
      userId: user.id,
    });
    await this.databaseAdapter.markOrgInviteAccepted(invite.id, now);

    return {
      orgId: invite.orgId,
      role: invite.role,
      user,
    };
  }

  async requestPasswordReset(
    requestedEmail: string,
    allowManualToken = false
  ): Promise<RequestPasswordResetResponse> {
    const email = normalizeEmail(requestedEmail);

    if (!EMAIL_PATTERN.test(email)) {
      throw new NakamaApiError("A valid email address is required.", 400);
    }

    const user = await this.databaseAdapter.getUserByEmail(email);

    if (!user) {
      // Match the successful-delivery shape so configured deployments do not
      // disclose whether an address has an account.
      return { delivered: true, token: null };
    }

    const now = new Date();
    const token = generatePasswordResetToken();

    const record: StoredPasswordResetTokenRecord = {
      consumedAt: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000
      ).toISOString(),
      id: `password_reset_${crypto.randomUUID().replace(/-/g, "")}`,
      tokenHash: this.authService.hashToken(token),
      userId: user.id,
    };

    await this.databaseAdapter.createPasswordResetToken(record);

    const webPublicUrl = this.getWebPublicUrl();

    const resetInstruction = webPublicUrl
      ? `Reset your password: ${webPublicUrl}/reset-password?token=${encodeURIComponent(token)}`
      : `Password reset token: ${token}`;

    const deliveryPromise = Promise.resolve().then(() =>
      this.email.send({
        subject: "Reset your Nakama password",
        text: [
          "A password reset was requested for your account.",
          "",
          resetInstruction,
          "",
          `This link expires on ${record.expiresAt}. If you did not request it, you can ignore this message.`,
        ].join("\n"),
        to: email,
      })
    );

    if (!allowManualToken) {
      // Public callers get a response independent of SMTP latency. The
      // adapter contains delivery errors, while this catch also protects
      // against an injected adapter rejecting unexpectedly.
      void deliveryPromise.catch(() => undefined);

      return { delivered: true, token: null };
    }

    const delivery = await deliveryPromise;

    return { delivered: delivery.ok, token: delivery.ok ? null : token };
  }

  async resetPassword(request: ResetPasswordRequest): Promise<void> {
    const token = request.token?.trim();

    if (!token) {
      throw new NakamaApiError("Password reset token is required.", 400);
    }

    const newPassword = request.newPassword?.trim() ?? "";
    assertNewPassword(newPassword);

    const consumed = await this.databaseAdapter.consumePasswordResetToken(
      this.authService.hashToken(token),
      await this.authService.hashPassword(newPassword),
      new Date().toISOString()
    );

    if (!consumed) {
      throw new NakamaApiError(
        "Password reset token is invalid or has expired.",
        400
      );
    }
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.databaseAdapter.getUserById(input.userId);

    if (!user) {
      throw new NakamaApiError("Authentication required", 401);
    }

    const currentPassword = input.currentPassword.trim();
    const newPassword = input.newPassword.trim();
    assertNewPassword(newPassword);

    const valid = await this.authService.verifyPassword(
      currentPassword,
      user.passwordHash
    );

    if (!valid) {
      throw new NakamaApiError("Current password is incorrect.", 401);
    }

    const now = new Date().toISOString();
    await this.databaseAdapter.updateUserPassword(
      user.id,
      await this.authService.hashPassword(newPassword),
      now
    );
    await this.databaseAdapter.revokeBrowserSessionsForUser(user.id, now);
  }

  private async assertCanChangeAdminMembership(
    orgId: string,
    userId: string,
    nextRole?: OrgRole
  ): Promise<{
    orgId: string;
    userId: string;
    role: OrgRole;
    createdAt: string;
  }> {
    const member = await this.databaseAdapter.getOrgMember(orgId, userId);

    if (!member) {
      throw new NakamaApiError("Not found", 404);
    }

    if (member.role !== "admin") {
      return member;
    }

    const members = await this.databaseAdapter.listOrgMembers(orgId);
    const admins = members.filter((entry) => entry.role === "admin");

    const adminUsers = await Promise.all(
      admins.map((entry) => this.databaseAdapter.getUserById(entry.userId))
    );

    // disabled_at is install-wide and does not touch org_members rows, so a raw
    // admin-row count still sees a disabled admin as usable coverage.
    const usableAdminCount = adminUsers.filter(
      (user) => user && !user.disabledAt
    ).length;

    if (usableAdminCount > 1) {
      return member;
    }

    if (nextRole !== undefined && nextRole !== "admin") {
      throw new NakamaApiError(
        "Cannot change role of the last org admin.",
        409
      );
    }

    if (nextRole === undefined) {
      throw new NakamaApiError("Cannot remove the last org admin.", 409);
    }

    return member;
  }

  private async buildOrganizationRecord(request: {
    name: string;
    slug: string;
  }): Promise<StoredOrganizationRecord> {
    const name = request.name.trim();
    const slug = request.slug.trim().toLowerCase();

    if (!name) {
      throw new NakamaApiError("Organization name is required.", 400);
    }

    if (!(slug && SLUG_PATTERN.test(slug))) {
      throw new NakamaApiError(
        "Organization slug must use lowercase letters, numbers, and hyphens.",
        400
      );
    }

    const existing = await this.databaseAdapter.getOrganizationBySlug(slug);

    if (existing) {
      throw new NakamaApiError("Organization slug already exists.", 409);
    }

    const now = new Date().toISOString();

    return {
      createdAt: now,
      id: `org_${crypto.randomUUID().replace(/-/g, "")}`,
      name,
      skillsCuratorArchiveAfterDays: 90,
      skillsCuratorStaleAfterDays: 30,
      slug,
      updatedAt: now,
    };
  }

  private async insertOrganization(
    request: CreateOrganizationRequest
  ): Promise<OrganizationSummary> {
    if (
      request.admin &&
      !(request.admin.name.trim() && request.admin.email.trim())
    ) {
      throw new NakamaApiError("Admin name and email are required.", 400);
    }

    const record = await this.buildOrganizationRecord(request);
    await this.databaseAdapter.upsertOrganization(record);
    await this.seedOrgProfiles(record.id);
    await ensureLocalClientAccess(this.databaseAdapter);

    return toOrganizationSummary(record);
  }

  private async seedOrgProfiles(orgId: string): Promise<void> {
    const defaultProfile = await seedOrgDefaultProfile(
      this.databaseAdapter,
      orgId
    );

    await initSoulDirectory(getProfileSoulDir(orgId, defaultProfile.id));

    const superNakamaProfile = await seedOrgSuperNakamaProfile(
      this.databaseAdapter,
      orgId,
      { grantBash: isTenantBashEnabled() }
    );

    await initSoulDirectory(getProfileSoulDir(orgId, superNakamaProfile.id));
  }
}

function assertMemberName(name: string): void {
  if (!name) {
    throw new NakamaApiError("Member name is required.", 400);
  }

  if (name.length > MAX_MEMBER_NAME_LENGTH) {
    throw new NakamaApiError("Member name is too long.", 400);
  }

  if (MEMBER_NAME_CONTROL_CHARS.test(name)) {
    throw new NakamaApiError("Member name contains invalid characters.", 400);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeAllowedInviteDomains<T>(input: T): string[] {
  if (!Array.isArray(input)) {
    throw new NakamaApiError("Allowed invite domains must be a list.", 400);
  }

  const domains = new Set<string>();

  for (const entry of input) {
    if (!isString(entry)) {
      throw new NakamaApiError("Invalid invite domain.", 400);
    }

    const domain = entry.trim().toLowerCase();

    if (!INVITE_DOMAIN_PATTERN.test(domain)) {
      throw new NakamaApiError("Invalid invite domain.", 400);
    }

    domains.add(domain);
  }

  return [...domains];
}

function assertAllowedInviteDomain(
  email: string,
  organization: StoredOrganizationRecord
): void {
  const domains = organization.allowedInviteDomains ?? [];

  if (domains.length > 0 && !domains.includes(email.split("@")[1] ?? "")) {
    throw new NakamaApiError("Email domain is not allowed.", 400);
  }
}

function normalizeOptionalPhone(
  phone: string | null | undefined
): string | null {
  const trimmed = phone?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  if (!PHONE_PATTERN.test(trimmed)) {
    throw new NakamaApiError("Enter a valid phone number.", 400);
  }

  return trimmed;
}

function normalizeOptionalName(name: string | null): string | null {
  const trimmed = name?.trim() ?? "";

  return trimmed || null;
}

function generateInviteToken(): string {
  return `tc_invite_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function generatePasswordResetToken(): string {
  return `tc_reset_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function assertInviteUsable(invite: StoredOrgInviteRecord): void {
  if (invite.acceptedAt) {
    throw new NakamaApiError("Invite has already been accepted.", 400);
  }

  if (invite.revokedAt) {
    throw new NakamaApiError("Invite is no longer valid.", 400);
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    throw new NakamaApiError("Invite has expired.", 400);
  }
}

function assertSkillCuratorFreshnessClocks(
  staleAfterDays: number,
  archiveAfterDays: number
): void {
  if (
    !(Number.isInteger(staleAfterDays) && Number.isInteger(archiveAfterDays)) ||
    staleAfterDays <= 0 ||
    archiveAfterDays <= 0 ||
    staleAfterDays >= archiveAfterDays ||
    archiveAfterDays > 3650
  ) {
    throw new NakamaApiError(
      "Skill curator days must be positive integers with stale before archive and archive at most 3650 days.",
      400
    );
  }
}

function assertMonthlyLlmTurnLimit(limit: number): void {
  if (!(Number.isInteger(limit) && limit >= 0 && limit <= 1_000_000)) {
    throw new NakamaApiError(
      "Monthly LLM turn limit must be an integer from 0 to 1000000.",
      400
    );
  }
}

function assertNewPassword(password: string): void {
  if (password.length < 8) {
    throw new NakamaApiError("Password must be at least 8 characters.", 400);
  }
}

function toOrganizationSummary(
  record: StoredOrganizationRecord
): OrganizationSummary {
  return {
    allowedInviteDomains: record.allowedInviteDomains ?? [],
    archivedAt: record.archivedAt ?? null,
    createdAt: record.createdAt,
    id: record.id,
    monthlyLlmTurnLimit: record.monthlyLlmTurnLimit ?? 0,
    name: record.name,
    parentOrgId: record.parentOrgId ?? null,
    skillsCuratorArchiveAfterDays: record.skillsCuratorArchiveAfterDays ?? 90,
    skillsCuratorConsolidateEnabled:
      record.skillsCuratorConsolidateEnabled ?? false,
    skillsCuratorEnabled: record.skillsCuratorEnabled ?? false,
    skillsCuratorLastRunAt: record.skillsCuratorLastRunAt ?? null,
    skillsCuratorStaleAfterDays: record.skillsCuratorStaleAfterDays ?? 30,
    skillsPostTurnReview: record.skillsPostTurnReview ?? false,
    skillsWriteApproval: record.skillsWriteApproval ?? false,
    slug: record.slug,
    updatedAt: record.updatedAt,
  };
}

function toOrgInviteSummary(record: StoredOrgInviteRecord): OrgInviteSummary {
  return {
    createdAt: record.createdAt,
    email: record.email,
    expiresAt: record.expiresAt,
    id: record.id,
    orgId: record.orgId,
    role: record.role,
  };
}

function toOrgMemberSummary(
  user: StoredUserRecord,
  role: OrgRole,
  createdAt: string
): OrgMemberSummary {
  return {
    createdAt,
    disabledAt: user.disabledAt ?? null,
    email: user.email,
    name: user.name ?? null,
    phone: user.phone ?? null,
    role,
    userId: user.id,
  };
}

function isString<T>(value: T): value is T & string {
  return Object.prototype.toString.call(value) === "[object String]";
}
