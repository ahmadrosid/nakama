import type { JsonSchema } from "@nakama/core/contract";

type ExampleValue =
  | string
  | number
  | boolean
  | null
  | ExampleValue[]
  | { [key: string]: ExampleValue };

// oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.

function exampleValueForSchema(field: JsonSchema): ExampleValue {
  if (field.enum?.length) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
    return field.enum[0];
  }

  // oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.

  switch (field.type) {
    case "string":
      return "";
    case "number":
    case "integer":
      // oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
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
  schema: JsonSchema | undefined
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
): { [key: string]: ExampleValue } {
  const properties = schema?.properties;

  if (!properties) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(properties).map(([name, field]) => [
      name,
      exampleValueForSchema(field),
    ])
  );
}

export function buildExampleParametersJson(
  schema: JsonSchema | undefined
): string {
  return JSON.stringify(exampleParametersFromSchema(schema), null, 2);
}
