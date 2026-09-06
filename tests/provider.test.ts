import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createAdminAuthentication } from '../src/main/admin/authenticate';
import { getModelId, getProviderId } from '../src/main/agent/agent_store';
import { getResolvedProvider } from '../src/main/agent/settings_store';
import { ConfigurationStore } from '../src/main/config/store';
import { providerBaseUrl } from '../src/main/provider/base';
import { registerProviderRoutes } from '../src/main/provider/routes';

test('provider API persists only supported provider configurations without returning keys', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-provider-'));
	const server = Fastify();
	const headers = { authorization: 'Bearer provider-test-token' };
	const secret = 'sk-provider-secret-sentinel';
	const authenticate = createAdminAuthentication(directory, 'provider-test-token');
	registerProviderRoutes(server, directory, authenticate);

	try {
		assert.equal((await server.inject({ method: 'GET', url: '/provider' })).statusCode, 401);
		assert.deepEqual((await server.inject({ method: 'GET', url: '/provider', headers })).json(), {
			configured: false,
			provider: null,
			model: null,
			hasApiKey: false,
		});

		for (const payload of [
			{ provider: 'custom', model: 'model', apiKey: secret },
			{ provider: 'anthropic', model: '', apiKey: secret },
			{ provider: 'anthropic', model: 'claude-model', baseURL: 'https://example.com' },
		]) {
			const response = await server.inject({
				method: 'PUT',
				url: '/provider',
				headers,
				payload,
			});
			assert.equal(response.statusCode, 400);
		}

		const missingKey = await server.inject({
			method: 'PUT',
			url: '/provider',
			headers,
			payload: { provider: 'anthropic', model: 'claude-model' },
		});
		assert.equal(missingKey.statusCode, 400);

		const created = await server.inject({
			method: 'PUT',
			url: '/provider',
			headers,
			payload: { provider: 'anthropic', model: 'claude-model', apiKey: secret },
		});
		assert.equal(created.statusCode, 201);
		assert.deepEqual(created.json(), {
			configured: true,
			provider: 'anthropic',
			model: 'claude-model',
			hasApiKey: true,
		});
		assert.equal(created.body.includes(secret), false);
		assert.equal(fs.statSync(path.join(directory, 'provider.json')).mode & 0o777, 0o600);

		const updated = await server.inject({
			method: 'PUT',
			url: '/provider',
			headers,
			payload: { provider: 'anthropic', model: 'claude-model-new' },
		});
		assert.equal(updated.statusCode, 200);
		assert.equal(updated.body.includes(secret), false);
		assert.equal(
			JSON.parse(fs.readFileSync(path.join(directory, 'provider.json'), 'utf8')).apiKey,
			secret
		);

		const changedWithoutKey = await server.inject({
			method: 'PUT',
			url: '/provider',
			headers,
			payload: { provider: 'openai', model: 'gpt-model' },
		});
		assert.equal(changedWithoutKey.statusCode, 400);

		const restartedServer = Fastify();
		registerProviderRoutes(restartedServer, directory, authenticate);
		try {
			const persisted = await restartedServer.inject({ method: 'GET', url: '/provider', headers });
			assert.deepEqual(persisted.json(), updated.json());
			assert.equal(persisted.body.includes(secret), false);
		} finally {
			await restartedServer.close();
		}

		assert.deepEqual(
			(await server.inject({ method: 'DELETE', url: '/provider', headers })).json(),
			{ deleted: true }
		);
		assert.equal(fs.existsSync(path.join(directory, 'provider.json')), false);
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('runtime resolves only encrypted provider configuration', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-provider-runtime-'));
	const previous = {
		dataDirectory: process.env.KUCEDR_CLOUD_DATA_DIR,
		configurationKey: process.env.KUCEDR_CLOUD_ENCRYPTION_KEY,
	};
	try {
		process.env.KUCEDR_CLOUD_DATA_DIR = directory;
		delete process.env.KUCEDR_CLOUD_ENCRYPTION_KEY;
		fs.writeFileSync(
			path.join(directory, 'provider.json'),
			JSON.stringify({ provider: 'deepseek', model: 'deepseek-model', apiKey: 'deepseek-key' }),
			{ mode: 0o600 }
		);

		assert.equal(getProviderId(), undefined);
		assert.equal(getModelId(), undefined);
		assert.equal(getResolvedProvider('deepseek'), undefined);

		process.env.KUCEDR_CLOUD_ENCRYPTION_KEY = '44'.repeat(32);
		const secureStore = new ConfigurationStore(directory, Buffer.from('44'.repeat(32), 'hex'));
		assert.equal(getProviderId(), undefined);
		assert.equal(getModelId(), undefined);
		assert.equal(getResolvedProvider('openai'), undefined);
		secureStore.setProvider({
			provider: 'anthropic',
			model: 'secure-model',
			apiKey: 'secure-key',
		});
		assert.equal(getProviderId(), 'anthropic');
		assert.equal(getModelId(), 'secure-model');
		assert.deepEqual(getResolvedProvider('anthropic'), {
			id: 'anthropic',
			apiKey: 'secure-key',
			baseURL: 'https://api.anthropic.com',
		});
		assert.equal(getResolvedProvider('deepseek'), undefined);
		secureStore.setProvider({ provider: 'openai', model: 'other-model', apiKey: 'other-key' });
		assert.equal(getProviderId(), 'anthropic');
		assert.equal(getModelId('openai'), 'other-model');
		assert.equal(secureStore.activateProvider('openai'), true);
		assert.equal(getProviderId(), 'openai');
		assert.equal(getModelId(), 'other-model');
		assert.equal(getModelId('anthropic'), 'secure-model');
		assert.equal(getResolvedProvider('anthropic')?.apiKey, 'secure-key');
		assert.equal(getResolvedProvider('openai')?.apiKey, 'other-key');
		assert.equal(secureStore.deleteProvider(), true);
		assert.equal(getProviderId(), undefined);
		assert.equal(getModelId(), undefined);
		assert.equal(getResolvedProvider('openai'), undefined);
		assert.equal(providerBaseUrl('anthropic'), 'https://api.anthropic.com');
		assert.equal(providerBaseUrl('openai'), 'https://api.openai.com/v1');
		assert.equal(providerBaseUrl('deepseek'), 'https://api.deepseek.com');
	} finally {
		for (const [name, value] of [
			['KUCEDR_CLOUD_DATA_DIR', previous.dataDirectory],
			['KUCEDR_CLOUD_ENCRYPTION_KEY', previous.configurationKey],
		] as const) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
