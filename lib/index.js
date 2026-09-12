/**
 * `@lalilulelo3/dsh-notify` — the host half of a DeepSeek Harness plugin that
 * raises a Windows desktop notification (toast + sound) when the agent needs
 * your attention:
 *
 * - a turn ends (`turn/end`) — completed, failed, blocked, or token-capped;
 * - the harness is waiting for your answer (`user-questions/request`);
 * - the harness is waiting for your approval (`approval/asked`).
 *
 * The plugin is intentionally Windows-only: on other platforms it loads and
 * stays inert so a shared profile keeps booting. It never blocks, never awaits,
 * and never throws into the agent loop — a failed notification is silently
 * dropped.
 *
 * @module @lalilulelo3/dsh-notify
 */

import { spawn } from 'node:child_process'

/** Cordis plugin identity, used by the profile row and diagnostics. */
export const name = 'dsh-notify'

/**
 * No host service is injected: the plugin only observes the event bus and the
 * user-questions waterfall.
 */
export const inject = []

/**
 * The plugin's own AppUserModelID.
 *
 * Earlier releases borrowed `powershell.exe`'s identity — the usual trick for
 * scripting a toast. That identity is shared with the Windows PowerShell app,
 * so switching "Windows PowerShell" off in Settings → Notifications silently
 * killed every notification, and that entry is easy to toggle by accident
 * because nothing links it to this plugin.
 *
 * A dedicated identity is attributed to this plugin by name and can only be
 * switched off on purpose. Desktop apps have no package manifest, so Windows
 * learns an AUMID from `HKCU\Software\Classes\AppUserModelId\<AUMID>`;
 * {@link ensureAppIdentity} writes that entry on first use.
 */
const APP_ID = 'com.lalilulelo3.dsh-notify'

/** Name Windows shows for this AUMID in Settings → Notifications. */
const APP_DISPLAY_NAME = 'DSH Notify'

/** Turn-end reasons notified when the config does not narrow them. */
const DEFAULT_REASONS = ['completed', 'error', 'blocked', 'max-tokens']

/** Human labels for the `turn/end` reason kinds. */
const REASON_LABELS = {
  completed: '任务完成',
  error: '任务出错',
  blocked: '任务被阻塞',
  aborted: '任务已取消',
  'max-tokens': '达到输出上限',
  interrupted: '任务被中断',
}

/** Row-config defaults. */
const DEFAULTS = {
  enabled: true,
  turnEnd: true,
  question: true,
  approval: true,
  reasons: DEFAULT_REASONS,
  subagents: false,
  appId: APP_ID,
  sound: true,
  title: 'DSH',
}

/**
 * Escape a value for XML text or attribute content.
 *
 * @param value - any value; coerced with `String`.
 * @returns the escaped string.
 */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Collapse whitespace and cut to a maximum length.
 *
 * @param value - any value; coerced with `String`.
 * @param max - maximum number of characters to keep.
 * @returns the shortened single-line string.
 */
function shorten(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 1))}…`
}

/**
 * Render the first characters of a session id for compact notifications.
 *
 * @param value - the session id.
 * @returns at most eight characters.
 */
function shortId(value) {
  const text = String(value ?? '')
  return text.length > 8 ? text.slice(0, 8) : text
}

/**
 * Whether one session is a delegated child (subagent) rather than a top-level
 * conversation. `origin` is the product classification and `delegationDepth` is
 * the durable depth, so either marker identifies a child.
 *
 * @param session - a live session from the firehose.
 * @returns true when the session is a subagent child.
 */
function isChildSession(session) {
  const header = session?.header
  if (header === null || header === undefined) return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Human label for one session: its workspace folder name when known, else a
 * short session id.
 *
 * @param session - a live session from the firehose.
 * @returns a short label suitable for a toast body.
 */
function sessionLabel(session) {
  const cwd = session?.header?.cwd
  if (typeof cwd === 'string' && cwd.length > 0) {
    const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0)
    const base = parts[parts.length - 1]
    if (base !== undefined) return base
  }
  return shortId(session?.id)
}

/**
 * Build the Windows PowerShell script that raises one toast.
 *
 * The script is executed through `powershell.exe -EncodedCommand`, so the XML —
 * which contains double quotes — never needs shell quoting of its own. Single
 * quotes are escaped out of the XML by {@link escapeXml}, letting the payload
 * sit inside a PowerShell single-quoted literal.
 *
 * @param options - the toast content.
 * @param options.appId - the AppUserModelID the toast is sent under.
 * @param options.title - toast heading.
 * @param options.body - toast body line.
 * @param options.sound - whether the default notification sound plays.
 * @returns the PowerShell script text.
 */
function buildToastScript({ appId, title, body, sound }) {
  const xml =
    '<toast><visual><binding template="ToastGeneric">' +
    `<text>${escapeXml(title)}</text>` +
    `<text>${escapeXml(body)}</text>` +
    '</binding></visual>' +
    (sound ? '<audio src="ms-winsoundevent:Notification.Default"/>' : '<audio silent="true"/>') +
    '</toast>'
  return [
    "$ErrorActionPreference = 'Stop'",
    '$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]',
    '$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('${xml}')`,
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${appId}').Show($toast)`,
  ].join('\n')
}

