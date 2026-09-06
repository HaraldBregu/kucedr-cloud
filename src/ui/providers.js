export function renderProviders(providers) {
	const rows = document.getElementById('provider-rows');
	const allSaved = Array.from(document.getElementById('provider').options).every((option) =>
		providers.some((provider) => provider.provider === option.value)
	);
	document.getElementById('add-provider').disabled = allSaved;
	document.getElementById('provider-limit').hidden = !allSaved;
	rows.replaceChildren();
	if (!providers.length) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 4;
		cell.className = 'empty-cell';
		cell.textContent = 'No providers saved. Choose Add provider to get started.';
		row.append(cell);
		rows.append(row);
	}
	for (const provider of providers) {
		const row = document.createElement('tr');
		for (const value of [provider.provider, provider.model, provider.active ? 'Active' : 'Saved']) {
			const cell = document.createElement('td');
			cell.textContent = value;
			row.append(cell);
		}
		const actions = document.createElement('td');
		const controls = document.createElement('div');
		controls.className = 'button-row button-row-wrap';
		for (const [action, label] of [
			['activate', provider.active ? 'Active provider' : 'Use provider'],
			['edit', 'Edit'],
			['remove', 'Remove'],
		]) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = `button button-small ${action === 'remove' ? 'button-danger' : 'button-secondary'}`;
			button.textContent = label;
			button.disabled = action === 'activate' && provider.active;
			button.dataset.provider = provider.provider;
			button.dataset.action = action;
			button.setAttribute('aria-label', `${label} ${provider.provider}`);
			controls.append(button);
		}
		actions.append(controls);
		row.append(actions);
		rows.append(row);
	}
}
