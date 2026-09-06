const elements = Object.fromEntries(
	[
		'notice',
		'session-status',
		'section-nav',
		'logout-button',
		'register-view',
		'login-view',
		'setup-view',
		'config-view',
		'register-form',
		'login-form',
		'setup-provider-form',
		'provider-form',
		'delete-provider',
		'client-form',
		'provider-status',
		'client-count',
		'signed-in-user',
		'api-key-helper',
		'oauth-issuer',
		'oauth-token',
		'oauth-resource',
		'oauth-scope',
		'client-rows',
	].map((id) => [id, document.getElementById(id)])
);

let csrf = '';
let currentUsername = '';

async function request(path, options = {}) {
	const headers = { accept: 'application/json', ...options.headers };
	if (options.body) headers['content-type'] = 'application/json';
	if (csrf && options.method && options.method !== 'GET') headers['x-kucedr-cloud-csrf'] = csrf;
	const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
	const body = response.status === 204 ? null : await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(body?.message || body?.error || `Request failed (${response.status}).`);
	return body;
}

function showNotice(message, kind = 'success') {
	elements.notice.textContent = message;
	elements.notice.dataset.kind = kind;
	elements.notice.hidden = false;
}

function setBusy(form, busy) {
	for (const control of form.elements) control.disabled = busy;
}

function showView(name, username = '') {
	currentUsername = username || currentUsername;
	elements['register-view'].hidden = name !== 'register';
	elements['login-view'].hidden = name !== 'login';
	elements['setup-view'].hidden = name !== 'setup';
	elements['config-view'].hidden = name !== 'config';
	elements['section-nav'].hidden = name !== 'config';
	elements['logout-button'].hidden = !['setup', 'config'].includes(name);
	elements['session-status'].dataset.connected = ['setup', 'config'].includes(name)
		? 'true'
		: 'false';
	elements['session-status'].textContent =
		name === 'config'
			? 'Authenticated'
			: name === 'setup'
				? 'Provider setup'
				: name === 'register'
					? 'Setup required'
					: 'Signed out';
	elements['signed-in-user'].textContent = currentUsername || '—';
}

function renderClients(clients) {
	elements['client-rows'].replaceChildren();
	if (!clients.length) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 4;
		cell.className = 'empty-cell';
		cell.textContent = 'No calling agents registered.';
		row.append(cell);
		elements['client-rows'].append(row);
		return;
	}
	for (const client of clients) {
		const row = document.createElement('tr');
		for (const value of [
			client.name,
			client.clientId,
			new Date(client.createdAt).toLocaleString(),
		]) {
			const cell = document.createElement('td');
			cell.textContent = value;
			row.append(cell);
		}
		const action = document.createElement('td');
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'button button-danger button-small';
		button.textContent = 'Revoke';
		button.addEventListener('click', () => revokeClient(client.clientId, client.name));
		action.append(button);
		row.append(action);
		elements['client-rows'].append(row);
	}
}

function renderConfiguration(configuration) {
	const provider = configuration.provider;
	elements['provider-status'].textContent = provider.configured
		? `${provider.provider} / ${provider.model}`
		: 'Not configured';
	elements['client-count'].textContent = String(configuration.clients.length);
	document.getElementById('provider').value = provider.provider || 'openai';
	document.getElementById('model').value = provider.model || '';
	elements['api-key-helper'].textContent = provider.hasApiKey
		? 'Leave blank to keep the saved API key.'
		: 'Required for the selected provider.';
	elements['delete-provider'].disabled = !provider.configured;
	elements['oauth-issuer'].textContent = configuration.oauth.issuer;
	elements['oauth-token'].textContent = configuration.oauth.tokenEndpoint;
	elements['oauth-resource'].textContent = configuration.oauth.resource;
	elements['oauth-scope'].textContent = configuration.oauth.scope;
	renderClients(configuration.clients);
}

async function loadConfiguration() {
	const configuration = await request('/config/api');
	renderConfiguration(configuration);
	showView(configuration.provider.configured ? 'config' : 'setup', currentUsername);
}

async function initialize() {
	try {
		const status = await request('/config/auth/status');
		csrf = status.csrfToken || '';
		if (!status.registered) return showView('register');
		if (!status.authenticated) return showView('login');
		currentUsername = status.username;
		await loadConfiguration();
	} catch (error) {
		showView('login');
		showNotice(error.message, 'error');
	}
}

elements['register-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	const data = new FormData(form);
	setBusy(form, true);
	try {
		await request('/config/auth/register', {
			method: 'POST',
			body: JSON.stringify({
				setupToken: data.get('setupToken'),
				username: data.get('username'),
				password: data.get('password'),
			}),
		});
		window.location.replace('/config');
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
	}
});

elements['setup-provider-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	setBusy(form, true);
	try {
		await saveProvider(form);
		form.reset();
		window.location.replace('/config');
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
	}
});

elements['login-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	const data = new FormData(form);
	setBusy(form, true);
	try {
		await request('/config/auth/session', {
			method: 'POST',
			body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
		});
		window.location.replace('/config');
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
	}
});

elements['logout-button'].addEventListener('click', async () => {
	try {
		await request('/config/auth/session', { method: 'DELETE' });
		window.location.replace('/config/login');
	} catch (error) {
		showNotice(error.message, 'error');
	}
});

elements['provider-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	setBusy(form, true);
	try {
		await saveProvider(form);
		document.getElementById('api-key').value = '';
		await loadConfiguration();
		showNotice('Provider configuration saved.');
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
	}
});

elements['delete-provider'].addEventListener('click', async () => {
	if (
		!window.confirm(
			'Remove the provider configuration? Agent runs will stop until another provider is configured.'
		)
	)
		return;
	try {
		await request('/config/provider', { method: 'DELETE' });
		window.location.replace('/config/setup');
	} catch (error) {
		showNotice(error.message, 'error');
	}
});

async function saveProvider(form) {
	const provider = form.querySelector('select[name="provider"]').value;
	const model = form.querySelector('input[name="model"]').value;
	const apiKey = form.querySelector('input[name="apiKey"]').value;
	return request('/config/provider', {
		method: 'PUT',
		body: JSON.stringify({ provider, model, ...(apiKey ? { apiKey } : {}) }),
	});
}

elements['client-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	const data = new FormData(form);
	let publicKeyJwk;
	try {
		publicKeyJwk = JSON.parse(data.get('publicKeyJwk'));
	} catch {
		return showNotice('The public JWK must be valid JSON.', 'error');
	}
	setBusy(form, true);
	try {
		await request('/config/clients', {
			method: 'POST',
			body: JSON.stringify({ name: data.get('name'), publicKeyJwk }),
		});
		form.reset();
		await loadConfiguration();
		showNotice('Calling agent registered.');
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
	}
});

async function revokeClient(clientId, name) {
	if (!window.confirm(`Revoke ${name}? It will no longer be able to obtain new access tokens.`))
		return;
	try {
		await request(`/config/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
		await loadConfiguration();
		showNotice('Calling agent revoked.');
	} catch (error) {
		showNotice(error.message, 'error');
	}
}

document.getElementById('copyright-year').textContent = String(new Date().getFullYear());
initialize();
