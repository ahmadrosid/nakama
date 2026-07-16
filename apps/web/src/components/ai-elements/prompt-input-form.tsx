import { InputGroup } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { FormEventHandler, HTMLAttributes, ReactNode } from "react";

export type PromptInputFormProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  accept?: string;
  multiple?: boolean;
  inputGroupClassName?: string;
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
  inputRef,
  formRef,
  onFileChange,
  onSubmit,
  children,
  ...props
}: PromptInputFormProps) {
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
        <InputGroup className={cn("overflow-hidden", inputGroupClassName)}>
          {children}
        </InputGroup>
      </form>
    </>
  );
}
