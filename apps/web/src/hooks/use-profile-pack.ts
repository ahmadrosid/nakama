import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
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
    onSuccess: () => invalidateQueries(queryClient, queryKeys.profiles.all),
  });
}
