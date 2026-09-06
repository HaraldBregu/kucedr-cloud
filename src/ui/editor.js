export function renderProviderEditor(providers) {
	const id = document.getElementById('provider').value;
	const saved = providers.find((provider) => provider.provider === id);
	document.getElementById('model').value = saved?.model || '';
	document.getElementById('api-key').value = '';
	document.getElementById('api-key-helper').textContent = saved
		? 'Leave blank to keep this provider’s saved API key.'
		: 'Enter an API key to add this provider.';
	document.getElementById('api-key').required = !saved;
	document.getElementById('provider-editor-title').textContent = saved
		? 'Edit provider'
		: 'Add provider';
	for (const option of document.getElementById('provider').options) {
		option.disabled =
			document.getElementById('provider-editor').dataset.mode === 'add' &&
			providers.some((provider) => provider.provider === option.value);
	}
}
