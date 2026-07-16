export function languageFromSourcePath(path: string): string {
  const dot = path.lastIndexOf(".");

  if (dot === -1) {
    return "javascript";
  }

  switch (path.slice(dot)) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".json":
      return "json";
    default:
      return "javascript";
  }
}
