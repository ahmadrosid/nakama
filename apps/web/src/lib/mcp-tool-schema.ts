export interface McpToolParameter {
  description?: string;
  name: string;
  required: boolean;
  type: string;
}

export function parseMcpToolParameters(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
  inputSchema: unknown
): McpToolParameter[] {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof inputSchema !== "object" || inputSchema === null) {
    return [];
  }

  // SAFETY: The enclosing parser checks the value before this conversion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties;

  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
        (entry): entry is string => typeof entry === "string"
      )
    : [];

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof properties !== "object" || properties === null) {
    return [];
  }

  const requiredNames = new Set(required);

  // SAFETY: The enclosing parser checks the value before this conversion.
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  return Object.entries(properties as Record<string, unknown>)
    .map(([name, property]) => {
      // SAFETY: The branch checks that this schema property is a non-null object.
      const propertyRecord =
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
        typeof property === "object" && property !== null
          ? // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
            (property as Record<string, unknown>)
          : {};

      return {
        description:
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
          typeof propertyRecord.description === "string"
            ? propertyRecord.description
            : undefined,
        name,
        required: requiredNames.has(name),
        type: formatSchemaType(propertyRecord.type),
      };
    })
    .sort(compareParameters);
}

// JSON Schema gives `properties` no meaningful order, so Object.entries would
// leak whatever order the MCP server happened to serialise. Callers render this
// list, so pin it: required first, then alphabetical.
function compareParameters(a: McpToolParameter, b: McpToolParameter): number {
  if (a.required !== b.required) {
    return a.required ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser accepts untrusted provider or tool output and decodes it at this boundary.
function formatSchemaType(value: unknown): string {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return (
      value
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This guard validates decoded external data before the caller uses the domain value.
        .filter((entry): entry is string => typeof entry === "string")
        .join(" | ")
    );
  }

  return "unknown";
}
