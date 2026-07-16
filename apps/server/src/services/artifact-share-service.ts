import crypto from "node:crypto";
import {
  NakamaApiError,
  buildArtifactSharePath,
  deleteArtifactShareSnapshot,
  generateArtifactShareToken,
  isBrowserExecutableArtifactMimeType,
  readArtifactFile,
  readArtifactShareSnapshot,
  writeArtifactShareSnapshot,
} from "@nakama/core";
import type {
  ArtifactShareStatusResponse,
  PublishArtifactShareResponse,
  PublicArtifactShareResponse,
  RevokeArtifactShareResponse,
} from "@nakama/core/contract";
import type { DatabaseAdapter, StoredArtifactShareRecord } from "@nakama/db";
import { resolveComposioCallbackBaseUrl } from "./composio-callback-url";
import type { AuthService } from "./auth-service";
import { ProfileService } from "./profile-service";

export class ArtifactShareService {
  private readonly profileService: ProfileService;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly authService: AuthService,
  ) {
    this.profileService = new ProfileService(db);
  }

  async publishArtifactShare(input: {
    orgId: string;
    profileId: string;
    sourcePath: string;
    userId: string;
    request?: Request;
  }): Promise<PublishArtifactShareResponse> {
    await this.requireProfile(input.orgId, input.profileId);

    const sourcePath = input.sourcePath.trim();
    if (!sourcePath) {
      throw new NakamaApiError("path is required.", 400);
    }

    const artifact = await readArtifactFile({
      orgId: input.orgId,
      profileId: input.profileId,
      filename: sourcePath,
    });

    const filename = sourcePath.split("/").pop() ?? "artifact";
    const existing = await this.db.getActiveArtifactShareByPath(
      input.orgId,
      input.profileId,
      sourcePath,
    );

    const now = new Date().toISOString();
    let record: StoredArtifactShareRecord;
    let token: string | null = null;
    let refreshed = false;

    if (existing) {
      refreshed = true;
      await deleteArtifactShareSnapshot(existing.storagePath);

      const storagePath = await writeArtifactShareSnapshot({
        orgId: input.orgId,
        shareId: existing.id,
        filename,
        bytes: artifact.bytes,
      });

      await this.db.updateArtifactShareSnapshot(existing.id, {
        filename,
        mimeType: artifact.contentType,
        sizeBytes: artifact.bytes.byteLength,
        storagePath,
      });

      record = {
        ...existing,
        filename,
        mimeType: artifact.contentType,
        sizeBytes: artifact.bytes.byteLength,
        storagePath,
      };
    } else {
      token = generateArtifactShareToken();
      const shareId = `share_${crypto.randomUUID().replace(/-/g, "")}`;
      const storagePath = await writeArtifactShareSnapshot({
        orgId: input.orgId,
        shareId,
        filename,
        bytes: artifact.bytes,
      });

      record = {
        id: shareId,
        orgId: input.orgId,
        profileId: input.profileId,
        sourcePath,
        filename,
        mimeType: artifact.contentType,
        sizeBytes: artifact.bytes.byteLength,
        tokenHash: this.authService.hashToken(token),
        storagePath,
        createdByUserId: input.userId,
        createdAt: now,
        revokedAt: null,
      };

      await this.db.createArtifactShare(record);
    }

    const baseUrl = resolveComposioCallbackBaseUrl({ request: input.request });
    const webPublicUrlConfigured = Boolean(baseUrl && !baseUrl.includes("127.0.0.1"));
    const shareUrl = token ? `${baseUrl}${buildArtifactSharePath(token)}` : null;

    return {
      id: record.id,
      token: token ?? "",
      shareUrl,
      sharePath: token ? buildArtifactSharePath(token) : "",
      webPublicUrlConfigured,
      refreshed,
    };
  }

  async getArtifactShareStatus(input: {
    orgId: string;
    profileId: string;
    sourcePath: string;
    request?: Request;
  }): Promise<ArtifactShareStatusResponse | null> {
    await this.requireProfile(input.orgId, input.profileId);

    const share = await this.db.getActiveArtifactShareByPath(
      input.orgId,
      input.profileId,
      input.sourcePath.trim(),
    );

    if (!share) {
      return null;
    }

    const baseUrl = resolveComposioCallbackBaseUrl({ request: input.request });
    const webPublicUrlConfigured = Boolean(baseUrl && !baseUrl.includes("127.0.0.1"));

    return {
      id: share.id,
      active: true,
      sharePath: "",
      shareUrl: null,
      webPublicUrlConfigured,
      createdAt: share.createdAt,
    };
  }

  async revokeArtifactShare(input: {
    orgId: string;
    profileId: string;
    shareId: string;
  }): Promise<RevokeArtifactShareResponse> {
    await this.requireProfile(input.orgId, input.profileId);

    const share = await this.db.getArtifactShareById(
      input.orgId,
      input.profileId,
      input.shareId,
    );

    if (!share || share.revokedAt) {
      throw new NakamaApiError("Not found", 404);
    }

    const revoked = await this.db.revokeArtifactShare(share.id, new Date().toISOString());
    if (revoked) {
      await deleteArtifactShareSnapshot(share.storagePath);
    }

    return { revoked, id: share.id };
  }

  async readPublicArtifactShare(token: string): Promise<{
    bytes: Buffer;
    metadata: PublicArtifactShareResponse;
  }> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new NakamaApiError("Not found", 404);
    }

    const share = await this.db.getArtifactShareByTokenHash(
      this.authService.hashToken(trimmed),
    );

    if (!share) {
      throw new NakamaApiError("Not found", 404);
    }

    const bytes = await readArtifactShareSnapshot(share.storagePath);
    const inlineAllowed = !isBrowserExecutableArtifactMimeType(share.mimeType);

    return {
      bytes,
      metadata: {
        filename: share.filename,
        mimeType: share.mimeType,
        sizeBytes: share.sizeBytes,
        inlineAllowed,
      },
    };
  }

  private async requireProfile(orgId: string, profileId: string): Promise<void> {
    const profile = await this.profileService.getProfile(orgId, profileId);
    if (!profile) {
      throw new NakamaApiError("Not found", 404);
    }
  }
}
