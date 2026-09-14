<script setup>
import { MonocleIcon } from '@modrinth/assets'
</script>

<template>
	<MonocleIcon class="monocle-loading" />
</template>

<style scoped>
.monocle-loading {
	width: 5rem;
	height: 5rem;
	animation: monocle-glow 2s ease-in-out infinite alternate;
}
@keyframes monocle-glow {
	from { opacity: .6; filter: drop-shadow(0 0 0 transparent); }
	to { opacity: 1; filter: drop-shadow(0 0 .4rem #d6b65e); }
}
@media (prefers-reduced-motion: reduce) {
	.monocle-loading { animation: none; }
}
</style>
