import { StorageApi } from './api.js';
import { AgentApi } from './agent.js';
import { PersistenceMarker } from './marker.js';
import { runSuite } from './suite.js';

const elements = Object.fromEntries(
	[
		'activity-list',
		'agent-output',
		'agent-prompt',
		'agent-session',
		'agent-state',
		'clear-log',
		'connection-status',
		'copy-log',
		'data-directory',
		'delete-file',
		'delete-provider',
		'delete-settings',
		'file-content',
		'file-count',
		'file-list',
		'file-path',
		'load-settings',
		'logout',
		'load-mcp',
		'mcp-json',
		'mcp-state',
		'notice',
		'new-session',
		'persistence-clean',
		'persistence-prepare',
		'persistence-result',
		'persistence-verify',
		'read-file',
		'refresh-all',
		'refresh-files',
		'run-suite',
		'save-file',
		'save-mcp',
		'save-provider',
		'save-settings',
		'settings-json',
		'settings-state',
		'provider-form',
		'provider-key',
		'provider-model',
		'provider-select',
		'provider-state',
		'send-prompt',
		'suite-result',
	].map((id) => [id, document.getElementById(id)])
);

const requiresToken = [...document.querySelectorAll('[data-requires-token]')];
const requiresProvider = [...document.querySelectorAll('[data-requires-provider]')];
const api = new StorageApi(logResult);
const agentApi = new AgentApi();
const marker = new PersistenceMarker(api);
let connected = false;
let providerConfigured = false;
let sessionId = '';

function format(value) {
	return JSON.stringify(value, null, 2);
}

function announce(message, kind = 'info') {
	elements.notice.textContent = message;
	elements.notice.dataset.kind = kind;
}

function logResult(result) {
	const item = document.createElement('li');
	item.className = 'activity-item';
	item.dataset.ok = result.status >= 200 && result.status < 300 ? 'true' : 'false';
	const summary = document.createElement('div');
	summary.className = 'activity-summary';
	const request = document.createElement('strong');
	request.textContent = `${result.method} ${result.endpoint}`;
	const status = document.createElement('span');
	status.textContent = result.status
		? `${result.status} · ${result.duration} ms`
		: `Network error · ${result.duration} ms`;
	summary.append(request, status);
	const details = document.createElement('pre');
	details.textContent = format(result.data);
	item.append(summary, details);
	elements['activity-list'].prepend(item);
}

function setConnected(value, label) {
	connected = value;
	elements['connection-status'].textContent = label;
	elements['connection-status'].dataset.connected = String(value);
	for (const control of requiresToken) control.disabled = !value;
	for (const control of requiresProvider) control.disabled = !value || !providerConfigured;
	elements['new-session'].disabled = !value || !providerConfigured || !sessionId;
}

function setBusy(button, busy, busyLabel) {
	if (busy) {
		button.dataset.label = button.textContent;
		button.textContent = busyLabel;
	} else if (button.dataset.label) {
		button.textContent = button.dataset.label;
		delete button.dataset.label;
	}
	button.disabled = busy || (!connected && button.hasAttribute('data-requires-token'));
	button.setAttribute('aria-busy', String(busy));
}

function renderFiles(files) {
	elements['file-list'].replaceChildren();
	if (files.length === 0) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 3;
		cell.className = 'empty-cell';
		cell.textContent = 'No files stored in /data/files.';
		row.append(cell);
		elements['file-list'].append(row);
		return;
	}
	for (const file of files) {
		const row = document.createElement('tr');
		const pathCell = document.createElement('td');
		pathCell.textContent = file.path;
		const sizeCell = document.createElement('td');
		sizeCell.textContent = `${file.size} B`;
		const actionCell = document.createElement('td');
		const loadButton = document.createElement('button');
		loadButton.type = 'button';
		loadButton.className = 'button button-quiet button-small';
		loadButton.textContent = 'Load';
		loadButton.dataset.filePath = file.path;
		loadButton.setAttribute('aria-label', `Load ${file.path}`);
		actionCell.append(loadButton);
		row.append(pathCell, sizeCell, actionCell);
		elements['file-list'].append(row);
	}
}

