import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const server = await createServer({
	root,
	configFile: false,
	plugins: [vue()],
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true },
	appType: 'custom',
})
try {
	const { default: Dashboard } = await server.ssrLoadModule(
		'/src/components/bot-dashboard/index.vue',
	)
	const worker = { id: 'worker', name: '<unsafe>', crew: 'crew', connected: true, reconciled: true }
	const job = {
		id: 'job',
		name: 'Test road',
		status: 'Running',
		crew: 'crew',
		highwayProgress: 25,
		nativeDefinition: { length: 100 },
	}
	const props = {
		host: { crews: ['crew'], crewLabels: { crew: 'Test crew' } },
		workers: [worker],
		jobs: [job],
		issues: [worker],
		connected: true,
		canControl: true,
	}
	const render = (overrides = {}) =>
		renderToString(createSSRApp({ render: () => h(Dashboard, { ...props, ...overrides }) }))
	const live = await render()
	assert.ok(live.includes('25.0%'))
	assert.ok(live.includes('&lt;unsafe&gt;'))
	assert.ok(!live.includes('<unsafe>'))
	assert.ok(!/disabled[^>]*>\s*Ⅱ Pause/.test(live))
	const offline = await render({ connected: false, canControl: false })
	assert.ok(offline.includes('LAST KNOWN OPERATIONS'))
	assert.ok(offline.includes('Waiting for the host.'))
	assert.match(offline, /disabled[^>]*>\s*Ⅱ Pause/)
	const cleanup = await render({ jobs: [{ ...job, cleanupPending: true }] })
	assert.match(cleanup, /disabled[^>]*>\s*Ⅱ Pause/)
	const empty = await render({ workers: [], jobs: [], issues: [] })
	assert.ok(empty.includes('Your fleet starts here.'))
	assert.ok(empty.includes('A clear runway.'))
	console.log(
		'Dashboard checks passed: progress, escaped names, disconnected controls, cleanup and empty fleet.',
	)
} finally {
	await server.close()
}
