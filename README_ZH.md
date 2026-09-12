# @lalilulelo3/dsh-notify

**DeepSeek Harness** 的 Windows 桌面通知插件——当 agent 完成一个回合，或正在等你操作时，弹出原生通知（toast）并响铃。

[English](./README.md) | 中文

## 为什么需要它

DSH 经常跑长任务。如果你没有盯着对话窗口，就会错过"任务完成了"或"它在等你"的时刻。`dsh-notify` 在**宿主端**监听 Harness 的事件总线并弹出 Windows 通知，因此无论浏览器标签页是前台、后台还是已关闭，都能收到提醒。

## 环境要求

- Windows 10 / 11
- 以 `web` profile 启动的 DeepSeek Harness
- Node.js >= 20

## 安装

```bash
dsh plugin --profile web add @lalilulelo3/dsh-notify
```

然后重启 `dsh web`。该包声明了 `dsh.bundle.patch`，CLI 会自动把它加入 `dsh.profile.bundles`，profile 启动时即挂载——**无需手改任何 profile 文件**。

## 什么情况会通知

| 时机 | 钩子 | 通知条件 |
| --- | --- | --- |
| 一个回合结束 | `turn/end` 会话事件 | completed / error / blocked / max-tokens |
| 等你的回答 | `user-questions/request` 瀑布钩子 | 总是 |
| 等你的授权 | `approval/asked` 会话事件 | 总是 |

插件是**只观察**的：它的 `user-questions/request` 监听器通过 `prepend` 抢在前面发通知，然后调用 `next()` 放行，因此真正的回答器仍能原样收到请求。通知失败会被静默吞掉，绝不干扰 agent 循环。顶层会话用其工作区文件夹名作为标签（取不到时退化为短会话 ID）；子 agent 会话默认保持静默，除非你设置 `subagents: true`。

## 配置

所有字段都可选。在你的 profile 补丁文件（`~/.dsh/profiles/web/cordis.patch.yml`）里加一条按 id 定位的覆盖即可，该文件支持实时重载：

```yaml
- id: dsh-notify
  config:
    sound: false
    reasons: [completed, error]
```

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；设为 `false` 关闭插件 |
| `turnEnd` | boolean | `true` | 回合结束时是否通知 |
| `question` | boolean | `true` | 等你回答时是否通知 |
| `approval` | boolean | `true` | 等你授权时是否通知 |
| `reasons` | string[] | `[completed, error, blocked, max-tokens]` | 哪些 `turn/end` 原因触发通知（`aborted`、`interrupted` 需显式开启） |
| `subagents` | boolean | `false` | 是否也为子 agent 会话通知；关闭可让多 agent 任务保持安静 |
| `sound` | boolean | `true` | 是否播放 Windows 默认通知音 |
| `title` | string | `DSH` | 通知标题 |

## 工作原理

本包只有一个宿主端实现（`lib/index.js`），没有客户端部分，因此**不需要重建任何 Web 产物**。挂载后它订阅：

- **`session/event`** —— 会话事件总线。`turn/end` 携带 `{ turn, reason: { kind } }`；`approval/asked` 携带 `{ id, toolName }`。
- **`user-questions/request`** —— `ask_user_question` 工具派发的 Cordis 瀑布钩子。监听器通过 `prepend` 抢先通知，再用 `next()` 放行。

每条通知会启动 `powershell.exe -EncodedCommand` 执行一小段 WinRT toast 脚本，子进程即发即忘，插件从不等待它。

在非 Windows 平台上插件会正常加载但保持静默，因此共享同一 profile 也能正常启动。

## 卸载

```bash
dsh plugin --profile web remove @lalilulelo3/dsh-notify
```

然后重启 `dsh web`。

## 排障

**完全没有通知弹出。**
1. **重启 `dsh web`** —— 新装的 bundle 只在启动时挂载。
2. 确认它已进入组合配置：`dsh --profile web --dump-config` 的输出里应能看到 `@lalilulelo3/dsh-notify`。
3. 检查 Windows 通知设置：设置 → 系统 → 通知，并确认**专注助手/勿扰模式已关闭**。
4. 本插件仅支持 Windows；其他平台会正常加载但保持静默（这是设计行为）。

**多 agent 任务时通知太多。**
子 agent 会话默认已被跳过。如果仍然嫌多，可以收窄触发原因：

```yaml
- id: dsh-notify
  config:
    reasons: [completed, error]
```

**`dsh web` 启动不起来了。**
移除插件后重启：

```bash
dsh plugin --profile web remove @lalilulelo3/dsh-notify
```

## 许可证

[MIT](./LICENSE)
