export function sessionState(binding, processes, worker, launching = false) {
	if (launching) return 'Launching'
	if (!binding) return 'Unmanaged'
	if (!processes.some((process) => process.instance_id === binding.instance))
		return worker?.connected ? 'External' : 'Stopped'
	return worker?.connected ? 'Connected' : 'Waiting'
}

export function canLaunchSession(binding, processes, worker) {
	return (
		Boolean(binding) &&
		!worker?.connected &&
		!processes.some((process) => process.instance_id === binding.instance)
	)
}

export async function launchSessions(bindings, processes, launch) {
	const failures = []
	for (const binding of bindings) {
		if (processes.some((process) => process.instance_id === binding.instance)) continue
		try {
			await launch(binding)
		} catch (error) {
			failures.push({ worker: binding.worker, error: String(error) })
		}
	}
	return failures
}
