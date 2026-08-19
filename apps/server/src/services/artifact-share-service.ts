import crypto from "node:crypto";
import {
  buildArtifactSharePath,
  deleteArtifactShareSnapshot,
  generateArtifactShareToken,
  isBrowserExecutableArtifactMimeType,
  NakamaApiError,
  readArtifactFile,
  readArtifactShareSnapshot,
  resolveArtifactMimeType,
  resolveWebPublicUrl,
  writeArtifactShareSnapshot,
} from "@nakama/core";
import type {
  ArtifactShareStatusResponse,
  PublicArtifactShareResponse,
  PublishArtifactShareResponse,
  RevokeArtifactShareResponse,
} from "@nakama/core/contract";
import type { DatabaseAdapter, StoredArtifactShareRecord } from "@nakama/db";
import type { AuthService } from "./auth-service";
import {
  isLoopbackComposioCallbackBaseUrl,
  resolveComposioCallbackBaseUrl,
} from "./composio-callback-url";
import { ProfileService } from "./profile-service";

/** Share links must be reachable outside the API host (Discord/Telegram). */
export function resolveArtifactShareBaseUrl(options: {
  clientOrigin?: string;
  request?: Request;
}): string {
  const resolved = resolveComposioCallbackBaseUrl({
    clientOrigin: options.clientOrigin,
    request: options.request,
  });

  if (!isLoopbackComposioCallbackBaseUrl(resolved)) {
    return resolved;
  }

  const configured = resolveWebPublicUrl();
  if (configured && !isLoopbackComposioCallbackBaseUrl(configured)) {
    return configured;
  }

  return resolved;
}

