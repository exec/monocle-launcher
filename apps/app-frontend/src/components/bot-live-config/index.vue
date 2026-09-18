<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
	task: { type: Object, required: true },
	run: { type: Object, required: true },
	worker: { type: String, required: true },
	canControl: Boolean,
})
const emit = defineEmits(['configure'])
const module = ref('speed')
const active = ref(true)
const speed = ref(6)
const settings = ref('{}')
const error = ref('')
const pending = computed(
	() =>
		props.run.configuration && (props.run.configRevision || 0) < props.run.configuration.revision,
)
const allowed = computed(
	() =>
		props.canControl &&
		props.run.configurationVersion === 1 &&
		!pending.value &&
		!['Complete', 'Failed', 'Cancelled'].includes(props.run.status) &&
		!props.task.cancelled,
)
function apply() {
	error.value = ''
	if (!allowed.value) return
	if (
		!/^[a-z0-9-]{1,64}$/.test(module.value) ||
		['highway-builder', 'printer-helper', 'schematic-selector'].includes(module.value)
	) {
		error.value = 'Choose a gameplay module, not a job-owned builder.'
		return
	}
	if (
		module.value === 'speed' &&
		(!Number.isFinite(Number(speed.value)) || Number(speed.value) <= 0)
	) {
		error.value = 'Speed must be a positive number.'
		return
	}
	const patch =
		module.value === 'speed'
			? `{groups:[{name:'General',settings:[{name:'vanilla-speed',value:${Number(speed.value)}d}]}]}`
			: module.value === 'auto-eat'
				? "{groups:[{name:'General',settings:[{name:'blacklist',value:[]},{name:'protect-named-food',value:0b}]}]}"
				: settings.value
	emit('configure', {
		op: 'configure',
		id: props.task.id,
		worker: props.worker,
		modules: { [module.value]: { active: active.value, settings: patch } },
	})
}
</script>

<template>
	<details class="live-config">
		<summary>Live gameplay settings</summary>
		<p>Temporary job overrides · no restart · personal settings restored when the job ends.</p>
		<p v-if="run.configurationVersion !== 1">
			Requires a worker and host supporting Monocle 0.7.50 live configuration.
		</p>
		<form @submit.prevent="apply">
			<label>Module<input v-model="module" :list="'live-modules-' + run.id" required /></label>
			<datalist :id="'live-modules-' + run.id">
				<option value="speed" />
				<option value="auto-eat" />
				<option value="kill-aura" />
				<option value="auto-tool" />
			</datalist>
			<label><input v-model="active" type="checkbox" /> Enabled</label>
			<label v-if="module === 'speed'"
				>Blocks/sec<input v-model="speed" type="number" min="0.01" step="0.1" required
			/></label>
			<p v-else-if="module === 'auto-eat'">
				Allows all food, including enchanted golden apples and named food.
			</p>
			<label v-else
				>Partial settings (SNBT)<textarea v-model="settings" rows="3" spellcheck="false" required />
			</label>
			<button type="submit" :disabled="!allowed">
				{{ pending ? 'Awaiting worker acknowledgement…' : 'Apply to worker' }}
			</button>
		</form>
		<p v-if="error" role="alert">{{ error }}</p>
		<p v-if="run.configError" role="alert">{{ run.configError }}</p>
		<p v-else-if="run.configRevision && !pending">Applied revision {{ run.configRevision }}</p>
	</details>
</template>

<style scoped>
.live-config {
	margin-block: 0.75rem;
	padding: 0.75rem;
	border: 1px solid #b49a58;
	border-radius: 0.75rem;
}
form {
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	gap: 0.75rem;
}
label {
	display: grid;
	gap: 0.25rem;
}
textarea {
	min-width: 18rem;
	max-width: 100%;
}
p {
	font-size: 0.85rem;
}
</style>
