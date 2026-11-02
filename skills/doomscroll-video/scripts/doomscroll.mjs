#!/usr/bin/env node
// DoomScroll agent client: submit a pull request or a local diff, poll until the video is ready, download the MP4; and use
// DoomScroll's metered voice APIs (speech, word-timed transcription) without an OpenAI key of your own.
// Dependency-free (Node 18+). Reads the key from DOOMSCROLL_API_KEY or the browser sign-in saved by `login`, and never prints it.
// MIT License. See ../../../LICENSE.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `Usage:
  doomscroll.mjs login                     Sign in through the browser (saves a key for this machine)
  doomscroll.mjs logout                    Forget the saved key
  doomscroll.mjs speak <text|-> --out <file.mp3> [--voice onyx] [--instructions <text>] [--model gpt-4o-mini-tts] [--speed 1]
  doomscroll.mjs transcribe <audio file> [--out <file.json>] [--model whisper-1] [--words]
  doomscroll.mjs pr <owner/repo#number | github PR URL> [options]
  doomscroll.mjs local [--base <ref>] [--diff-file <path|->] [--title <text>] [--description <text>] [--repo <name>] [--include <path>]... [options]
  doomscroll.mjs item follow <id>             Bind this session to future feedback on current bytes
  doomscroll.mjs item post <manifest.json>    Upload files and submit a stored review item
  doomscroll.mjs item feedback [--project <slug>] [--since <id>] [--latest 1] [--json]   Responses after a numeric cursor; --latest 1 keeps only each reviewer's newest per item revision
  doomscroll.mjs item get <id>                Print the item as the API returns it ({"item":{revision,state,responses,...}})
  doomscroll.mjs item reply <id> <text> [--revision <sha>]   Comment on the revision you reviewed (stale = 409, no comment); default: the current one
  doomscroll.mjs item tags <id> a,b
  doomscroll.mjs item project <slug> <scheme.json>   Set a project's verdict scheme ({"verdicts":[{id,label,tone,emoji?}]})
  doomscroll.mjs item events [--since <seq>] [--limit <n>]   Your change log after a sequence number (raw API JSON); exit 6 when the cursor was swept
  doomscroll.mjs status <id>
  doomscroll.mjs download <id> [--out <file.mp4>] [--gif <file.gif>]
  doomscroll.mjs share <id>                     Enable its stable public-by-link MP4 URL
  doomscroll.mjs unshare <id>                   Disable its public MP4 URL
  doomscroll.mjs me
  doomscroll.mjs gh                            Let DoomScroll read your PRs with your GitHub CLI sign-in (ask the user first)
  doomscroll.mjs auto on|off|status          Automatic PR videos and video offers in Claude Code (the plugin's hooks; default on)
  doomscroll.mjs watermark <video> [--out <file.mp4>] [--jingle <audio> --jingle-start <s>] [--threads <n>]   Brand any video: DoomScroll mark at the bottom right + a short outro (needs ffmpeg)

Options:
  --theme classic|football|kpop   Video style (default classic)
  --language <id>                 en ar es fr de pt tr hi id ja ko zh (default: your DoomScroll setting, else en)
  --notes <file.json|->           Your write-up of the change: components, architecture, how it works (see SKILL.md)
  --screen <image>=<caption>      A screenshot of the UI the change touches (repeat, up to 4), e.g. --screen before.png="Before: no bell"
  --publish                      PR only: post progress, failures and the hosted video link
  --no-publish                   Keep the video private to DoomScroll (default)
  --shareable                    Enable a stable unguessable public MP4 link
  --private                      Disable the public MP4 link (local defaults shared; PR defaults private)
  --out <file.mp4>                Where to save the video (default doomscroll-<id>.mp4)
  --gif <file.gif>                Also save the silent GIF preview
  --or-shareable                  With --publish: when DoomScroll cannot publish (no write access, Stealth on), make it shareable instead
  --comment                       PR only: post one PR comment with your own gh right after submitting: the preview GIF (a
                                  "cooking" animation until the video is ready) linking to DoomScroll; a re-run edits it
  --auto                          PR only: you are making it on your own (after a push), not because the user asked; when the
                                  DoomScroll GitHub App makes this PR's videos already, nothing is queued and its link is printed
  --open                          Open the finished video in the browser (its DoomScroll page, else the share link, else the MP4)
  --no-wait                       Submit and print the id and the links the video will have, without waiting
  --timeout <minutes>             Give up waiting after this long (default 60)

Sign-in (either one):
  doomscroll.mjs login   Opens a browser page; approve the code and the key is saved to ~/.config/doomscroll/credentials.json
  DOOMSCROLL_API_KEY     A key from DoomScroll Settings -> Agent access (wins over the saved one)

Voice for any OpenAI SDK: base URL <DOOMSCROLL_URL>/api/agent/v1 with the DoomScroll key as the API key
(POST /audio/speech, POST /audio/transcriptions). Every call is paid in DoomScroll credits.

Environment:
  DOOMSCROLL_URL       Server origin (default https://doomscroll.build)
  DOOMSCROLL_TIMEOUT_MS  Deadline of one small read (default 30000, 100..3600000): a write gets 2x, a long poll 2x, a
                       64 MiB upload part 10x, a voice call 10x, an MP4 download 20x; each covers headers and body.
                       A read (GET/HEAD) gets 3 attempts; the server's hash check of a committed upload is waited out
                       up to the upload deadline (10x); a video poll runs every 10 s (or this value when smaller)
  DOOMSCROLL_PART_BYTES  Upload part size in bytes (default 64 MiB, 1..64 MiB): smaller parts bound each PUT on slow links

Exit codes: 0 ok, 1 bad input or a refused request (the message names the HTTP status; a redirect, an empty upload file or
an invalid upload state from the server count as refused), 2 the video failed, 3 not signed in, 4 out of credits, 5 still
running after --timeout, 6 the events cursor was swept (stdout: {"error":"resync","status":410,"since","message"}; re-read
the current state, then continue from a newer cursor), 7 unreachable (a deadline, a network error, or 429/5xx on every
bounded read attempt; an upload still being verified past its deadline; a video poll rate-limited past --timeout: retry
later, nothing is assumed done). A write (reply, tags, item, voice) is sent once: its 5xx is reported as refused.
  FFMPEG, FFPROBE      ffmpeg/ffprobe binaries for watermark (default: from PATH)
  FFMPEG_THREADS       Threads for watermark's decoder and x264 encoder, like --threads (default: ffmpeg's own)

Progress goes to stderr; the final result is one JSON object on stdout.`

const LIMITS = { diff: 600_000, includes: 40, includeBytes: 100_000, includeTotal: 400_000 }
const fail = (message, code = 1) => { process.stderr.write(`doomscroll: ${message}\n`); process.exit(code) }
const log = message => process.stderr.write(`${message}\n`)

function parseArgs(argv) {
  const args = { _: [], include: [], screen: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '--no-wait') args.noWait = true
    else if (arg === '--json') args.json = true
    else if (arg === '--words') args.words = true
    else if (arg === '--publish') args.publish = true
    else if (arg === '--no-publish') args.noPublish = true
    else if (arg === '--shareable') args.shareable = true
    else if (arg === '--private') args.private = true
    else if (arg === '--open') args.open = true
    else if (arg === '--auto') args.auto = true
    else if (arg === '--comment') args.comment = true
    else if (arg === '--or-shareable') args.orShareable = true
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      const value = argv[++i]
      if (value === undefined) fail(`${arg} needs a value`)
      if (key === 'include' || key === 'screen') args[key].push(value); else args[key] = value
    } else args._.push(arg)
  }
  return args
}

const origin = (process.env.DOOMSCROLL_URL || 'https://doomscroll.build').replace(/\/+$/, '')
const CONFIG = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'doomscroll')
const CREDENTIALS = join(CONFIG, 'credentials.json'), SETTINGS = join(CONFIG, 'settings.json')
const saved = () => { try { return JSON.parse(readFileSync(CREDENTIALS, 'utf8'))[origin]?.apiKey } catch { return undefined } }
const key = process.env.DOOMSCROLL_API_KEY || saved()
const headers = () => {
  if (!key) fail('not signed in. Run: doomscroll.mjs login (or export DOOMSCROLL_API_KEY from DoomScroll Settings -> Agent access).', 3)
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' }
}
const bounded = (value, fallback, min, max) => { const n = Number(value); return value === undefined || value === '' ? fallback : Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fail(`${value} is out of range ${min}..${max}`) }
const READ_MS = bounded(process.env.DOOMSCROLL_TIMEOUT_MS, 30_000, 100, 3_600_000)
/** Per-purpose deadlines, each covering headers and body of one attempt. */
const DEADLINES = { read: READ_MS, write: 2 * READ_MS, poll: 2 * READ_MS, upload: 10 * READ_MS, voice: 10 * READ_MS, download: 20 * READ_MS }
const RETRY = { attempts: 3, backoff: READ_MS / 30, recoveries: 3 }
/** Between two video status polls (10 s, or the read deadline when it is shorter, so tests run on a short clock). */
const POLL_MS = Math.min(10_000, READ_MS)
const PART_BYTES = bounded(process.env.DOOMSCROLL_PART_BYTES, 64 * 1024 * 1024, 1, 64 * 1024 * 1024)
const exitFor = status => status === 401 ? 3 : status === 402 ? 4 : 1

/**
 * One request owner for every DoomScroll call. Each attempt has a deadline that covers the headers AND the body (the
 * AbortController fires either way), scaled per purpose from DOOMSCROLL_TIMEOUT_MS. Retries are bounded and only for
 * safe reads (GET/HEAD, 5xx/429/network/deadline, Retry-After honored up to the deadline); a POST/PUT is sent once and its
 * caller decides what an ambiguous answer means. Returns {response, data} for any definite HTTP answer (a redirect is one:
 * never followed, so callers refuse it like any other non-2xx), or {transient} once a retried read ran out of attempts
 * without one (a 429/5xx on the last attempt included). `data` is parsed JSON ({} when the body is not JSON), text with
 * {text: true}, a Buffer with {raw: true}. The transient message names the resolved URL without its query and never a body.
 */
async function http(path, { method = 'GET', headers: extra = {}, body, purpose = 'read', retry = method === 'GET' || method === 'HEAD', auth = true, raw = false, text = false } = {}) {
  const deadline = DEADLINES[purpose], attempts = retry ? RETRY.attempts : 1, url = /^https?:\/\//.test(path) ? path : origin + path
  let last = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deadline)
    try {
      const response = await fetch(url, { method, headers: { ...(auth ? headers() : {}), ...extra }, body, redirect: 'manual', signal: controller.signal })
      const bytes = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
      clearTimeout(timer)
      if (retry && (response.status === 429 || response.status >= 500)) {
        last = `HTTP ${response.status} on every one of ${attempts} attempts`
        if (attempt < attempts) await sleep(retryAfter(response, attempt))
        continue
      }
      let data = bytes
      if (!raw) { const string = bytes.toString('utf8'); if (text) data = string; else { try { data = JSON.parse(string) } catch { data = {} } } }
      return { response, data }
    } catch (error) {
      clearTimeout(timer)
      last = controller.signal.aborted ? `no complete answer within the ${deadline} ms deadline` : (error.cause?.code || error.cause?.message || error.message)
      if (attempt < attempts) await sleep(retryAfter(undefined, attempt))
    }
  }
  return { transient: `could not reach ${url.split('?')[0]}: ${last}` }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/** Retry-After in seconds (or an HTTP date), capped at the read deadline; else exponential backoff from RETRY.backoff. */
function retryAfter(response, attempt) {
  const header = response?.headers.get('retry-after')
  const seconds = header === null || header === undefined ? NaN : /^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, DEADLINES.read)
  return RETRY.backoff * 2 ** (attempt - 1)
}

/** Opens a URL or file with the system's default app; a headless machine just keeps the printed link. */
function openInBrowser(target) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try { execFileSync(opener, [target], { stdio: 'ignore', timeout: 5000 }); return true } catch { return false }
}

/** Browser sign-in (device code): show a code, the user approves it on doomscroll, the key lands in a 0600 file, never on screen. */
async function login() {
  const post = (path, body) => http(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), purpose: 'write', auth: false })
  const started = await post('/api/agent/device')
  if (started.transient) fail(started.transient, 7)
  const start = started.data
  if (!start.device_code) fail(`could not start sign-in: ${start.error || 'unexpected answer'}`)
  log(`Open ${start.verification_uri_complete}\nand approve the code ${start.user_code}`)
  openInBrowser(start.verification_uri_complete)
  const deadline = Date.now() + start.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, (start.interval || 3) * 1000))
    // A deploy or a network blip must not end the sign-in: keep polling through 5xx and connection errors until the code expires.
    const { response, data } = await post('/api/agent/device/token', { device_code: start.device_code })
    if (!response || response.status === 428 || response.status >= 500) continue
    if (!response.ok) fail(data.error || `sign-in failed: ${response.status}`)
    let all = {}
    try { all = JSON.parse(readFileSync(CREDENTIALS, 'utf8')) } catch { /* first sign-in */ }
    mkdirSync(dirname(CREDENTIALS), { recursive: true, mode: 0o700 })
    writeFileSync(CREDENTIALS, JSON.stringify({ ...all, [origin]: { apiKey: data.api_key, login: data.login } }, null, 2), { mode: 0o600 })
    chmodSync(CREDENTIALS, 0o600)
    process.stdout.write(`${JSON.stringify({ signedIn: data.login, credentials: CREDENTIALS })}\n`)
    return
  }
  fail('the sign-in code expired; run login again')
}

/** Text to speech through DoomScroll (OpenAI gpt-4o-mini-tts upstream), written straight to a file. */
async function speak(text, args) {
  if (!args.out) fail('speak needs --out <file.mp3>')
  const input = text === '-' ? readFileSync(0, 'utf8') : text
  if (!input?.trim()) fail('speak needs the text, or - to read it from stdin')
  const format = args.out.split('.').pop()
  const body = { model: args.model || 'gpt-4o-mini-tts', voice: args.voice || 'onyx', input, ...(args.instructions ? { instructions: args.instructions } : {}), ...(args.speed ? { speed: Number(args.speed) } : {}), ...(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].includes(format) ? { response_format: format } : {}) }
  // Paid: one attempt, never retried (a lost answer may already have been charged).
  const { response, data, transient } = await http('/api/agent/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), purpose: 'voice', raw: true })
  if (transient) fail(transient, 7)
  if (!response.ok) { let error; try { error = JSON.parse(data.toString('utf8')).error } catch { /* not JSON */ } fail(`${response.status} ${error || response.statusText}`, exitFor(response.status)) }
  writeFileSync(args.out, data)
  process.stdout.write(`${JSON.stringify({ file: args.out, creditsRemaining: Number(response.headers.get('x-doomscroll-credits-remaining')) })}\n`)
}

/** Speech to text through DoomScroll (OpenAI upstream); --words asks for word timestamps (verbose_json). */
async function transcribe(file, args) {
  if (!file || !existsSync(file)) fail('transcribe needs an audio file')
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)]), basename(file))
  form.append('model', args.model || 'whisper-1')
  if (args.words) { form.append('response_format', 'verbose_json'); form.append('timestamp_granularities[]', 'word') }
  const { response, data: text, transient } = await http('/api/agent/v1/audio/transcriptions', { method: 'POST', body: form, purpose: 'voice', text: true })
  if (transient) fail(transient, 7)
  if (!response.ok) { let error; try { error = JSON.parse(text).error } catch { /* not JSON */ } fail(`${response.status} ${error || response.statusText}`, exitFor(response.status)) }
  if (args.out) { writeFileSync(args.out, text); process.stdout.write(`${JSON.stringify({ file: args.out })}\n`) } else process.stdout.write(`${text}\n`)
}

/** A JSON API call: reads are retried, writes are sent once; an exhausted read or a lost write answer is exit 7. */
async function request(path, body, method = body ? 'POST' : 'GET') {
  const answer = await http(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, purpose: body ? 'write' : 'read' })
  if (answer.transient) fail(answer.transient, 7)
  return answer
}

async function call(path, body, method) {
  const { response, data } = await request(path, body, method)
  if (!response.ok) fail(`${response.status} ${data.error || response.statusText}`, exitFor(response.status))
  return data
}

async function download(url, file) {
  const { response, data, transient } = await http(url, { purpose: 'download', raw: true })
  if (transient) fail(transient, 7)
  if (!response.ok) fail(`download failed: ${response.status}`, exitFor(response.status))
  writeFileSync(file, data)
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
    // A deploy, a network blip or a rate limit must not end the wait (the render keeps going on the server): keep polling
    // through 5xx, connection errors and 429 (its Retry-After honored, capped) until the overall deadline.
    const { response, data, transient } = await http(`/api/agent/videos/${id}`, { purpose: 'poll', retry: false })
    if (transient || response.status === 429 || response.status >= 500) {
      if (Date.now() > deadline) fail(transient || `could not reach ${origin}: ${response.status}`, 7)
      if (last !== 'blip') { log(`connection problem (${transient || response.status}), still waiting`); last = 'blip' }
      await sleep(Math.min(Math.max(POLL_MS, response?.status === 429 ? retryAfter(response, 1) : 0), deadline - Date.now()))
      continue
    }
    if (!response.ok) fail(`${response.status} ${data.error || response.statusText}`, exitFor(response.status))
    const { video } = data
    const line = `${video.status}: ${video.stage}${video.progress.percent === null ? '' : ` (${video.progress.percent}%)`}`
    if (line !== last) { log(line); last = line }
    if (video.status === 'succeeded' || video.status === 'failed') return video
    if (Date.now() > deadline) fail(`still ${video.status} after ${args.timeout || 60} minutes; check later with: doomscroll.mjs status ${id}`, 5)
    await sleep(POLL_MS)
  }
}

async function finish(video, args, extra = {}) {
  if (video.status === 'failed') { process.stdout.write(`${JSON.stringify({ id: video.id, status: 'failed', error: video.error })}\n`); process.exit(2) }
  const mp4 = await download(video.video.mp4Url, args.out || `doomscroll-${video.id}.mp4`)
  const gif = args.gif ? await download(video.video.gifUrl, args.gif) : undefined
  const opened = args.open ? openInBrowser(video.video.watchUrl || video.video.shareUrl || resolve(mp4)) : undefined
  process.stdout.write(`${JSON.stringify({ id: video.id, status: 'succeeded', mp4, ...(gif ? { gif } : {}), previewUrl: video.video.previewUrl, watchUrl: video.video.watchUrl, publish: video.publish, shareable: video.shareable, shareUrl: video.video.shareUrl, ...(args.open ? { opened } : {}), ...extra })}\n`)
}

const args = parseArgs(process.argv.slice(2))
const [command, target] = args._
if (args.help || !command) { process.stdout.write(`${HELP}\n`); process.exit(command || args.help ? 0 : 1) }
const theme = args.theme || 'classic'
if (!['classic', 'football', 'kpop'].includes(theme)) fail('--theme must be classic, football or kpop')
const LANGUAGES = ['en', 'ar', 'es', 'fr', 'de', 'pt', 'tr', 'hi', 'id', 'ja', 'ko', 'zh']
if (args.language && !LANGUAGES.includes(args.language)) fail(`--language must be one of ${LANGUAGES.join(' ')}`)
if (args.publish && args.noPublish) fail('choose --publish or --no-publish, not both')
if (args.publish && command === 'local') fail('--publish is only available for pull requests')
if (args.auto && command !== 'pr') fail('--auto is only available for pull requests')
if (args.comment && command !== 'pr') fail('--comment is only available for pull requests')
if (args.shareable && args.private) fail('choose --shareable or --private, not both')
if (args.orShareable && !args.publish) fail('--or-shareable goes with --publish')
/** Every DoomScroll video carries this tag once branded, so branding twice is a no-op. */
const BRAND_TAG = 'Made with DoomScroll'
const OUTRO_SECONDS = 1.6
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

/** A small DoomScroll mark at the bottom right, then a TikTok-style outro: the logo pops in on black, the name fades up under it and the jingle plays. */
function watermark(input, output, jingle, jingleStart, threads) {
  if (!input || !existsSync(input)) fail('watermark needs a video file')
  if (threads !== undefined && !/^[1-9]\d?$/.test(threads)) fail('--threads must be a whole number from 1 to 99')
  const out = resolve(output || input.replace(/(\.[^./]+)?$/, '-doomscroll.mp4'))
  const ffmpeg = process.env.FFMPEG || 'ffmpeg', ffprobe = process.env.FFPROBE || 'ffprobe'
  const run = (bin, argv) => {
    try { return execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10_000_000 }) }
    catch (error) { fail(error.code === 'ENOENT' ? `${bin} not found; install ffmpeg` : `${bin} failed: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`) }
  }
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]))
  const video = probe.streams.find(stream => stream.codec_type === 'video')
  if (!video) fail(`${input} has no video stream`)
  if (probe.format.tags?.comment?.toLowerCase() === BRAND_TAG.toLowerCase()) {
    if (resolve(input) !== out) copyFileSync(input, out)
    return out
  }
  // Another sound for the outro (any audio file; only its first outro-length seconds from --jingle-start play, faded out).
  if (jingle && !existsSync(jingle)) fail(`jingle ${jingle} not found`)
  const W = video.width, H = video.height, D = Number(probe.format.duration), O = OUTRO_SECONDS
  const unit = Math.min(W, H) / 1080, markWidth = Math.round(330 * unit), markY = Math.round(H * 0.42)
  // Pops past full size, then settles: 0 → 1.15 by 0.25 s, back to 1 by 0.4 s.
  const bounce = 'if(lt(t,0.25),t/0.25*1.15,if(lt(t,0.4),1.15-(t-0.25),1))'
  const hasAudio = probe.streams.some(stream => stream.codec_type === 'audio')
  const graph = [
    `[0:v]tpad=stop_duration=${O}:color=black,setsar=1[base]`,
    `[1:v]scale=${Math.round(W * 0.15 / 2) * 2}:-2,format=rgba,colorchannelmixer=aa=0.55[wm]`,
    `[base][wm]overlay=x=W-w-${Math.round(W * 0.1)}:y=H-h-${Math.round(H * 0.035)}:enable='lt(t,${D})'[v1]`,
    `[2:v]format=rgba,scale=w='max(2,trunc(${markWidth}*(${bounce})/2)*2)':h=-2:eval=frame,setpts=PTS-STARTPTS+${D}/TB[mark]`,
    `[v1][mark]overlay=x=(W-w)/2:y=${markY}-h/2:enable='gte(t,${D})':eof_action=pass[v2]`,
    `[3:v]format=rgba,scale=${Math.round(560 * unit / 2) * 2}:-2,fade=in:st=0.35:d=0.3:alpha=1,setpts=PTS-STARTPTS+${D}/TB[name]`,
    `[v2][name]overlay=x=(W-w)/2:y=${markY + Math.round(markWidth * 0.62)}:enable='gte(t,${D})':eof_action=pass,format=yuv420p[v]`,
    // The jingle starts with the outro; the video's own audio (if any) is padded with silence under it.
    `[4:a]atrim=0:${O},afade=t=out:st=${O - 0.3}:d=0.3,aresample=48000,aformat=channel_layouts=stereo,adelay=delays=${Math.round(D * 1000)}:all=1,volume=0.45[jingle]`,
    hasAudio ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur=${O}[voice];[voice][jingle]amix=inputs=2:duration=first:normalize=0[mix]` : `[jingle]apad=whole_dur=${D + O}[mix]`,
    // Phone video is mastered near -14 LUFS; TTS arrives near -25, so it played ~10 dB quieter than everything around it.
    `[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[a]`,
  ].join(';')
  const image = name => ['-loop', '1', '-framerate', '30', '-t', String(O), '-i', join(ASSETS, name)]
  run(ffmpeg, ['-v', 'error', '-y', '-threads', threads ?? '2', '-i', input, '-loop', '1', '-framerate', '30', '-t', String(D), '-i', join(ASSETS, 'watermark.png'), ...image('mark.png'), ...image('outro-text.png'), ...(jingle ? ['-ss', String(Number(jingleStart) || 0)] : []), '-i', jingle || join(ASSETS, 'jingle.m4a'),
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', ...(threads ? ['-threads', threads] : []), '-movflags', '+faststart', '-metadata', `comment=${BRAND_TAG}`, out])
  return out
}

/** The tmux pane this agent runs in, so a comment on its local video can reach this session; nothing outside tmux. */
function sessionSource() {
  const pane = process.env.TMUX_PANE
  if (!process.env.TMUX || !/^%\d+$/.test(pane ?? '')) return {}
  try {
    const [tmuxSession, currentPane, cwd] = execFileSync('tmux', ['display-message', '-p', '-t', pane, '#S\t#{pane_id}\t#{pane_current_path}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim().split('\t')
    return tmuxSession && currentPane === pane && cwd ? { source: { tmuxSession, tmuxPane: pane, cwd } } : {}
  } catch { return {} }
}

/** `--screen <image>=<caption>` files as data URLs; one over 1.5 MB is shrunk to a 1080 px wide JPEG with ffmpeg when it is installed. */
function readScreens(values) {
  if (values.length > 4) fail('at most 4 --screen images')
  return values.map(value => {
    const at = value.indexOf('='), path = at < 0 ? value : value.slice(0, at), caption = (at < 0 ? '' : value.slice(at + 1)).trim()
    if (!caption) fail(`--screen ${path} needs a caption: --screen ${path}="After: the new button"`)
    if (!existsSync(path)) fail(`--screen ${path} not found`)
    let bytes = readFileSync(path), type = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' }[path.split('.').pop().toLowerCase()]
    if (!type) fail(`--screen ${path} must be a PNG, JPEG or WebP`)
    if (bytes.length > 1_500_000) {
      try { bytes = execFileSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-i', path, '-vf', "scale='min(1080,iw)':-2", '-frames:v', '1', '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 50_000_000 }); type = 'jpeg' }
      catch { fail(`--screen ${path} is over 1.5 MB; shrink it (ffmpeg was not available to do it)`) }
      if (bytes.length > 1_500_000) fail(`--screen ${path} is still over 1.5 MB after shrinking`)
    }
    return { caption: caption.length > 120 ? `${caption.slice(0, 119).replace(/\s+\S*$/, '')}…` : caption, image: `data:image/${type};base64,${bytes.toString('base64')}` }
  })
}

const COMMENT_MARKER = '<!-- doomscroll-agent-video -->'
/**
 * `--comment`: one PR comment from the user's own gh, like the bot's. Its GIF URL serves a "cooking" animation while the video
 * renders and the video's preview once it is ready, so it is posted at once. A re-run edits the user's earlier one (its marker).
 */
function commentOnPr({ owner, repo, number }, video) {
  if (video.publish) return { comment: 'skipped', commentReason: 'DoomScroll posts this video on the PR itself' }
  const { watchUrl, previewUrl, shareUrl } = video.links ?? {}
  if (!previewUrl) return { comment: 'skipped', commentReason: 'no preview link' }
  const site = new URL(origin)
  const body = `${COMMENT_MARKER}\n### 🎬 DoomScroll video of this PR\n\n[![DoomScroll video: it plays here when it is ready](${previewUrl})](${watchUrl})\n\n**[▶ Watch on DoomScroll](${watchUrl})**${shareUrl ? ` · [Play the MP4](${shareUrl})` : ''}, a short narrated walkthrough of this pull request.\n\n<sub>🎬 10x your reviews! Watch your PRs as videos with [${site.host.replace(/^doomscroll/i, 'DoomScroll')}](${site.origin}/)</sub>\n`
  const gh = (ghArgs, input) => execFileSync('gh', ghArgs, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  try {
    const me = gh(['api', 'user', '--jq', '.login'])
    const mine = gh(['api', '--paginate', `repos/${owner}/${repo}/issues/${number}/comments`, '--jq', `.[] | select(.user.login == "${me}" and (.body | contains("${COMMENT_MARKER}"))) | .id`]).split('\n').filter(Boolean)
    if (mine.length) return { comment: gh(['api', '-X', 'PATCH', `repos/${owner}/${repo}/issues/comments/${mine.at(-1)}`, '--input', '-', '--jq', '.html_url'], JSON.stringify({ body })), commentEdited: true }
    return { comment: gh(['pr', 'comment', `https://github.com/${owner}/${repo}/pull/${number}`, '--body-file', '-'], body).split('\n').at(-1) }
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'gh not found' : String(error.stderr || error.message).trim().split('\n').at(-1)
    log(`could not comment on the PR: ${reason}`)
    return { comment: 'failed', commentReason: reason }
  }
}

function readNotes(path) {
  if (!path) return undefined
  try { return JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) } catch (error) { fail(`--notes must be a JSON file: ${error.message}`) }
}


async function itemCommand(action, args) {
  const id = args._[2]
  if (action === 'feedback') {
    const query = new URLSearchParams({ since: args.since || '0' })
    if (args.project) query.set('project', args.project)
    if (args.latest !== undefined) query.set('latest', args.latest)
    return call(`/api/agent/responses?${query}`)
  }
  if (action === 'events') {
    const query = new URLSearchParams({ since: args.since || '0', ...(args.limit === undefined ? {} : { limit: args.limit }) })
    const { response, data } = await request(`/api/agent/events?${query}`)
    // 410: events after `since` were swept. Never an empty list: the caller must re-read state before continuing.
    if (response.status === 410 && data.resync) { process.stdout.write(`${JSON.stringify({ error: 'resync', status: 410, since: Number(args.since || 0), message: data.error })}\n`); process.exit(6) }
    if (!response.ok) fail(`${response.status} ${data.error || response.statusText}`, exitFor(response.status))
    return data
  }
  if (!id) fail(`item ${action} needs ${action === 'post' ? 'a manifest file' : action === 'project' ? 'a project slug and a scheme file' : 'an item id'}`)
  if (action === 'project') {
    if (!args._[3]) fail('item project needs <slug> <scheme.json>')
    let scheme
    try { scheme = JSON.parse(readFileSync(args._[3], 'utf8')) } catch (error) { fail(`the scheme must be a JSON file: ${error.message}`) }
    return call(`/api/agent/projects/${encodeURIComponent(id)}`, scheme, 'PUT')
  }
  if (action === 'follow') {
    const context = sessionSource()
    if (!context.source) fail('item follow requires an exact current tmux session')
    return call(`/api/agent/items/${encodeURIComponent(id)}/follow`, context)
  }
  if (action === 'get') return call(`/api/agent/items/${encodeURIComponent(id)}`)
  if (action === 'reply') {
    const text = args._.slice(3).join(' ')
    if (!text) fail('item reply needs text')
    // --revision is the revision the caller reviewed, sent as given, so the server's 409 catches a newer upload in between;
    // without it the comment goes on whatever the item's current revision is now.
    const revision = args.revision ?? (await call(`/api/agent/items/${encodeURIComponent(id)}`)).item.revision
    return call(`/api/agent/items/${encodeURIComponent(id)}/responses`, { kind: 'comment', revision, text, ...sessionSource() })
  }
  if (action === 'tags') return call(`/api/agent/items/${encodeURIComponent(id)}/tags`, { tags: (args._[3] || '').split(',').filter(Boolean) }, 'PUT')
  if (action !== 'post') fail('item takes post, follow, get, feedback, reply, tags, project or events')
  const file = resolve(id), root = dirname(file), input = JSON.parse(readFileSync(file, 'utf8'))
  const seen = new Set()
  for (const [path, sha] of [...Object.entries(input.manifest || {}), ...Object.entries(input.panelBlobs || {})]) {
    if (!/^[a-f0-9]{64}$/.test(sha)) fail(`invalid SHA-256 for ${path}`)
    if (seen.has(sha)) continue
    seen.add(sha)
    const endpoint = `/api/agent/blobs/${sha}`
    const local = resolve(root, path), rel = relative(root, local)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) fail(`file outside manifest directory: ${path}`)
    const fd = openSync(local, 'r')
    try {
      const size = fstatSync(fd).size, hash = createHash('sha256'), buffer = Buffer.alloc(Math.min(size, PART_BYTES))
      if (!size) fail(`${path} is empty; the server stores no empty files`)
      for (let position = 0; position < size;) { const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position); if (!n) fail(`short read: ${path}`); hash.update(buffer.subarray(0, n)); position += n }
      if (hash.digest('hex') !== sha) fail(`file does not match manifest SHA-256: ${path}`)
      await uploadBlob(endpoint, path, size, offset => { const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset); if (!n) fail(`short read: ${path}`); return buffer.subarray(0, n) })
    } finally { closeSync(fd) }
  }
  return call('/api/agent/items', { ...input, ...sessionSource() })
}

