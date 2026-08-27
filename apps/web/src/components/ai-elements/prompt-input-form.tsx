import type { FormEventHandler, HTMLAttributes, ReactNode } from "react";
import {
  ComposerRimGlow,
  useComposerRimHost,
} from "@/components/chat/composer-rim-glow";
import { InputGroup } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export type PromptInputFormProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit"
> & {
  accept?: string;
  multiple?: boolean;
  inputGroupClassName?: string;
  /** Overrides the default rounded-xl on the rim host (e.g. recessed stack). */
  rimClassName?: string;
  /** Rainbow rim while the agent turn is streaming. */
  rimActive?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  formRef: React.RefObject<HTMLFormElement | null>;
  onFileChange: React.ChangeEventHandler<HTMLInputElement>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
};

export function PromptInputForm({
  className,
  accept,
  multiple,
  inputGroupClassName,
  rimClassName,
  rimActive = false,
  inputRef,
  formRef,
  onFileChange,
  onSubmit,
  children,
  ...props
}: PromptInputFormProps) {
  const hostRef = useComposerRimHost();

  return (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={onFileChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={onSubmit}
        ref={formRef}
        {...props}
      >
        {/* Glow under an opaque face; keep overflow visible so slash skill picker can escape upward. */}
        <div
          className={cn(
            "composer-rim relative overflow-visible rounded-xl p-px",
            rimClassName
          )}
          ref={hostRef}
        >
          <ComposerRimGlow active={rimActive} hostRef={hostRef} />
          <InputGroup
            className={cn(
              "relative z-[1] w-full overflow-hidden rounded-[calc(0.75rem-1px)] bg-card dark:bg-card",
              inputGroupClassName
            )}
          >
            {children}
          </InputGroup>
        </div>
      </form>
    </>
  );
}
