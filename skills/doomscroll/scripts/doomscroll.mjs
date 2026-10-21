#!/usr/bin/env node
// Doomscroll agent client: submit a pull request or a local diff, poll until the video is ready, download the MP4.
// Dependency-free (Node 18+). Reads the API key from DOOMSCROLL_API_KEY and never prints it.
// MIT License. See ../../../LICENSE.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const HELP = `Usage:
  doomscroll.mjs pr <owner/repo#number | github PR URL> [options]
  doomscroll.mjs local [--base <ref>] [--diff-file <path|->] [--title <text>] [--description <text>] [--repo <name>] [--include <path>]... [options]
  doomscroll.mjs status <id>
  doomscroll.mjs download <id> [--out <file.mp4>] [--gif <file.gif>]
  doomscroll.mjs me

Options:
  --theme classic|football|kpop   Video style (default classic)
  --out <file.mp4>                Where to save the video (default doomscroll-<id>.mp4)
  --gif <file.gif>                Also save the silent GIF preview
  --no-wait                       Submit and print the id without waiting
  --timeout <minutes>             Give up waiting after this long (default 60)

Environment:
  DOOMSCROLL_API_KEY   Your key from Doomscroll Settings -> Agent access (required)
  DOOMSCROLL_URL       Server origin (default https://doomscroll.build)

Progress goes to stderr; the final result is one JSON object on stdout.`

const LIMITS = { diff: 600_000, includes: 40, includeBytes: 100_000, includeTotal: 400_000 }
const fail = (message, code = 1) => { process.stderr.write(`doomscroll: ${message}\n`); process.exit(code) }
const log = message => process.stderr.write(`${message}\n`)

function parseArgs(argv) {
  const args = { _: [], include: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '--no-wait') args.noWait = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      if (key === 'include') args.include.push(value); else args[key] = value
    } else args._.push(arg)
  }
  return args
}

const origin = (process.env.DOOMSCROLL_URL || 'https://doomscroll.build').replace(/\/+$/, '')
const key = process.env.DOOMSCROLL_API_KEY
const headers = () => {
  if (!key) fail('DOOMSCROLL_API_KEY is not set. Create a key in Doomscroll Settings -> Agent access, then export it.')
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' }
}

async function call(path, body) {
  let response
  try {
    response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error' })
  } catch (error) { fail(`could not reach ${origin}: ${error.message}`) }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) fail(`${response.status} ${data.error || response.statusText}`, response.status === 401 ? 3 : response.status === 402 ? 4 : 1)
  return data
}

async function download(url, file) {
  const response = await fetch(url, { headers: headers(), redirect: 'error' })
  if (!response.ok) fail(`download failed: ${response.status}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  return file
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const tryGit = (...args) => { try { return git(...args) } catch { return '' } }

function parsePr(value) {
  const match = /github\.com\/([\w-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(value) || /^([\w-]+)\/([\w.-]+)#(\d+)$/.exec(value || '')
  if (!match) fail('give the PR as owner/repo#123 or its github.com URL')
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

function localChange(args) {
  let diff
  if (args.diffFile) diff = readFileSync(args.diffFile === '-' ? 0 : args.diffFile, 'utf8')
  else {
    // Everything on this branch plus uncommitted work, compared with where it left the base branch.
    const base = args.base || tryGit('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD') || 'main'
    const from = tryGit('merge-base', 'HEAD', base) || base
    diff = tryGit('diff', '--no-color', '--no-ext-diff', from)
  }
  if (!diff.trim()) fail('the diff is empty: commit or stage some changes, pass --base, or use --diff-file')
  if (diff.length > LIMITS.diff) fail(`the diff is ${diff.length} characters; the limit is ${LIMITS.diff}. Narrow it with --diff-file.`)
  if (args.include.length > LIMITS.includes) fail(`at most ${LIMITS.includes} --include files`)
  let total = 0
  const files = args.include.map(path => {
    const content = readFileSync(path, 'utf8').slice(0, LIMITS.includeBytes)
    total += content.length
    return { path: path.replace(/^\.\//, ''), content }
  })
  if (total > LIMITS.includeTotal) fail(`the --include files add up to more than ${LIMITS.includeTotal} characters`)
  const title = args.title || tryGit('log', '-1', '--format=%s') || tryGit('rev-parse', '--abbrev-ref', 'HEAD') || 'Local change'
  const top = tryGit('rev-parse', '--show-toplevel')
  const repo = args.repo || (top ? top.split(/[\\/]/).pop().replace(/[^\w.-]/g, '-') : undefined)
  return { title: title.slice(0, 300), description: (args.description || '').slice(0, 20_000), diff, ...(repo ? { repo } : {}), files }
}

async function wait(id, args) {
  const deadline = Date.now() + Number(args.timeout || 60) * 60_000
  let last = ''
  for (;;) {
    const { video } = await call(`/api/agent/videos/${id}`)
    const line = `${video.status}: ${video.stage}${video.progress.percent === null ? '' : ` (${video.progress.percent}%)`}`
    if (line !== last) { log(line); last = line }
    if (video.status === 'succeeded' || video.status === 'failed') return video
    if (Date.now() > deadline) fail(`still ${video.status} after ${args.timeout || 60} minutes; check later with: doomscroll.mjs status ${id}`, 5)
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
}

async function finish(video, args) {
  if (video.status === 'failed') { process.stdout.write(`${JSON.stringify({ id: video.id, status: 'failed', error: video.error })}\n`); process.exit(2) }
  const mp4 = await download(video.video.mp4Url, args.out || `doomscroll-${video.id}.mp4`)
  const gif = args.gif ? await download(video.video.gifUrl, args.gif) : undefined
  process.stdout.write(`${JSON.stringify({ id: video.id, status: 'succeeded', mp4, ...(gif ? { gif } : {}), previewUrl: video.video.previewUrl, watchUrl: video.video.watchUrl })}\n`)
}

const args = parseArgs(process.argv.slice(2))
const [command, target] = args._
if (args.help || !command) { process.stdout.write(`${HELP}\n`); process.exit(command || args.help ? 0 : 1) }
const theme = args.theme || 'classic'
if (!['classic', 'football', 'kpop'].includes(theme)) fail('--theme must be classic, football or kpop')

if (command === 'me') process.stdout.write(`${JSON.stringify(await call('/api/agent/me'))}\n`)
else if (command === 'status') { if (!target) fail('status needs an id'); process.stdout.write(`${JSON.stringify((await call(`/api/agent/videos/${encodeURIComponent(target)}`)).video)}\n`) }
else if (command === 'download') {
  if (!target) fail('download needs an id')
  const { video } = await call(`/api/agent/videos/${encodeURIComponent(target)}`)
  if (video.status !== 'succeeded') fail(`video is ${video.status}: ${video.error || video.stage}`)
  await finish(video, args)
} else if (command === 'pr' || command === 'local') {
  const body = command === 'pr' ? { pr: parsePr(target), theme } : { change: localChange(args), theme }
  const { video, credits } = await call('/api/agent/videos', body)
  log(`queued ${video.id} (${credits.unlimited ? 'unlimited' : `${credits.remaining} credits left`})`)
  if (args.noWait) process.stdout.write(`${JSON.stringify({ id: video.id, status: video.status })}\n`)
  else await finish(await wait(video.id, args), args)
} else fail(`unknown command "${command}"\n\n${HELP}`)