async function loadSettings(updateEditor = true) {
	const result = await api.request('/settings');
	elements['settings-state'].textContent = result.exists ? 'Stored on volume' : 'Not created';
	elements['settings-state'].dataset.exists = String(result.exists);
	if (updateEditor) elements['settings-json'].value = format(result.settings);
	return result;
}

async function loadFiles() {
	const result = await api.request('/files');
	renderFiles(result.files);
	elements['file-count'].textContent = String(result.files.length);
	return result;
}

async function loadMcp(updateEditor = true) {
	const result = await api.request('/mcp');
	elements['mcp-state'].textContent = `${result.servers.length} configured`;
	if (updateEditor) elements['mcp-json'].value = format(result);
	return result;
}

async function loadProvider() {
	const result = await api.request('/provider');
	providerConfigured = result.configured;
	elements['provider-state'].textContent = result.configured
		? `${result.provider} · ${result.model}`
		: 'Not configured';
	elements['provider-state'].dataset.connected = String(result.configured);
	if (result.provider) elements['provider-select'].value = result.provider;
	if (result.model) elements['provider-model'].value = result.model;
	elements['provider-key'].value = '';
	elements['provider-key'].placeholder = result.hasApiKey
		? 'Saved key · leave blank to keep'
		: 'Enter API key';
	elements['agent-state'].textContent = result.configured
		? 'Ready to send a prompt.'
		: 'Configure a provider first.';
	setConnected(connected, elements['connection-status'].textContent);
	return result;
}

async function refreshAll(updateEditor = true) {
	const [storage] = await Promise.all([
		api.request('/storage'),
		loadProvider(),
		loadMcp(updateEditor),
		loadSettings(updateEditor),
		loadFiles(),
	]);
	elements['data-directory'].textContent = storage.dataDirectory;
	elements['file-count'].textContent = String(storage.files.count);
	return storage;
}

function handleError(error) {
	const message = error instanceof Error ? error.message : String(error);
	if (error?.status === 401) {
		window.location.replace('/access');
	} else if (error?.status === 404) {
		announce('The requested application service is unavailable.', 'error');
	} else if (error?.status === 0 || error instanceof TypeError) {
		announce('The server is offline or restarting. Reconnect when it is available.', 'error');
	} else {
		announce(message, 'error');
	}
}

