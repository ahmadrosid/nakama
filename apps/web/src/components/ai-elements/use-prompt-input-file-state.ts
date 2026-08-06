import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import type { ChangeEventHandler, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AttachmentsContext,
  PromptInputControllerProps,
} from "@/components/ai-elements/prompt-input-context";
import { useOptionalPromptInputController } from "@/components/ai-elements/prompt-input-context";

type FileErrorCode = "max_files" | "max_file_size" | "accept";

export type UsePromptInputFileStateOptions = {
  accept?: string;
  globalDrop?: boolean;
  syncHiddenInput?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  prepareFiles?: (files: File[]) => File[] | Promise<File[]>;
  onError?: (err: { code: FileErrorCode; message: string }) => void;
};

export type UsePromptInputFileStateResult = {
  usingProvider: boolean;
  controller: PromptInputControllerProps | null;
  files: (FileUIPart & { id: string })[];
  inputRef: RefObject<HTMLInputElement | null>;
  formRef: RefObject<HTMLFormElement | null>;
  add: (fileList: File[] | FileList) => void;
  remove: (id: string) => void;
  clearAttachments: () => void;
  clear: () => void;
  openFileDialog: () => void;
  handleChange: ChangeEventHandler<HTMLInputElement>;
  attachmentsCtx: AttachmentsContext;
};

export function usePromptInputFileState({
  accept,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  prepareFiles,
  onError,
}: UsePromptInputFileStateOptions): UsePromptInputFileStateResult {
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const files = usingProvider ? controller.attachments.files : items;

  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }

      const fileType = f.type.split(";")[0]?.trim().toLowerCase() ?? "";
      const fileName = f.name.toLowerCase();
      const patterns = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      return patterns.some((pattern) => {
        const normalizedPattern = pattern.toLowerCase();

        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -1);
          return fileType.startsWith(prefix);
        }

        if (pattern.startsWith(".")) {
          return fileName.endsWith(normalizedPattern);
        }

        return fileType === normalizedPattern;
      });
    },
    [accept],
  );

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      void (async () => {
        let incoming = [...fileList];

        if (prepareFiles) {
          try {
            incoming = await prepareFiles(incoming);
          } catch (error) {
            onError?.({
              code: "max_file_size",
              message:
                error instanceof Error ? error.message : "Could not process the selected files.",
            });
            return;
          }
        }

        const accepted = incoming.filter((f) => matchesAccept(f));
        if (incoming.length && accepted.length === 0) {
          onError?.({
            code: "accept",
            message: "No files match the accepted types.",
          });
          return;
        }
        const withinSize = (f: File) =>
          maxFileSize ? f.size <= maxFileSize : true;
        const sized = accepted.filter(withinSize);
        if (accepted.length > 0 && sized.length === 0) {
          onError?.({
            code: "max_file_size",
            message: "All files exceed the maximum size.",
          });
          return;
        }

        const remainingCapacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - filesRef.current.length)
            : undefined;
        const capped =
          typeof remainingCapacity === "number" ? sized.slice(0, remainingCapacity) : sized;
        if (typeof remainingCapacity === "number" && sized.length > remainingCapacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }

        setItems((prev) => {
          const next: (FileUIPart & { id: string })[] = [];
          for (const file of capped) {
            next.push({
              filename: file.name,
              id: nanoid(),
              mediaType: file.type,
              type: "file",
              url: URL.createObjectURL(file),
            });
          }
          return [...prev, ...next];
        });
      })();
    },
    [matchesAccept, maxFiles, maxFileSize, onError, prepareFiles],
  );

  const removeLocal = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id);
        if (found?.url) {
          URL.revokeObjectURL(found.url);
        }
        return prev.filter((file) => file.id !== id);
      }),
    [],
  );

  const addWithProviderValidation = useCallback(
    (fileList: File[] | FileList) => {
      void (async () => {
        let incoming = [...fileList];

        if (prepareFiles) {
          try {
            incoming = await prepareFiles(incoming);
          } catch (error) {
            onError?.({
              code: "max_file_size",
              message:
                error instanceof Error ? error.message : "Could not process the selected files.",
            });
            return;
          }
        }

        const accepted = incoming.filter((f) => matchesAccept(f));
        if (incoming.length && accepted.length === 0) {
          onError?.({
            code: "accept",
            message: "No files match the accepted types.",
          });
          return;
        }
        const withinSize = (f: File) =>
          maxFileSize ? f.size <= maxFileSize : true;
        const sized = accepted.filter(withinSize);
        if (accepted.length > 0 && sized.length === 0) {
          onError?.({
            code: "max_file_size",
            message: "All files exceed the maximum size.",
          });
          return;
        }

        const currentCount = files.length;
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - currentCount)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }

        if (capped.length > 0) {
          controller?.attachments.add(capped);
        }
      })();
    },
    [matchesAccept, maxFileSize, maxFiles, onError, prepareFiles, files.length, controller],
  );

  const clearAttachments = useCallback(
    () =>
      usingProvider
        ? controller?.attachments.clear()
        : setItems((prev) => {
            for (const file of prev) {
              if (file.url) {
                URL.revokeObjectURL(file.url);
              }
            }
            return [];
          }),
    [usingProvider, controller],
  );

  const add = usingProvider ? addWithProviderValidation : addLocal;
  const remove = usingProvider ? controller.attachments.remove : removeLocal;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal;

  const clear = useCallback(() => {
    clearAttachments();
  }, [clearAttachments]);

  useEffect(() => {
    if (!usingProvider) {
      return;
    }
    controller.__registerFileInput(inputRef, () => inputRef.current?.click());
  }, [usingProvider, controller]);

  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    if (globalDrop) {
      return;
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(() => {
    if (!globalDrop) {
      return;
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.url) {
            URL.revokeObjectURL(f.url);
          }
        }
      }
    },
    [usingProvider],
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [add],
  );

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files: files.map((item) => ({ ...item, id: item.id })),
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog],
  );

  return {
    usingProvider,
    controller,
    files,
    inputRef,
    formRef,
    add,
    remove,
    clearAttachments,
    clear,
    openFileDialog,
    handleChange,
    attachmentsCtx,
  };
}
