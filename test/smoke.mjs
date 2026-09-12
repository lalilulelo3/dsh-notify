/**
 * Local smoke test for `@lalilulelo3/dsh-notify`.
 *
 * Mounts the plugin against a minimal fake Cordis context, then replays one
 * `turn/end`, one `user-questions/request` waterfall and one `approval/asked`
 * event. Each should raise a real Windows toast, and the waterfall must call
 * `next()` so the request is never vetoed.
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
const session = { id: 'session-abcdef123456' }

console.log('1) turn/end (completed) -> toast expected')
sessionEvent(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

console.log('2) user-questions/request -> toast expected, then next()')
let nextCalled = false
let nextResult
const questions = handlers.get('user-questions/request')?.handler
if (questions === undefined) {
  throw new Error('user-questions/request was not registered')
}
const waterfallResult = questions({ questions: [{ id: 'q1', question: '这是一条测试问题，验证通知是否弹出' }] }, () => {
  nextCalled = true
  return 'answered-by-next'
})
nextResult = waterfallResult
console.log(`   next() called = ${nextCalled}, returned = ${JSON.stringify(nextResult)}`)
if (!nextCalled) throw new Error('waterfall listener vetoed the request (next() was not called)')

console.log('3) approval/asked -> toast expected')
sessionEvent(session, { type: 'approval/asked', data: { id: 'a1', toolName: 'pwsh' } })

console.log('')
console.log('SMOKE OK — expect 3 toasts above.')
