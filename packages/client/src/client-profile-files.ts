import { NakamaApiError } from "@nakama/core/api-error";
import type {
  ArtifactShareStatusResponse,
  DeleteArtifactResponse,
  DeleteKnowledgeBaseResponse,
  DeleteOrganizationKnowledgeBaseResponse,
  DocumentAttachment,
  ImportKnowledgeBaseZipRequest,
  ImportKnowledgeBaseZipResponse,
  InitSoulResponse,
  KnowledgeBaseDuplicateAction,
  ListArtifactsResponse,
  ListKnowledgeBaseResponse,
  ListWorkspaceFilesResponse,
  PublishArtifactShareRequest,
  PublishArtifactShareResponse,
  RenameWorkspaceEntryRequest,
  RevokeArtifactShareResponse,
  SetFilePinnedRequest,
  SoulStackResponse,
  SoulStatusResponse,
  UpdateArtifactRequest,
  UpdateArtifactResponse,
  UpdateSoulFileRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
  UploadOrganizationKnowledgeBaseResponse,
  WorkspaceEntry,
} from "@nakama/core/contract";
import { ProfilesClient } from "./client-profiles";

/** An agent's soul, workspace files, artifacts, and knowledge base. */
export class ProfileFilesClient extends ProfilesClient {
  async getProfileSoulStatus(
    profileId: string,
    options: { includeContents?: boolean } = {}
  ): Promise<SoulStatusResponse> {
    const query = options.includeContents ? "?contents=true" : "";

    return this.request<SoulStatusResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul${query}`
    );
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    return this.request<InitSoulResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/init`,
      {
        method: "POST",
      }
    );
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    return this.request<SoulStackResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/stack`
    );
  }

  async writeProfileSoulFile(
    profileId: string,
    fileKey: string,
    content: string
  ): Promise<void> {
    await this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/soul/files/${encodeURIComponent(fileKey)}`,
      {
        body: JSON.stringify({ content } satisfies UpdateSoulFileRequest),
        method: "PUT",
      }
    );
  }

  async listProfileWorkspaceFiles(
    profileId: string,
    folder = ""
  ): Promise<ListWorkspaceFilesResponse> {
    const query = new URLSearchParams({ folder });

    return this.request<ListWorkspaceFilesResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/workspace?${query}`
    );
  }

  async renameProfileWorkspaceEntry(
    profileId: string,
    body: RenameWorkspaceEntryRequest
  ): Promise<WorkspaceEntry> {
    return this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/workspace/rename`,
      {
        body: JSON.stringify(body),
        method: "PATCH",
      }
    );
  }

  async readProfileWorkspaceFile(
    profileId: string,
    filename: string,
    options: { render?: "markdown" } = {}
  ): Promise<Blob> {
    const query = new URLSearchParams({ path: filename });

    if (options.render) {
      query.set("render", options.render);
    }

    const response = await this.fetchRaw(
      `/v1/profiles/${encodeURIComponent(profileId)}/workspace/content?${query}`
    );

    return response.blob();
  }

  async listProfileFilePins(
    profileId: string
  ): Promise<ListWorkspaceFilesResponse> {
    return this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/workspace/pins`
    );
  }

  async setProfileFilePinned(
    profileId: string,
    body: SetFilePinnedRequest
  ): Promise<void> {
    await this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/workspace/pins`,
      { body: JSON.stringify(body), method: "PUT" }
    );
  }

  async listProfileArtifacts(
    profileId: string,
    options: { folder?: string; limit?: number; offset?: number } = {}
  ): Promise<ListArtifactsResponse> {
    const query = new URLSearchParams();

    if (options.folder) {
      query.set("folder", options.folder);
    }

    if (options.limit !== undefined) {
      query.set("limit", String(options.limit));
    }

    if (options.offset !== undefined) {
      query.set("offset", String(options.offset));
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";

    return this.request<ListArtifactsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts${suffix}`
    );
  }

  async deleteProfileArtifact(
    profileId: string,
    filename: string
  ): Promise<DeleteArtifactResponse> {
    const query = new URLSearchParams({ path: filename });

    return this.request<DeleteArtifactResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  async publishProfileArtifactShare(
    profileId: string,
    path: string
  ): Promise<PublishArtifactShareResponse> {
    const body: PublishArtifactShareRequest = { path };

    if (this.clientOrigin) {
      body.clientOrigin = this.clientOrigin;
    }

    return this.request<PublishArtifactShareResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async getProfileArtifactShareStatus(
    profileId: string,
    path: string
  ): Promise<ArtifactShareStatusResponse | null> {
    const query = new URLSearchParams({ path });

    return this.request<ArtifactShareStatusResponse | null>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares/status?${query.toString()}`
    );
  }

  async revokeProfileArtifactShare(
    profileId: string,
    shareId: string
  ): Promise<RevokeArtifactShareResponse> {
    return this.request<RevokeArtifactShareResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/shares/${encodeURIComponent(shareId)}`,
      { method: "DELETE" }
    );
  }

  async readProfileArtifactContent(
    profileId: string,
    artifactPath: string,
    options: {
      inline?: boolean;
      render?: "markdown";
      signal?: AbortSignal;
      maxBytes?: number;
    } = {}
  ): Promise<{ contentType: string; data: ArrayBuffer }> {
    const query = new URLSearchParams({ path: artifactPath });

    if (options.inline) {
      query.set("inline", "1");
    }

    if (options.render) {
      query.set("render", options.render);
    }

    const response = await this.fetchRaw(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`,
      { signal: options.signal }
    );

    let data: ArrayBuffer;

    if (options.maxBytes === undefined) {
      data = await response.arrayBuffer();
    } else {
      const maxBytes = options.maxBytes;

      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
        await response.body?.cancel();
        throw new Error("maxBytes must be a nonnegative integer.");
      }

      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;

      const onAbort = () => {
        void reader?.cancel().catch(() => {});
      };

      options.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        if (Number(response.headers.get("Content-Length")) > maxBytes) {
          throw new Error("Artifact exceeds the download byte budget.");
        }

        while (reader) {
          options.signal?.throwIfAborted();
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          size += value.byteLength;

          if (size > maxBytes) {
            throw new Error("Artifact exceeds the download byte budget.");
          }

          chunks.push(value);
        }

        options.signal?.throwIfAborted();
        const bytes = new Uint8Array(size);
        let offset = 0;

        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        data = bytes.buffer;
      } catch (error) {
        await reader?.cancel().catch(() => {});
        throw error;
      } finally {
        options.signal?.removeEventListener("abort", onAbort);
        reader?.releaseLock();
      }
    }

    return {
      contentType:
        response.headers.get("Content-Type") ?? "application/octet-stream",
      data,
    };
  }

  async hasProfileArtifact(
    profileId: string,
    artifactPath: string
  ): Promise<boolean> {
    const query = new URLSearchParams({ path: artifactPath });

    try {
      await this.fetchRaw(
        `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`,
        { method: "HEAD" }
      );

      return true;
    } catch (error) {
      if (error instanceof NakamaApiError && error.status === 404) {
        return false;
      }

      throw error;
    }
  }

  async writeProfileArtifactContent(
    profileId: string,
    artifactPath: string,
    content: string
  ): Promise<UpdateArtifactResponse> {
    const query = new URLSearchParams({ path: artifactPath });

    return this.request<UpdateArtifactResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/artifacts/content?${query.toString()}`,
      {
        body: JSON.stringify({ content } satisfies UpdateArtifactRequest),
        method: "PUT",
      }
    );
  }

  async listOrganizationKnowledgeBase(
    orgId: string
  ): Promise<{ documents: ListKnowledgeBaseResponse["documents"] }> {
    return this.request(`/v1/orgs/${encodeURIComponent(orgId)}/knowledge-base`);
  }

  async uploadOrganizationKnowledgeBaseDocument(
    orgId: string,
    document: DocumentAttachment,
    onDuplicate?: KnowledgeBaseDuplicateAction
  ): Promise<UploadOrganizationKnowledgeBaseResponse> {
    const body: UploadKnowledgeBaseRequest = { document };

    if (onDuplicate) {
      body.onDuplicate = onDuplicate;
    }

    return this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/knowledge-base`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async deleteOrganizationKnowledgeBaseDocument(
    orgId: string,
    documentId: string
  ): Promise<DeleteOrganizationKnowledgeBaseResponse> {
    return this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/knowledge-base/${encodeURIComponent(documentId)}`,
      { method: "DELETE" }
    );
  }

  async attachSharedKnowledgeBaseDocument(
    profileId: string,
    documentId: string
  ): Promise<{ attached: true; documentId: string; profileId: string }> {
    return this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/shared/${encodeURIComponent(documentId)}`,
      { method: "PUT" }
    );
  }

  async detachSharedKnowledgeBaseDocument(
    profileId: string,
    documentId: string
  ): Promise<{ detached: true; documentId: string; profileId: string }> {
    return this.request(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/shared/${encodeURIComponent(documentId)}`,
      { method: "DELETE" }
    );
  }

  async listKnowledgeBase(
    profileId: string
  ): Promise<ListKnowledgeBaseResponse> {
    return this.request<ListKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`
    );
  }

  async uploadKnowledgeBaseDocument(
    profileId: string,
    document: DocumentAttachment,
    onDuplicate?: KnowledgeBaseDuplicateAction
  ): Promise<UploadKnowledgeBaseResponse> {
    const body: UploadKnowledgeBaseRequest = { document };

    if (onDuplicate) {
      body.onDuplicate = onDuplicate;
    }

    return this.request<UploadKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base`,
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async importKnowledgeBaseZip(
    profileId: string,
    zipBase64: string
  ): Promise<ImportKnowledgeBaseZipResponse> {
    return this.request<ImportKnowledgeBaseZipResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/import-zip`,
      {
        body: JSON.stringify({
          zipBase64,
        } satisfies ImportKnowledgeBaseZipRequest),
        method: "POST",
      }
    );
  }

  async deleteKnowledgeBaseDocument(
    profileId: string,
    documentId: string
  ): Promise<DeleteKnowledgeBaseResponse> {
    return this.request<DeleteKnowledgeBaseResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}`,
      { method: "DELETE" }
    );
  }

  async readKnowledgeBaseDocumentContent(
    profileId: string,
    documentId: string,
    options: { inline?: boolean; render?: "text" } = {}
  ): Promise<{ contentType: string; data: ArrayBuffer }> {
    const query = new URLSearchParams();

    if (options.inline) {
      query.set("inline", "1");
    }

    if (options.render) {
      query.set("render", options.render);
    }

    const queryString = query.toString();
    const path = `/v1/profiles/${encodeURIComponent(profileId)}/knowledge-base/${encodeURIComponent(documentId)}/content${queryString ? `?${queryString}` : ""}`;

    const response = await this.fetchRaw(path);

    return {
      contentType:
        response.headers.get("Content-Type") ?? "application/octet-stream",
      data: await response.arrayBuffer(),
    };
  }
}
