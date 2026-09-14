<script setup>
import { ServerStackIcon } from '@modrinth/assets'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import BotWorkerSessions from '@/components/bot-worker-sessions/index.vue'

import { auto_install_java, find_filtered_jres } from '@/helpers/jre'
import { useRootBreadcrumb } from '@/providers/breadcrumbs'
import {
	directions,
	highwayDefaults,
	highwayEndpoint,
	highwayPayload,
	workerRoster,
	inventoryLimits,
	commonArguments,
} from '@/helpers/bot-operations'

useRootBreadcrumb({
	slot: 'root',
	id: 'bots',
	label: 'Bots',
	to: '/bots',
	visual: { type: 'icon', component: ServerStackIcon },
})
const settings = ref({ dataDir: '', javaPath: '' })
const saved = ref(false)
const connection = ref({ connected: false, managed: false })
const host = ref(null)
const tab = ref('Overview')
const busy = ref(false)
const notice = ref('')
const crewKeys = ref(null)
const dialog = ref(null)
const workflow = ref(null)
const selected = ref([])
const job = ref({
	name: 'Highway job',
	crew: '',
	server: '',
	dimension: 'minecraft:the_nether',
	priority: 0,
	args: '{}',
})
const pending = ref(null)
const roster = computed(() => workerRoster(host.value))
const currentCrew = ref('')
const jobHistory = ref(false)
const draftId = ref('')
const jobType = ref('Highway')
const workflowId = ref('highway-default')
const highway = ref(highwayDefaults())
const common = ref({
	x: 0,
	y: 116,
	z: 0,
	radius: 2,
	ticks: 200,
	target: '',
	warmupTicks: 60,
	timeoutTicks: 600,
	item: 'minecraft:netherrack',
	count: 64,
	recipient: '',
	profile: 'Current',
})
const endpoint = computed(() => {
	try {
		return highwayEndpoint(highway.value)
	} catch (e) {
		return { error: String(e) }
	}
})
const librarySearch = ref('')
const workflowDialog = ref(null)
const editor = ref(null)
const editorScript = ref('')
const editorEntry = ref('')
const previousEditorEntry = ref('')
const editorPackage = ref('')
const assignmentDialog = ref(null)
const assignmentId = ref('')
const crewName = ref('')
const workerFilter = ref('All')
const retention = ref(30)
const lastSnapshot = ref(0)
const liveJobs = computed(() => [
	...(host.value?.tasks || []),
	...(host.value?.history || []).filter((t) => t.cleanupPending),
])
const finishedHistory = computed(() => (host.value?.history || []).filter((t) => !t.cleanupPending))
const issues = computed(() =>
	roster.value.filter((w) => {
		const d = nativeWorker(w)?.diagnostics || w.diagnostics || {}
		return (
			w.connected &&
			(d.paused ||
				d.waitingForWorld ||
				Number(d.tickAgeMs) > 1000 ||
				/paused|failed|no safe|unexpected|blocked/i.test(state(w).detail) ||
				(Number(d.idleTicks) >= 20 &&
					/wait|request|restock|recover|return|seal/i.test(state(w).detail)))
		)
	}),
)
const visibleWorkflows = computed(() =>
	(host.value?.workflows || []).filter((w) =>
		`${w.folder}/${w.name}`.toLowerCase().includes(librarySearch.value.toLowerCase()),
	),
)
const workflowFolders = computed(() =>
	[...new Set(visibleWorkflows.value.map((w) => w.folder))].sort(),
)
const draftJobs = computed(() =>
	(host.value?.drafts || []).filter(
		(d) =>
			![...(host.value?.tasks || []), ...(host.value?.history || [])].some((t) => t.id === d.id),
	),
)
const canControl = computed(() => !busy.value && saved.value && connection.value.connected)
function crewLabel(id) {
	return host.value?.crewLabels?.[id] || id
}
function confirmed(message, fn) {
	if (confirm(message)) return action(fn)
}
function ago(at) {
	if (!at) return 'Unknown'
	return `${Math.max(0, Math.round((Date.now() - at) / 1000))}s ago`
}
function workerName(id) {
	return roster.value.find((w) => w.id === id)?.name || id
}
function nativeWorker(w) {
	return host.value?.highways?.[w.crew]?.workers?.find((n) => n.id === w.id)
}
function workerRuns(w) {
	return liveJobs.value.filter((t) => t.runs?.[w.id]).map((t) => ({ task: t, run: t.runs[w.id] }))
}
function pickCrew(id) {
	currentCrew.value = id
	job.value.crew = id
	selected.value = workers()
		.filter((w) => w.crew === id && w.reconciled)
		.map((w) => w.id)
	const first = workers().find((w) => w.crew === id && w.positionFresh)
	if (first) {
		const scope = first.scope.split('\n')
		job.value.server = scope[0]
		job.value.dimension = scope[1] || job.value.dimension
	}
}
async function loadWorkflow(id) {
	const record = await control({ op: 'workflow-get', id })
	workflow.value = record.package
	workflowId.value = id
	highway.value = highwayDefaults(record.package)
	jobType.value = record.package.highways?.[record.package.entry] ? 'Highway' : 'Workflow'
	const first = workers().find((w) => w.crew === job.value.crew && w.positionFresh)
	if (first) {
		Object.assign(highway.value, {
			x: Math.floor(first.x),
			y: Math.floor(first.y),
			z: Math.floor(first.z),
		})
		Object.assign(common.value, {
			x: Math.floor(first.x),
			y: Math.floor(first.y),
			z: Math.floor(first.z),
		})
	}
}
async function prepareJob(crew) {
	if (pending.value) {
		dialog.value.showModal()
		return
	}
	draftId.value = ''
	pickCrew(typeof crew === 'string' ? crew : currentCrew.value || host.value.crews[0])
	await loadWorkflow(workflowId.value || 'highway-default')
	const first = workers().find((w) => w.crew === job.value.crew && w.positionFresh)
	if (first) {
		highway.value.x = Math.floor(first.x)
		highway.value.y = Math.floor(first.y)
		highway.value.z = Math.floor(first.z)
	}
	job.value.name = jobType.value === 'Highway' ? 'Highway job' : 'Workflow job'
	job.value.args = '{}'
	dialog.value.showModal()
}
async function useWorkflow(id) {
	await prepareJob()
	await loadWorkflow(id)
}
function jobDefinition() {
	if (!workflow.value) throw new Error('Select a saved workflow')
	const payload =
		jobType.value === 'Highway'
			? highwayPayload(workflow.value, highway.value, job.value.server, job.value.dimension)
			: {
					package: JSON.parse(JSON.stringify(workflow.value)),
					args:
						commonArguments(workflow.value.entry, common.value, job.value.dimension) ||
						JSON.parse(job.value.args),
				}
	return {
		id: draftId.value || crypto.randomUUID(),
		name: job.value.name,
		server: job.value.server,
		dimension: job.value.dimension,
		priority: Number(job.value.priority),
		package: payload.package,
		args: payload.args,
	}
}
async function saveDraft() {
	const draft = jobDefinition()
	draftId.value = draft.id
	await control({ op: 'draft-save', draft })
	dialog.value.close()
	tab.value = 'Jobs'
	notice.value = 'Job saved without assigning a crew. No workers were started.'
}
async function editDraft(id) {
	const d = await control({ op: 'draft-get', id })
	if (d.nativeDefinition)
		throw new Error(
			'This job contains a verified checkpoint. Assign a crew to continue it; its geometry is protected from accidental edits.',
		)
	draftId.value = id
	workflow.value = d.package
	Object.assign(common.value, d.args)
	if (d.args.name) common.value.profile = d.args.name
	Object.assign(job.value, {
		name: d.name,
		server: d.server,
		dimension: d.dimension,
		priority: d.priority,
		args: JSON.stringify(d.args, null, 2),
	})
	highway.value = { ...highwayDefaults(d.package), ...d.args }
	jobType.value = d.package.highways?.[d.package.entry] ? 'Highway' : 'Workflow'
	dialog.value.showModal()
}
async function assignCrew(id) {
	pickCrew(id)
	assignmentId.value = draftJobs.value[0]?.id || ''
	assignmentDialog.value.showModal()
}
async function dispatchDraft() {
	if (!assignmentId.value || !selected.value.length)
		throw new Error('Choose an unfinished job and at least one worker')
	if (!pending.value)
		pending.value = {
			op: 'draft-assign',
			id: assignmentId.value,
			crew: job.value.crew,
			workers: [...selected.value],
		}
	await sendPending()
	assignmentDialog.value.close()
	tab.value = 'Jobs'
}
async function sendPending() {
	try {
		await control(pending.value)
	} catch (e) {
		if (String(e).startsWith('Host rejected request:')) pending.value = null
		throw e
	}
	pending.value = null
	notice.value = 'Host accepted the assignment. Worker acknowledgments appear in Jobs.'
}
async function importWorkflow(event) {
	const file = event.target.files?.[0]
	if (!file) return
	if (file.size > 4 * 1024 * 1024) throw new Error('Workflow package exceeds 4 MiB')
	const packet = JSON.parse(await file.text())
	const name = packet.programs?.[packet.entry]?.name || file.name.replace(/\.json$/, '')
	if (!packet.programs?.[packet.entry]) throw new Error('Choose a captured workflow package')
	editor.value = {
		id: crypto.randomUUID(),
		name,
		folder: 'Imported',
		builtin: false,
		package: packet,
	}
	editorEntry.value = packet.entry
	previousEditorEntry.value = packet.entry
	editorScript.value = packet.programs[packet.entry].script
	editorPackage.value = JSON.stringify(packet, null, 2)
	workflowDialog.value.showModal()
	notice.value = 'Review the imported name, code and profiles, then save it to the library.'
	event.target.value = ''
}
async function openEditor(id) {
	const record = await control({ op: 'workflow-get', id })
	editor.value = record
	if (record.builtin) editor.value.name = `${record.name.slice(0, 43)} copy`
	editorEntry.value = record.package.entry
	previousEditorEntry.value = record.package.entry
	editorScript.value = record.package.programs[record.package.entry].script
	editorPackage.value = JSON.stringify(record.package, null, 2)
	workflowDialog.value.showModal()
}
function changeEditorEntry() {
	const packet = JSON.parse(editorPackage.value)
	packet.programs[previousEditorEntry.value].script = editorScript.value
	if (!packet.programs[editorEntry.value])
		throw new Error('Program is missing from the edited package')
	editor.value.package = packet
	editorPackage.value = JSON.stringify(packet, null, 2)
	editorScript.value = packet.programs[editorEntry.value].script
	previousEditorEntry.value = editorEntry.value
}
async function saveEditor() {
	const packet = JSON.parse(editorPackage.value)
	packet.programs[editorEntry.value].script = editorScript.value
	if (editor.value.builtin) {
		editor.value.id = crypto.randomUUID()
		editor.value.builtin = false
	}
	const id = editor.value.id
	const result = await control({
		op: 'workflow-save',
		id,
		name: editor.value.name,
		folder: editor.value.folder,
		package: packet,
	})
	editor.value = result
	workflowDialog.value.close()
	notice.value = 'Workflow snapshot saved. Existing jobs were not changed.'
}
async function duplicateWorkflow(id) {
	const r = await control({ op: 'workflow-get', id })
	const name = prompt('Name for the editable copy', `${r.name} copy`)
	if (name === null) return
	await control({
		op: 'workflow-duplicate',
		source: id,
		id: crypto.randomUUID(),
		name,
		folder: r.folder,
	})
	notice.value = 'Editable copy created.'
}
async function newWorkflow() {
	const name = 'New workflow',
		id = crypto.randomUUID()
	editor.value = {
		id,
		name,
		folder: 'My Workflows',
		builtin: false,
		package: {
			version: 1,
			entry: 'main',
			programs: { main: { name, script: 'return function(ctx)\n return bot.done()\nend' } },
			highways: {},
			profiles: { Current: {} },
		},
	}
	editorEntry.value = 'main'
	previousEditorEntry.value = 'main'
	editorScript.value = editor.value.package.programs.main.script
	editorPackage.value = JSON.stringify(editor.value.package, null, 2)
	workflowDialog.value.showModal()
}
async function createCrew() {
	await control({ op: 'crew-create', id: crypto.randomUUID(), name: crewName.value })
	crewName.value = ''
	notice.value = 'Crew created. Its key is available in Settings.'
}
async function renameCrew(id) {
	const name = prompt('Crew name', crewLabel(id))
	if (name !== null) await control({ op: 'crew-rename', crew: id, name })
}
async function deleteCrew(id) {
	if (confirm(`Delete ${crewLabel(id)}? Workers, jobs and recovery must be released first.`))
		await control({ op: 'crew-delete', crew: id })
}
async function moveWorker(w, event) {
	const target = event.target.value
	event.target.value = w.crew
	if (
		target !== w.crew &&
		confirm(
			`Move ${w.name} to ${crewLabel(target)}? This updates its key and reconnects after cleanup.`,
		)
	)
		await control({ op: 'crew-move', crew: target, worker: w.id })
}
async function resolveTransfer(crew) {
	const execution = host.value.highways[crew]?.execution
	if (
		confirm(
			'Have you inspected both inventories and the ground for dropped resources? This clears the transfer hold without resending unknown drops.',
		)
	)
		await control({ op: 'resolve-transfers', crew, execution, confirmed: true })
}
async function endHighway(crew) {
	if (
		confirm(
			'Cancel this crew’s execution? Cancellation is final; supply recovery and offline-worker cleanup remain protected.',
		)
	)
		await control({ op: 'end-highway', crew })
}
async function continueHighway(task) {
	const captured = await control({ op: 'task-get', id: task.id }),
		g = captured.nativeDefinition,
		p = Number(captured.highwayProgress || 0),
		remaining = g.length - p
	if (remaining < 16)
		throw new Error(
			'Fewer than 16 blocks remain; the native job minimum is 16. Review the endpoint manually.',
		)
	pickCrew(task.crew)
	draftId.value = ''
	workflow.value = captured.package
	highway.value = highwayDefaults(captured.package)
	Object.assign(highway.value, {
		x: g.x + g.layout.dx * p,
		y: g.y,
		z: g.z + g.layout.dz * p,
		direction: g.layout.heading,
		length: remaining,
	})
	Object.assign(job.value, {
		name: `${task.name.slice(0, 35)} continuation`,
		server: task.server,
		dimension: task.dimension,
		priority: task.priority,
	})
	jobType.value = 'Highway'
	dialog.value.showModal()
}
async function releaseJob(task) {
	if (
		confirm(
			'Release this crew and keep the remaining highway as an unassigned job? Work stops now; reassignment waits for supply recovery and worker cleanup.',
		)
	)
		await control({ op: 'task-release', id: task.id, newId: crypto.randomUUID() })
}
let timer,
	disposed = false