/**
 * Run one PowerShell script in a fire-and-forget child process.
 *
 * The script travels as base64-encoded UTF-16LE (`-EncodedCommand`), so no
 * quoting layer ever touches it. A missing `powershell.exe` surfaces only as a
 * swallowed `error` event.
 *
 * @param script - the script text to execute.
 */
function spawnPowershell(script) {
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { stdio: 'ignore', windowsHide: true },
    )
    child.on('error', () => {})
  } catch {
    /* a failed helper must never disturb the agent loop */
  }
}

/** Whether the AUMID registration was already attempted in this process. */
let appIdentityReady = false

/**
 * Register this plugin's AUMID so Windows displays its toasts under our own
 * name.
 *
 * Idempotent and attempted once per process. Any failure — policy, security
 * software, a locked registry — is ignored: the toast is still attempted, and
 * the worst case is the pre-existing behaviour of an unregistered identity.
 *
 * @param appId - the AppUserModelID to register.
 */
function ensureAppIdentity(appId) {
  if (appIdentityReady) return
  appIdentityReady = true
  if (appId !== APP_ID) return
  spawnPowershell(
    [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\${APP_ID}'`,
      'New-Item -Path $key -Force | Out-Null',
      `New-ItemProperty -Path $key -Name 'DisplayName' -Value '${APP_DISPLAY_NAME}' -PropertyType String -Force | Out-Null`,
    ].join('\n'),
  )
}

/**
 * Raise one toast without ever blocking or throwing into the harness.
 *
 * @param options - the toast content.
 * @param options.appId - the AppUserModelID to send under.
 * @param options.title - toast heading.
 * @param options.body - toast body line.
 * @param options.sound - whether the default notification sound plays.
 */
function notify({ appId = APP_ID, title, body, sound }) {
  if (process.platform !== 'win32') return
  ensureAppIdentity(appId)
  spawnPowershell(buildToastScript({ appId, title, body, sound }))
}

/**
 * Mount the plugin.
 *
 * @param ctx - the Cordis context the profile row created.
 * @param config - optional row config: `enabled`, `turnEnd`, `question`,
 *   `approval`, `reasons`, `subagents`, `appId`, `sound`, `title`.
 */
export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config !== null && typeof config === 'object' ? config : {}) }
  if (cfg.enabled === false) return

  const reasons = new Set(
    Array.isArray(cfg.reasons) && cfg.reasons.length > 0 ? cfg.reasons : DEFAULT_REASONS,
  )

  /** Raise one configured notification. */
  const emit = (body) =>
    notify({ appId: cfg.appId, title: cfg.title, body, sound: cfg.sound !== false })

  ctx.on('session/event', (session, event) => {
    if (event === null || event === undefined) return
    if (cfg.subagents !== true && isChildSession(session)) return
    const data = event.data ?? {}

    if (event.type === 'turn/end' && cfg.turnEnd !== false) {
      const kind = data.reason?.kind ?? 'completed'
      if (!reasons.has(kind)) return
      emit(`${REASON_LABELS[kind] ?? kind} · ${sessionLabel(session)}`)
      return
    }

    if (event.type === 'approval/asked' && cfg.approval !== false) {
      const tool = shorten(data.toolName ?? '未知操作', 60)
      emit(`需要你的授权：${tool} · ${sessionLabel(session)}`)
    }
  })

  // The Web answerer is a remote listener on the same waterfall. Prepending
  // makes this notification fire before the request is consumed, and `next()`
  // then hands the request on unchanged — never vetoing it.
  ctx.on(
    'user-questions/request',
    (request, next) => {
      if (typeof next !== 'function') return undefined
      try {
        if (cfg.question !== false) {
          const first = request?.questions?.[0]
          emit(`等你回答：${shorten(first?.question ?? first?.header ?? '需要你的回复', 90)}`)
        }
      } catch {
        /* never break the waterfall */
      }
      return next()
    },
    { prepend: true },
  )
}
