export function sessionRoster(workers, bindings, accounts) {
	const rows = new Map(workers.map((worker) => [worker.id, worker]))
	for (const binding of bindings) {
		if (!rows.has(binding.worker)) rows.set(binding.worker, {
			id: binding.worker,
			name: accounts.find((account) => account.id === binding.account)?.name || binding.worker,
			connected: false,
		})
	}
	for (const account of accounts) {
		if (!rows.has(account.id) && !bindings.some((binding) => binding.account === account.id)) {
			rows.set(account.id, { id: account.id, name: account.name, connected: false })
		}
	}
	return [...rows.values()]
}

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
