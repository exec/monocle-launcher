<script setup>
import { Input, defineMessages, useVIntl } from '@modrinth/ui'
import { invoke } from '@tauri-apps/api/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { users } from '@/helpers/auth'
import { canLaunchSession, launchSessions, sessionState, sessionRoster } from '@/helpers/bot-sessions'
import { list, run } from '@/helpers/instance'
import { get_all, kill } from '@/helpers/process'

const props = defineProps({
	workers: { type: Array, default: () => [] },
	crews: { type: Array, default: () => [] },
	crewLabels: { type: Object, default: () => ({}) },
})
const { formatMessage: t } = useVIntl()
const messages = defineMessages({
	title: { id: 'app.bots.sessions.title', defaultMessage: 'Local worker sessions' },
	intro: {
		id: 'app.bots.sessions.intro',
		defaultMessage:
			'One account, one instance, one worker. Remote workers remain independently managed.',
	},
	setup: {
		id: 'app.bots.sessions.setup',
		defaultMessage:
			'Choose an instance for each Minecraft account. Install Monocle in it, then select a crew to prepare Worker mode and its connection automatically before launch. No first connection is required.',
	},
	launchAll: { id: 'app.bots.sessions.launch-all', defaultMessage: 'Launch stopped sessions' },
	refresh: { id: 'app.bots.sessions.refresh', defaultMessage: 'Refresh accounts & instances' },
	empty: {
		id: 'app.bots.sessions.empty',
		defaultMessage: 'Sign in to a Minecraft account in the launcher to set up your first local worker.',
	},
	crew: { id: 'app.bots.sessions.crew', defaultMessage: 'Initial crew / automatic connection' },
	manual: { id: 'app.bots.sessions.manual', defaultMessage: 'Use the client’s connection settings' },
	source: { id: 'app.bots.sessions.source', defaultMessage: 'Gameplay settings source' },
	keepSettings: { id: 'app.bots.sessions.keep-settings', defaultMessage: 'Keep this worker’s settings' },
	preparation: {
		id: 'app.bots.sessions.preparation',
		defaultMessage: 'Preparation runs before Minecraft starts. Source instances must be stopped. Only module settings are copied; enabled modules and keybinds stay with this worker. Originals are backed up under monocle-client/launcher-backups. Pending recovery keeps its existing configuration. Job profiles still come from the host for every worker.',
	},
	crewNote: {
		id: 'app.bots.sessions.crew-note',
		defaultMessage: 'The host’s recorded crew assignment takes precedence on later launches. Move an existing worker from Crews; the launcher does not undo host reassignments.',
	},
	account: { id: 'app.bots.sessions.account', defaultMessage: 'Minecraft account' },
	instance: { id: 'app.bots.sessions.instance', defaultMessage: 'Local instance' },
	server: { id: 'app.bots.sessions.server', defaultMessage: 'Join server (optional)' },
	unbound: { id: 'app.bots.sessions.unbound', defaultMessage: 'Not bound' },
	missing: {
		id: 'app.bots.sessions.missing',
		defaultMessage: 'Unavailable — choose a replacement',
	},
	save: { id: 'app.bots.sessions.save', defaultMessage: 'Save binding' },
	remove: { id: 'app.bots.sessions.remove', defaultMessage: 'Unbind' },
	launch: { id: 'app.bots.sessions.launch', defaultMessage: 'Launch game' },
	stop: { id: 'app.bots.sessions.stop', defaultMessage: 'Stop game' },
	logs: { id: 'app.bots.sessions.logs', defaultMessage: 'Session logs' },
	configure: { id: 'app.bots.sessions.configure', defaultMessage: 'Open instance' },
	confirmStop: {
		id: 'app.bots.sessions.confirm-stop',
		defaultMessage:
			'Stop this local Minecraft session? This does not cancel its host job. Active work will detach, and unfinished container recovery may need attention.',
	},
	saved: { id: 'app.bots.sessions.saved', defaultMessage: 'Worker session binding saved.' },
	select: {
		id: 'app.bots.sessions.select',
		defaultMessage: 'Choose an account and instance before saving.',
	},
	failed: { id: 'app.bots.sessions.failed', defaultMessage: '{worker}: {error}' },
	Launching: { id: 'app.bots.sessions.launching', defaultMessage: 'Launching game' },
	Unmanaged: { id: 'app.bots.sessions.unmanaged', defaultMessage: 'Unmanaged / remote' },
	External: {
		id: 'app.bots.sessions.external',
		defaultMessage: 'Worker online · external session',
	},
	Stopped: { id: 'app.bots.sessions.stopped', defaultMessage: 'Not running in this launcher' },
	Waiting: {
		id: 'app.bots.sessions.waiting',
		defaultMessage: 'Game running · waiting for crew connection',
	},
	Connected: {
		id: 'app.bots.sessions.connected',
		defaultMessage: 'Game running · worker connected',
	},
})
const bindings = ref([])
const accounts = ref([])
const instances = ref([])
const processes = ref([])
const edits = ref({})
const launching = ref(new Set())
const busy = ref(false)
const notice = ref('')
let timer
let disposed = false
const rows = computed(() => sessionRoster(props.workers, bindings.value, accounts.value))
function binding(worker) {
	return bindings.value.find((entry) => entry.worker === worker.id)
}
function edit(worker) {
	return (edits.value[worker.id] ||= {
		...binding(worker),
		worker: worker.id,
		account: binding(worker)?.account || accounts.value.find((account) => account.id === worker.id)?.id || '',
		instance: binding(worker)?.instance || '',
		server: binding(worker)?.server || '',
		crew: binding(worker)?.crew || '',
		template: binding(worker)?.template || '',
	})
}
function running(worker) {
	return processes.value.filter((process) => process.instance_id === binding(worker)?.instance)
}
function ready(entry) {
	if (
		!canLaunchSession(
			entry,
			processes.value,
			props.workers.find((worker) => worker.id === entry.worker),
		)
	)
		return false
	const draft = edits.value[entry.worker]
	if (
		draft &&
		(draft.account !== entry.account ||
			draft.instance !== entry.instance ||
			draft.server !== entry.server ||
			draft.crew !== (entry.crew || '') ||
			draft.template !== (entry.template || ''))
	)
		return false
	return (
		accounts.value.some((account) => account.id === entry.account) &&
		instances.value.some((instance) => instance.id === entry.instance) &&
		(!entry.template || instances.value.some((instance) => instance.id === entry.template) &&
			!processes.value.some((process) => process.instance_id === entry.template))
	)
}
async function refreshResources() {
	const [credentials, profiles] = await Promise.all([users(), list()])
	accounts.value = credentials.map(({ profile }) => ({ id: profile.id, name: profile.name }))
	instances.value = profiles
	processes.value = await get_all()
}
async function action(fn) {
	if (busy.value) return
	busy.value = true
	notice.value = ''
	try {
		await fn()
	} catch (error) {
		notice.value = String(error)
	} finally {
		busy.value = false
	}
}
async function save(worker, remove = false) {
	const entry = { ...edit(worker), server: edit(worker).server.trim() }
	if (!remove && (!entry.account || !entry.instance)) throw new Error(t(messages.select))
	const next = bindings.value.filter((entry) => entry.worker !== worker.id)
	if (!remove) next.push(entry)
	await invoke('bot_worker_sessions_save', { sessions: next })
	bindings.value = next
	delete edits.value[worker.id]
	notice.value = t(messages.saved)
}
async function launch(entries) {
	processes.value = await get_all()
	const failures = await launchSessions(entries, processes.value, async (entry) => {
		launching.value.add(entry.worker)
		try {
			await run(entry.instance, entry.server || null, entry.account)
		} finally {
			launching.value.delete(entry.worker)
		}
	})
	processes.value = await get_all()
	notice.value = failures
		.map(({ worker, error }) =>
			t(messages.failed, {
				worker: rows.value.find((row) => row.id === worker)?.name || worker,
				error,
			}),
		)
		.join('\n')
}
async function stop(worker) {
	if (!confirm(t(messages.confirmStop))) return
	for (const process of running(worker)) await kill(process.uuid)
	processes.value = await get_all()
}
async function poll() {
	if (disposed) return
	try {
		processes.value = await get_all()
	} catch (error) {
		notice.value = String(error)
	}
	if (!disposed) timer = setTimeout(poll, 1000)
}
onMounted(async () => {
	await action(async () => {
		bindings.value = await invoke('bot_worker_sessions')
		await refreshResources()
	})
	void poll()
})
onUnmounted(() => {
	disposed = true
	clearTimeout(timer)
})
</script>

