import { createId } from "@nakama/core";
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

const SOUL_CHANGE_FIELDS = {
  instructions: "soul.instructions",
  memory: "soul.memory",
  soul: "soul.soul",
  style: "soul.style",
} as const satisfies Record<string, ProfileChangeField>;

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
): Promise<StoredProfileChangeEvent> {
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
  return record;
}

export function assignmentIdsValue(ids: string[]): string {
  return JSON.stringify([...ids].sort());
}

/** Skip when meta is omitted or the sorted id set did not change. */
export async function recordAssignmentChange(
  db: DatabaseAdapter,
  input: {
    afterIds: string[];
    beforeIds: string[];
    field: "tools" | "skills" | "mcp";
    meta?: ProfileChangeMeta;
    orgId: string;
    profileId: string;
  }
): Promise<void> {
  if (!input.meta) {
    return;
  }
  const beforeValue = assignmentIdsValue(input.beforeIds);
  const afterValue = assignmentIdsValue(input.afterIds);
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
  return (
    (SOUL_CHANGE_FIELDS as Record<string, ProfileChangeField>)[key] ?? null
  );
}

export function soulFieldFromFileName(
  fileName: string
): ProfileChangeField | null {
  if (!fileName.endsWith(".md")) {
    return null;
  }
  return soulFieldFromKey(fileName.slice(0, -3).toLowerCase());
}
