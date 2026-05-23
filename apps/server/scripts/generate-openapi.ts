import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeOpenApiSpec } from "../src/openapi/build-spec";

const serverRoot = join(import.meta.dir, "..");
const outputPath = join(serverRoot, "openapi.json");

writeFileSync(outputPath, serializeOpenApiSpec());
console.log(`Wrote ${outputPath}`);
