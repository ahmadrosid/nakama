// @bun
// src/actions.ts
function run(input, context) {
  if (!context.webActor) {
    throw new Error("Authenticated web access required");
  }
  return context.host({ input, op: "postgresql" });
}
export {
  run
};
