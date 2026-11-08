import { readFileSync, writeFileSync } from 'node:fs'
const root = new URL('../', import.meta.url)
const { version } = JSON.parse(readFileSync(new URL('.claude-plugin/plugin.json', root), 'utf8'))
const file = new URL('skills/doomscroll-video/scripts/release.json', root)
const expected = `${JSON.stringify({ version, distribution: 'standalone' }, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== expected) throw new Error('Release metadata drift. Run node agent-plugin/hooks/generate-release.mjs')
} else writeFileSync(file, expected)