async function refresh() {
	const state = await invoke('bot_host_snapshot')
	if (disposed) return
	connection.value = state
	if (state.host) {
		if (!host.value) retention.value = state.host.historyDays ?? 30
		host.value = state.host
		lastSnapshot.value = Date.now()
		if (!currentCrew.value || !state.host.crews.includes(currentCrew.value))
			currentCrew.value = state.host.crews[0] || ''
		if (tab.value !== 'Settings') retention.value = state.host.historyDays ?? 30
		if (
			pending.value &&
			[...state.host.tasks, ...state.host.history].some((t) => t.id === pending.value.id)
		) {
			pending.value = null
			dialog.value?.close()
			assignmentDialog.value?.close()
			notice.value = 'Job accepted by the host.'
		}
	}
}
async function poll() {
	if (disposed) return
	if (!busy.value) {
		try {
			await refresh()
		} catch (e) {
			connection.value.connected = false
			notice.value = String(e)
		}
	}
	if (!disposed) timer = setTimeout(poll, 1000)
}
async function action(fn) {
	if (busy.value) return
	busy.value = true
	notice.value = ''
	try {
		await fn()
		await refresh()
	} catch (e) {
		notice.value = String(e)
	} finally {
		busy.value = false
	}
}
async function save() {
	if (pending.value)
		throw new Error('Confirm the pending submission in Jobs or retry it before changing hosts.')
	await invoke('bot_host_save', { settings: { ...settings.value } })
	saved.value = true
	crewKeys.value = null
	host.value = null
}
function edited() {
	saved.value = false
	crewKeys.value = null
}
async function choose(kind) {
	const path = await open({
		directory: kind === 'dataDir',
		multiple: false,
		title: kind === 'dataDir' ? 'Host data directory' : 'Java 25 executable',
	})
	if (path) {
		settings.value[kind] = path
		edited()
	}
}
async function java(install) {
	await action(async () => {
		if (install) settings.value.javaPath = await auto_install_java(25)
		else {
			const versions = await find_filtered_jres(25)
			if (!versions.length)
				throw new Error('No Java 25 found. Select its executable or install it.')
			settings.value.javaPath = versions[0].path
		}
		edited()
	})
}
async function control(body) {
	return invoke('bot_host_control', { body })
}
function workers() {
	return roster.value.filter((w) => w.connected)
}
function state(worker) {
	const native = host.value?.highways[worker.crew]?.workers?.find((w) => w.id === worker.id)
	return {
		phase: !worker.connected
			? 'Offline'
			: native?.phase || (worker.reconciled ? 'Ready' : 'Reconciling'),
		detail: native?.status || worker.diagnostics?.status || 'Ready for assignment',
	}
}
async function dispatch() {
	await action(async () => {
		if (!selected.value.length) throw new Error('Choose at least one connected worker')
		if (jobType.value === 'Highway' && selected.value.length > Number(highway.value.width))
			throw new Error('The crew must fit the highway width')
		if (!pending.value)
			pending.value = {
				...jobDefinition(),
				op: 'submit',
				crew: job.value.crew,
				workers: [...selected.value],
			}
		await sendPending()
		dialog.value.close()
		tab.value = 'Jobs'
	})
}
function taskAction(task, op) {
	if (
		op === 'cancel' &&
		!confirm(
			'Cancel this job for all assigned workers? Cancellation is final; recovery receipts remain.',
		)
	)
		return
	if (
		op === 'delete' &&
		!confirm('Delete this finished history record? Pending cleanup cannot be deleted.')
	)
		return
	return action(() => control({ op, id: task.id }))
}
function priority(task, worker) {
	const value = prompt(
		'Job priority (-1000 to 1000). Higher priorities can preempt after cleanup.',
		String(worker ? (task.overrides?.[worker] ?? task.priority) : task.priority),
	)
	if (value === null) return
	const number = Number(value)
	if (!value.trim() || !Number.isInteger(number) || number < -1000 || number > 1000) {
		notice.value = 'Priority must be an integer from -1000 to 1000.'
		return
	}
	return action(() =>
		control({ op: 'priority', id: task.id, priority: number, ...(worker ? { worker } : {}) }),
	)
}
onMounted(async () => {
	try {
		settings.value = await invoke('bot_host_settings')
		saved.value = true
	} catch (e) {
		notice.value = String(e)
	}
	void poll()
})
onUnmounted(() => {
	disposed = true
	clearTimeout(timer)
	crewKeys.value = null
})
</script>