<template>
	<section class="sessions" aria-labelledby="local-sessions-title">
		<div class="session-heading">
			<div>
				<h2 id="local-sessions-title">{{ t(messages.title) }}</h2>
				<p>{{ t(messages.intro) }}</p>
			</div>
			<button
				class="launch-all"
				:disabled="busy || !bindings.some(ready)"
				@click="action(() => launch(bindings.filter(ready)))"
			>
				{{ t(messages.launchAll) }}
			</button>
		</div>
		<p class="setup-note">{{ t(messages.setup) }}</p>
		<p v-if="notice" role="status" class="session-notice">{{ notice }}</p>
		<p v-if="!rows.length">{{ t(messages.empty) }}</p>
		<article v-for="worker in rows" :key="worker.id" class="worker-session">
			<div class="session-heading">
				<strong>{{ worker.name }}</strong>
				<span
					class="session-state"
					:class="{ online: sessionState(binding(worker), processes, worker) === 'Connected' }"
					>{{
						t(messages[sessionState(binding(worker), processes, worker, launching.has(worker.id))])
					}}</span
				>
			</div>
			<div class="binding-fields">
				<label
					>{{ t(messages.account)
					}}<select v-model="edit(worker).account" :disabled="busy || running(worker).length">
						<option value="">{{ t(messages.unbound) }}</option>
						<option
							v-if="
								edit(worker).account &&
								!accounts.some((account) => account.id === edit(worker).account)
							"
							:value="edit(worker).account"
						>
							{{ t(messages.missing) }}
						</option>
						<option v-for="account in accounts" :key="account.id" :value="account.id">
							{{ account.name }}
						</option>
					</select></label
				>
				<label
					>{{ t(messages.instance)
					}}<select v-model="edit(worker).instance" :disabled="busy || running(worker).length">
						<option value="">{{ t(messages.unbound) }}</option>
						<option
							v-if="
								edit(worker).instance &&
								!instances.some((instance) => instance.id === edit(worker).instance)
							"
							:value="edit(worker).instance"
						>
							{{ t(messages.missing) }}
						</option>
						<option v-for="instance in instances" :key="instance.id" :value="instance.id">
							{{ instance.name }}
						</option>
					</select></label
				>
				<div>
					<label :for="`server-${worker.id}`">{{ t(messages.server) }}</label
					><Input
						:id="`server-${worker.id}`"
						v-model="edit(worker).server"
						:disabled="busy || running(worker).length"
						:maxlength="253"
					/>
				</div>
			</div>
			<div class="session-actions">
				<label>{{ t(messages.crew) }}<select v-model="edit(worker).crew" :disabled="busy || running(worker).length">
					<option value="">{{ t(messages.manual) }}</option>
					<option v-if="edit(worker).crew && !crews.includes(edit(worker).crew)" :value="edit(worker).crew">{{ t(messages.missing) }}</option>
					<option v-for="crew in crews" :key="crew" :value="crew">{{ crewLabels[crew] || crew }}</option>
				</select></label>
				<label>{{ t(messages.source) }}<select v-model="edit(worker).template" :disabled="busy || running(worker).length">
					<option value="">{{ t(messages.keepSettings) }}</option>
					<option v-if="edit(worker).template && !instances.some((i) => i.id === edit(worker).template)" :value="edit(worker).template">{{ t(messages.missing) }}</option>
					<option v-for="instance in instances.filter((i) => i.id !== edit(worker).instance)" :key="instance.id" :value="instance.id">{{ instance.name }}</option>
				</select></label>
			</div>
			<p v-if="edit(worker).crew" class="preparation-note">{{ t(messages.crewNote) }}</p>
			<p v-if="edit(worker).crew || edit(worker).template" class="preparation-note">{{ t(messages.preparation) }}</p>
			<div class="session-actions">
				<button :disabled="busy || running(worker).length" @click="action(() => save(worker))">
					{{ t(messages.save) }}
				</button>
				<button
					v-if="binding(worker)"
					:disabled="busy || running(worker).length"
					@click="action(() => save(worker, true))"
				>
					{{ t(messages.remove) }}
				</button>
				<button
					v-if="binding(worker)"
					class="launch-all"
					:disabled="busy || running(worker).length || !ready(binding(worker))"
					@click="action(() => launch([binding(worker)]))"
				>
					{{ t(messages.launch) }}
				</button>
				<button v-if="running(worker).length" :disabled="busy" @click="action(() => stop(worker))">
					{{ t(messages.stop) }}
				</button>
				<template
					v-if="
						binding(worker) &&
						instances.some((instance) => instance.id === binding(worker).instance)
					"
				>
					<RouterLink :to="{ name: 'InstanceLogs', params: { id: binding(worker).instance } }">{{
						t(messages.logs)
					}}</RouterLink>
					<RouterLink :to="{ name: 'InstanceContent', params: { id: binding(worker).instance } }">{{
						t(messages.configure)
					}}</RouterLink>
				</template>
			</div>
		</article>
		<button :disabled="busy" @click="action(refreshResources)">{{ t(messages.refresh) }}</button>
	</section>
