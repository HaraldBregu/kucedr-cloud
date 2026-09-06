export function renderProviders(providers) {
	const rows = document.getElementById('provider-rows');
	rows.replaceChildren();
	if (!providers.length) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 4;
		cell.className = 'empty-cell';
		cell.textContent = 'No providers saved. Add your first provider below.';
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
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'button button-secondary button-small';
		button.textContent = provider.active ? 'Active provider' : 'Use provider';
		button.disabled = provider.active;
		button.dataset.provider = provider.provider;
		actions.append(button);
		row.append(actions);
		rows.append(row);
	}
}