<template>
	<div class="control-room">
		<header class="hero">
			<div>
				<p class="eyebrow">MONOCLE / OPERATIONS</p>
				<h1>Keep the train moving.</h1>
				<p>Crews are your people. Jobs are their work. Workflows are how it gets done.</p>
			</div>
			<button
				class="pill"
				:class="{ healthy: connection.connected && saved }"
				@click="tab = 'Settings'"
			>
				{{
					!saved
						? 'Unsaved connection'
						: connection.connected
							? connection.managed
								? 'Managed host · connected'
								: 'External host · connected'
							: 'Host disconnected'
				}}
			</button>
		</header>
		<p v-if="notice" class="notice" role="status">{{ notice }}</p>
		<p v-if="connection.error" class="notice" role="status">{{ connection.error }}</p>
		<p v-if="host && !connection.connected" class="hint">
			Showing the last snapshot, {{ ago(lastSnapshot) }}. Commands are disabled until the host
			reconnects.
		</p>
		<div class="toolbar">
			<nav aria-label="Operations sections">
				<button
					v-for="name in ['Overview', 'Crews', 'Jobs', 'Workflows', 'Workers', 'Settings']"
					:key="name"
					:class="{ active: tab === name }"
					@click="tab = name"
				>
					{{ name }}
				</button>
			</nav>
			<button
				class="gold"
				:disabled="!canControl || !host?.operationsVersion"
				@click="action(() => prepareJob())"
			>
				+ New job
			</button>
		</div>
		<BotWorkerSessions v-if="tab === 'Workers'" :workers="connection.connected && saved ? roster : roster.map((worker) => ({ ...worker, connected: false }))" />
		<section v-if="tab === 'Settings' || (!host && tab !== 'Workers')" class="panel setup">
			<h2>Host connection &amp; service</h2>
			<div class="form-grid">
				<label
					>Host data directory<input
						v-model="settings.dataDir"
						:disabled="connection.managed"
						@input="edited"
					/><button :disabled="busy || connection.managed" @click="choose('dataDir')">
						Choose directory
					</button></label
				>
				<label
					>Java 25 executable<input
						v-model="settings.javaPath"
						:disabled="connection.managed"
						@input="edited"
					/><span class="actions"
						><button :disabled="busy || connection.managed" @click="choose('javaPath')">
							Choose Java</button
						><button :disabled="busy || connection.managed" @click="java(false)">
							Find Java 25</button
						><button :disabled="busy || connection.managed" @click="java(true)">
							Install Java 25
						</button></span
					></label
				>
			</div>
			<div class="actions">
				<button class="gold" :disabled="busy || connection.managed" @click="action(save)">
					Save &amp; connect
				</button>
				<button
					:disabled="busy || !saved || connection.connected"
					@click="action(() => invoke('bot_host_initialize'))"
				>
					Initialize new host
				</button>
				<button
					:disabled="busy || !saved || connection.connected"
					@click="action(() => invoke('bot_host_start'))"
				>
					Start bundled host
				</button>
				<button
					:disabled="busy || !connection.managed"
					@click="action(() => invoke('bot_host_stop'))"
				>
					Stop idle host
				</button>
				<button
					:disabled="busy || !saved"
					@click="
						action(async () => {
							crewKeys = await invoke('bot_host_crew_keys')
						})
					"
				>
					Reveal crew keys
				</button>
				<button v-if="crewKeys" @click="crewKeys = null">Hide keys</button>
			</div>
			<div v-if="crewKeys" class="key-list">
				<label v-for="(key, crew) in crewKeys" :key="crew"
					>{{ crewLabel(crew) }} worker key<input
						:value="key"
						readonly
						autocomplete="off"
						spellcheck="false"
				/></label>
			</div>
			<p class="hint">
				{{ connection.endpoint ? `Workers connect to ${connection.endpoint}. ` : '' }}The controller
				attaches locally; configure the host's LAN bind/ports before starting. Initialization never
				overwrites existing data.
			</p>
			<p class="hint">
				Closing the launcher keeps the host and jobs running. Only a host started by this launcher
				session can be stopped here, after jobs and recovery finish. Other hosts remain untouched.
			</p>
			<form
				v-if="host?.operationsVersion"
				@submit.prevent="
					action(() => control({ op: 'host-settings', historyDays: Number(retention) }))
				"
			>
				<label
					>Job history retention (days; −1 keeps indefinitely, 0 removes finished history
					immediately)<input
						v-model="retention"
						type="number"
						min="-1"
						max="3650"
						required /></label
				><button :disabled="!canControl">Save retention</button>
			</form>
		</section>
		<template v-if="host && tab !== 'Settings'">
			<p v-if="!host.operationsVersion" class="notice">
				This host runs the earlier API. Monitoring and existing job controls work; start the new
				bundled host when idle to enable crew management, saved workflows and unassigned jobs.
			</p>
			<div class="metrics">
				<article>
					<small>CONNECTED / KNOWN</small
					><strong>{{ workers().length }} / {{ roster.length }}</strong>
				</article>
				<article>
					<small>CREWS</small><strong>{{ host.crews.length }}</strong>
				</article>
				<article>
					<small>ACTIVE JOBS</small><strong>{{ liveJobs.length }}</strong>
				</article>
				<article>
					<small>NEEDS ATTENTION</small><strong>{{ issues.length }}</strong>
				</article>
			</div>
			<section v-if="tab === 'Overview'" class="job-list">
				<article class="panel">
					<div class="task-title">
						<h2>Operations now</h2>
						<button @click="tab = 'Jobs'">Open jobs</button>
					</div>
					<p v-if="!liveJobs.length" class="hint">
						No assigned work. Create a job, then assign a crew.
					</p>
					<div v-for="task in liveJobs" :key="task.id" class="operation-row">
						<strong>{{ task.name }}</strong
						><span class="pill">{{ task.status }}</span>
						<p>
							{{ crewLabel(task.crew) }} · {{ task.detail || 'Awaiting worker acknowledgment' }}
						</p>
						<progress
							v-if="task.nativeDefinition"
							:max="task.nativeDefinition.length"
							:value="task.highwayProgress || 0"
						></progress>
						<p v-if="task.nativeDefinition">
							{{ task.highwayProgress || 0 }} / {{ task.nativeDefinition.length }} road blocks
						</p>
					</div>
				</article>
				<article class="panel">
					<h2>What is holding things up?</h2>
					<p v-if="!issues.length" class="hint">No reported worker blockers in this snapshot.</p>
					<div v-for="worker in issues" :key="worker.id" class="operation-row">
						<strong>{{ worker.name }} · {{ crewLabel(worker.crew) }}</strong>
						<p>{{ state(worker).detail }}</p>
						<small
							>{{ state(worker).phase }} · observation {{ worker.observationAgeMs }} ms old</small
						>
					</div>
				</article>
				<article class="panel">
					<h2>Host activity</h2>
					<p v-if="!host.activity?.length" class="hint">No recent events reported by this host.</p>
					<div
						v-for="(event, i) in [...(host.activity || [])].reverse().slice(0, 30)"
						:key="i"
						class="activity-row"
					>
						<small>{{ ago(event.at) }}</small
						><strong>{{ event.event }}</strong
						><span>{{ event.worker ? workerName(event.worker) : '' }} {{ event.detail }}</span>
					</div>
					<p v-if="host.lastConnectionError" class="notice">{{ host.lastConnectionError }}</p>
				</article>
			</section>
			<section v-else-if="tab === 'Crews'" class="job-list">
				<form
					v-if="host.operationsVersion"
					class="panel actions"
					@submit.prevent="action(createCrew)"
				>
					<label
						>New crew name<input
							v-model="crewName"
							maxlength="48"
							placeholder="Westbound crew"
							required /></label
					><button class="gold" :disabled="!canControl">Create crew</button>
				</form>
				<div class="crew-grid">
					<article v-for="crew in host.crews" :key="crew" class="panel">
						<p class="eyebrow">CREW</p>
						<div class="task-title">
							<h2>{{ crewLabel(crew) }}</h2>
							<span class="pill">{{ host.highways[crew]?.phase || 'Idle' }}</span>
						</div>
						<p>
							{{ workers().filter((w) => w.crew === crew).length }} connected workers ·
							{{ roster.filter((w) => w.crew === crew).length }} known
						</p>
						<p>
							{{
								roster
									.filter((w) => w.crew === crew)
									.map((w) => w.name + (w.connected ? '' : ' (offline)'))
									.join(' · ') || 'No workers assigned'
							}}
						</p>
						<template v-if="host.highways[crew]?.length"
							><progress
								:max="host.highways[crew].length"
								:value="host.highways[crew].progress"
							></progress>
							<p>
								{{ host.highways[crew].progress }} / {{ host.highways[crew].length }} road blocks
							</p></template
						>
						<div class="actions">
							<button
								class="gold"
								:disabled="!canControl || !host.operationsVersion"
								@click="action(() => assignCrew(crew))"
							>
								Assign crew</button
							><button
								:disabled="!canControl || !host.operationsVersion"
								@click="action(() => prepareJob(crew))"
							>
								New job for crew</button
							><button
								:disabled="!canControl || !host.operationsVersion"
								@click="action(() => renameCrew(crew))"
							>
								Rename</button
							><button
								:disabled="!canControl || !host.operationsVersion"
								@click="action(() => deleteCrew(crew))"
							>
								Delete
							</button>
						</div>
						<details>
							<summary>Recovery &amp; coordinator</summary>
							<p>
								Supply owner:
								{{
									host.highways[crew]?.supplyOwner
										? workerName(host.highways[crew].supplyOwner)
										: 'None'
								}}
								· pending cleanup: {{ host.highways[crew]?.pendingEnds || 0 }}
							</p>
							<p class="hint">
								Only clear an item transfer after inspecting the participants and dropped items.
								Ending execution preserves recovery receipts.
							</p>
							<div class="actions">
								<button
									:disabled="!canControl || !host.highways[crew]?.execution"
									@click="action(() => resolveTransfer(crew))"
								>
									Resolve inspected transfer</button
								><button
									:disabled="!canControl || !host.highways[crew]?.execution"
									@click="action(() => endHighway(crew))"
								>
									Cancel crew execution
								</button>
							</div>
							<pre>{{ JSON.stringify(host.highways[crew], null, 2) }}</pre>
						</details>
					</article>
				</div>
			</section>
			<section v-else-if="tab === 'Workers'" class="panel">
				<div class="task-title">
					<h2>Workers</h2>
					<label
						>Show<select v-model="workerFilter">
							<option>All</option>
							<option>Connected</option>
							<option>Offline</option>
							<option v-for="crew in host.crews" :key="crew" :value="crew">
								{{ crewLabel(crew) }}
							</option>
						</select></label
					>
				</div>
				<p class="hint">
					Offline workers retain their last observation; it is never treated as live verification.
				</p>
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Worker</th>
								<th>Crew</th>
								<th>Position</th>
								<th>State &amp; decisions</th>
							</tr>
						</thead>
						<tbody>
							<tr
								v-for="worker in roster.filter(
									(w) =>
										workerFilter === 'All' ||
										(workerFilter === 'Connected' && w.connected) ||
										(workerFilter === 'Offline' && !w.connected) ||
										w.crew === workerFilter,
								)"
								:key="worker.id"
							>
								<td>
									<strong>{{ worker.name }}</strong
									><small>{{ worker.scope?.split('\n')[1] || 'World unknown' }}</small
									><small>{{
										worker.connected ? 'Connected' : 'Offline · ' + ago(worker.lastSeen)
									}}</small>
								</td>
								<td>
									<select
										:value="worker.crew"
										:disabled="!canControl || !worker.connected || !host.operationsVersion"
										:aria-label="'Crew for ' + worker.name"
										@change="action(() => moveWorker(worker, $event))"
									>
										<option v-for="crew in host.crews" :key="crew" :value="crew">
											{{ crewLabel(crew) }}
										</option>
									</select>
								</td>
								<td class="coords">
									{{ worker.x ?? '—' }}, {{ worker.y ?? '—' }}, {{ worker.z ?? '—'
									}}<small>{{
										worker.positionFresh ? 'Live position' : 'Last-known / unavailable'
									}}</small>
								</td>
								<td>
									<span
										class="pill"
										:class="{ healthy: worker.connected && state(worker).phase === 'Ready' }"
										>{{ state(worker).phase }}</span
									>
									<p>{{ state(worker).detail }}</p>
									<details>
										<summary>Inventory, execution &amp; checkpoints</summary>
										<p>
											Current run: {{ worker.current || 'None' }} ·
											{{ worker.reconciled ? 'Host state reconciled' : 'Awaiting reconciliation' }}
										</p>
										<pre v-if="nativeWorker(worker)?.inventory">{{
											JSON.stringify(nativeWorker(worker).inventory, null, 2)
										}}</pre>
										<div v-for="item in workerRuns(worker)" :key="item.task.id">
											<strong>{{ item.task.name }} · {{ item.run.status }}</strong>
											<p>{{ item.run.detail || 'No blocker reported' }}</p>
											<small
												>Priority {{ item.task.overrides?.[worker.id] ?? item.task.priority }} ·
												action {{ item.run.action?.type || 'Between workflow steps' }} · command
												token {{ item.run.token || 'None' }}</small
											><button :disabled="!canControl" @click="priority(item.task, worker.id)">
												Change priority
											</button>
											<pre>{{ JSON.stringify(item.run, null, 2) }}</pre>
										</div>
										<pre>{{ JSON.stringify(worker.diagnostics, null, 2) }}</pre>
									</details>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
			<section v-else-if="tab === 'Workflows'" class="job-list">
				<div class="panel">
					<div class="task-title">
						<h2>Workflow library</h2>
						<button
							class="gold"
							:disabled="!canControl || !host.operationsVersion"
							@click="newWorkflow"
						>
							+ Lua workflow
						</button>
					</div>
					<label>Find workflow<input v-model="librarySearch" placeholder="Folder or name" /></label
					><label
						>Import captured package<input
							type="file"
							accept=".json,application/json"
							:disabled="!canControl || !host.operationsVersion"
							@change="action(() => importWorkflow($event))"
					/></label>
					<p class="hint">
						Export captures from a client with <code>.bot export-workflow &lt;id&gt;</code>.
						Built-ins are read-only. Duplicates and edits never alter jobs already queued. Built-in
						templates inherit worker settings except explicit job-form overrides; imported profiles
						synchronize the captured configuration.
					</p>
				</div>
				<article v-for="folder in workflowFolders" :key="folder" class="panel">
					<p class="eyebrow">{{ folder }}</p>
					<div
						v-for="record in visibleWorkflows.filter((w) => w.folder === folder)"
						:key="record.id"
						class="operation-row"
					>
						<div class="task-title">
							<h3>{{ record.name }}</h3>
							<span class="pill">{{
								record.builtin ? 'Built-in · read-only' : 'Custom snapshot'
							}}</span>
						</div>
						<p>
							{{ record.highway ? 'Native highway' : 'Lua workflow' }} ·
							{{
								record.configured
									? 'Captured module profiles'
									: 'Worker settings + explicit overrides'
							}}
							· {{ record.profiles.join(' · ') }}
						</p>
						<div class="actions">
							<button :disabled="!canControl" @click="action(() => useWorkflow(record.id))">
								Create job</button
							><button :disabled="!canControl" @click="action(() => openEditor(record.id))">
								{{ record.builtin ? 'Inspect / customize copy' : 'Edit' }}</button
							><button :disabled="!canControl" @click="action(() => duplicateWorkflow(record.id))">
								Duplicate</button
							><button
								v-if="!record.builtin"
								:disabled="!canControl"
								@click="
									confirmed('Delete this workflow? Existing jobs keep their snapshot.', () =>
										control({ op: 'workflow-delete', id: record.id }),
									)
								"
							>
								Delete
							</button>
						</div>
					</div>
				</article>
			</section>
			<section v-else-if="tab === 'Jobs'" class="job-list">
				<div class="actions">
					<button :class="{ active: !jobHistory }" @click="jobHistory = false">
						Active &amp; unassigned</button
					><button :class="{ active: jobHistory }" @click="jobHistory = true">Job history</button>
				</div>
				<article v-for="draft in jobHistory ? [] : draftJobs" :key="draft.id" class="panel">
					<div class="task-title">
						<h2>{{ draft.name }}</h2>
						<span class="pill">Unassigned</span>
					</div>
					<p>{{ draft.server }} · {{ draft.dimension }} · Priority {{ draft.priority }}</p>
					<p v-if="draft.args?.length">{{ draft.args.length }} road blocks</p>
					<div class="actions">
						<button
							class="gold"
							:disabled="!canControl"
							@click="
								action(async () => {
									await assignCrew(currentCrew)
									assignmentId = draft.id
								})
							"
						>
							Assign crew</button
						><button :disabled="!canControl" @click="action(() => editDraft(draft.id))">Edit</button
						><button
							:disabled="!canControl"
							@click="
								confirmed('Delete this unassigned job?', () =>
									control({ op: 'draft-delete', id: draft.id }),
								)
							"
						>
							Delete
						</button>
					</div>
				</article>
				<p
					v-if="
						!(jobHistory ? finishedHistory : liveJobs).length && (jobHistory || !draftJobs.length)
					"
					class="panel hint"
				>
					{{
						jobHistory
							? 'No finished job history.'
							: 'No jobs. Create work first, then assign your crew.'
					}}
				</p>
				<article
					v-for="task in jobHistory ? finishedHistory : liveJobs"
					:key="task.id"
					class="panel"
				>
					<div class="task-title">
						<h2>{{ task.name }}</h2>
						<span class="pill">{{ task.status }}</span>
					</div>
					<p>{{ crewLabel(task.crew) }} · {{ task.server }} · Priority {{ task.priority }}</p>
					<p>{{ task.detail || 'Awaiting workflow state' }}</p>
					<template v-if="task.nativeDefinition"
						><progress
							:max="task.nativeDefinition.length"
							:value="task.highwayProgress || 0"
						></progress>
						<p>
							{{ task.highwayProgress || 0 }} / {{ task.nativeDefinition.length }} road blocks
						</p></template
					>
					<p v-if="task.cleanupPending" class="notice">
						Cancellation is already final. Waiting for worker cleanup/recovery acknowledgments;
						offline workers receive cancellation when they reconnect.
					</p>
					<div class="actions">
						<template v-if="!jobHistory"
							><button
								:disabled="!canControl || ['Complete', 'Cancelled', 'Failed'].includes(task.status)"
								@click="taskAction(task, 'pause')"
							>
								Pause</button
							><button
								:disabled="!canControl || ['Complete', 'Cancelled', 'Failed'].includes(task.status)"
								@click="taskAction(task, 'resume')"
							>
								Resume / retry</button
							><button
								:disabled="!canControl || ['Complete', 'Cancelled', 'Failed'].includes(task.status)"
								@click="taskAction(task, 'cancel')"
							>
								Cancel</button
							><button
								v-if="
									task.nativeDefinition &&
									!task.cleanupPending &&
									!task.cancelled &&
									host.operationsVersion
								"
								:disabled="!canControl"
								@click="action(() => releaseJob(task))"
							>
								Release crew · keep job</button
							><button :disabled="!canControl" @click="priority(task)">Priority</button></template
						><template v-else
							><button
								v-if="
									task.nativeDefinition &&
									(task.highwayProgress || 0) < task.nativeDefinition.length
								"
								:disabled="!canControl || task.cleanupPending || !host.operationsVersion"
								@click="action(() => continueHighway(task))"
							>
								Continue from verified checkpoint</button
							><button
								:disabled="!canControl || task.cleanupPending"
								@click="taskAction(task, 'delete')"
							>
								Delete history
							</button></template
						>
					</div>
					<details>
						<summary>Worker acknowledgments &amp; checkpoints</summary>
						<div v-for="(run, id) in task.runs" :key="id" class="operation-row">
							<strong>{{ workerName(id) }} · {{ run.status }}</strong>
							<p>{{ run.detail || 'No blocker reported' }}</p>
							<small
								>Action {{ run.action?.type || 'Between steps / queued' }} · effective priority
								{{ task.overrides?.[id] ?? task.priority }}</small
							><button v-if="!jobHistory" :disabled="!canControl" @click="priority(task, id)">
								Worker priority
							</button>
							<pre>{{ JSON.stringify(run, null, 2) }}</pre>
						</div>
						<pre>{{ JSON.stringify(task, null, 2) }}</pre>
					</details>
				</article>
			</section>
		</template>
		<dialog ref="dialog" class="dispatch-dialog">
			<form @submit.prevent="dispatch">
				<div class="task-title">
					<h2>{{ draftId ? 'Edit unassigned job' : 'Create job' }}</h2>
					<button type="button" @click="dialog.close()">Close</button>
				</div>
				<fieldset :disabled="busy || !!pending">
					<label>Job name<input v-model="job.name" maxlength="48" required /></label>
					<label v-if="!draftId"
						>Workflow<select v-model="workflowId" @change="action(() => loadWorkflow(workflowId))">
							<option v-for="w in host?.workflows" :key="w.id" :value="w.id">
								{{ w.folder }} / {{ w.name }}
							</option>
						</select></label
					>
					<template v-if="jobType === 'Highway'">
						<div class="form-grid">
							<label v-for="axis in ['x', 'y', 'z']" :key="axis"
								>Origin {{ axis.toUpperCase()
								}}<input v-model="highway[axis]" type="number" step="1" required /></label
							><label
								>Direction<select v-model="highway.direction">
									<option v-for="(_, direction) in directions" :key="direction">
										{{ direction }}
									</option>
								</select></label
							>
						</div>
						<div class="form-grid">
							<label
								>Finish by<select v-model="highway.endMode">
									<option value="length">Road length</option>
									<option value="endpoint">Exact endpoint coordinate</option>
								</select></label
							><label v-if="highway.endMode === 'length'"
								>Length<input
									v-model="highway.length"
									type="number"
									min="16"
									max="100000"
									required /></label
							><label v-else
								>End {{ ['East', 'West'].includes(highway.direction) ? 'X' : 'Z'
								}}<input v-model="highway.endpoint" type="number" step="1" required
							/></label>
						</div>
						<p class="notice">
							{{
								endpoint.error ||
								`Finish at ${endpoint.x}, ${endpoint.y}, ${endpoint.z} · ${endpoint.length} road blocks`
							}}
						</p>
						<div class="form-grid">
							<label
								>Width<input
									v-model="highway.width"
									type="number"
									min="1"
									max="5"
									required /></label
							><label
								>Height<input
									v-model="highway.height"
									type="number"
									min="1"
									max="7"
									required /></label
							><label
								>Vanilla Speed (blocks/sec)<input
									v-model="highway.speed"
									type="number"
									min="0.1"
									max="10"
									step="any"
									required /></label
							><label
								>Work sharing<select v-model="highway.sharing">
									<option>Lanes</option>
									<option>BreakOrder</option>
								</select></label
							>
						</div>
						<label>Paving material IDs<input v-model="highway.material" required /></label
						><label
							>Floor<select v-model="highway.floor">
								<option>Replace</option>
								<option>PlaceMissing</option>
							</select></label
						>
						<div class="actions">
							<label><input v-model="highway.railings" type="checkbox" /> Railings</label
							><label><input v-model="highway.above" type="checkbox" /> Mine above railings</label
							><label><input v-model="highway.supports" type="checkbox" /> Supports</label
							><label
								><input v-model="highway.keepShulkers" type="checkbox" /> Keep empty/useless
								shulkers</label
							>
						</div>
						<details open>
							<summary>Inventory targets &amp; building rates</summary>
							<div class="form-grid">
								<label v-for="key in ['paving', 'picks', 'food', 'filler']" :key="key"
									>{{ key }} target<input
										v-model="highway[key]"
										type="number"
										:min="inventoryLimits[key][0]"
										:max="inventoryLimits[key][1]"
										required /></label
								><label
									>Pave ahead<input
										v-model="highway.paveAhead"
										type="number"
										min="1"
										max="5"
										required /></label
								><label
									>Break ahead<input
										v-model="highway.breakAhead"
										type="number"
										min="1"
										max="5"
										required /></label
								><label
									>Placements per tick<input
										v-model="highway.placementRate"
										type="number"
										min="1"
										max="20"
										required /></label
								><label
									>Breaks per tick<input
										v-model="highway.breakRate"
										type="number"
										min="1"
										max="20"
										required
								/></label>
							</div>
						</details>
						<p class="hint">
							The form overrides speed, shulker retention and building rates in captured profiles.
							Other captured settings are preserved. Built-in templates do not include your
							combat/eating/tool configuration; import a client capture for synchronized settings.
						</p>
					</template>
					<div v-else-if="workflow?.entry === 'task-travel'" class="form-grid">
						<label v-for="axis in ['x', 'y', 'z']" :key="axis"
							>Destination {{ axis.toUpperCase()
							}}<input v-model="common[axis]" type="number" step="1" required /></label
						><label
							>Arrival radius<input v-model="common.radius" type="number" min="1" max="8" required
						/></label>
					</div>
					<div v-else-if="workflow?.entry === 'task-tpa'" class="form-grid">
						<label
							>TPA target<input v-model="common.target" list="bot-targets" required /><datalist
								id="bot-targets"
							>
								<option
									v-for="w in workers().filter((w) => w.crew === job.crew)"
									:key="w.id"
									:value="w.name"
								/></datalist></label
						><label
							>Warmup ticks<input
								v-model="common.warmupTicks"
								type="number"
								min="0"
								max="1200"
								required /></label
						><label
							>Timeout ticks<input
								v-model="common.timeoutTicks"
								type="number"
								min="20"
								max="72000"
								required /></label
						><label
							>Arrival radius<input v-model="common.radius" type="number" min="1" max="16" required
						/></label>
						<p class="hint">
							20 ticks ≈ one second. Success requires observed arrival, not just expiration of the
							warmup.
						</p>
					</div>
					<div v-else-if="workflow?.entry === 'task-drop'" class="form-grid">
						<label>Item ID<input v-model="common.item" required /></label
						><label
							>Count<input
								v-model="common.count"
								type="number"
								min="1"
								max="2304"
								required /></label
						><label
							>Recipient (optional)<select v-model="common.recipient">
								<option value="">Drop locally</option>
								<option
									v-for="w in workers().filter((w) => w.crew === job.crew)"
									:key="w.id"
									:value="w.id"
								>
									{{ w.name }}
								</option>
							</select></label
						>
						<p class="notice">
							This drops real inventory items. Review the resource, quantity and recipient before
							starting.
						</p>
					</div>
					<label v-else-if="workflow?.entry === 'task-wait'"
						>Wait ticks<input v-model="common.ticks" type="number" min="1" max="72000" required
					/></label>
					<label v-else-if="workflow?.entry === 'task-profile'"
						>Captured gameplay profile<select v-model="common.profile">
							<option v-for="(_, name) in workflow.profiles" :key="name">{{ name }}</option>
						</select></label
					>
					<label v-else
						>Workflow arguments (JSON)<textarea
							v-model="job.args"
							rows="5"
							required
							spellcheck="false"
						></textarea>
					</label>
					<div class="form-grid">
						<label>Server<input v-model="job.server" required /></label
						><label>Dimension<input v-model="job.dimension" required /></label
						><label
							>Priority<input v-model="job.priority" type="number" min="-1000" max="1000" required
						/></label>
					</div>
					<details>
						<summary>Captured profile preview</summary>
						<pre>{{ JSON.stringify(workflow?.profiles, null, 2) }}</pre>
					</details>
					<label
						>Crew (for Start now)<select v-model="job.crew" @change="pickCrew(job.crew)">
							<option v-for="crew in host?.crews" :key="crew" :value="crew">
								{{ crewLabel(crew) }}
							</option>
						</select></label
					>
					<label
						v-for="w in workers().filter((w) => w.crew === job.crew)"
						:key="w.id"
						class="worker-choice"
						><input v-model="selected" type="checkbox" :value="w.id" :disabled="!w.reconciled" />{{
							w.name
						}}
						{{ w.reconciled ? '' : '· reconciling' }}</label
					>
				</fieldset>
				<p v-if="pending" class="notice">
					Response unconfirmed. Retry uses the same job ID and unchanged request; inspect Jobs
					before submitting replacement work.
				</p>
				<div class="actions">
					<button class="gold" :disabled="!canControl">
						{{ pending ? 'Retry same request' : 'Start now' }}</button
					><button type="button" :disabled="!canControl || !!pending" @click="action(saveDraft)">
						Save unassigned job
					</button>
				</div>
			</form>
		</dialog>
		<dialog ref="assignmentDialog" class="dispatch-dialog">
			<form @submit.prevent="action(dispatchDraft)">
				<div class="task-title">
					<h2>Assign crew</h2>
					<button type="button" @click="assignmentDialog.close()">Close</button>
				</div>
				<fieldset :disabled="busy || !!pending">
					<label
						>Crew<select v-model="job.crew" @change="pickCrew(job.crew)">
							<option v-for="crew in host?.crews" :key="crew" :value="crew">
								{{ crewLabel(crew) }}
							</option>
						</select></label
					><label
						>Unclaimed unfinished job<select v-model="assignmentId" required>
							<option value="" disabled>Choose a saved job</option>
							<option v-for="d in draftJobs" :key="d.id" :value="d.id">
								{{ d.name }} · {{ d.server }}
							</option>
						</select></label
					>
					<p v-if="!draftJobs.length" class="hint">Create a job and save it unassigned first.</p>
					<label v-for="w in workers().filter((w) => w.crew === job.crew)" :key="w.id"
						><input v-model="selected" type="checkbox" :value="w.id" :disabled="!w.reconciled" />
						{{ w.name }}</label
					>
				</fieldset>
				<p v-if="pending" class="notice">Retry retains the same immutable assignment request.</p>
				<button class="gold" :disabled="!canControl">
					{{ pending ? 'Retry same assignment' : 'Assign and start' }}
				</button>
			</form>
		</dialog>
		<dialog ref="workflowDialog" class="dispatch-dialog">
			<form v-if="editor" @submit.prevent="action(saveEditor)">
				<div class="task-title">
					<h2>{{ editor.builtin ? 'Customize a copy' : 'Edit workflow' }}</h2>
					<button type="button" @click="workflowDialog.close()">Close</button>
				</div>
				<fieldset :disabled="busy">
					<label>Name<input v-model="editor.name" maxlength="48" required /></label
					><label>Folder<input v-model="editor.folder" maxlength="96" required /></label
					><label
						>Program<select v-model="editorEntry" @change="action(changeEditorEntry)">
							<option v-for="(_, id) in editor.package.programs" :key="id">{{ id }}</option>
						</select></label
					><label
						>Lua source<textarea
							v-model="editorScript"
							rows="12"
							spellcheck="false"
							required
						></textarea>
					</label>
					<details>
						<summary>Advanced package: nested workflows, native duties, captured profiles</summary>
						<p class="hint">
							Edit the portable JSON package. Lua source above replaces the selected program when
							saving. Native action lists and dependencies remain validated by the shared core.
						</p>
						<textarea v-model="editorPackage" rows="14" spellcheck="false" required></textarea>
					</details>
					<p class="hint">
						Edits only affect future assignments. Native presets can include Excavating, Paving and
						supply fallback; nested programs and profiles travel in this package.
					</p>
				</fieldset>
				<button class="gold" :disabled="!canControl">
					{{ editor.builtin ? 'Save as editable copy' : 'Save workflow' }}
				</button>
			</form>
		</dialog>
	</div>
