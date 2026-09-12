/**
 * Local smoke test for `@lalilulelo3/dsh-notify`.
 *
 * Mounts the plugin against a minimal fake Cordis context, then replays:
 *
 *   1. a top-level `turn/end` (completed)          -> toast, labelled by workspace
 *   2. a subagent `turn/end`                        -> NO toast (filtered)
 *   3. a `user-questions/request` waterfall         -> toast + next() delegation
 *   4. an `approval/asked`                          -> toast
 *
 * Run: node test/smoke.mjs
 */

import { apply, inject, name } from '../lib/index.js'

const handlers = new Map()

const ctx = {
  on(event, handler, options) {
    handlers.set(event, { handler, options })
    return () => true
  },
}

apply(ctx, {})

console.log(`name   = ${name}`)
console.log(`inject = ${JSON.stringify(inject)}`)
console.log(`events = ${[...handlers.keys()].join(', ')}`)
console.log('')

const sessionEvent = handlers.get('session/event')?.handler ?? (() => {})
const questions = handlers.get('user-questions/request')?.handler
if (questions === undefined) throw new Error('user-questions/request was not registered')

const topLevel = { id: 'session-abcdef123456', header: { cwd: 'C:\\Users\\lalil\\Desktop\\DSH\\电视优化' } }
const child = { id: 'session-child0001', header: { origin: 'subagent', delegationDepth: 1, cwd: 'C:\\tmp\\child' } }

console.log('1) top-level turn/end (completed) -> toast expected: "任务完成 · 电视优化"')
sessionEvent(topLevel, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

console.log('2) subagent turn/end -> NO toast expected (filtered)')
sessionEvent(child, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

console.log('3) user-questions/request -> toast expected, then next()')
let nextCalled = false
const waterfallResult = questions(
  { questions: [{ id: 'q1', question: '这是一条测试问题，验证通知是否弹出' }] },
  () => {
    nextCalled = true
    return 'answered-by-next'
  },
)
console.log(`   next() called = ${nextCalled}, returned = ${JSON.stringify(waterfallResult)}`)
if (!nextCalled) throw new Error('waterfall listener vetoed the request (next() was not called)')

console.log('4) approval/asked -> toast expected')
sessionEvent(topLevel, { type: 'approval/asked', data: { id: 'a1', toolName: 'pwsh' } })

console.log('')
console.log('SMOKE OK — expect 3 toasts (step 2 must stay silent).')
