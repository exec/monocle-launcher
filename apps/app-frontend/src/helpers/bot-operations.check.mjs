import assert from 'node:assert/strict'
import { highwayDefaults, highwayPayload, highwayEndpoint, workerRoster } from './bot-operations.js'
const packet = {
	version: 1,
	entry: 'highway-default',
	programs: {},
	highways: { 'highway-default': { duty: 'Build' } },
	profiles: {
		Current: {
			speed: { settings: '{groups:[{name:"General",settings:[{name:"existing",value:["a]b"]}]}]}' },
		},
	},
}
const f = {
	...highwayDefaults(packet),
	x: -16500,
	z: 0,
	direction: 'West',
	endMode: 'endpoint',
	endpoint: -20000,
}
assert.deepEqual(highwayEndpoint(f), { x: -20000, y: 116, z: 0, length: 3500 })
const result = highwayPayload(packet, f, 'play.6b6t.org', 'minecraft:the_nether')
assert.equal(result.args.length, 3500)
assert.equal(result.package.geometry.layout.inventory.paving, 512)
assert(
	result.package.profiles.Current['highway-builder'].settings.includes('"keep-shulkers",value:0b'),
)
assert(result.package.profiles.Current.speed.settings.includes('"existing","value":["a]b"]'))
assert(result.package.profiles.Current.speed.settings.includes('"vanilla-speed","value":5d'))
const edited = highwayPayload(
	result.package,
	{ ...f, speed: 6, keepShulkers: true },
	's',
	'minecraft:the_nether',
)
assert.equal((edited.package.profiles.Current.speed.settings.match(/"General"/g) || []).length, 1)
assert.equal(
	(edited.package.profiles.Current.speed.settings.match(/"vanilla-speed"/g) || []).length,
	1,
)
assert.equal(
	(edited.package.profiles.Current['highway-builder'].settings.match(/"Inventory"/g) || []).length,
	1,
)
assert.equal(highwayDefaults(edited.package).speed, 6)
assert.equal(highwayDefaults(edited.package).keepShulkers, true)
assert.equal(packet.geometry, undefined)
assert.throws(() => highwayPayload(packet, { ...f, endpoint: -10000 }, 's', 'd'))
assert.throws(() => highwayPayload(packet, { ...f, length: 100001, endMode: 'length' }, 's', 'd'))
assert.throws(() => highwayPayload(packet, { ...f, width: 7 }, 's', 'd'))
assert.equal(
	workerRoster({
		workers: [
			{ id: '1', name: 'B', crew: 'C', connected: false },
			{ id: '1', name: 'B', crew: 'C', connected: true },
		],
		tasks: [{ crew: 'C', runs: { 2: {} } }],
	}).length,
	2,
)
console.log(
	'Operations checks passed: exact endpoints, limits, snapshots, preserved settings, shulkers off, offline/deduplicated roster.',
)