</template>

<style scoped>
.sessions {
	padding: 1.5rem;
	border: 1px solid var(--surface-4);
	border-radius: 1rem;
	background: var(--surface-2);
	color: #eeedf1;
	margin-bottom: 1rem;
}
.session-heading,
.session-actions {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 0.75rem;
	flex-wrap: wrap;
}
h2 {
	font-size: 1.3rem;
	margin: 0;
}
p {
	color: #b7b3c1;
	font-size: 0.9rem;
	margin: 0.5rem 0;
}
.setup-note {
	border-left: 2px solid #c5a765;
	padding-left: 0.75rem;
	margin: 1rem 0;
}
.worker-session {
	border: 1px solid var(--surface-4);
	border-radius: 0.75rem;
	padding: 1rem;
	margin: 0.75rem 0;
	background: var(--surface-1);
}
.binding-fields {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.75rem;
	margin: 1rem 0;
}
label {
	display: block;
	font-size: 0.85rem;
	color: #d3cedb;
}
select {
	display: block;
	width: 100%;
	padding: 0.65rem;
	background: var(--surface-3);
	color: #eeedf1;
	border: 1px solid var(--surface-4);
	border-radius: 0.5rem;
	margin-top: 0.25rem;
}
button,
a {
	border: 1px solid var(--surface-4);
	border-radius: 0.5rem;
	padding: 0.5rem 0.8rem;
	color: #eeedf1;
	background: var(--surface-3);
	text-decoration: none;
	font-size: 0.85rem;
}
button:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
button:not(:disabled):hover,
a:hover {
	border-color: #dbbd7c;
}
button:focus-visible,
a:focus-visible,
select:focus-visible {
	outline: 2px solid #f0d697;
	outline-offset: 3px;
}
.launch-all {
	color: #19150b;
	border-color: #b69a58;
	background: linear-gradient(115deg, #ba9a5e, #ebd19a);
}
.session-actions {
	justify-content: flex-start;
}
.preparation-note { font-size: .75rem; line-height: 1.6; margin: .75rem 0; }
.session-state {
	font-size: 0.8rem;
	color: #bdb4cf;
}
.online {
	color: #87deb0;
}
.session-notice {
	white-space: pre-wrap;
	color: #f3d694;
}
@media (max-width: 900px) {
	.binding-fields {
		grid-template-columns: 1fr;
	}
}
</style>
