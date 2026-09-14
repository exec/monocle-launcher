import assert from 'node:assert/strict'
import { canLaunchSession, launchSessions, sessionState } from './bot-sessions.js'

const binding = { worker: 'one', instance: 'first', account: 'account-one' }
const running = [{ instance_id: 'first' }]
assert.equal(sessionState(null, [], null), 'Unmanaged')
assert.equal(sessionState(binding, [], { connected: true }), 'External')
assert.equal(sessionState(binding, running, null), 'Waiting')
assert.equal(sessionState(binding, running, { connected: true }), 'Connected')
assert.equal(sessionState(binding, [], null), 'Stopped')
assert.equal(sessionState(binding, [], null, true), 'Launching')
assert.equal(canLaunchSession(binding, [], { connected: true }), false)
assert.equal(canLaunchSession(binding, running, null), false)
assert.equal(canLaunchSession(null, [], null), false)
assert.equal(canLaunchSession(binding, [], { connected: false }), true)
const attempted = []
const failures = await launchSessions(
	[binding, { worker: 'two', instance: 'second' }, { worker: 'three', instance: 'third' }],
	running,
	async (session) => {
		attempted.push(session.worker)
		if (session.worker === 'two') throw new Error('Authentication failed')
	},
)
assert.deepEqual(attempted, ['two', 'three'])
assert.equal(failures.length, 1)
assert.equal(failures[0].worker, 'two')
console.log('Worker session state and batch launch checks passed')
