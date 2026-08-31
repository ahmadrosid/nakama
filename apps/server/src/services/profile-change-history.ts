import { createId, isWritableSoulFileKey } from "@nakama/core";
import type {
  DatabaseAdapter,
  ProfileChangeField,
  ProfileChangeSource,
  StoredProfileChangeEvent,
} from "@nakama/db";

export type ProfileChangeMeta = {
  actorUserId?: string | null;
  source: ProfileChangeSource;
};

export async function recordProfileChangeEvent(
  db: DatabaseAdapter,
  input: {
    actorUserId?: string | null;
    afterValue: string | null;
    beforeValue: string | null;
    field: ProfileChangeField;
    orgId: string;
    profileId: string;
    source: ProfileChangeSource;
    createdAt?: string;
  }
): Promise<void> {
  const record: StoredProfileChangeEvent = {
    actorUserId: input.actorUserId?.trim() || null,
    afterValue: input.afterValue,
    beforeValue: input.beforeValue,
    createdAt: input.createdAt ?? new Date().toISOString(),
    field: input.field,
    id: createId("profile_change"),
    orgId: input.orgId,
    profileId: input.profileId,
    source: input.source,
  };

  await db.createProfileChangeEvent(record);
}

async function listAssignmentIds(
  db: DatabaseAdapter,
  profileId: string,
  field: "tools" | "skills" | "mcp"
): Promise<string[]> {
  switch (field) {
    case "tools":
      return (await db.listToolsForProfile(profileId)).map((entry) => entry.id);
    case "skills":
      return (await db.listSkillsForProfile(profileId)).map(
        (entry) => entry.id
      );
    case "mcp":
      return (await db.listMcpServersForProfile(profileId)).map(
        (entry) => entry.id
      );
  }
}

/** List ids before/after `mutate` when meta is present; skip when unchanged. */
export async function withAssignmentChange(
  db: DatabaseAdapter,
  input: {
    field: "tools" | "skills" | "mcp";
    meta?: ProfileChangeMeta;
    orgId: string;
    profileId: string;
  },
  mutate: () => Promise<void>
): Promise<void> {
  const beforeIds = input.meta
    ? await listAssignmentIds(db, input.profileId, input.field)
    : [];
  await mutate();
  if (!input.meta) {
    return;
  }
  const afterIds = await listAssignmentIds(db, input.profileId, input.field);
  const beforeValue = JSON.stringify([...beforeIds].sort());
  const afterValue = JSON.stringify([...afterIds].sort());
  if (beforeValue === afterValue) {
    return;
  }
  await recordProfileChangeEvent(db, {
    actorUserId: input.meta.actorUserId,
    afterValue,
    beforeValue,
    field: input.field,
    orgId: input.orgId,
    profileId: input.profileId,
    source: input.meta.source,
  });
}

export function soulFieldFromKey(key: string): ProfileChangeField | null {
  if (!isWritableSoulFileKey(key)) {
    return null;
  }
  return `soul.${key}` as ProfileChangeField;
}

export function soulFieldFromFileName(
  fileName: string
): ProfileChangeField | null {
  if (!fileName.endsWith(".md")) {
    return null;
  }
  return soulFieldFromKey(fileName.slice(0, -3).toLowerCase());
}