/**
 * What the server has of this blob: `complete`, or the verified offset the next part must start at (0 when unknown).
 * The three upload headers must all be present and consistent with this file (a missing Upload-Offset is not 0): anything
 * else is refused before a single byte is sent.
 */
async function serverOffset(endpoint, size) {
  const { response, transient } = await http(endpoint, { method: 'HEAD', purpose: 'read' })
  if (transient) fail(transient, 7)
  if (response.status === 404) return 0
  if (response.status !== 200 && response.status !== 204) fail(`blob check failed: ${response.status}`, exitFor(response.status))
  const complete = response.headers.get('Upload-Complete'), offset = response.headers.get('Upload-Offset'), length = response.headers.get('Upload-Length')
  const valid = (complete === 'true' || complete === 'false') && /^\d+$/.test(offset ?? '') && length === String(size) && Number(offset) <= size && (complete === 'false' || Number(offset) === size)
  if (!valid) fail('the server answered the blob check with an invalid upload state')
  return complete === 'true' ? 'complete' : Number(offset)
}

/**
 * Resumable upload driven by the server's verified offset. Every part is PUT once; an ambiguous answer (deadline, network,
 * 5xx) or an offset conflict (409) re-HEADs and continues from what the server has, so committed bytes are never re-sent
 * and nothing is assumed done. `recoveries` consecutive rounds without progress give up (exit 7). Once every byte is
 * committed (offset = size, not complete) the server is hashing them: that is polled with growing pauses, never re-PUT,
 * up to the upload deadline, then exit 7.
 */
