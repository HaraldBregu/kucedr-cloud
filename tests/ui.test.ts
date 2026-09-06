import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { createAdminAuthentication } from '../src/main/admin/authenticate';
import { registerStorageRoutes } from '../src/main/storage/routes';
import { PersistenceMarker } from '../src/ui/marker.js';
import { runSuite } from '../src/ui/suite.js';

test('UI workflows exercise storage safely and restore existing data', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-ui-'));
	const server = Fastify();
	registerStorageRoutes(server, directory, createAdminAuthentication(directory, 'ui-test-token'));
	const api = {
		async request(
			endpoint: string,
			options: { method?: string; body?: unknown } = {}
		): Promise<any> {
			const response = await server.inject({
				method: options.method ?? 'GET',
				url: endpoint,
				headers: { authorization: 'Bearer ui-test-token' },
				...(options.body === undefined ? {} : { payload: options.body }),
			});
			const data = response.json();
			if (response.statusCode >= 400) {
				throw Object.assign(new Error(data.message ?? data.error), { status: response.statusCode });
			}
			return data;
		},
	};

	try {
		await api.request('/settings', {
			method: 'PUT',
			body: { settings: { theme: 'dark', preserved: true } },
		});
		const steps = new Map<string, string>();
		let suiteResult = '';
		const passed = await runSuite(api, {
			reset() {
				steps.clear();
			},
			step(name: string, state: string) {
				steps.set(name, state);
			},
			result(state: string) {
				suiteResult = state;
			},
		});
		assert.equal(passed, true);
		assert.equal(suiteResult, 'passed');
		assert.deepEqual([...steps.values()], Array(6).fill('passed'));
		assert.deepEqual(await api.request('/settings'), {
			exists: true,
			settings: { theme: 'dark', preserved: true },
		});
		assert.deepEqual(await api.request('/files'), { files: [] });

		const marker = new PersistenceMarker(api);
		const prepared = await marker.prepare();
		const verified = await marker.verify();
		assert.equal(verified.id, prepared.id);
		assert.equal((await api.request('/settings')).settings._kucedrCloudVolumeTest.id, prepared.id);
		assert.equal((await api.request('/files')).files[0].path, prepared.filePath);

		const cleaned = await marker.cleanup();
		assert.equal(cleaned.id, prepared.id);
		assert.deepEqual(await api.request('/settings'), {
			exists: true,
			settings: { theme: 'dark', preserved: true },
		});
		assert.deepEqual(await api.request('/files'), { files: [] });
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
