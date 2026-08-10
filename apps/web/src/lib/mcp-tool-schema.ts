export interface McpToolParameter {
  description?: string;
  name: string;
  required: boolean;
  type: string;
}

export function parseMcpToolParameters(
  inputSchema: unknown
): McpToolParameter[] {
  if (typeof inputSchema !== "object" || inputSchema === null) {
    return [];
  }

  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties;
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  if (typeof properties !== "object" || properties === null) {
    return [];
  }

  const requiredNames = new Set(required);

  return Object.entries(properties as Record<string, unknown>).map(
    ([name, property]) => {
      const propertyRecord =
        typeof property === "object" && property !== null
          ? (property as Record<string, unknown>)
          : {};

      return {
        description:
          typeof propertyRecord.description === "string"
            ? propertyRecord.description
            : undefined,
        name,
        required: requiredNames.has(name),
        type: formatSchemaType(propertyRecord.type),
      };
    }
  );
}

function formatSchemaType(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .join(" | ");
  }

  return "unknown";
}