async function uploadBlob(endpoint, path, size, part) {
  let offset = await serverOffset(endpoint, size), stalls = 0, polls = 0, verifyBy = 0
  while (offset !== 'complete') {
    if (offset === size) {
      verifyBy ||= Date.now() + DEADLINES.upload
      if (Date.now() >= verifyBy) fail(`upload of ${path}: the server was still verifying the bytes ${DEADLINES.upload} ms after they were all committed`, 7)
      await sleep(Math.min(RETRY.backoff * 2 ** polls++, DEADLINES.read, verifyBy - Date.now()))
      offset = await serverOffset(endpoint, size)
      continue
    }
    verifyBy = 0; polls = 0
    const bytes = part(offset)
    const { response, data, transient } = await http(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${size}` }, body: bytes, purpose: 'upload' })
    if (response?.ok) {
      if (data.complete) return
      if (!Number.isInteger(data.offset) || data.offset <= offset || data.offset > size) fail('server returned an invalid upload offset')
      offset = data.offset; stalls = 0
      continue
    }
    if (response && response.status !== 409 && response.status < 500) fail(`${response.status} ${data.error || 'upload failed'}`, exitFor(response.status))
    const reason = transient || `${response.status} ${data.error || response.statusText}`
    const verified = await serverOffset(endpoint, size)
    if (verified !== 'complete' && verified <= offset && ++stalls >= RETRY.recoveries) fail(`upload of ${path} made no progress after ${RETRY.recoveries} recoveries (${reason})`, 7)
    if (verified === 'complete' || verified > offset) stalls = 0
    offset = verified
  }
}

if (command === 'item') process.stdout.write(`${JSON.stringify(await itemCommand(target, args))}\n`)
else if (command === 'login') await login()
else if (command === 'logout') { try { const all = JSON.parse(readFileSync(CREDENTIALS, 'utf8')); delete all[origin]; Object.keys(all).length ? writeFileSync(CREDENTIALS, JSON.stringify(all, null, 2), { mode: 0o600 }) : rmSync(CREDENTIALS) } catch { /* nothing saved */ } process.stdout.write(`${JSON.stringify({ signedOut: true })}\n`) }
else if (command === 'speak') await speak(target, args)
else if (command === 'transcribe') await transcribe(target, args)
else if (command === 'watermark') process.stdout.write(`${JSON.stringify({ watermarked: watermark(target, args.out, args.jingle ?? process.env.DOOMSCROLL_JINGLE, args.jingleStart ?? process.env.DOOMSCROLL_JINGLE_START, args.threads ?? (process.env.FFMPEG_THREADS || undefined)) })}\n`)
else if (command === 'auto') {
  let settings = {}
  try { settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) } catch { /* defaults */ }
  if (target === 'on' || target === 'off') {
    settings.auto = target === 'on'
    mkdirSync(CONFIG, { recursive: true, mode: 0o700 })
    writeFileSync(SETTINGS, JSON.stringify(settings, null, 2))
  } else if (target && target !== 'status') fail('auto takes on, off or status')
  process.stdout.write(`${JSON.stringify({ auto: settings.auto !== false && process.env.DOOMSCROLL_AUTO !== '0' })}\n`)
}
else if (command === 'me') process.stdout.write(`${JSON.stringify(await call('/api/agent/me'))}\n`)
else if (command === 'gh') {
  // Every github.com account `gh` is signed in to; the tokens go to DoomScroll only, never to stdout.
  let text
  try { text = execFileSync('gh', ['auth', 'status', '--hostname', 'github.com', '--show-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (error) { fail(error.code === 'ENOENT' ? 'gh not found; install the GitHub CLI and run gh auth login' : 'gh is not signed in; run gh auth login first') }
  process.stdout.write(`${JSON.stringify(await call('/api/agent/github', { text }))}\n`)
}
else if (command === 'status') { if (!target) fail('status needs an id'); process.stdout.write(`${JSON.stringify((await call(`/api/agent/videos/${encodeURIComponent(target)}`)).video)}\n`) }
else if (command === 'share' || command === 'unshare') {
  if (!target) fail(`${command} needs an id`)
  const { video } = await call(`/api/agent/videos/${encodeURIComponent(target)}/sharing`, { shareable: command === 'share' })
  process.stdout.write(`${JSON.stringify({ id: video.id, shareable: video.shareable, shareUrl: video.video?.shareUrl ?? null })}\n`)
}
else if (command === 'download') {
  if (!target) fail('download needs an id')
  const { video } = await call(`/api/agent/videos/${encodeURIComponent(target)}`)
  if (video.status !== 'succeeded') fail(`video is ${video.status}: ${video.error || video.stage}`)
  await finish(video, args)
} else if (command === 'pr' || command === 'local') {
  const notes = readNotes(args.notes), screens = readScreens(args.screen)
  const sharing = args.shareable ? { shareable: true } : args.private ? { shareable: false } : {}
  const extras = { theme, ...(args.language ? { language: args.language } : {}), ...(notes ? { notes } : {}), ...(screens.length ? { screens } : {}), ...sharing }
  const body = command === 'pr' ? { pr: parsePr(target), ...extras, ...sessionSource(), ...(args.publish ? { publish: true } : args.noPublish ? { publish: false } : {}), ...(args.auto ? { auto: true } : {}) } : { change: localChange(args), ...extras, ...sessionSource() }
  let answer = args.orShareable && body.publish ? await request('/api/agent/videos', body) : undefined
  // --publish --or-shareable: publishing needs write access and Stealth off; when DoomScroll refuses, the video is made
  // shareable instead, so reviewers can still play it from the PR comment.
  if (answer && [403, 409, 503].includes(answer.response.status)) {
    log(`not published (${answer.data.error || answer.response.status}); making it shareable instead`)
    delete body.publish
    body.shareable = true
    answer = undefined
  }
  if (answer && !answer.response.ok) fail(`${answer.response.status} ${answer.data.error || answer.response.statusText}`, answer.response.status === 401 ? 3 : answer.response.status === 402 ? 4 : 1)
  const { video, credits, automatic, watchUrl, connectUrl } = answer?.data ?? await call('/api/agent/videos', body)
  if (!video) {
    // The DoomScroll GitHub App makes this PR's videos by itself: nothing was queued or charged.
    log('the DoomScroll GitHub App makes this PR\'s video automatically; nothing was queued')
    if (args.open) openInBrowser(watchUrl)
    process.stdout.write(`${JSON.stringify({ status: 'automatic', watchUrl })}\n`)
    process.exit(0)
  }
  log(`queued ${video.id} (${credits.unlimited ? 'unlimited' : `${credits.remaining} credits left`})`)
  // Where the video will be, known now: the links go live when it is done, so a caller can hand them on without waiting.
  if (video.links?.watchUrl) log(`it will be at ${video.links.watchUrl}`)
  const tip = { ...(automatic === false ? { tip: `Connect GitHub at ${connectUrl} and every new PR gets its video automatically.` } : {}), ...(args.comment ? commentOnPr(body.pr, video) : {}) }
  if (args.noWait) process.stdout.write(`${JSON.stringify({ id: video.id, status: video.status, ...(video.links ?? {}), ...tip })}\n`)
  else await finish(await wait(video.id, args), args, tip)
} else fail(`unknown command "${command}"\n\n${HELP}`)
