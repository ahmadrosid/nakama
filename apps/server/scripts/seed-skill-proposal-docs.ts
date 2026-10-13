/**
 * Seeds a demo org with one pending skill proposal. Run while the server is stopped.
 * - no args: a `create` proposal (capture-self-improving-skills-screenshots.sh)
 * - `version-history <profileId>`: a `patch` proposal on `campaign-reporting`
 *   (capture-skill-version-history-screenshots.sh)
 */
import { getUserConfigDir } from "@nakama/core";
import { createDatabase } from "@nakama/db";
import { SkillProposalService } from "../src/services/skill-proposal-service";
import { SkillsService } from "../src/services/skills-service";

const configDir = process.env.NAKAMA_CONFIG_DIR?.trim() || getUserConfigDir();

const database = await createDatabase("file:data/sqlite/nakama.sqlite", {
  baseDir: configDir,
});

const db = database.adapter;

const organizations = await db.listOrganizations();

const org = organizations[0];

if (!org) {
  throw new Error("No organization found — run auth setup first.");
}

const [mode, profileIdArg] = process.argv.slice(2);

const profiles = await db.listProfilesForOrg(org.id);

const profile = profileIdArg
  ? profiles.find((entry) => entry.id === profileIdArg)
  : profiles[0];

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

const result =
  mode === "version-history"
    ? await service.stageProposal({
        action: "patch",
        newString: [
          "3. Flag any campaign more than 20% under target.",
          "4. Suggest where to move its budget, with the expected ROAS.",
          "5. Write the summary in Acme's brand voice.",
          "6. Post the dashboard to #marketing-weekly.",
        ].join("\n"),
        oldString: [
          "3. Write the summary in Acme's brand voice.",
          "4. Post the dashboard to #marketing-weekly.",
        ].join("\n"),
        orgId: org.id,
        profileId: profile.id,
        skillName: "campaign-reporting",
      })
    : await service.stageProposal({
        action: "create",
        content: sampleSkillMarkdown,
        orgId: org.id,
        profileId: profile.id,
      });

if (result.outcome !== "created" && result.outcome !== "already_pending") {
  throw new Error(
    `Failed to seed skill proposal: ${result.message ?? result.outcome}`
  );
}

database.close();

console.log(
  `Seeded pending skill proposal for org ${org.id}, profile ${profile.id}`
);
