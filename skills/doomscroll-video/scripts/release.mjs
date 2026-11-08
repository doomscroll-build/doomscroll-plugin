import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifest = new URL('../../../.claude-plugin/plugin.json', import.meta.url)
const shipped = JSON.parse(readFileSync(new URL('./release.json', import.meta.url), 'utf8'))
export const release = existsSync(fileURLToPath(manifest))
  ? { ...shipped, version: JSON.parse(readFileSync(manifest, 'utf8')).version, distribution: 'claude-plugin' }
  : shipped
export function clientHeaders(url, origin) {
  if (new URL(url).origin !== new URL(origin).origin) return {}
  const distribution = ['claude-plugin', 'standalone', 'codex-plugin'].includes(process.env.DOOMSCROLL_DISTRIBUTION)
    ? process.env.DOOMSCROLL_DISTRIBUTION : release.distribution
  return { 'X-DoomScroll-Client': 'doomscroll-cli', 'X-DoomScroll-Version': release.version, 'X-DoomScroll-Distribution': distribution }
}
