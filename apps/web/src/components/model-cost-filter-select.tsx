import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ModelCostFilter = "all" | "free";

interface ModelCostFilterSelectProps {
  onValueChange: (value: ModelCostFilter) => void;
  value: ModelCostFilter;
}

export function ModelCostFilterSelect({
  value,
  onValueChange,
}: ModelCostFilterSelectProps) {
  return (
    <Select
      onValueChange={(next) => onValueChange(next as ModelCostFilter)}
      value={value}
    >
      <SelectTrigger className="w-27.5">
        <SelectValue>{value === "free" ? "Free only" : "All"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="free">Free only</SelectItem>
      </SelectContent>
    </Select>
  );
}
