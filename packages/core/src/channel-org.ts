import { dirname, join } from "node:path";
import type { ListUserOrgsResponse, UserOrgSummary } from "./contract";
import { readTextOrNull, writePrivateTextFile } from "./fs";
import { getUserConfigDir } from "./user-config";

export type ChannelOrgSelectionChannel = "telegram" | "whatsapp" | "discord";

export interface ChannelOrgRecord {
  orgId: string;
  updatedAt: string;
}

type ChannelOrgMap = Record<string, ChannelOrgRecord>;

export function getChannelOrgSelectionPath(
  channel: ChannelOrgSelectionChannel,
): string {
  return join(getUserConfigDir(), channel, "org-selection.json");
}

export class ChannelOrgStore {
  private readonly path: string;
  private map: ChannelOrgMap = {};

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    const raw = await readTextOrNull(this.path);

    if (raw === null) {
      this.map = {};
      return;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.map = {};
      return;
    }

    this.map = parsed as ChannelOrgMap;
  }

  get(channelUserId: string): ChannelOrgRecord | undefined {
    return this.map[channelUserId];
  }

  set(channelUserId: string, orgId: string): void {
    this.map[channelUserId] = {
      orgId,
      updatedAt: new Date().toISOString(),
    };
  }

  delete(channelUserId: string): void {
    delete this.map[channelUserId];
  }

  async save(): Promise<void> {
    await writePrivateTextFile(this.path, `${JSON.stringify(this.map, null, 2)}\n`, {
      ensureDir: dirname(this.path),
    });
  }
}

export function formatOrgSelectionPrompt(
  orgs: UserOrgSummary[],
  currentOrgId?: string | null,
): string {
  const current = currentOrgId
    ? orgs.find((org) => org.id === currentOrgId)
    : undefined;
  const lines = [
    "Choose an organization (reply with a number or slug):",
    "",
    ...orgs.map((org, index) => `${index + 1}. ${org.name} (${org.slug})`),
    "",
    current
      ? `Current: ${current.name}`
      : "Current: none selected",
    "",
    "/org — show this list again",
  ];

  return lines.join("\n");
}

export function findOrgBySelectionInput(
  input: string,
  orgs: UserOrgSummary[],
): UserOrgSummary | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith("/")) {
    return null;
  }

  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= orgs.length) {
    return orgs[index - 1] ?? null;
  }

  const normalized = trimmed.toLowerCase();
  return (
    orgs.find(
      (org) =>
        org.id === trimmed ||
        org.slug.toLowerCase() === normalized ||
        org.name.toLowerCase() === normalized,
    ) ?? null
  );
}

export function isOrgSelectionInput(input: string, orgCount: number): boolean {
  if (orgCount <= 1) {
    return false;
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith("/") || /\s/.test(trimmed)) {
    return false;
  }

  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= orgCount) {
    return true;
  }

  return trimmed.length > 0;
}

export type PrepareChannelOrgResult =
  | { status: "ready"; orgId: string; orgName: string; justSelected?: boolean }
  | { status: "prompt"; message: string }
  | { status: "empty" };

export async function prepareChannelOrgContext(options: {
  listOrgs: () => Promise<ListUserOrgsResponse>;
  getSelectedOrgId: () => string | undefined;
  saveSelectedOrgId: (orgId: string) => Promise<void>;
  text?: string;
}): Promise<PrepareChannelOrgResult> {
  const { orgs } = await options.listOrgs();

  if (orgs.length === 0) {
    return { status: "empty" };
  }

  if (orgs.length === 1) {
    const org = orgs[0]!;
    if (options.getSelectedOrgId() !== org.id) {
      await options.saveSelectedOrgId(org.id);
    }
    return { status: "ready", orgId: org.id, orgName: org.name };
  }

  const storedOrgId = options.getSelectedOrgId();
  const storedOrg = storedOrgId
    ? orgs.find((org) => org.id === storedOrgId)
    : undefined;

  const selectionInput = options.text?.trim();
  if (selectionInput) {
    const picked = findOrgBySelectionInput(selectionInput, orgs);
    if (picked) {
      await options.saveSelectedOrgId(picked.id);
      return {
        status: "ready",
        orgId: picked.id,
        orgName: picked.name,
        justSelected: true,
      };
    }
  }

  if (storedOrg) {
    return { status: "ready", orgId: storedOrg.id, orgName: storedOrg.name };
  }

  return {
    status: "prompt",
    message: formatOrgSelectionPrompt(orgs, storedOrgId),
  };
}

export function formatOrgSwitchConfirmation(orgName: string): string {
  return `Now using ${orgName}. Send /new to start a fresh conversation in this org.`;
}
