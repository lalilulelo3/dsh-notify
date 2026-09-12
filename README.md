# @lalilulelo3/dsh-notify

**🌏 中文文档：[README_ZH.md](./README_ZH.md)** · English

> **中文简介**：DeepSeek Harness 的 Windows 桌面通知插件 —— agent 完成任务、或需要你回答 / 授权时，弹出原生系统通知（toast）并响铃。**完整中文文档见 [README_ZH.md](./README_ZH.md)。**

Windows desktop notifications for **DeepSeek Harness** — get a native toast and a
sound when the agent finishes a turn, or when it is waiting for you.

## Why

DSH runs long tasks. If you are not staring at the conversation window, you miss
the moment the agent finishes or blocks on your input. `dsh-notify` observes the
harness event bus on the **host** and raises a Windows toast, so it works whether
the browser tab is focused, in the background, or closed.

<p align="center">
  <em>A turn ended · the harness is waiting for your answer · the harness is waiting for your approval</em>
</p>

## Requirements

- Windows 10 or 11
- DeepSeek Harness booted with the `web` profile
- Node.js >= 20

## Install

```bash
dsh plugin --profile web add @lalilulelo3/dsh-notify
```

Then restart `dsh web`. The package declares `dsh.bundle.patch`, so the CLI adds
it to `dsh.profile.bundles` and the profile boot mounts it — no profile file
edits are required.

## What triggers a notification

| Moment | Hook | Notified |
| --- | --- | --- |
| A turn ends | `turn/end` session event | completed / error / blocked / max-tokens |
| The harness waits for your answer | `user-questions/request` waterfall | always |
| The harness waits for your approval | `approval/asked` session event | always |

The plugin is **observe-only**: its `user-questions/request` listener is
prepended, notifies, and then calls `next()`, so the real answerer still receives
the request untouched. A failed notification is swallowed and never disturbs the
agent loop. Top-level sessions are labelled by their workspace folder name
(falling back to a short session id), and child (subagent) sessions stay silent
unless you set `subagents: true`.

## Configuration

Every field is optional. Add an id-targeted override to your profile patch file
(`~/.dsh/profiles/web/cordis.patch.yml`), which the profile reloads live:

```yaml
- id: dsh-notify
  config:
    sound: false
    reasons: [completed, error]
```

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; `false` disables the plugin |
| `turnEnd` | boolean | `true` | Notify when a turn ends |
| `question` | boolean | `true` | Notify when the harness waits for an answer |
| `approval` | boolean | `true` | Notify when the harness waits for approval |
| `reasons` | string[] | `[completed, error, blocked, max-tokens]` | Which `turn/end` reasons notify (`aborted`, `interrupted` are opt-in) |
| `subagents` | boolean | `false` | Also notify for subagent (child) sessions; off keeps multi-agent runs quiet |
| `appId` | string | `com.lalilulelo3.dsh-notify` | AppUserModelID the toast is sent under; Windows lists it as **DSH Notify** |
| `sound` | boolean | `true` | Play the Windows default notification sound |
| `title` | string | `DSH` | Toast heading |

## How it works

The package has one host half (`lib/index.js`) and no client half, so nothing in
the Web UI needs rebuilding. On mount it subscribes to:

- **`session/event`** — the session firehose. `turn/end` carries
  `{ turn, reason: { kind } }`; `approval/asked` carries `{ id, toolName }`.
- **`user-questions/request`** — the Cordis waterfall the `ask_user_question`
  tool dispatches. The listener is prepended so the notification fires before the
  Web answerer consumes the request, then delegates with `next()`.

A notification spawns `powershell.exe -EncodedCommand` with a small WinRT toast
script. The child is fire-and-forget; the plugin never awaits it.

### App identity

Toasts are sent under the plugin's **own** AppUserModelID
(`com.lalilulelo3.dsh-notify`), registered on first use through
`HKCU\Software\Classes\AppUserModelId\…` with the display name **DSH Notify**.

Earlier releases borrowed `powershell.exe`'s identity instead — the usual trick
for scripting a toast. That identity is shared with the Windows PowerShell app,
so switching "Windows PowerShell" off in Settings → Notifications silently
disabled every notification, and nothing in that list pointed back to this
plugin. With a dedicated identity the plugin is listed by its own name and can
only be toggled on purpose.

On non-Windows platforms the plugin loads and stays inert, so a shared profile
still boots.

## Uninstall

```bash
dsh plugin --profile web remove @lalilulelo3/dsh-notify
```

Then restart `dsh web`.

## Troubleshooting

**No toast appears at all.**
1. Restart `dsh web` — a newly installed bundle only mounts at boot.
2. Confirm it is in the composed config: `dsh --profile web --dump-config` should
   list `@lalilulelo3/dsh-notify`.
3. Check Windows notifications: Settings → System → Notifications, and make sure
   Focus Assist / Do Not Disturb is off.
4. The plugin is Windows-only; elsewhere it loads and stays inert by design.

**Multi-agent runs are noisy.**
Child (subagent) sessions are skipped by default. If you still see too many,
narrow the reasons:

```yaml
- id: dsh-notify
  config:
    reasons: [completed, error]
```

**Notifications stopped after something was switched off.**
Find **DSH Notify** in Settings → System → Notifications and switch it back on.
Releases before 0.2.0 sent toasts under "Windows PowerShell" instead, so that
entry — not this plugin's — was the one to check.

**`dsh web` no longer starts.**
Remove the plugin and restart:

```bash
dsh plugin --profile web remove @lalilulelo3/dsh-notify
```

## License

[MIT](./LICENSE)
