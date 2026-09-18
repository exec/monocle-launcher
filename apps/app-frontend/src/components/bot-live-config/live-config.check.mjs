import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const server = await createServer({
	root: fileURLToPath(new URL('../../../', import.meta.url)),
	configFile: false,
	plugins: [vue()],
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { middlewareMode: true },
	appType: 'custom',
})
try {
	const { default: Component } = await server.ssrLoadModule(
		'/src/components/bot-live-config/index.vue',
	)
	const task = { id: 'job' },
		run = { id: 'run', status: 'Running', configurationVersion: 1 }
	const render = (overrides = {}) =>
		renderToString(
			createSSRApp({
				render: () => h(Component, { task, run, worker: 'worker', canControl: true, ...overrides }),
			}),
		)
	assert.doesNotMatch(await render(), /disabled[^>]*>Apply to worker/)
	assert.match(await render({ canControl: false }), /disabled[^>]*>Apply to worker/)
	assert.match(
		await render({ run: { ...run, configurationVersion: undefined } }),
		/disabled[^>]*>Apply to worker/,
	)
	assert.match(
		await render({ run: { ...run, status: 'Cancelled' } }),
		/disabled[^>]*>Apply to worker/,
	)
	assert.match(
		await render({ task: { ...task, cancelled: true } }),
		/disabled[^>]*>Apply to worker/,
	)
	assert.match(
		await render({ run: { ...run, configuration: { revision: 2 }, configRevision: 1 } }),
		/Awaiting worker acknowledgement/,
	)
	const rejection = await render({
		run: { ...run, configRevision: 2, configError: '<bad setting>' },
	})
	assert.ok(rejection.includes('&lt;bad setting&gt;') && !rejection.includes('<bad setting>'))
	assert.match(await render({ run: { ...run, configRevision: 2 } }), /Applied revision 2/)
	console.log(
		'Live configuration checks passed: capability, offline/cancelled gates, pending ACK, applied and escaped errors.',
	)
} finally {
	await server.close()
}
