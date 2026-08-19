import type { ArtifactFile } from "@nakama/core/contract";

export type ArtifactFolderEntry = {
  fileCount: number;
  latestUpdatedAt: string;
  name: string;
  prefix: string;
};

export type ArtifactFolderListing = {
  files: ArtifactFile[];
  folders: ArtifactFolderEntry[];
};

export function normalizeArtifactPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function normalizeArtifactFolderPrefix(prefix: string): string {
  return normalizeArtifactPath(prefix);
}

export function artifactFolderFileLabel(fileCount: number): string {
  return fileCount === 1 ? "1 file" : `${fileCount} files`;
}

export function artifactBasename(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? normalized : normalized.slice(separator + 1);
}

export function artifactFolderSegments(prefix: string): Array<{
  name: string;
  prefix: string;
}> {
  const normalized = normalizeArtifactFolderPrefix(prefix);
  if (!normalized) {
    return [];
  }

  const parts = normalized.split("/");
  return parts.map((name, index) => ({
    name,
    prefix: parts.slice(0, index + 1).join("/"),
  }));
}

export function listArtifactsInFolder(
  artifacts: readonly ArtifactFile[],
  folderPrefix: string
): ArtifactFolderListing {
  const prefix = normalizeArtifactFolderPrefix(folderPrefix);
  const prefixWithSlash = prefix ? `${prefix}/` : "";
  const folders = new Map<string, ArtifactFolderEntry>();
  const files: ArtifactFile[] = [];

  for (const artifact of artifacts) {
    const relative = normalizeArtifactPath(artifact.filename);
    if (prefix && !relative.startsWith(prefixWithSlash)) {
      continue;
    }

    const rest = prefix ? relative.slice(prefixWithSlash.length) : relative;
    if (!rest) {
      continue;
    }

    const separator = rest.indexOf("/");
    if (separator === -1) {
      files.push(artifact);
      continue;
    }

    const name = rest.slice(0, separator);
    if (!name || name === "." || name === "..") {
      continue;
    }

    const childPrefix = prefix ? `${prefix}/${name}` : name;
    const existing = folders.get(childPrefix);
    if (existing) {
      existing.fileCount += 1;
      if (artifact.updatedAt.localeCompare(existing.latestUpdatedAt) > 0) {
        existing.latestUpdatedAt = artifact.updatedAt;
      }
      continue;
    }

    folders.set(childPrefix, {
      fileCount: 1,
      latestUpdatedAt: artifact.updatedAt,
      name,
      prefix: childPrefix,
    });
  }

  return {
    files,
    folders: [...folders.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
  };
}
