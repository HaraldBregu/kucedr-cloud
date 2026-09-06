export function renderProviderEditor(providers) {
	const id = document.getElementById('provider').value;
	const saved = providers.find((provider) => provider.provider === id);
	document.getElementById('model').value = saved?.model || '';
	document.getElementById('api-key').value = '';
	document.getElementById('api-key-helper').textContent = saved
		? 'Leave blank to keep this provider’s saved API key.'
		: 'Enter an API key to add this provider.';
	document.getElementById('api-key').required = !saved;
	document.getElementById('delete-provider').disabled = !saved;
}
