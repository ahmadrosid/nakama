import type { ProfileChangeEvent } from "@nakama/core";
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

function parseAssignmentIds(value: string | null): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) &&
      parsed.every((id): id is string => typeof id === "string")
      ? [...new Set<string>(parsed)]
      : null;
  } catch {
    return null;
  }
}

export async function describeProfileChangeEvents(
  db: DatabaseAdapter,
  orgId: string,
  events: StoredProfileChangeEvent[]
): Promise<ProfileChangeEvent[]> {
  const actors = new Map<string, Promise<string | null>>();
  const names = new Map<string, Promise<string | null>>();

  const itemName = (field: "skills" | "tools", id: string) => {
    const key = `${field}:${id}`;
    let name = names.get(key);
    if (!name) {
      name = (field === "skills" ? db.getSkill(id) : db.getTool(id)).then(
        (item) =>
          item && (!item.orgId || item.orgId === orgId) ? item.name : null
      );
      names.set(key, name);
    }
    return name;
  };

  return Promise.all(
    events.map(async (event): Promise<ProfileChangeEvent> => {
      let actorName: string | null = null;
      if (event.actorUserId) {
        let actor = actors.get(event.actorUserId);
        if (!actor) {
          actor = db
            .getUserById(event.actorUserId)
            .then((user) => user?.name?.trim() || null);
          actors.set(event.actorUserId, actor);
        }
        actorName = await actor;
      }
      const result: ProfileChangeEvent = { ...event, actorName };
      const field = event.field;
      if (field !== "skills" && field !== "tools") {
        return result;
      }
      const before = parseAssignmentIds(event.beforeValue);
      const after = parseAssignmentIds(event.afterValue);
      if (!(before && after)) {
        return result;
      }
      const beforeIds = new Set(before);
      const afterIds = new Set(after);
      result.assignmentNames = Object.fromEntries(
        await Promise.all(
          [...new Set([...before, ...after])].map(async (id) => [
            id,
            await itemName(field, id),
          ])
        )
      );
      const describe = async (id: string) => ({
        id,
        name: await itemName(field, id),
      });
      result.assignmentChanges = {
        added: await Promise.all(
          after.filter((id) => !beforeIds.has(id)).map(describe)
        ),
        removed: await Promise.all(
          before.filter((id) => !afterIds.has(id)).map(describe)
        ),
      };
      return result;
    })
  );
}

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