</template>

<style scoped>
.control-room {
	padding: 2rem;
	color: var(--color-primary);
}
.operation-row {
	padding: 1rem 0;
	border-top: 1px solid #d8b76d25;
}
.activity-row {
	display: grid;
	grid-template-columns: 5rem 13rem minmax(0, 1fr);
	gap: 0.75rem;
	padding: 0.6rem 0;
	border-top: 1px solid #d8b76d15;
	overflow-wrap: anywhere;
}
.dispatch-dialog textarea {
	font-family: monospace;
	font-size: 0.8rem;
}
@media (max-width: 700px) {
	.activity-row {
		grid-template-columns: 1fr;
	}
	.control-room {
		padding: 1rem;
	}
}
.hero,
.toolbar,
.task-title {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 1rem;
	flex-wrap: wrap;
}
.hero {
	padding-bottom: 1.5rem;
}
.hero h1 {
	font-size: 2rem;
	color: var(--color-contrast);
	margin: 0.5rem 0;
}
.eyebrow {
	color: #d8b76d;
	font-size: 0.7rem;
	letter-spacing: 0.18em;
	font-weight: 700;
}
.panel {
	border: 1px solid #d8b76d35;
	border-radius: 1rem;
	padding: 1.5rem;
	background: linear-gradient(135deg, #d8b76d09, transparent 60%), var(--color-raised-bg);
	min-width: 0;
}
.setup {
	margin-bottom: 1.5rem;
}
.setup > summary {
	font-weight: 700;
	margin-bottom: 1rem;
}
.metrics {
	display: grid;
	grid-template-columns: repeat(4, 1fr);
	gap: 1rem;
	margin: 1.5rem 0;
}
.metrics article {
	padding: 1rem 1.25rem;
	border-left: 2px solid #d8b76d;
	background: var(--color-raised-bg);
	border-radius: 0.5rem;
}
.metrics strong {
	display: block;
	color: var(--color-contrast);
	font-size: 2rem;
}
small,
.hint {
	font-size: 0.8rem;
	opacity: 0.8;
	line-height: 1.6;
}
.toolbar {
	margin: 1.5rem 0;
}
nav,
.actions {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}
button {
	border: 1px solid #d8b76d35;
	border-radius: 0.6rem;
	background: var(--color-button-bg);
	color: var(--color-contrast);
	padding: 0.6rem 0.9rem;
	cursor: pointer;
	font: inherit;
}
button:hover:not(:disabled),
button.active {
	border-color: #d8b76d;
	background: #d8b76d18;
}
button.gold {
	background: linear-gradient(120deg, #a7823b, #edd49a, #bb9650);
	color: #19150b;
	font-weight: 700;
}
button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible,
select:focus-visible,
textarea:focus-visible {
	outline: 2px solid #d8b76d;
	outline-offset: 3px;
}
.pill {
	display: inline-block;
	border: 1px solid #d8b76d40;
	color: #d8b76d;
	border-radius: 2rem;
	font-size: 0.75rem;
	padding: 0.35rem 0.7rem;
	white-space: nowrap;
}
.pill.healthy {
	color: #83dba0;
	border-color: #83dba050;
}
.notice {
	border-left: 3px solid #d8b76d;
	padding: 1rem;
	background: #d8b76d10;
	overflow-wrap: anywhere;
}
.form-grid,
.crew-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem;
}
label {
	display: block;
	font-size: 0.85rem;
	font-weight: 600;
	margin: 0.75rem 0;
}
input:not([type='checkbox']),
select,
textarea {
	display: block;
	width: 100%;
	box-sizing: border-box;
	margin: 0.5rem 0;
	padding: 0.65rem;
	border: 1px solid #d8b76d40;
	border-radius: 0.5rem;
	background: var(--color-bg);
	color: var(--color-contrast);
	font: inherit;
}
.worker-choice {
	display: flex;
	align-items: center;
	gap: 0.75rem;
}
.key-list input,
.coords,
code,
pre {
	font-family: monospace;
}
pre {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	max-height: 22rem;
	overflow: auto;
	padding: 1rem;
	font-size: 0.75rem;
	background: var(--color-bg);
	border-radius: 0.5rem;
}
summary {
	cursor: pointer;
	color: #d8b76d;
}
.table-wrap {
	overflow-x: auto;
}
table {
	width: 100%;
	border-collapse: collapse;
	text-align: left;
}
th {
	font-size: 0.75rem;
	color: #d8b76d;
	padding: 1rem 0.75rem;
}
td {
	border-top: 1px solid #d8b76d25;
	padding: 1rem 0.75rem;
	vertical-align: top;
}
td small {
	display: block;
}
td:last-child {
	max-width: 24rem;
}
h2 {
	color: var(--color-contrast);
	font-size: 1.25rem;
}
h3 {
	font-size: 1rem;
}
.job-list {
	display: grid;
	gap: 1rem;
}
progress {
	width: 100%;
	accent-color: #d8b76d;
}
.dispatch-dialog {
	color: var(--color-primary);
	background: var(--color-raised-bg);
	border: 1px solid #d8b76d70;
	border-radius: 1rem;
	padding: 1.5rem;
	width: min(42rem, 80vw);
	max-height: 85vh;
}
.dispatch-dialog::backdrop {
	background: #0009;
	backdrop-filter: blur(5px);
}
fieldset {
	border: 0;
	padding: 0;
	min-width: 0;
}
@media (max-width: 1000px) {
	.metrics {
		grid-template-columns: repeat(2, 1fr);
	}
	.form-grid,
	.crew-grid {
		grid-template-columns: 1fr;
	}
}
</style>
