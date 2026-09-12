/**
 * Real-Cordis mount test for `@lalilulelo3/dsh-notify`.
 *
 * The smoke test mounts the plugin against a fake context. This one mounts it
 * against a real `@deepseek-ai/cordis` Context, dispatches a `session/event`
 * and the `user-questions/request` waterfall exactly like the harness does, and
 * fails loudly on any mount or dispatch error.
 *
 * Run from anywhere: node test/cordis-mount.mjs
 */

const CORDIS = 'file:///C:/Users/lalil/.dsh/profiles/node_modules/@deepseek-ai/cordis/lib/index.js'
const PLUGIN = 'file:///C:/Users/lalil/Desktop/DSH/dsh-notify/lib/index.js'

const cordis = await import(CORDIS)
const Context = cordis.Context ?? cordis.default
if (typeof Context !== 'function') {
  throw new Error(`cannot resolve Context from cordis; exports = ${Object.keys(cordis).join(', ')}`)
}

const plugin = await import(PLUGIN)
const root = new Context()

const fiber = root.plugin(plugin, { title: 'DSH-MOUNT-TEST' })
await fiber
console.log(`mounted plugin: ${plugin.name}`)

root.emit('session/event', { id: 'session-mount-test' }, {
  type: 'turn/end',
  data: { turn: 1, reason: { kind: 'completed' } },
})
console.log('dispatched session/event turn/end -> toast expected')

let nextCalled = false
const answer = root.waterfall(
  'user-questions/request',
  { questions: [{ id: 'q1', question: '真实 Cordis 挂载测试问题' }] },
  () => 'builtin-fallback',
)
nextCalled = answer === 'builtin-fallback'
console.log(`waterfall returned ${JSON.stringify(answer)} (delegated = ${nextCalled})`)

root.emit('session/event', { id: 'session-mount-test' }, {
  type: 'approval/asked',
  data: { id: 'a1', toolName: 'pwsh' },
})
console.log('dispatched session/event approval/asked -> toast expected')

await new Promise((resolve) => setTimeout(resolve, 2000))
await fiber.dispose?.()
console.log('CORDIS MOUNT OK — expect 3 toasts, plugin unmounted cleanly.')
