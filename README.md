# @lalilulelo3/dsh-notify

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
agent loop.

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

On non-Windows platforms the plugin loads and stays inert, so a shared profile
still boots.

## Uninstall

```bash
dsh plugin --profile web remove @lalilulelo3/dsh-notify
```

Then restart `dsh web`.

## License

[MIT](./LICENSE)
