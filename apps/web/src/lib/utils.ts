import { type ClassNameValue, twMerge } from "tailwind-merge";

type ClassNameInput =
  | ClassNameValue
  | ((state: never) => string | undefined | null);

export function cn(...inputs: ClassNameInput[]) {
  return twMerge(
    inputs.map((input) => (typeof input === "function" ? undefined : input))
  );
}
