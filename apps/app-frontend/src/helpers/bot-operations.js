export const directions = {
	North: [0, -1],
	South: [0, 1],
	West: [-1, 0],
	East: [1, 0],
}
export const inventoryLimits = {
	paving: [64, 1536],
	picks: [2, 9],
	food: [16, 256],
	filler: [0, 256],
}
export function commonArguments(entry, f, dimension) {
	switch (entry) {
		case 'task-travel':
			return {
				x: integer(f.x, -29900000, 29900000, 'X'),
				y: integer(f.y, -2048, 2048, 'Y'),
				z: integer(f.z, -29900000, 29900000, 'Z'),
				radius: integer(f.radius, 1, 8, 'Arrival radius'),
				dimension,
			}
		case 'task-wait':
			return { ticks: integer(f.ticks, 1, 72000, 'Wait ticks') }
		case 'task-tpa': {
			if (!f.target?.trim()) throw new Error('Choose a TPA target')
			return {
				target: f.target.trim(),
				warmupTicks: integer(f.warmupTicks, 0, 1200, 'Warmup'),
				timeoutTicks: integer(f.timeoutTicks, 20, 72000, 'Timeout'),
				radius: integer(f.radius, 1, 16, 'Arrival radius'),
			}
		}
		case 'task-drop': {
			if (!/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(f.item)) throw new Error('Specify an item ID')
			return {
				item: f.item,
				count: integer(f.count, 1, 2304, 'Item count'),
				...(f.recipient ? { recipient: f.recipient } : {}),
			}
		}
		case 'task-profile':
			return { name: f.profile || 'Current' }
		default:
			return null
	}
}
export function highwayDefaults(packet) {
	const g = packet?.geometry || {},
		l = g.layout || {},
		p = l.inventory || {}
	const captured = packet?.profiles?.Current || {}
	function setting(module, key, fallback) {
		const source = captured[module]?.settings || ''
		const matches = [
			...source.matchAll(
				new RegExp(
					`(?:name|"name")\\s*:\\s*"${key}"\\s*,\\s*(?:value|"value")\\s*:\\s*([^,}]+)`,
					'g',
				),
			),
		]
		if (!matches.length) return fallback
		const value = matches.at(-1)[1].trim()
		if (value === '1b' || value === 'true') return true
		if (value === '0b' || value === 'false') return false
		const number = Number(value.replace(/[bBdDfFlLsS]$/, ''))
		return Number.isFinite(number) ? number : fallback
	}
	return {
		x: g.x ?? 0,
		y: g.y ?? 116,
		z: g.z ?? 0,
		direction: l.heading || 'North',
		length: 4096,
		endMode: 'length',
		endpoint: -100000,
		width: l.width ?? 5,
		height: l.height ?? 3,
		railings: l.railings ?? true,
		above: l.above ?? true,
		supports: l.supports ?? false,
		floor: l.floor || 'Replace',
		material: l.blocks || 'minecraft:obsidian',
		sharing: l.workSharing || 'Lanes',
		speed: setting('speed', 'vanilla-speed', 5),
		keepShulkers: setting('highway-builder', 'keep-shulkers', false),
		paving: p.paving ?? 512,
		picks: p.picks ?? 3,
		food: p.food ?? 64,
		filler: p.filler ?? 64,
		paveAhead: setting('highway-builder', 'blocks-ahead-to-pave', 5),
		breakAhead: setting('highway-builder', 'blocks-ahead-to-break', 5),
		placementRate: setting('highway-builder', 'placements-per-tick', 10),
		breakRate: setting('highway-builder', 'blocks-per-tick', 5),
	}
}
function integer(value, min, max, label) {
	const n = Number(value)
	if (!Number.isSafeInteger(n) || n < min || n > max)
		throw new Error(`${label}: expected ${min}–${max}`)
	return n
}
export function highwayDistance(f) {
	const [dx, dz] = directions[f.direction] || []
	if (dx === undefined) throw new Error('Choose a highway direction')
	const start = integer(dx ? f.x : f.z, -29900000, 29900000, 'Origin')
	return f.endMode === 'endpoint'
		? integer((Number(f.endpoint) - start) * (dx || dz), 16, 100000, 'Distance to endpoint')
		: integer(f.length, 16, 100000, 'Length')
}
export function highwayEndpoint(f) {
	const length = highwayDistance(f),
		[dx, dz] = directions[f.direction]
	return { x: Number(f.x) + dx * length, y: Number(f.y), z: Number(f.z) + dz * length, length }
}
function splitSnbt(source, delimiter = ',') {
	const result = []
	let depth = 0,
		quote = '',
		escaped = false,
		start = 0
	for (let i = 0; i < source.length; i++) {
		const c = source[i]
		if (quote) {
			if (escaped) escaped = false
			else if (c === '\\') escaped = true
			else if (c === quote) quote = ''
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === '[' || c === '{') depth++
		else if (c === ']' || c === '}') depth--
		else if (c === delimiter && depth === 0) {
			result.push(source.slice(start, i).trim())
			start = i + 1
		}
		if (depth < 0) throw new Error('Invalid captured SNBT')
	}
	if (quote || depth !== 0) throw new Error('Unbalanced captured SNBT')
	const last = source.slice(start).trim()
	if (last) result.push(last)
	return result
}
function snbtString(source) {
	const value = source.trim()
	return /^["']/.test(value) ? value.slice(1, -1).replace(/\\(["'\\])/g, '$1') : value
}
function snbtCompound(source) {
	const value = source.trim()
	if (!value.startsWith('{') || !value.endsWith('}')) throw new Error('Expected settings compound')
	const fields = new Map()
	for (const entry of splitSnbt(value.slice(1, -1))) {
		const parts = splitSnbt(entry, ':'),
			key = snbtString(parts.shift())
		if (!key || !parts.length || fields.has(key))
			throw new Error('Invalid or duplicate settings field')
		fields.set(key, parts.join(':'))
	}
	return fields
}
function snbtList(source) {
	const value = source.trim()
	if (!value.startsWith('[') || !value.endsWith(']')) throw new Error('Expected settings list')
	return splitSnbt(value.slice(1, -1))
}
function encodeCompound(fields) {
	return `{${[...fields].map(([k, v]) => JSON.stringify(k) + ':' + v).join(',')}}`
}
function mergeSettings(source, overrides) {
	const root = snbtCompound(source || '{}'),
		groups = snbtList(root.get('groups') || '[]').map(snbtCompound)
	const names = new Set()
	for (const g of groups) {
		const name = snbtString(g.get('name') || '')
		if (!name || names.has(name)) throw new Error('Duplicate or unnamed captured settings group')
		names.add(name)
	}
	for (const override of splitSnbt(overrides).map(snbtCompound)) {
		const name = snbtString(override.get('name')),
			existing = groups.find((g) => snbtString(g.get('name')) === name)
		if (!existing) {
			groups.push(override)
			continue
		}
		const entries = snbtList(existing.get('settings') || '[]').map(snbtCompound),
			seen = new Set()
		for (const entry of entries) {
			const key = snbtString(entry.get('name') || '')
			if (!key || seen.has(key)) throw new Error('Duplicate or unnamed captured setting')
			seen.add(key)
		}
		for (const entry of snbtList(override.get('settings')).map(snbtCompound)) {
			const key = snbtString(entry.get('name')),
				index = entries.findIndex((e) => snbtString(e.get('name')) === key)
			if (index < 0) entries.push(entry)
			else entries[index].set('value', entry.get('value'))
		}
		existing.set('settings', `[${entries.map(encodeCompound).join(',')}]`)
	}
	root.set('groups', `[${groups.map(encodeCompound).join(',')}]`)
	return encodeCompound(root)
}
function group(name, values) {
	return `{name:${JSON.stringify(name)},sectionExpanded:1b,settings:[${Object.entries(values)
		.map(([key, value]) => `{name:${JSON.stringify(key)},value:${value}}`)
		.join(',')}]}`
}
export function highwayPayload(packet, f, server, dimension) {
	const result = JSON.parse(JSON.stringify(packet))
	if (!result?.highways?.[result.entry]) throw new Error('Choose a native highway workflow')
	const plan = result.highways[result.entry],
		end = highwayEndpoint(f),
		[dx, dz] = directions[f.direction]
	const operation = { Build: 'Build', Excavate: 'ClearTunnel', Pave: 'Pave' }[plan.duty]
	if (!operation) throw new Error('This workflow cannot build a highway')
	const inventory = { enabled: true, trash: true }
	for (const [key, limits] of Object.entries(inventoryLimits))
		inventory[key] = integer(f[key], ...limits, key)
	result.geometry = {
		scope: `${server}\n${dimension}`,
		x: integer(f.x, -29900000, 29900000, 'X'),
		y: integer(f.y, -2048, 2048, 'Y'),
		z: integer(f.z, -29900000, 29900000, 'Z'),
		layout: {
			...(result.geometry?.layout || {}),
			dx,
			dz,
			heading: f.direction,
			operation,
			width: integer(f.width, 1, 5, 'Width'),
			height: integer(f.height, 1, 7, 'Height'),
			floor: f.floor,
			railings: !!f.railings,
			above: !!f.above,
			supports: !!f.supports,
			blocks: f.material,
			workSharing: f.sharing,
			inventory,
		},
	}
	const speed = Number(f.speed)
	if (!Number.isFinite(speed) || speed < 0.1 || speed > 10) throw new Error('Speed must be 0.1–10')
	const profiles = result.profiles || (result.profiles = { Current: {} })
	for (const profile of Object.values(profiles)) {
		profile.speed = {
			...profile.speed,
			active: true,
			settings: mergeSettings(
				profile.speed?.settings,
				group('General', { mode: '"Vanilla"', 'vanilla-speed': `${speed}d` }),
			),
		}
		profile['highway-builder'] = {
			...profile['highway-builder'],
			active: false,
			settings: mergeSettings(
				profile['highway-builder']?.settings,
				[
					group('Inventory', { 'keep-shulkers': f.keepShulkers ? '1b' : '0b' }),
					group('Paving', {
						'blocks-ahead-to-pave': integer(f.paveAhead, 1, 5, 'Pave ahead'),
						'placements-per-tick': integer(f.placementRate, 1, 20, 'Placement rate'),
					}),
					group('Digging', {
						'blocks-ahead-to-break': integer(f.breakAhead, 1, 5, 'Break ahead'),
						'blocks-per-tick': integer(f.breakRate, 1, 20, 'Break rate'),
					}),
				].join(','),
			),
		}
	}
	return {
		package: result,
		args: { x: result.geometry.x, y: result.geometry.y, z: result.geometry.z, length: end.length },
		endpoint: end,
	}
}
export function workerRoster(snapshot) {
	const roster = new Map()
	for (const worker of snapshot?.workers || []) {
		const prior = roster.get(worker.id)
		if (
			!prior ||
			(!prior.connected && worker.connected) ||
			(prior.connected === worker.connected && (worker.lastSeen || 0) > (prior.lastSeen || 0))
		)
			roster.set(worker.id, worker)
	}
	for (const task of [...(snapshot?.tasks || []), ...(snapshot?.history || [])])
		for (const id of Object.keys(task.runs || {})) {
			if (!roster.has(id)) roster.set(id, { id, name: id, crew: task.crew, connected: false })
		}
	return [...roster.values()].sort(
		(a, b) => a.crew.localeCompare(b.crew) || a.name.localeCompare(b.name),
	)
}
