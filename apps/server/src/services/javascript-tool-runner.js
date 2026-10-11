import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];

if (!modulePath) {
  console.error("Missing tool module path");
  process.exit(1);
}

const mod = await import(pathToFileURL(modulePath).href);

const skillMode = process.argv[3];
const skillModule = mod.default?.run instanceof Function ? mod.default : mod;
const run = skillMode ? skillModule.run : (mod.run ?? mod.default?.run);

if (!(run instanceof Function)) {
  console.error("Tool module must export a run(input, context) function.");
  process.exit(1);
}

const payload = JSON.parse((await Bun.stdin.text()) || "{}");

const result =
  skillMode === "--describe-skill"
    ? {
        description: skillModule.description,
        name: skillModule.name,
        parameters: skillModule.parameters,
      }
    : await run(skillMode === "--run-skill" ? payload.input : payload, {
        ...(skillMode === "--run-skill" ? payload.context : {}),
        workspaceRoot: process.env.NAKAMA_WORKSPACE_ROOT,
      });

process.stdout.write(JSON.stringify(result));
