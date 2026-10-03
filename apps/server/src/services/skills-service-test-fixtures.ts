import { type DatabaseAdapter, seedOrgDefaultProfile } from "@nakama/db";

export const ORG_ID = "org_test";

export async function seedSkillOrg(
  db: DatabaseAdapter,
  options: {
    orgSkillsWriteApproval?: boolean;
    profileSkillsWriteApproval?: boolean | null;
  } = {}
) {
  const now = new Date().toISOString();
  await db.upsertOrganization({
    createdAt: now,
    id: ORG_ID,
    name: "Test Org",
    skillsWriteApproval: options.orgSkillsWriteApproval ?? false,
    slug: "test-org",
    updatedAt: now,
  });
  const profile = await seedOrgDefaultProfile(db, ORG_ID);
  if (options.profileSkillsWriteApproval !== undefined) {
    await db.upsertProfile({
      ...profile,
      skillsWriteApproval: options.profileSkillsWriteApproval,
      updatedAt: now,
    });
  }
  return profile;
}
