import type { JsonSchema } from "@nakama/core/contract";

function exampleValueForSchema(field: JsonSchema): unknown {
  if (field.enum?.length) {
    return field.enum[0];
  }

  switch (field.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return field.items ? [exampleValueForSchema(field.items)] : [];
    case "object":
      return exampleParametersFromSchema(field);
    default:
      return null;
  }
}

export function exampleParametersFromSchema(
  schema: JsonSchema | undefined,
): Record<string, unknown> {
  const properties = schema?.properties;

  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).map(([name, field]) => [name, exampleValueForSchema(field)]),
  );
}

export function buildExampleParametersJson(schema: JsonSchema | undefined): string {
  return JSON.stringify(exampleParametersFromSchema(schema), null, 2);
}
