import { registerAccountForm } from './account.js';
import { showPage } from './page.js';
import { renderProviders } from './providers.js';
import { renderProviderEditor } from './editor.js';

const elements = Object.fromEntries(
	[
		'notice',
		'session-status',
		'section-nav',
		'logout-button',
		'register-view',
		'login-view',
		'config-view',
		'register-form',
		'login-form',
		'provider-form',
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
let savedProviders = [];
let configurationLoaded = false;

async function request(path, options = {}) {
	const headers = { accept: 'application/json', ...options.headers };
	if (options.body) headers['content-type'] = 'application/json';
	if (csrf && options.method && options.method !== 'GET') headers['x-kucedr-cloud-csrf'] = csrf;
	const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
	const body = response.status === 204 ? null : await response.json().catch(() => null);
	if (response.status === 401 && csrf) window.location.replace('/config/login');
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
	form.setAttribute('aria-busy', String(busy));
	const submit = form.querySelector('button[type="submit"]');
	if (busy) submit.dataset.label = submit.textContent;
	submit.textContent = busy ? 'Submitting…' : submit.dataset.label;
	for (const control of form.elements) control.disabled = busy;
}

function showView(name, username = '') {
	currentUsername = username || currentUsername;
	elements['register-view'].hidden = name !== 'register';
	elements['login-view'].hidden = name !== 'login';
	elements['config-view'].hidden = name !== 'config';
	elements['section-nav'].hidden = name !== 'config';
	elements['logout-button'].hidden = name !== 'config';
	elements['session-status'].dataset.connected = name === 'config' ? 'true' : 'false';
	elements['session-status'].textContent =
		name === 'config' ? 'Authenticated' : name === 'register' ? 'Setup required' : 'Signed out';
	showPage(name);
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
	document.getElementById('provider-guidance').textContent = provider.configured
		? 'Your provider is configured. Manage clients and review A2A connection settings.'
		: configuration.providers.length
			? 'Choose an active provider on the Provider page to enable agent runs.'
			: 'Connect a model provider to enable agent runs. You can configure clients at any time.';
	elements['provider-status'].textContent = provider.configured
		? `${provider.provider} / ${provider.model}`
		: 'Not configured';
	elements['client-count'].textContent = String(configuration.clients.length);
	if (!configurationLoaded)
		document.getElementById('provider').value = provider.provider || 'openai';
	configurationLoaded = true;
	savedProviders = configuration.providers;
	renderProviders(savedProviders);
	renderProviderEditor(savedProviders);
	elements['oauth-issuer'].textContent = configuration.oauth.issuer;
	elements['oauth-token'].textContent = configuration.oauth.tokenEndpoint;
	elements['oauth-resource'].textContent = configuration.oauth.resource;
	elements['oauth-scope'].textContent = configuration.oauth.scope;
	renderClients(configuration.clients);
}

async function loadConfiguration() {
	const configuration = await request('/config/api');
	renderConfiguration(configuration);
	showView('config', currentUsername);
}

async function initialize() {
	try {
		const status = await request('/config/auth/status');
		csrf = status.csrfToken || '';
		if (!status.registered) return showView('register');
		if (!status.authenticated) {
			showView('login');
			if (new URLSearchParams(window.location.search).get('updated') === '1')
				showNotice('Administrator updated. Log in with your updated credentials.');
			return;
		}
		currentUsername = status.username;
		document.getElementById('administrator-username').value = currentUsername;
		await loadConfiguration();
	} catch (error) {
		showNotice(error.message, 'error');
		document.getElementById('page-description').textContent = 'Unable to load this page.';
		document.getElementById('load-retry').hidden = false;
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

document
	.getElementById('provider')
	.addEventListener('change', () => renderProviderEditor(savedProviders));

document.getElementById('add-provider').addEventListener('click', () => {
	const select = document.getElementById('provider');
	const available = Array.from(select.options).find(
		(option) => !savedProviders.some((provider) => provider.provider === option.value)
	);
	if (!available) return;
	select.value = available.value;
	document.getElementById('provider-editor').dataset.mode = 'add';
	renderProviderEditor(savedProviders);
	document.getElementById('provider-editor').hidden = false;
	select.focus();
});

document.getElementById('cancel-provider').addEventListener('click', () => {
	document.getElementById('provider-editor').hidden = true;
	document.getElementById('api-key').value = '';
	const target = document.getElementById('add-provider').disabled
		? document.querySelector('#provider-rows button[data-action="edit"]')
		: document.getElementById('add-provider');
	target?.focus();
});

document.getElementById('provider-rows').addEventListener('click', async (event) => {
	const button = event.target.closest('button[data-provider]');
	if (!button || button.disabled) return;
	const id = button.dataset.provider;
	const action = button.dataset.action;
	if (action === 'edit') {
		document.getElementById('provider').value = id;
		document.getElementById('provider-editor').dataset.mode = 'edit';
		renderProviderEditor(savedProviders);
		document.getElementById('provider-editor').hidden = false;
		document.getElementById('model').focus();
		return;
	}
	if (
		action === 'remove' &&
		!window.confirm(
			`Remove ${id}? Its saved model and API key will be deleted.${savedProviders.find((provider) => provider.provider === id)?.active ? ' Choose another saved provider before starting new agent runs.' : ''}`
		)
	)
		return;
	button.disabled = true;
	try {
		if (action === 'remove') {
			await request(`/config/provider/${id}`, { method: 'DELETE' });
			if (document.getElementById('provider').value === id)
				document.getElementById('provider-editor').hidden = true;
		} else {
			await request('/config/provider/active', {
				method: 'PUT',
				body: JSON.stringify({ provider: id }),
			});
		}
		await loadConfiguration();
		showNotice(
			action === 'remove'
				? `${id} removed.`
				: 'Active provider updated. New agent runs will use this provider.'
		);
		if (action === 'remove') document.getElementById('add-provider').focus();
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		button.disabled = false;
	}
});

elements['provider-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	const form = event.currentTarget;
	setBusy(form, true);
	try {
		await saveProvider(form);
		document.getElementById('provider-editor').hidden = true;
		document.getElementById('api-key').value = '';
		await loadConfiguration();
		showNotice('Provider configuration saved.');
		const target = document.getElementById('add-provider').disabled
			? document.querySelector('#provider-rows button[data-action="edit"]')
			: document.getElementById('add-provider');
		target?.focus();
	} catch (error) {
		showNotice(error.message, 'error');
	} finally {
		setBusy(form, false);
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

registerAccountForm(request, showNotice, setBusy);
initialize();