elements['load-mcp'].addEventListener('click', async () => {
	try {
		await loadMcp();
		announce('MCP configuration reloaded.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['save-mcp'].addEventListener('click', async () => {
	setBusy(elements['save-mcp'], true, 'Saving…');
	try {
		const document = JSON.parse(elements['mcp-json'].value);
		await api.request('/mcp', { method: 'PUT', body: document });
		await loadMcp();
		announce('MCP configuration was saved and reloaded.', 'success');
	} catch (error) {
		handleError(error);
	} finally {
		setBusy(elements['save-mcp'], false, 'Save MCP configuration');
	}
});

elements['provider-select'].addEventListener('change', () => {
	const placeholders = {
		anthropic: 'claude-sonnet-4-5',
		openai: 'gpt-5.6',
		deepseek: 'deepseek-v4-flash',
	};
	elements['provider-model'].placeholder = placeholders[elements['provider-select'].value];
	elements['provider-key'].value = '';
});

elements['provider-form'].addEventListener('submit', async (event) => {
	event.preventDefault();
	setBusy(elements['save-provider'], true, 'Saving…');
	try {
		const provider = elements['provider-select'].value;
		const model = elements['provider-model'].value.trim();
		const apiKey = elements['provider-key'].value;
		if (!model) throw new Error('Enter a model name.');
		await api.request('/provider', {
			method: 'PUT',
			body: { provider, model, ...(apiKey ? { apiKey } : {}) },
		});
		await loadProvider();
		announce(`${provider} is configured for ${model}.`, 'success');
	} catch (error) {
		handleError(error);
	} finally {
		setBusy(elements['save-provider'], false, 'Save configuration');
	}
});

elements['delete-provider'].addEventListener('click', async () => {
	if (!window.confirm('Remove the saved provider, model, and API key?')) return;
	try {
		await api.request('/provider', { method: 'DELETE' });
		providerConfigured = false;
		sessionId = '';
		elements['provider-model'].value = '';
		elements['agent-session'].textContent = 'No session';
		await loadProvider();
		announce('Provider configuration was removed.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['send-prompt'].addEventListener('click', async () => {
	const message = elements['agent-prompt'].value.trim();
	if (!message) {
		announce('Enter a prompt first.', 'error');
		return;
	}
	setBusy(elements['send-prompt'], true, 'Running…');
	elements['agent-output'].textContent = '';
	elements['agent-state'].textContent = 'Waiting for the agent…';
	let receivedDelta = false;
	try {
		await agentApi.prompt(message, sessionId, (event) => {
			if (event.type === 'run_started') {
				sessionId = event.sessionId;
				elements['agent-session'].textContent = `Session ${sessionId}`;
				elements['agent-state'].textContent =
					`Running with ${elements['provider-select'].value} · ${elements['provider-model'].value}`;
				elements['new-session'].disabled = false;
			} else if (event.type === 'text_delta') {
				receivedDelta = true;
				elements['agent-output'].textContent += event.delta;
			} else if (event.type === 'assistant_message' && !receivedDelta) {
				elements['agent-output'].textContent = event.content;
			} else if (event.type === 'run_finished') {
				elements['agent-state'].textContent = 'Completed.';
			}
		});
		if (!elements['agent-output'].textContent) {
			elements['agent-output'].textContent = 'The agent completed without a text response.';
		}
		announce('Agent response completed.', 'success');
	} catch (error) {
		elements['agent-state'].textContent = 'Run failed.';
		if (!elements['agent-output'].textContent) {
			elements['agent-output'].textContent = error instanceof Error ? error.message : String(error);
		}
		handleError(error);
	} finally {
		setBusy(elements['send-prompt'], false, 'Send prompt');
	}
});

elements['new-session'].addEventListener('click', () => {
	sessionId = '';
	elements['agent-session'].textContent = 'No session';
	elements['agent-output'].textContent = 'The streamed response will appear here.';
	elements['agent-state'].textContent = 'Ready to start a new session.';
	elements['new-session'].disabled = true;
});

elements['refresh-all'].addEventListener('click', async () => {
	setBusy(elements['refresh-all'], true, 'Refreshing…');
	try {
		await refreshAll();
		announce('Storage overview refreshed.', 'success');
	} catch (error) {
		handleError(error);
	} finally {
		setBusy(elements['refresh-all'], false, 'Refresh all');
	}
});

elements.logout.addEventListener('click', async () => {
	setBusy(elements.logout, true, 'Logging out…');
	try {
		const response = await fetch('/access/session', {
			method: 'DELETE',
			credentials: 'same-origin',
		});
		if (!response.ok) throw new Error(`Logout failed with status ${response.status}.`);
		window.location.replace('/access');
	} catch (error) {
		handleError(error);
		setBusy(elements.logout, false, 'Log out');
	}
});

elements['load-settings'].addEventListener('click', async () => {
	try {
		await loadSettings();
		announce('Settings loaded from the volume.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['save-settings'].addEventListener('click', async () => {
	try {
		const settings = JSON.parse(elements['settings-json'].value);
		if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
			throw new Error('Settings must be a JSON object.');
		}
		await api.request('/settings', { method: 'PUT', body: { settings } });
		await refreshAll(false);
		announce('Settings saved to the volume.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['delete-settings'].addEventListener('click', async () => {
	if (!window.confirm('Delete settings.json from the persistent volume?')) return;
	try {
		await api.request('/settings', { method: 'DELETE' });
		await refreshAll();
		announce('settings.json was deleted.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['save-file'].addEventListener('click', async () => {
	try {
		const path = elements['file-path'].value;
		await api.request('/files', {
			method: 'PUT',
			body: { path, content: elements['file-content'].value },
		});
		await loadFiles();
		announce(`${path} saved to the volume.`, 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['read-file'].addEventListener('click', async () => {
	try {
		const path = elements['file-path'].value;
		const result = await api.request(`/files?${new URLSearchParams({ path })}`);
		elements['file-content'].value = result.file.content;
		announce(`${path} loaded.`, 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['delete-file'].addEventListener('click', async () => {
	const path = elements['file-path'].value;
	if (!window.confirm(`Delete ${path} from the persistent volume?`)) return;
	try {
		await api.request(`/files?${new URLSearchParams({ path })}`, { method: 'DELETE' });
		await loadFiles();
		announce(`${path} deleted.`, 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['refresh-files'].addEventListener('click', async () => {
	try {
		await loadFiles();
		announce('File list refreshed.', 'success');
	} catch (error) {
		handleError(error);
	}
});

elements['file-list'].addEventListener('click', async (event) => {
	const button = event.target.closest('[data-file-path]');
	if (!button) return;
	elements['file-path'].value = button.dataset.filePath;
	elements['read-file'].click();
});

elements['run-suite'].addEventListener('click', async () => {
	setBusy(elements['run-suite'], true, 'Running suite…');
	const hooks = {
		reset() {
			for (const step of document.querySelectorAll('[data-suite-step]'))
				step.dataset.state = 'pending';
			elements['suite-result'].textContent = 'Running safe storage checks…';
			elements['suite-result'].dataset.kind = 'info';
		},
		step(name, state) {
			document.querySelector(`[data-suite-step="${name}"]`).dataset.state = state;
		},
		result(state, message) {
			elements['suite-result'].textContent = message;
			elements['suite-result'].dataset.kind = state === 'passed' ? 'success' : 'error';
		},
	};
	try {
		await runSuite(api, hooks);
		await refreshAll();
	} catch (error) {
		handleError(error);
	} finally {
		setBusy(elements['run-suite'], false, 'Run full API suite');
	}
});

elements['persistence-prepare'].addEventListener('click', async () => {
	try {
		const result = await marker.prepare();
		elements['persistence-result'].textContent =
			`Marker ${result.id} is ready. Recreate the container, reconnect, then verify.`;
		elements['persistence-result'].dataset.kind = 'success';
		await refreshAll();
	} catch (error) {
		handleError(error);
	}
});

elements['persistence-verify'].addEventListener('click', async () => {
	try {
		const result = await marker.verify();
		elements['persistence-result'].textContent =
			`Persistence verified. Settings and ${result.filePath} contain marker ${result.id}.`;
		elements['persistence-result'].dataset.kind = 'success';
	} catch (error) {
		elements['persistence-result'].textContent =
			error instanceof Error ? error.message : String(error);
		elements['persistence-result'].dataset.kind = 'error';
		handleError(error);
	}
});

elements['persistence-clean'].addEventListener('click', async () => {
	try {
		const result = await marker.cleanup();
		elements['persistence-result'].textContent = `Marker ${result.id} was removed safely.`;
		elements['persistence-result'].dataset.kind = 'success';
		await refreshAll();
	} catch (error) {
		handleError(error);
	}
});

elements['clear-log'].addEventListener('click', () => {
	elements['activity-list'].replaceChildren();
	announce('Activity log cleared.', 'info');
});

elements['copy-log'].addEventListener('click', async () => {
	try {
		await navigator.clipboard.writeText(elements['activity-list'].innerText);
		announce('Activity log copied.', 'success');
	} catch {
		announce('The browser could not copy the activity log.', 'error');
	}
});

for (const editor of [
	elements['settings-json'],
	elements['mcp-json'],
	elements['file-content'],
	elements['agent-prompt'],
]) {
	editor.addEventListener('keydown', (event) => {
		if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
		event.preventDefault();
		const button =
			editor === elements['settings-json']
				? elements['save-settings']
				: editor === elements['mcp-json']
					? elements['save-mcp']
				: editor === elements['file-content']
					? elements['save-file']
					: elements['send-prompt'];
		button.click();
	});
}

setConnected(true, 'Access granted');
elements['settings-json'].value = '{}';
elements['mcp-json'].value = '{\n  \"servers\": []\n}';
elements['file-content'].value = 'Hello from the storage test console.';
elements['provider-select'].dispatchEvent(new Event('change'));
try {
	await refreshAll();
	announce('Workspace ready.', 'success');
} catch (error) {
	handleError(error);
}
