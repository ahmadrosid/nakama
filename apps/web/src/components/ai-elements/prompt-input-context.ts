import type { RefObject } from "react";
import { createContext, useContext } from "react";
import type { FileUIPart } from "@/lib/ai-ui-types";

export interface AttachmentsContext {
  add: (files: File[] | FileList) => void;
  clear: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  files: (FileUIPart & { id: string })[];
  openFileDialog: () => void;
  remove: (id: string) => void;
}

interface TextInputContext {
  clear: () => void;
  setInput: (v: string) => void;
  value: string;
}

export interface PromptInputControllerProps {
  /** INTERNAL: Allows PromptInput to register its file textInput + "open" callback */
  __registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void;
  attachments: AttachmentsContext;
  textInput: TextInputContext;
}

export const PromptInputController =
  createContext<PromptInputControllerProps | null>(null);

export const ProviderAttachmentsContext =
  createContext<AttachmentsContext | null>(null);

export const LocalAttachmentsContext = createContext<AttachmentsContext | null>(
  null
);

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController()."
    );
  }
  return ctx;
};

export const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext);
