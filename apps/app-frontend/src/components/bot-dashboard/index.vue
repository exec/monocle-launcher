<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
	host: { type: Object, required: true },
	workers: { type: Array, default: () => [] },
	jobs: { type: Array, default: () => [] },
	issues: { type: Array, default: () => [] },
	connected: Boolean,
	canControl: Boolean,
	snapshotAt: Number,
})
const emit = defineEmits(['navigate', 'task-action'])
const crewFilter = ref('')
const search = ref('')
const inspector = ref('')
function inspectWorker(id) {
	inspector.value = id
	crewFilter.value = ''
	search.value = ''
}
const crewName = (id) => props.host.crewLabels?.[id] || id || 'Unassigned'
const native = (worker) =>
	props.host.highways?.[worker.crew]?.workers?.find((w) => w.id === worker.id)
const online = (worker) => props.connected && worker.connected
const phase = (worker) =>
	!props.connected
		? 'Awaiting host'
		: !worker.connected
			? 'Offline'
			: native(worker)?.phase || (worker.reconciled ? 'Ready' : 'Reconciling')
const detail = (worker) =>
	native(worker)?.status || worker.diagnostics?.status || 'Ready for assignment'
const needsAttention = (worker) => online(worker) && props.issues.some((w) => w.id === worker.id)
const filteredWorkers = computed(() =>
	props.workers.filter(
		(w) =>
			(!crewFilter.value || w.crew === crewFilter.value) &&
			`${w.name} ${crewName(w.crew)} ${phase(w)}`
				.toLowerCase()
				.includes(search.value.toLowerCase()),
	),
)
const filteredJobs = computed(() =>
	props.jobs.filter((j) => !crewFilter.value || j.crew === crewFilter.value),
)
const inspected = computed(() => props.workers.find((w) => w.id === inspector.value))
const recentEvents = computed(() => [...(props.host.activity || [])].reverse().slice(0, 12))
const connectedCount = computed(() => props.workers.filter(online).length)
const format = (value) =>
	Number.isFinite(Number(value))
		? Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })
		: '—'
const progress = (job) =>
	Math.min(
		100,
		Math.max(
			0,
			(100 * (Number(job.highwayProgress) || 0)) / (Number(job.nativeDefinition?.length) || 1),
		),
	)
const terminal = (job) =>
	['Complete', 'Cancelled', 'Failed'].includes(job.status) || job.cleanupPending
const position = (worker) =>
	[worker.x, worker.y, worker.z].map((n) => (n == null ? '—' : format(Math.floor(n)))).join(' / ')
const time = (at) =>
	at
		? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
		: '—'
</script>

