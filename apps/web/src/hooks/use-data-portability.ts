import { useMutation } from "@tanstack/react-query";
import { client } from "@/lib/client";

export function useMigrateDataFolders() {
  return useMutation({
    mutationFn: () => client.migrateDataFolders(),
  });
}

export function useExportData() {
  return useMutation({
    mutationFn: () => client.exportData(),
  });
}

export function usePreviewDataImport() {
  return useMutation({
    mutationFn: (file: File) => client.previewDataImport(file),
  });
}

export function useRestoreDataImport() {
  return useMutation({
    mutationFn: ({ file, confirm }: { file: File; confirm: boolean }) =>
      client.restoreDataImport(file, { confirm }),
  });
}

export function formatDataPortabilityBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function canRestoreDataImport(options: {
  selectedFile: File | null;
  previewReady: boolean;
  pending: boolean;
}): boolean {
  return Boolean(options.selectedFile) && options.previewReady && !options.pending;
}
