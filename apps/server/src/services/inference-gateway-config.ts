export function isInferenceGatewayEnabled(): boolean {
  return process.env.NAKAMA_INFERENCE_GATEWAY_ENABLED === "1";
}
