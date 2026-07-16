export interface McpToolParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
}

export function parseMcpToolParameters(inputSchema: unknown): McpToolParameter[] {
  if (typeof inputSchema !== "object" || inputSchema === null) {
    return [];
  }

  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (typeof properties !== "object" || properties === null) {
    return [];
  }

  const requiredNames = new Set(required);

  return Object.entries(properties as Record<string, unknown>).map(([name, property]) => {
    const propertyRecord =
      typeof property === "object" && property !== null
        ? (property as Record<string, unknown>)
        : {};

    return {
      name,
      type: formatSchemaType(propertyRecord.type),
      description:
        typeof propertyRecord.description === "string"
          ? propertyRecord.description
          : undefined,
      required: requiredNames.has(name),
    };
  });
}

function formatSchemaType(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(" | ");
  }

  return "unknown";
}
