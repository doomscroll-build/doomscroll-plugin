#!/usr/bin/env node
// Doomscroll agent client: submit a pull request or a local diff, poll until the video is ready, download the MP4; and use
// Doomscroll's metered voice APIs (speech, word-timed transcription) without an OpenAI key of your own.
// Dependency-free (Node 18+). Reads the key from DOOMSCROLL_API_KEY or the browser sign-in saved by `login`, and never prints it.
// MIT License. See ../../../LICENSE.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `Usage:
  doomscroll.mjs login                     Sign in through the browser (saves a key for this machine)
  doomscroll.mjs logout                    Forget the saved key
  doomscroll.mjs speak <text|-> --out <file.mp3> [--voice onyx] [--instructions <text>] [--model gpt-4o-mini-tts] [--speed 1]
  doomscroll.mjs transcribe <audio file> [--out <file.json>] [--model whisper-1] [--words]
  doomscroll.mjs pr <owner/repo#number | github PR URL> [options]
  doomscroll.mjs local [--base <ref>] [--diff-file <path|->] [--title <text>] [--description <text>] [--repo <name>] [--include <path>]... [options]
  doomscroll.mjs status <id>
  doomscroll.mjs download <id> [--out <file.mp4>] [--gif <file.gif>]
  doomscroll.mjs me
  doomscroll.mjs watermark <video> [--out <file.mp4>]   Brand any video: Doomscroll mark at the bottom right + a short outro (needs ffmpeg)

Options:
  --theme classic|football|kpop   Video style (default classic)
  --language <id>                 en ar es fr de pt tr hi id ja ko zh (default: your Doomscroll setting, else en)
  --notes <file.json|->           Your write-up of the change: components, architecture, how it works (see SKILL.md)
  --out <file.mp4>                Where to save the video (default doomscroll-<id>.mp4)
  --gif <file.gif>                Also save the silent GIF preview
  --no-wait                       Submit and print the id without waiting
  --timeout <minutes>             Give up waiting after this long (default 60)

Sign-in (either one):
  doomscroll.mjs login   Opens a browser page; approve the code and the key is saved to ~/.config/doomscroll/credentials.json
  DOOMSCROLL_API_KEY     A key from Doomscroll Settings -> Agent access (wins over the saved one)

Voice for any OpenAI SDK: base URL <DOOMSCROLL_URL>/api/agent/v1 with the Doomscroll key as the API key
(POST /audio/speech, POST /audio/transcriptions). Every call is paid in Doomscroll credits.

Environment:
  DOOMSCROLL_URL       Server origin (default https://doomscroll.build)
  FFMPEG, FFPROBE      ffmpeg/ffprobe binaries for watermark (default: from PATH)

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
    else if (arg === '--words') args.words = true
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
const CREDENTIALS = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'doomscroll', 'credentials.json')
const saved = () => { try { return JSON.parse(readFileSync(CREDENTIALS, 'utf8'))[origin]?.apiKey } catch { return undefined } }
const key = process.env.DOOMSCROLL_API_KEY || saved()
const headers = () => {
  if (!key) fail('not signed in. Run: doomscroll.mjs login (or export DOOMSCROLL_API_KEY from Doomscroll Settings -> Agent access).', 3)
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' }
}

/** Browser sign-in (device code): show a code, the user approves it on doomscroll, the key lands in a 0600 file, never on screen. */
async function login() {
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), redirect: 'error' })
  const start = await (await post('/api/agent/device')).json()
  if (!start.device_code) fail(`could not start sign-in: ${start.error || 'unexpected answer'}`)
  log(`Open ${start.verification_uri_complete}\nand approve the code ${start.user_code}`)
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try { execFileSync(opener, [start.verification_uri_complete], { stdio: 'ignore', timeout: 5000 }) } catch { /* headless: the printed link is enough */ }
  const deadline = Date.now() + start.expires_in * 1000
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, (start.interval || 3) * 1000))
    // A deploy or a network blip must not end the sign-in: keep polling through 5xx and connection errors until the code expires.
    const response = await post('/api/agent/device/token', { device_code: start.device_code }).catch(() => null)
    if (!response || response.status === 428 || response.status >= 500) continue
    const data = await response.json().catch(() => ({}))
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

