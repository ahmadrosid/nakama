/**
 * Seeds a demo org with one pending skill proposal.
 * Used by docs/website/scripts/capture-self-improving-skills-screenshots.sh — run while the server is stopped.
 */
import { getUserConfigDir } from "@nakama/core";
import { createDatabase } from "@nakama/db";
import { SkillProposalService } from "../src/services/skill-proposal-service";
import { SkillsService } from "../src/services/skills-service";

const configDir = process.env.NAKAMA_CONFIG_DIR?.trim() || getUserConfigDir();
const database = await createDatabase("file:data/sqlite/nakama.sqlite", { baseDir: configDir });
const db = database.adapter;

const organizations = await db.listOrganizations();
const org = organizations[0];
if (!org) {
  throw new Error("No organization found — run auth setup first.");
}

const profiles = await db.listProfilesForOrg(org.id);
const profile = profiles[0];
if (!profile) {
  throw new Error("No profile found for organization.");
}

const service = new SkillProposalService(db, new SkillsService(db));
const sampleSkillMarkdown = `---
name: deploy-checklist
description: Run before every production deploy.
---

1. Run the test suite.
2. Review pending migrations.
3. Deploy to staging, then production.
`;

const result = await service.stageProposal({
  orgId: org.id,
  profileId: profile.id,
  action: "create",
  content: sampleSkillMarkdown,
});

if (result.outcome !== "created" && result.outcome !== "already_pending") {
  throw new Error(`Failed to seed skill proposal: ${result.message ?? result.outcome}`);
}

database.close();
console.log(`Seeded pending skill proposal for org ${org.id}, profile ${profile.id}`);