<template>
	<div class="fleet-dashboard">
		<div class="fleet-metrics">
			<button @click="emit('navigate', 'Workers')">
				<span class="metric-label">WORKERS ONLINE <span class="metric-glyph">▣</span></span
				><strong
					>{{ connected ? connectedCount : '—' }}<small>/ {{ workers.length }}</small></strong
				><span class="metric-foot"
					><i :class="{ live: connected }"></i
					>{{ connected ? 'Connected to your host' : 'Connection lost · last known fleet' }}</span
				>
			</button>
			<button @click="emit('navigate', 'Crews')">
				<span class="metric-label">YOUR CREWS <span class="metric-glyph">⊞</span></span
				><strong>{{ host.crews.length }}</strong
				><span class="metric-foot">Organized and ready to assign <span>↗</span></span>
			</button>
			<button @click="emit('navigate', 'Jobs')">
				<span class="metric-label">ACTIVE & RECOVERING <span class="metric-glyph">▤</span></span
				><strong>{{ jobs.length }}</strong
				><span class="metric-foot"
					>{{ host.drafts?.length || 0 }} saved job records <span>↗</span></span
				>
			</button>
			<button
				:class="{ 'metric-warning': connected && issues.length }"
				@click="emit('navigate', 'Workers')"
			>
				<span class="metric-label">NEEDS ATTENTION <span class="metric-glyph">◇</span></span
				><strong>{{ connected ? issues.length : '—' }}</strong
				><span class="metric-foot">{{
					!connected
						? 'Waiting for a fresh snapshot'
						: issues.length
							? 'Worker reports to investigate'
							: 'No worker blockers reported'
				}}</span>
			</button>
		</div>
		<div class="dashboard-filter">
			<div>
				<span class="live-label"
					><i :class="{ live: connected }"></i
					>{{ connected ? 'LIVE OPERATIONS' : 'LAST KNOWN OPERATIONS' }}</span
				><span class="snapshot">Snapshot {{ time(snapshotAt) }}</span>
			</div>
			<label
				><span class="sr-only">Filter dashboard by crew</span
				><select v-model="crewFilter">
					<option value="">All crews</option>
					<option v-for="crew in host.crews" :key="crew" :value="crew">{{ crewName(crew) }}</option>
				</select></label
			>
		</div>
		<div class="dashboard-grid">
			<div class="primary-stack">
				<section class="dashboard-panel operations-panel">
					<div class="panel-heading">
						<div>
							<p class="kicker">THE WORK IN MOTION</p>
							<h2>Active operations</h2>
						</div>
						<button class="quiet-button" @click="emit('navigate', 'Jobs')">All jobs ↗</button>
					</div>
					<div v-if="!filteredJobs.length" class="empty-state">
						<span class="empty-glyph">◇</span>
						<h3>A clear runway.</h3>
						<p>Create a job and give your crew something to work toward.</p>
						<button class="quiet-button" @click="emit('navigate', 'Jobs')">
							Prepare your next job →
						</button>
					</div>
					<article v-for="job in filteredJobs" :key="job.id" class="mission">
						<div class="mission-heading">
							<span class="mission-icon" aria-hidden="true">{{
								job.nativeDefinition ? '↗' : '⑂'
							}}</span>
							<div>
								<h3>{{ job.name }}</h3>
								<p>{{ crewName(job.crew) }} <span>·</span> {{ job.server || 'Server pending' }}</p>
							</div>
							<span
								class="status-badge"
								:class="{ running: connected && job.status === 'Running' }"
								>{{ job.status }}</span
							>
						</div>
						<template v-if="job.nativeDefinition"
							><div class="progress-caption">
								<strong
									>{{ format(job.highwayProgress || 0) }}
									<small>/ {{ format(job.nativeDefinition.length) }} road blocks</small></strong
								><span>{{ progress(job).toFixed(1) }}%</span>
							</div>
							<progress
								:value="progress(job)"
								max="100"
								:aria-label="`${job.name} completion`"
							></progress>
							<div class="mission-meta">
								<span
									>{{ job.nativeDefinition.layout?.heading || 'Highway' }} ·
									{{ job.nativeDefinition.layout?.width }} wide ×
									{{ job.nativeDefinition.layout?.height }} high</span
								><span>{{ job.dimension?.replace('minecraft:', '') }}</span>
							</div></template
						>
						<p class="mission-detail">{{ job.detail || 'Awaiting worker acknowledgment' }}</p>
						<div class="mission-actions">
							<button
								:disabled="!canControl || terminal(job)"
								@click="emit('task-action', job, 'pause')"
							>
								Ⅱ Pause</button
							><button
								:disabled="!canControl || terminal(job)"
								@click="emit('task-action', job, 'resume')"
							>
								↻ Resume / retry</button
							><button class="quiet-button" @click="emit('navigate', 'Jobs')">Inspect job →</button>
						</div>
					</article>
				</section>
				<section class="dashboard-panel fleet-panel">
					<div class="panel-heading">
						<div>
							<p class="kicker">ACCOUNTS ON THE GROUND</p>
							<h2>
								Worker fleet <span class="count">{{ filteredWorkers.length }}</span>
							</h2>
						</div>
						<label class="worker-search"
							><span class="sr-only">Find a worker</span
							><input v-model="search" placeholder="Find worker or status…" type="search"
						/></label>
					</div>
					<div v-if="!filteredWorkers.length" class="empty-state">
						<h3>{{ workers.length ? 'No matching workers.' : 'Your fleet starts here.' }}</h3>
						<p>
							{{
								workers.length
									? 'Try a different name or crew.'
									: 'Connect a Monocle worker, then bind a local account in Workers.'
							}}
						</p>
						<button class="quiet-button" @click="emit('navigate', 'Workers')">
							Manage workers →
						</button>
					</div>
					<div class="worker-grid">
						<button
							v-for="(worker, index) in filteredWorkers"
							:key="worker.id"
							class="worker-card"
							:class="{
								'worker-alert': needsAttention(worker),
								'worker-offline': !online(worker),
								selected: inspector === worker.id,
							}"
							@click="inspector = inspector === worker.id ? '' : worker.id"
							:aria-expanded="inspector === worker.id"
						>
							<div class="worker-top">
								<span
									class="worker-avatar"
									:style="{ '--avatar-hue': `${(index * 47 + 32) % 360}` }"
									>{{ worker.name.slice(0, 2).toUpperCase() }}</span
								><span class="worker-identity"
									><strong>{{ worker.name }}</strong
									><small>{{ crewName(worker.crew) }}</small></span
								><i :class="{ live: online(worker), warning: needsAttention(worker) }"></i>
							</div>
							<div class="worker-phase">
								<span>{{ phase(worker) }}</span
								><span aria-hidden="true">↗</span>
							</div>
							<p class="worker-detail">{{ detail(worker) }}</p>
							<div class="worker-position">
								{{ position(worker)
								}}<small>{{
									connected && worker.positionFresh ? 'LIVE POSITION' : 'LAST KNOWN / UNAVAILABLE'
								}}</small>
							</div>
						</button>
					</div>
					<article v-if="inspected" class="worker-inspector">
						<div class="panel-heading">
							<h3>{{ inspected.name }} · worker detail</h3>
							<button class="quiet-button" @click="inspector = ''" aria-label="Close worker detail">
								Close ×
							</button>
						</div>
						<p>{{ detail(inspected) }}</p>
						<dl>
							<div>
								<dt>World</dt>
								<dd>{{ inspected.scope?.split('\n')[1] || 'Unknown' }}</dd>
							</div>
							<div>
								<dt>Host reconciliation</dt>
								<dd>{{ inspected.reconciled ? 'Acknowledged' : 'Waiting for worker' }}</dd>
							</div>
							<div>
								<dt>Position</dt>
								<dd>{{ position(inspected) }}</dd>
							</div>
						</dl>
						<button class="quiet-button" @click="emit('navigate', 'Workers')">
							Sessions, inventory & diagnostics →
						</button>
					</article>
				</section>
			</div>
			<aside class="secondary-stack">
				<section class="dashboard-panel attention-panel">
					<div class="panel-heading">
						<div>
							<p class="kicker">WATCH DESK</p>
							<h2>
								Attention <span class="count">{{ connected ? issues.length : '—' }}</span>
							</h2>
						</div>
						<span class="watch-icon" :class="{ warning: connected && issues.length }">{{
							connected && !issues.length ? '✓' : '!'
						}}</span>
					</div>
					<div v-if="!connected" class="attention-empty">
						<h3>Waiting for the host.</h3>
						<p>
							These panels show the last received state. Reconnect to get current worker reports.
						</p>
						<button class="quiet-button" @click="emit('navigate', 'Settings')">
							Connection settings →
						</button>
					</div>
					<div v-else-if="!issues.length" class="attention-empty">
						<h3>Looking clear.</h3>
						<p>No worker blockers reported in this snapshot. Any hold-ups will appear here.</p>
					</div>
					<button
						v-for="worker in connected ? issues : []"
						:key="worker.id"
						class="attention-item"
						@click="inspectWorker(worker.id)"
					>
						<strong><i class="warning"></i>{{ worker.name }} ↗</strong>
						<p>{{ detail(worker) }}</p>
					</button>
				</section>
				<section class="dashboard-panel">
					<div class="panel-heading">
						<div>
							<p class="kicker">WHO WORKS WITH WHOM</p>
							<h2>Crew board</h2>
						</div>
					</div>
					<div v-if="!host.crews.length" class="attention-empty">
						<p>Create your first crew to organize workers.</p>
					</div>
					<button
						v-for="crew in host.crews"
						:key="crew"
						class="crew-board-row"
						:class="{ chosen: crewFilter === crew }"
						@click="crewFilter = crewFilter === crew ? '' : crew"
					>
						<div>
							<strong>{{ crewName(crew) }}</strong
							><span>{{ workers.filter((w) => w.crew === crew && online(w)).length }} online</span>
						</div>
						<div class="crew-members">
							<span
								v-for="worker in workers.filter((w) => w.crew === crew)"
								:key="worker.id"
								:title="`${worker.name} · ${phase(worker)}`"
								:class="{ offline: !online(worker) }"
								>{{ worker.name.slice(0, 2).toUpperCase() }}</span
							><small v-if="!workers.some((w) => w.crew === crew)">No workers assigned</small>
						</div>
						<small>{{ host.highways?.[crew]?.phase || 'Ready for assignment' }}</small></button
					><button class="quiet-button board-footer" @click="emit('navigate', 'Crews')">
						Manage crews →
					</button>
				</section>
				<section class="dashboard-panel activity-panel">
					<div class="panel-heading">
						<div>
							<p class="kicker">FROM THE HOST</p>
							<h2>Activity feed</h2>
						</div>
						<span class="count">{{ recentEvents.length }}</span>
					</div>
					<p v-if="!recentEvents.length" class="attention-empty">
						Connection changes and job events will appear here.
					</p>
					<ol class="event-list">
						<li v-for="(event, index) in recentEvents" :key="index">
							<i></i>
							<div>
								<strong>{{ event.event }}</strong>
								<p>
									{{
										event.worker
											? workers.find((w) => w.id === event.worker)?.name || event.worker
											: ''
									}}
									{{ event.detail }}
								</p>
								<time>{{ time(event.at) }}</time>
							</div>
						</li>
					</ol>
				</section>
			</aside>
		</div>
	</div>
