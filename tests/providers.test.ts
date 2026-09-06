import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createConfigurationServer } from '../src/main/config/server';
import { ConfigurationStore } from '../src/main/config/store';
import { seal } from '../src/main/config/seal';
import { OAuthIssuer } from '../src/main/oauth/issuer';

test('saved providers retain independent encrypted settings and an explicit active selection', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-providers-'));
	const key = Buffer.alloc(32, 31);
	const origin = 'http://127.0.0.1:3001';
	let store = new ConfigurationStore(directory, key);
	const file = path.join(directory, 'secure-config.json');
	const document = JSON.parse(fs.readFileSync(file, 'utf8'));
	const original = { provider: 'openai', model: 'openai-model', apiKey: 'openai-secret-sentinel' };
	document.provider = seal(original, key, 'provider');
	fs.writeFileSync(file, JSON.stringify(document));
	const beforeRead = fs.readFileSync(file, 'utf8');
	store = new ConfigurationStore(directory, key);
	assert.deepEqual(store.provider(), original);
	assert.equal(store.providers().configurations.length, 1);
	assert.equal(fs.readFileSync(file, 'utf8'), beforeRead);
	let server = createConfigurationServer(
		store,
		origin,
		new OAuthIssuer(store, 'https://agent.example')
	);
	server.log.level = 'silent';
	try {
		const registration = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin },
			payload: { username: 'operator', password: 'correct horse battery staple' },
		});
		assert.equal(registration.statusCode, 201);
		const cookie = String(registration.headers['set-cookie']).split(';')[0];
		const headers = { cookie, origin, 'x-kucedr-cloud-csrf': registration.json().csrfToken };
		for (const provider of ['anthropic', 'deepseek']) {
			const response = await server.inject({
				method: 'PUT',
				url: '/config/provider',
				headers,
				payload: { provider, model: `${provider}-model`, apiKey: `${provider}-secret-sentinel` },
			});
			assert.equal(response.statusCode, 200);
			assert.equal(response.json().provider, provider);
			assert.equal(response.body.includes('secret-sentinel'), false);
		}
		assert.equal(store.provider()?.provider, 'openai');
		assert.equal(store.providers().configurations.length, 3);
		const updated = await server.inject({
			method: 'PUT',
			url: '/config/provider',
			headers,
			payload: { provider: 'anthropic', model: 'anthropic-updated' },
		});
		assert.equal(updated.statusCode, 200);
		assert.equal(store.provider('anthropic')?.apiKey, 'anthropic-secret-sentinel');
		assert.equal(store.provider('openai')?.apiKey, original.apiKey);
		assert.equal(store.provider('deepseek')?.apiKey, 'deepseek-secret-sentinel');
		const blankKey = await server.inject({
			method: 'PUT',
			url: '/config/provider',
			headers,
			payload: { provider: 'anthropic', model: 'anthropic-updated', apiKey: '   ' },
		});
		assert.equal(blankKey.statusCode, 200);
		assert.equal(store.provider('anthropic')?.apiKey, 'anthropic-secret-sentinel');
		const noCsrf = await server.inject({
			method: 'PUT',
			url: '/config/provider/active',
			headers: { cookie, origin },
			payload: { provider: 'anthropic' },
		});
		assert.equal(noCsrf.statusCode, 403);
		const activation = await server.inject({
			method: 'PUT',
			url: '/config/provider/active',
			headers,
			payload: { provider: 'anthropic' },
		});
		assert.equal(activation.statusCode, 200);
		assert.equal(store.provider()?.model, 'anthropic-updated');
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider/active',
					headers,
					payload: { provider: 'unknown' },
				})
			).statusCode,
			400
		);
		assert.equal(
			(await server.inject({ method: 'DELETE', url: '/config/provider/unknown', headers }))
				.statusCode,
			400
		);
		await server.close();
		store = new ConfigurationStore(directory, key);
		server = createConfigurationServer(
			store,
			origin,
			new OAuthIssuer(store, 'https://agent.example')
		);
		server.log.level = 'silent';
		const persisted = await server.inject({ method: 'GET', url: '/config/api', headers });
		assert.equal(persisted.statusCode, 200);
		assert.equal(persisted.json().provider.provider, 'anthropic');
		assert.equal(persisted.json().providers.length, 3);
		assert.equal(
			persisted.json().providers.filter((provider: { active: boolean }) => provider.active).length,
			1
		);
		assert.equal(persisted.body.includes('apiKey'), false);
		assert.equal(persisted.body.includes('secret-sentinel'), false);
		assert.equal(fs.readFileSync(file, 'utf8').includes('secret-sentinel'), false);
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		const unauthorizedDelete = await server.inject({
			method: 'DELETE',
			url: '/config/provider/deepseek',
			headers: { origin },
		});
		assert.equal(unauthorizedDelete.statusCode, 401);
		const inactiveDelete = await server.inject({
			method: 'DELETE',
			url: '/config/provider/deepseek',
			headers,
		});
		assert.equal(inactiveDelete.statusCode, 200);
		assert.equal(store.provider()?.provider, 'anthropic');
		assert.equal(store.providers().configurations.length, 2);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider/active',
					headers,
					payload: { provider: 'deepseek' },
				})
			).statusCode,
			404
		);
		await server.inject({ method: 'DELETE', url: '/config/provider/anthropic', headers });
		assert.equal(store.provider(), undefined);
		assert.equal(store.providers().configurations.length, 1);
		assert.equal(store.publicConfiguration().provider.configured, false);
		await server.inject({
			method: 'PUT',
			url: '/config/provider',
			headers,
			payload: { provider: 'openai', model: 'openai-updated' },
		});
		assert.equal(store.provider(), undefined);
		assert.equal(store.provider('openai')?.apiKey, original.apiKey);
		await server.inject({
			method: 'PUT',
			url: '/config/provider/active',
			headers,
			payload: { provider: 'openai' },
		});
		assert.equal(store.provider()?.model, 'openai-updated');
		await server.inject({ method: 'DELETE', url: '/config/provider/openai', headers });
		assert.equal(store.providers().configurations.length, 0);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers,
					payload: { provider: 'deepseek', model: 'new-model' },
				})
			).statusCode,
			400
		);
		await server.inject({
			method: 'PUT',
			url: '/config/provider',
			headers,
			payload: { provider: 'deepseek', model: 'new-model', apiKey: 'new-key-sentinel' },
		});
		assert.equal(store.provider()?.provider, 'deepseek');
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