/** Text to speech through Doomscroll (OpenAI gpt-4o-mini-tts upstream), written straight to a file. */
async function speak(text, args) {
  if (!args.out) fail('speak needs --out <file.mp3>')
  const input = text === '-' ? readFileSync(0, 'utf8') : text
  if (!input?.trim()) fail('speak needs the text, or - to read it from stdin')
  const format = args.out.split('.').pop()
  const body = { model: args.model || 'gpt-4o-mini-tts', voice: args.voice || 'onyx', input, ...(args.instructions ? { instructions: args.instructions } : {}), ...(args.speed ? { speed: Number(args.speed) } : {}), ...(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'].includes(format) ? { response_format: format } : {}) }
  const response = await fetch(`${origin}/api/agent/v1/audio/speech`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error' })
  if (!response.ok) { const data = await response.json().catch(() => ({})); fail(`${response.status} ${data.error || response.statusText}`, response.status === 401 ? 3 : response.status === 402 ? 4 : 1) }
  writeFileSync(args.out, Buffer.from(await response.arrayBuffer()))
  process.stdout.write(`${JSON.stringify({ file: args.out, creditsRemaining: Number(response.headers.get('x-doomscroll-credits-remaining')) })}\n`)
}

/** Speech to text through Doomscroll (OpenAI upstream); --words asks for word timestamps (verbose_json). */
async function transcribe(file, args) {
  if (!file || !existsSync(file)) fail('transcribe needs an audio file')
  const form = new FormData()
  form.append('file', new Blob([readFileSync(file)]), basename(file))
  form.append('model', args.model || 'whisper-1')
  if (args.words) { form.append('response_format', 'verbose_json'); form.append('timestamp_granularities[]', 'word') }
  const response = await fetch(`${origin}/api/agent/v1/audio/transcriptions`, { method: 'POST', headers: headers(), body: form, redirect: 'error' })
  const text = await response.text()
  if (!response.ok) { let error; try { error = JSON.parse(text).error } catch { /* not JSON */ } fail(`${response.status} ${error || response.statusText}`, response.status === 401 ? 3 : response.status === 402 ? 4 : 1) }
  if (args.out) { writeFileSync(args.out, text); process.stdout.write(`${JSON.stringify({ file: args.out })}\n`) } else process.stdout.write(`${text}\n`)
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
const LANGUAGES = ['en', 'ar', 'es', 'fr', 'de', 'pt', 'tr', 'hi', 'id', 'ja', 'ko', 'zh']
if (args.language && !LANGUAGES.includes(args.language)) fail(`--language must be one of ${LANGUAGES.join(' ')}`)
/** Every Doomscroll video carries this tag once branded, so branding twice is a no-op. */
const BRAND_TAG = 'Made with Doomscroll'
const OUTRO_SECONDS = 1.6
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')

/** A small Doomscroll mark at the bottom right, then a TikTok-style outro: the logo pops in on black, the name fades up under it and the jingle plays. */
function watermark(input, output) {
  if (!input || !existsSync(input)) fail('watermark needs a video file')
  const out = resolve(output || input.replace(/(\.[^./]+)?$/, '-doomscroll.mp4'))
  const ffmpeg = process.env.FFMPEG || 'ffmpeg', ffprobe = process.env.FFPROBE || 'ffprobe'
  const run = (bin, argv) => {
    try { return execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10_000_000 }) }
    catch (error) { fail(error.code === 'ENOENT' ? `${bin} not found; install ffmpeg` : `${bin} failed: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`) }
  }
  const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]))
  const video = probe.streams.find(stream => stream.codec_type === 'video')
  if (!video) fail(`${input} has no video stream`)
  if (probe.format.tags?.comment === BRAND_TAG) {
    if (resolve(input) !== out) copyFileSync(input, out)
    return out
  }
  const W = video.width, H = video.height, D = Number(probe.format.duration), O = OUTRO_SECONDS
  const unit = Math.min(W, H) / 1080, markWidth = Math.round(330 * unit), markY = Math.round(H * 0.42)
  // Pops past full size, then settles: 0 → 1.15 by 0.25 s, back to 1 by 0.4 s.
  const bounce = 'if(lt(t,0.25),t/0.25*1.15,if(lt(t,0.4),1.15-(t-0.25),1))'
  const hasAudio = probe.streams.some(stream => stream.codec_type === 'audio')
  const graph = [
    `[0:v]tpad=stop_duration=${O}:color=black,setsar=1[base]`,
    `[1:v]scale=${Math.round(W * 0.24 / 2) * 2}:-2,format=rgba,colorchannelmixer=aa=0.8[wm]`,
    `[base][wm]overlay=x=W-w-${Math.round(W * 0.035)}:y=H-h-${Math.round(H * 0.06)}:enable='lt(t,${D})'[v1]`,
    `[2:v]format=rgba,scale=w='max(2,trunc(${markWidth}*(${bounce})/2)*2)':h=-2:eval=frame,setpts=PTS-STARTPTS+${D}/TB[mark]`,
    `[v1][mark]overlay=x=(W-w)/2:y=${markY}-h/2:enable='gte(t,${D})':eof_action=pass[v2]`,
    `[3:v]format=rgba,scale=${Math.round(560 * unit / 2) * 2}:-2,fade=in:st=0.35:d=0.3:alpha=1,setpts=PTS-STARTPTS+${D}/TB[name]`,
    `[v2][name]overlay=x=(W-w)/2:y=${markY + Math.round(markWidth * 0.62)}:enable='gte(t,${D})':eof_action=pass,format=yuv420p[v]`,
    // The jingle starts with the outro; the video's own audio (if any) is padded with silence under it.
    `[4:a]aresample=48000,aformat=channel_layouts=stereo,adelay=delays=${Math.round(D * 1000)}:all=1,volume=0.45[jingle]`,
    hasAudio ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur=${O}[voice];[voice][jingle]amix=inputs=2:duration=first:normalize=0[a]` : `[jingle]apad=whole_dur=${D + O}[a]`,
  ].join(';')
  const image = name => ['-loop', '1', '-framerate', '30', '-t', String(O), '-i', join(ASSETS, name)]
  run(ffmpeg, ['-v', 'error', '-y', '-threads', '2', '-i', input, '-loop', '1', '-framerate', '30', '-t', String(D), '-i', join(ASSETS, 'watermark.png'), ...image('mark.png'), ...image('outro-text.png'), '-i', join(ASSETS, 'jingle.m4a'),
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:a', 'aac', '-b:a', '160k',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-movflags', '+faststart', '-metadata', `comment=${BRAND_TAG}`, out])
  return out
}

function readNotes(path) {
  if (!path) return undefined
  try { return JSON.parse(readFileSync(path === '-' ? 0 : path, 'utf8')) } catch (error) { fail(`--notes must be a JSON file: ${error.message}`) }
}

if (command === 'login') await login()
else if (command === 'logout') { try { const all = JSON.parse(readFileSync(CREDENTIALS, 'utf8')); delete all[origin]; Object.keys(all).length ? writeFileSync(CREDENTIALS, JSON.stringify(all, null, 2), { mode: 0o600 }) : rmSync(CREDENTIALS) } catch { /* nothing saved */ } process.stdout.write(`${JSON.stringify({ signedOut: true })}\n`) }
else if (command === 'speak') await speak(target, args)
else if (command === 'transcribe') await transcribe(target, args)
else if (command === 'watermark') process.stdout.write(`${JSON.stringify({ watermarked: watermark(target, args.out) })}\n`)
else if (command === 'me') process.stdout.write(`${JSON.stringify(await call('/api/agent/me'))}\n`)
else if (command === 'status') { if (!target) fail('status needs an id'); process.stdout.write(`${JSON.stringify((await call(`/api/agent/videos/${encodeURIComponent(target)}`)).video)}\n`) }
else if (command === 'download') {
  if (!target) fail('download needs an id')
  const { video } = await call(`/api/agent/videos/${encodeURIComponent(target)}`)
  if (video.status !== 'succeeded') fail(`video is ${video.status}: ${video.error || video.stage}`)
  await finish(video, args)
} else if (command === 'pr' || command === 'local') {
  const notes = readNotes(args.notes)
  const extras = { theme, ...(args.language ? { language: args.language } : {}), ...(notes ? { notes } : {}) }
  const body = command === 'pr' ? { pr: parsePr(target), ...extras } : { change: localChange(args), ...extras }
  const { video, credits } = await call('/api/agent/videos', body)
  log(`queued ${video.id} (${credits.unlimited ? 'unlimited' : `${credits.remaining} credits left`})`)
  if (args.noWait) process.stdout.write(`${JSON.stringify({ id: video.id, status: video.status })}\n`)
  else await finish(await wait(video.id, args), args)
} else fail(`unknown command "${command}"\n\n${HELP}`)
