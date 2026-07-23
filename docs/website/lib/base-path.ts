/** Must match `basePath` in next.config.mjs */
export const BASE_PATH = '/nakama'

export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path
  return `${BASE_PATH}${path}`
}

export function hrefWithBasePath(href: string | undefined): string | undefined {
  if (
    typeof href === 'string' &&
    href.startsWith('/') &&
    !href.startsWith('http') &&
    !href.startsWith('#')
  ) {
    return withBasePath(href)
  }
  return href
}