</template>

<style scoped>
.fleet-dashboard {
	--stroke: var(--surface-4);
	--muted: #9caaa8;
	--gold: #dcc28b;
	--green: #88d6b2;
	color: #e6ebe8;
}
button,
input,
select {
	font: inherit;
}
button {
	cursor: pointer;
	color: inherit;
}
button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
	outline: 2px solid var(--gold);
	outline-offset: 4px;
}
h2,
h3,
p {
	margin: 0;
}
h2 {
	font-size: 1.1rem;
	font-weight: 650;
	letter-spacing: -0.025em;
}
h3 {
	font-size: 0.95rem;
	font-weight: 650;
}
i {
	display: inline-block;
	flex-shrink: 0;
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #67716e;
}
i.live {
	background: var(--green);
	box-shadow: 0 0 9px #88d6b22a;
}
i.warning {
	background: #e8b56d;
}
.fleet-metrics {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 14px;
}
.fleet-metrics > button {
	text-align: left;
	border: 1px solid var(--stroke);
	border-radius: 12px;
	padding: 19px;
	background: linear-gradient(140deg, #ffffff03, transparent), var(--surface-2);
}
.fleet-metrics > button:hover {
	border-color: #dcc28b65;
}
.metric-label {
	display: flex;
	justify-content: space-between;
	gap: 6px;
	color: var(--muted);
	font-size: 0.61rem;
	font-weight: 700;
	letter-spacing: 0.09em;
}
.metric-glyph {
	color: var(--gold);
	font-size: 0.95rem;
}
.fleet-metrics strong {
	display: block;
	font-size: 2.3rem;
	font-weight: 500;
	letter-spacing: -0.055em;
	margin: 13px 0;
	font-variant-numeric: tabular-nums;
}
.fleet-metrics strong small {
	color: #74817b;
	font-size: 1rem;
	margin-left: 8px;
	letter-spacing: 0;
}
.metric-foot {
	color: var(--muted);
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.68rem;
}
.metric-foot > span {
	margin-left: auto;
}
.fleet-metrics .metric-warning {
	border-color: #d7a66060;
	background: linear-gradient(130deg, #d7a6600d, transparent), var(--surface-2);
}
.metric-warning strong {
	color: #e8b56d;
}
.dashboard-filter {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16px;
	margin: 26px 0 15px;
}
.dashboard-filter > div {
	display: flex;
	align-items: center;
	gap: 15px;
}
.live-label {
	display: flex;
	align-items: center;
	gap: 7px;
	font-size: 0.65rem;
	letter-spacing: 0.12em;
	font-weight: 700;
}
.snapshot {
	font-size: 0.66rem;
	color: var(--muted);
}
input,
select {
	min-width: 0;
	max-width: 100%;
	border: 1px solid var(--stroke);
	border-radius: 7px;
	color: #d7dfda;
	background: var(--surface-3);
	padding: 8px 11px;
	font-size: 0.75rem;
}
.dashboard-grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 290px;
	gap: 18px;
	align-items: start;
}
.primary-stack,
.secondary-stack {
	display: grid;
	gap: 18px;
	min-width: 0;
}
.dashboard-panel {
	background: var(--surface-2);
	border: 1px solid var(--stroke);
	border-radius: 12px;
	min-width: 0;
	overflow: hidden;
}
.panel-heading {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	padding: 19px 20px;
	flex-wrap: wrap;
}
.kicker {
	color: var(--muted);
	font-size: 0.56rem;
	letter-spacing: 0.12em;
	font-weight: 650;
	margin-bottom: 8px;
}
.quiet-button {
	border: 0;
	background: transparent;
	color: var(--gold);
	font-size: 0.72rem;
	padding: 6px 0;
}
.quiet-button:hover {
	color: #f4deac;
	text-decoration: underline;
}
.count {
	font-size: 0.66rem;
	padding: 3px 6px;
	border: 1px solid var(--stroke);
	border-radius: 5px;
	margin-left: 5px;
	vertical-align: middle;
	color: var(--muted);
	font-weight: 500;
}
.mission {
	border-top: 1px solid var(--stroke);
	padding: 20px;
}
.mission-heading {
	display: flex;
	gap: 11px;
	align-items: center;
}
.mission-heading > div {
	min-width: 0;
	flex: 1;
}
.mission-heading h3 {
	overflow-wrap: anywhere;
}
.mission-icon {
	display: grid;
	place-items: center;
	flex-shrink: 0;
	width: 35px;
	height: 35px;
	color: var(--gold);
	background: #dcc28b0c;
	border: 1px solid #dcc28b25;
	border-radius: 9px;
}
.mission-heading p {
	color: var(--muted);
	font-size: 0.68rem;
	margin-top: 5px;
	overflow-wrap: anywhere;
}
.mission-heading p span {
	margin: 0 4px;
}
.status-badge {
	font-size: 0.61rem;
	padding: 4px 7px;
	background: #ffffff05;
	border: 1px solid var(--stroke);
	border-radius: 5px;
}
.status-badge.running {
	color: var(--green);
	border-color: #88d6b229;
	background: #88d6b209;
}
.progress-caption {
	display: flex;
	justify-content: space-between;
	gap: 10px;
	align-items: baseline;
	margin-top: 24px;
	font-size: 0.78rem;
}
.progress-caption strong {
	font-size: 1.15rem;
	font-weight: 550;
	font-variant-numeric: tabular-nums;
}
.progress-caption small {
	font-size: 0.7rem;
	font-weight: 400;
	color: var(--muted);
}
.progress-caption > span {
	color: var(--gold);
	font-variant-numeric: tabular-nums;
}
progress {
	width: 100%;
	height: 5px;
	appearance: none;
	border: none;
	border-radius: 10px;
	overflow: hidden;
	margin: 12px 0;
	background: var(--surface-4);
}
progress::-webkit-progress-bar {
	background: var(--surface-4);
}
progress::-webkit-progress-value {
	background: linear-gradient(90deg, #ab8950, #efdaa9);
	border-radius: 10px;
}
progress::-moz-progress-bar {
	background: linear-gradient(90deg, #ab8950, #efdaa9);
}
.mission-meta {
	display: flex;
	justify-content: space-between;
	color: var(--muted);
	font-size: 0.65rem;
	gap: 10px;
}
.mission-detail {
	font-size: 0.74rem;
	color: #b7c5bd;
	line-height: 1.6;
	margin: 16px 0;
	overflow-wrap: anywhere;
}
.mission-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}
.mission-actions button:not(.quiet-button) {
	padding: 7px 10px;
	border: 1px solid var(--stroke);
	background: var(--surface-3);
	border-radius: 6px;
	font-size: 0.7rem;
}
.mission-actions button:hover:not(:disabled) {
	border-color: #dcc28b65;
}
.mission-actions .quiet-button {
	margin-left: auto;
}
.worker-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
	padding: 0 16px 16px;
}
.worker-card {
	min-width: 0;
	text-align: left;
	background: linear-gradient(135deg, #ffffff02, transparent), var(--surface-1);
	border: 1px solid var(--stroke);
	border-radius: 9px;
	padding: 15px;
}
.worker-card:hover,
.worker-card.selected {
	border-color: #dcc28b70;
}
.worker-card.worker-alert {
	border-color: #c8a36560;
}
.worker-top {
	display: flex;
	align-items: center;
	gap: 10px;
}
.worker-avatar {
	display: grid;
	place-items: center;
	width: 31px;
	height: 34px;
	flex-shrink: 0;
	border-radius: 7px;
	font: 600 0.65rem monospace;
	background: hsl(var(--avatar-hue) 20% 20%);
	color: hsl(var(--avatar-hue) 40% 76%);
	border: 1px solid hsl(var(--avatar-hue) 20% 29%);
}
.worker-identity {
	flex: 1;
	min-width: 0;
}
.worker-identity strong {
	font-size: 0.79rem;
	display: block;
	overflow-wrap: anywhere;
}
.worker-identity small {
	display: block;
	font-size: 0.62rem;
	color: var(--muted);
	margin-top: 4px;
}
.worker-phase {
	display: flex;
	justify-content: space-between;
	color: var(--green);
	font-size: 0.7rem;
	margin-top: 17px;
	text-transform: capitalize;
}
.worker-alert .worker-phase {
	color: #e8b56d;
}
.worker-offline .worker-phase {
	color: var(--muted);
}
.worker-detail {
	margin: 8px 0 14px;
	font-size: 0.69rem;
	line-height: 1.5;
	color: var(--muted);
	overflow-wrap: anywhere;
}
.worker-position {
	border-top: 1px solid var(--stroke);
	padding-top: 11px;
	font: 0.7rem monospace;
	color: #ccd5d0;
}
.worker-position small {
	display: block;
	font: 500 0.5rem sans-serif;
	letter-spacing: 0.07em;
	color: var(--muted);
	margin-top: 5px;
}
.worker-inspector {
	border-top: 1px solid var(--stroke);
	padding: 0 20px 20px;
	background: var(--surface-3);
}
.worker-inspector .panel-heading {
	padding: 16px 0;
}
.worker-inspector p,
.worker-inspector dl {
	font-size: 0.75rem;
	overflow-wrap: anywhere;
	line-height: 1.7;
}
.worker-inspector dl > div {
	display: flex;
	justify-content: space-between;
	gap: 20px;
}
dt {
	color: var(--muted);
}
dd {
	margin: 0;
	text-align: right;
}
.watch-icon {
	width: 27px;
	height: 27px;
	display: grid;
	place-items: center;
	border: 1px solid #88d6b22a;
	border-radius: 50%;
	color: var(--green);
}
.watch-icon.warning {
	color: #e8b56d;
	border-color: #e8b56d45;
}
.attention-empty {
	padding: 0 20px 20px;
	font-size: 0.75rem;
	color: var(--muted);
	line-height: 1.7;
}
.attention-empty h3 {
	color: #c8d6cf;
	font-size: 0.8rem;
	margin-bottom: 6px;
}
.attention-item {
	display: block;
	text-align: left;
	width: 100%;
	border: 0;
	border-top: 1px solid var(--stroke);
	padding: 16px 20px;
	background: #d7a66004;
}
.attention-item strong {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 0.77rem;
}
.attention-item p {
	margin-top: 7px;
	font-size: 0.7rem;
	color: var(--muted);
	line-height: 1.6;
	overflow-wrap: anywhere;
}
.crew-board-row {
	display: block;
	text-align: left;
	width: 100%;
	border: 0;
	border-top: 1px solid var(--stroke);
	padding: 15px 20px;
	background: transparent;
}
.crew-board-row:hover,
.crew-board-row.chosen {
	background: #dcc28b09;
}
.crew-board-row > div:first-child {
	display: flex;
	justify-content: space-between;
	gap: 8px;
	font-size: 0.76rem;
}
.crew-board-row > div:first-child span,
.crew-board-row small {
	color: var(--muted);
	font-size: 0.63rem;
}
.crew-members {
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
	margin: 12px 0 8px;
}
.crew-members > span {
	display: grid;
	place-items: center;
	height: 27px;
	min-width: 27px;
	border-radius: 5px;
	border: 1px solid #88d6b22a;
	background: #88d6b20a;
	color: #b3d5c3;
	font: 0.6rem monospace;
}
.crew-members > .offline {
	opacity: 0.4;
}
.board-footer {
	margin: 0 20px 14px;
}
.event-list {
	list-style: none;
	margin: 0;
	padding: 0 20px 20px;
	max-height: 350px;
	overflow-y: auto;
}
.event-list li {
	display: flex;
	gap: 11px;
	padding: 0 0 18px;
}
.event-list i {
	margin-top: 5px;
	background: #a28d65;
}
.event-list li > div {
	min-width: 0;
}
.event-list strong {
	font-size: 0.7rem;
	font-weight: 550;
	overflow-wrap: anywhere;
}
.event-list p {
	color: var(--muted);
	font-size: 0.67rem;
	line-height: 1.6;
	margin: 4px 0;
	overflow-wrap: anywhere;
}
.event-list time {
	font-size: 0.58rem;
	color: #8e9b95;
	font-variant-numeric: tabular-nums;
}
.empty-state {
	padding: 35px 22px;
	text-align: center;
	border-top: 1px solid var(--stroke);
}
.empty-state p {
	color: var(--muted);
	font-size: 0.76rem;
	line-height: 1.7;
	margin: 10px auto 15px;
	max-width: 310px;
}
.empty-glyph {
	display: block;
	font-size: 2rem;
	color: var(--gold);
	margin-bottom: 16px;
}
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
@media (min-width: 1600px) {
	.worker-grid {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.dashboard-grid {
		grid-template-columns: minmax(0, 1fr) 330px;
	}
}
@media (max-width: 1200px) {
	.dashboard-grid {
		grid-template-columns: minmax(0, 1fr);
	}
	.secondary-stack {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.activity-panel {
		grid-column: 1 / -1;
	}
	.fleet-metrics {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
@media (max-width: 650px) {
	.worker-grid,
	.secondary-stack {
		grid-template-columns: minmax(0, 1fr);
	}
	.fleet-metrics {
		gap: 8px;
	}
	.fleet-metrics > button {
		padding: 14px;
	}
	.snapshot {
		display: none;
	}
	.mission-heading {
		flex-wrap: wrap;
	}
	.mission-meta {
		flex-wrap: wrap;
	}
	.worker-search {
		width: 100%;
	}
	.worker-search input {
		width: 100%;
		box-sizing: border-box;
	}
}
</style>
