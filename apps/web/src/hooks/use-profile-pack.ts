import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

export function useExportProfilePackMutation() {
  return useMutation({
    mutationFn: (profileId: string) => client.exportProfilePack(profileId),
  });
}

export function usePreviewProfilePackImportMutation() {
  return useMutation({
    mutationFn: (file: File) => client.previewProfilePackImport(file),
  });
}

export function useImportProfilePackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file }: { file: File }) =>
      client.importProfilePack(file, { confirm: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
  });
}

export function canConfirmProfilePackImport(options: {
  selectedFile: File | null;
  previewReady: boolean;
  hasPreviewError: boolean;
  pending: boolean;
}): boolean {
  return (
    Boolean(options.selectedFile) &&
    options.previewReady &&
    !options.hasPreviewError &&
    !options.pending
  );
}

export function downloadProfilePackArchive(
  filename: string,
  data: ArrayBuffer
): void {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/zip" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
