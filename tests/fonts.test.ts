import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerFontRoutes } from '../src/main/fonts';

test('UI fonts are served locally and unknown assets are not exposed', async () => {
	const server = Fastify();
	registerFontRoutes(server);
	try {
		for (const name of ['archivo', 'inter', 'inter-semibold', 'space-mono', 'space-mono-bold']) {
			const response = await server.inject(`/ui/fonts/${name}.ttf`);
			assert.equal(response.statusCode, 200);
			assert.equal(response.headers['content-type'], 'font/ttf');
			assert.equal(response.headers['x-content-type-options'], 'nosniff');
			assert.equal(response.rawPayload.readUInt32BE(0), 0x00010000);
		}
		assert.equal((await server.inject('/ui/fonts/missing.ttf')).statusCode, 404);
	} finally {
		await server.close();
	}
});
