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

export function soulFieldFromFileName(
  fileName: string
): ProfileChangeField | null {
  switch (fileName) {
    case "SOUL.md":
      return "soul.soul";
    case "STYLE.md":
      return "soul.style";
    case "INSTRUCTIONS.md":
      return "soul.instructions";
    case "MEMORY.md":
      return "soul.memory";
    default:
      return null;
  }
}

export function soulFieldFromKey(key: string): ProfileChangeField | null {
  switch (key) {
    case "soul":
      return "soul.soul";
    case "style":
      return "soul.style";
    case "instructions":
      return "soul.instructions";
    case "memory":
      return "soul.memory";
    default:
      return null;
  }
}
