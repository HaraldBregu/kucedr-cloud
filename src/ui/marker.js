export class PersistenceMarker {
	#api;

	constructor(api) {
		this.#api = api;
	}

	async prepare() {
		const current = await this.#api.request('/settings');
		const id = crypto.randomUUID();
		const filePath = `checks/ui-volume-${id}.json`;
		const hadPrevious = Object.hasOwn(current.settings, '_kucedrCloudVolumeTest');
		const marker = {
			id,
			createdAt: new Date().toISOString(),
			filePath,
			settingsExisted: current.exists,
			hadPrevious,
			previous: hadPrevious ? current.settings._kucedrCloudVolumeTest : null,
		};
		await this.#api.request('/settings', {
			method: 'PUT',
			body: { settings: { ...current.settings, _kucedrCloudVolumeTest: marker } },
		});
		await this.#api.request('/files', {
			method: 'PUT',
			body: {
				path: filePath,
				content: JSON.stringify({ id, createdAt: marker.createdAt }, null, 2),
			},
		});
		return marker;
	}

	async verify() {
		const current = await this.#api.request('/settings');
		const marker = current.settings?._kucedrCloudVolumeTest;
		if (!marker?.id || !marker.filePath) throw new Error('No persistence marker is prepared.');
		const storedFile = await this.#api.request(
			`/files?${new URLSearchParams({ path: marker.filePath })}`
		);
		const fileMarker = JSON.parse(storedFile.file.content);
		if (fileMarker.id !== marker.id) throw new Error('Settings and file marker IDs do not match.');
		return marker;
	}

	async cleanup() {
		const current = await this.#api.request('/settings');
		const marker = current.settings?._kucedrCloudVolumeTest;
		if (!marker?.id || !marker.filePath) throw new Error('No persistence marker is prepared.');
		const nextSettings = { ...current.settings };
		delete nextSettings._kucedrCloudVolumeTest;
		if (marker.hadPrevious) nextSettings._kucedrCloudVolumeTest = marker.previous;
		if (marker.settingsExisted || Object.keys(nextSettings).length > 0) {
			await this.#api.request('/settings', {
				method: 'PUT',
				body: { settings: nextSettings },
			});
		} else {
			await this.#api.request('/settings', { method: 'DELETE' });
		}
		await this.#api.request(`/files?${new URLSearchParams({ path: marker.filePath })}`, {
			method: 'DELETE',
		});
		return marker;
	}
}
