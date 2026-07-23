/** Must match `basePath` in next.config.mjs */
export const BASE_PATH = '/nakama'

export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  if (path.startsWith(BASE_PATH)) return path
  return `${BASE_PATH}${path}`
}
