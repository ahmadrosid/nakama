import { type ClassNameValue, twMerge } from "tailwind-merge";

type ClassNameInput =
  | ClassNameValue
  | ((state: never) => string | undefined | null);

export function cn(...inputs: ClassNameInput[]) {
  return twMerge(
    inputs.map((input) => {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ClassNameInput is already a typed string-or-classname-function union.
      return typeof input === "function" ? undefined : input;
    })
  );
}