export class ArtifactShareService {
  private readonly profileService: ProfileService;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly authService: AuthService
  ) {
    this.profileService = new ProfileService(db);
  }

  async publishArtifactShare(input: {
    orgId: string;
    profileId: string;
    sourcePath: string;
    userId: string;
    clientOrigin?: string;
    request?: Request;
  }): Promise<PublishArtifactShareResponse> {
    await this.requireProfile(input.orgId, input.profileId);

    const sourcePath = input.sourcePath.trim();
    if (!sourcePath) {
      throw new NakamaApiError("path is required.", 400);
    }

    const artifact = await readArtifactFile({
      filename: sourcePath,
      orgId: input.orgId,
      profileId: input.profileId,
    });

    const filename = sourcePath.split("/").pop() ?? "artifact";
    const mimeType = resolveArtifactMimeType(artifact.contentType, filename);
    const existing = await this.db.getActiveArtifactShareByPath(
      input.orgId,
      input.profileId,
      sourcePath
    );

    const now = new Date().toISOString();
    let record: StoredArtifactShareRecord;
    let token: string | null = null;
    let refreshed = false;

    if (existing) {
      refreshed = true;
      record = await this.replaceSnapshot(existing, {
        bytes: artifact.bytes,
        filename,
        mimeType,
        orgId: input.orgId,
      });
    } else {
      token = generateArtifactShareToken();
      const shareId = `share_${crypto.randomUUID().replace(/-/g, "")}`;
      const storagePath = await writeArtifactShareSnapshot({
        bytes: artifact.bytes,
        filename,
        orgId: input.orgId,
        shareId,
      });

      record = {
        createdAt: now,
        createdByUserId: input.userId,
        filename,
        id: shareId,
        mimeType,
        orgId: input.orgId,
        profileId: input.profileId,
        revokedAt: null,
        sizeBytes: artifact.bytes.byteLength,
        sourcePath,
        storagePath,
        tokenHash: this.authService.hashToken(token),
      };

      await this.db.createArtifactShare(record);
    }

    const baseUrl = resolveArtifactShareBaseUrl({
      clientOrigin: input.clientOrigin,
      request: input.request,
    });
    const webPublicUrlConfigured = Boolean(
      baseUrl && !isLoopbackComposioCallbackBaseUrl(baseUrl)
    );
    const shareUrl = token
      ? `${baseUrl}${buildArtifactSharePath(token)}`
      : null;

    return {
      id: record.id,
      refreshed,
      sharePath: token ? buildArtifactSharePath(token) : "",
      shareUrl,
      token: token ?? "",
      webPublicUrlConfigured,
    };
  }

  private async replaceSnapshot(
    existing: StoredArtifactShareRecord,
    input: {
      bytes: Buffer;
      filename: string;
      mimeType: string;
      orgId: string;
    }
  ): Promise<StoredArtifactShareRecord> {
    await deleteArtifactShareSnapshot(existing.storagePath);

    const storagePath = await writeArtifactShareSnapshot({
      bytes: input.bytes,
      filename: input.filename,
      orgId: input.orgId,
      shareId: existing.id,
    });

    await this.db.updateArtifactShareSnapshot(existing.id, {
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storagePath,
    });

    return {
      ...existing,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      storagePath,
    };
  }

  /**
   * A share serves a snapshot taken at publish time, so an edited artifact keeps
   * serving the old text on the public link until the snapshot is replaced.
   * Callers pass every path the share could have been published under (the
   * dashboard sends absolute paths, channels send workspace-relative ones), and
   * this no-ops when the artifact was never shared.
   */
  async refreshArtifactShareSnapshot(input: {
    orgId: string;
    profileId: string;
    sourcePaths: string[];
  }): Promise<boolean> {
    let refreshed = false;

    for (const sourcePath of new Set(input.sourcePaths)) {
      const existing = await this.db.getActiveArtifactShareByPath(
        input.orgId,
        input.profileId,
        sourcePath
      );

      if (!existing) {
        continue;
      }

      const artifact = await readArtifactFile({
        filename: sourcePath,
        orgId: input.orgId,
        profileId: input.profileId,
      });
      const filename = sourcePath.split("/").pop() ?? "artifact";

      await this.replaceSnapshot(existing, {
        bytes: artifact.bytes,
        filename,
        mimeType: resolveArtifactMimeType(artifact.contentType, filename),
        orgId: input.orgId,
      });
      refreshed = true;
    }

    return refreshed;
  }

  async getArtifactShareStatus(input: {
    orgId: string;
    profileId: string;
    sourcePath: string;
    clientOrigin?: string;
    request?: Request;
  }): Promise<ArtifactShareStatusResponse | null> {
    await this.requireProfile(input.orgId, input.profileId);

    const share = await this.db.getActiveArtifactShareByPath(
      input.orgId,
      input.profileId,
      input.sourcePath.trim()
    );

    if (!share) {
      return null;
    }

    const baseUrl = resolveArtifactShareBaseUrl({
      clientOrigin: input.clientOrigin,
      request: input.request,
    });
    const webPublicUrlConfigured = Boolean(
      baseUrl && !isLoopbackComposioCallbackBaseUrl(baseUrl)
    );

    return {
      active: true,
      createdAt: share.createdAt,
      id: share.id,
      sharePath: "",
      shareUrl: null,
      webPublicUrlConfigured,
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
      input.shareId
    );

    if (!share || share.revokedAt) {
      throw new NakamaApiError("Not found", 404);
    }

    const revoked = await this.db.revokeArtifactShare(
      share.id,
      new Date().toISOString()
    );
    if (revoked) {
      await deleteArtifactShareSnapshot(share.storagePath);
    }

    return { id: share.id, revoked };
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
      this.authService.hashToken(trimmed)
    );

    if (!share) {
      throw new NakamaApiError("Not found", 404);
    }

    const bytes = await readArtifactShareSnapshot(share.storagePath);
    // Sidecars sometimes store application/octet-stream; resolve from the filename
    // so <video>/<img> can play with X-Content-Type-Options: nosniff.
    const mimeType = resolveArtifactMimeType(share.mimeType, share.filename);
    const inlineAllowed = !isBrowserExecutableArtifactMimeType(mimeType);

    return {
      bytes,
      metadata: {
        filename: share.filename,
        inlineAllowed,
        mimeType,
        sizeBytes: share.sizeBytes,
      },
    };
  }

  private async requireProfile(
    orgId: string,
    profileId: string
  ): Promise<void> {
    const profile = await this.profileService.getProfile(orgId, profileId);
    if (!profile) {
      throw new NakamaApiError("Not found", 404);
    }
  }
}
