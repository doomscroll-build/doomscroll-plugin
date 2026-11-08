import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

const digest = value => createHash('sha256').update(value).digest('hex')
const statuses = {
  SessionStart: 'started', UserPromptSubmit: 'working', PermissionRequest: 'permission needed',
  Notification: 'permission needed', Stop: 'turn ended', StopFailure: 'turn failed', SessionEnd: 'exited',
}
export function reportingSettings(settings, scope, target) {
  if (!target || target === 'status') return
  if (!['on', 'off'].includes(target)) throw new Error('report takes on, off or status')
  return { ...settings, reporting: { ...settings.reporting, [scope]: { on: target === 'on' } } }
}
function safeLink(value) {
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return
    const h = u.hostname.toLowerCase()
    if (!h.includes('.') || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(':')) return
    if (/(?:token|secret|credential|api[-_]?key|password)/i.test(u.pathname)) return
    return u.href
  } catch { return }
}
export function completion(message) {
  if (typeof message !== 'string') return
  const section = /(?:^|\n)## DoomScroll completion\s*\n([\s\S]*?)(?=\n## |$)/.exec(message)?.[1]?.trim()
  if (!section) return
  const links = [...new Set((section.match(/https?:\/\/[^\s<>\]\)]+/g) || []).map(safeLink).filter(Boolean))].slice(0, 10)
  const text = section.replace(/(?:https?:\/\/[^\s<>\]\)]+|file:\/\/\S+)/g, '').trim()
  let bytes = Buffer.from(text)
  if (bytes.length > 4096) bytes = bytes.subarray(0, 4096)
  const summary = bytes.toString('utf8').replace(/�$/, '')
  return { summary, links }
}
const LOCK_STALE_MS = 5000
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' } }
/** A hook killed by its timeout, SessionEnd teardown or Ctrl+C leaves its lock behind; a resumed session must not wait on it forever. */
export function abandoned(lock, now = Date.now()) {
  try {
    const pid = Number(readFileSync(lock, 'utf8'))
    return now - statSync(lock).mtimeMs > LOCK_STALE_MS || (Number.isInteger(pid) && pid > 0 && !alive(pid))
  } catch { return false }
}
export async function reportHook({ input, config, scope, quiet, settings }) {
  const start = Date.now(), until = start + (input?.hook_event_name === 'SessionEnd' ? 1100 : 1700)
  if (!input || settings.reporting?.[scope]?.on === false || typeof input.session_id !== 'string' || !input.session_id || input.session_id.length > 256 || input.stop_hook_active) return
  const event = input.hook_event_name
  if (!(event in statuses) && !['PostToolUse', 'PostToolUseFailure'].includes(event)) return
  const session = digest(input.session_id), directory = join(config, 'report', scope)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `${session}.json`), lock = `${file}.lock`
  let fd
  while (Date.now() < until - 150) {
    try { fd = openSync(lock, 'wx', 0o600); writeSync(fd, String(process.pid)); break } catch {
      if (abandoned(lock)) rmSync(lock, { force: true })
      else await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  if (fd === undefined) return
  try {
    let state = { turn: 0, tools: [], seen: [], status: 'started' }
    try { state = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first event */ }
    const tool = ['PostToolUse', 'PostToolUseFailure'].includes(event)
    const eventId = digest(JSON.stringify([event, input.tool_use_id || '', input.prompt_id || '', input.last_assistant_message || '', input.background_tasks?.length ?? null, input.session_crons?.length ?? null]))
    if (state.seen.includes(eventId) && event !== 'UserPromptSubmit') return
    state.seen = [...state.seen, eventId].slice(-200)
    if (event === 'UserPromptSubmit') { state.turn++; state.tools = []; state.status = statuses[event] }
    else if (tool) {
      const name = typeof input.tool_name === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(input.tool_name) ? input.tool_name : 'unknown'
      const outcome = event === 'PostToolUse' ? 'success' : 'failure'
      if (!state.tools.some(t => t.name === name && t.outcome === outcome) && state.tools.length < 50) state.tools.push({ name, outcome })
    } else state.status = statuses[event]
    if (event === 'Stop') {
      state.background = Array.isArray(input.background_tasks) ? Math.min(input.background_tasks.length, 1000) : null
      state.scheduled = Array.isArray(input.session_crons) ? Math.min(input.session_crons.length, 1000) : null
      if (state.background || state.scheduled) state.status = 'waiting for background work'
    }
    const done = event === 'Stop' ? completion(input.last_assistant_message) : undefined
    const report = done
      ? { item: { key: `ext:claude-completion/${session}-${state.turn}-${digest(JSON.stringify(done)).slice(0, 16)}`, title: 'Claude completion summary', project: 'agent-sessions', tags: ['completion'] }, text: [done.summary, ...done.links].join('\n\n'), request: true }
      : { item: { key: `ext:claude-status/${session}`, title: 'Claude session status', project: 'agent-sessions', tags: ['session-status'] }, text: `Status: ${state.status}\n\nBackground tasks: ${state.background ?? 'unknown'}\nScheduled tasks: ${state.scheduled ?? 'unknown'}\n\n${state.tools.map(t => `- ${t.name}: ${t.outcome}`).join('\n')}`, request: false }
    const payloadHash = digest(JSON.stringify(report))
    // Tool events accumulate locally. A lifecycle boundary sends the coalesced result once.
    if (!tool && payloadHash !== state.sent) {
      const answer = await quiet('/items', report, Math.max(1, until - Date.now()))
      if (answer) state.sent = payloadHash
    }
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
    renameSync(temporary, file)
  } finally { closeSync(fd); rmSync(lock, { force: true }) }
}
