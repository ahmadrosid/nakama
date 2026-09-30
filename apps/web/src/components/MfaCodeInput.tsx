import { Input } from "@nakama/ui/input";

const CODE_LENGTH = 6;

export function MfaCodeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label="6-digit authentication code"
      autoComplete="one-time-code"
      id={id}
      inputMode="numeric"
      maxLength={CODE_LENGTH}
      onChange={(event) =>
        onChange(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
      }
      placeholder="Enter a 6-digit code"
      value={value.replace(/\D/g, "").slice(0, CODE_LENGTH)}
    />
  );
}
