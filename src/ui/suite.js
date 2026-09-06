export async function runSuite(api, hooks) {
	const id = crypto.randomUUID();
	const filePath = `checks/ui-suite-${id}.txt`;
	const firstContent = `kucedr-cloud storage UI suite ${id}`;
	const secondContent = `kucedr-cloud storage UI suite updated ${id}`;
	let snapshot;
	let cleaned = false;
	hooks.reset();

	try {
		hooks.step('status', 'running');
		await api.request('/storage');
		hooks.step('status', 'passed');

		hooks.step('snapshot', 'running');
		snapshot = await api.request('/settings');
		hooks.step('snapshot', 'passed');

		hooks.step('settings', 'running');
		await api.request('/settings', {
			method: 'PUT',
			body: {
				settings: {
					...snapshot.settings,
					_kucedrCloudStorageTest: { id, createdAt: new Date().toISOString() },
				},
			},
		});
		const settings = await api.request('/settings');
		if (settings.settings?._kucedrCloudStorageTest?.id !== id)
			throw new Error('Settings marker mismatch.');
		hooks.step('settings', 'passed');

		hooks.step('files', 'running');
		await api.request('/files', {
			method: 'PUT',
			body: { path: filePath, content: firstContent },
		});
		const createdFile = await api.request(`/files?${new URLSearchParams({ path: filePath })}`);
		if (createdFile.file?.content !== firstContent)
			throw new Error('Created file content mismatch.');
		const files = await api.request('/files');
		if (!files.files?.some((file) => file.path === filePath))
			throw new Error('File missing from list.');
		await api.request('/files', {
			method: 'PUT',
			body: { path: filePath, content: secondContent },
		});
		const overwrittenFile = await api.request(`/files?${new URLSearchParams({ path: filePath })}`);
		if (overwrittenFile.file?.content !== secondContent)
			throw new Error('Overwritten file mismatch.');
		hooks.step('files', 'passed');

		hooks.step('delete', 'running');
		await api.request(`/files?${new URLSearchParams({ path: filePath })}`, { method: 'DELETE' });
		try {
			await api.request(`/files?${new URLSearchParams({ path: filePath })}`);
			throw new Error('Deleted file is still readable.');
		} catch (error) {
			if (error.status !== 404) throw error;
		}
		hooks.step('delete', 'passed');

		hooks.step('restore', 'running');
		if (snapshot.exists) {
			await api.request('/settings', { method: 'PUT', body: { settings: snapshot.settings } });
		} else {
			await api.request('/settings', { method: 'DELETE' });
		}
		await api.request('/storage');
		cleaned = true;
		hooks.step('restore', 'passed');
		hooks.result('passed', `All storage API checks passed. Existing settings were restored.`);
		return true;
	} catch (error) {
		hooks.result('failed', error instanceof Error ? error.message : String(error));
		return false;
	} finally {
		if (!cleaned) {
			await api
				.request(`/files?${new URLSearchParams({ path: filePath })}`, { method: 'DELETE' })
				.catch(() => undefined);
			if (snapshot) {
				const restore = snapshot.exists
					? { method: 'PUT', body: { settings: snapshot.settings } }
					: { method: 'DELETE' };
				await api.request('/settings', restore).catch(() => undefined);
			}
		}
	}
}
