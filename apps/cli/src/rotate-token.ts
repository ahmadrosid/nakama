import {
  getLocalAuthTokenPath,
  LocalAuthTokenManagedExternallyError,
  rotateLocalAuthToken,
} from "@nakama/core/local-auth";

export function isRotateTokenCommand(argv = process.argv.slice(2)): boolean {
  return argv[0] === "rotate-token";
}

export async function runRotateToken(): Promise<void> {
  await rotateLocalAuthToken();

  console.log("Local auth token rotated.");
  console.log(`Token file: ${getLocalAuthTokenPath()}`);
  console.log("");
  console.log(
    "Workers reload from disk on the next request. Restart them if anything stays disconnected."
  );
}

export function formatRotateTokenError(error: unknown): string {
  if (error instanceof LocalAuthTokenManagedExternallyError) {
    return error.message;
  }

  return error instanceof Error ? error.message : String(error);
}
