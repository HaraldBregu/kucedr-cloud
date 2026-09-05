import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';

export function registerFontRoutes(server: FastifyInstance): void {
	for (const name of [
		'archivo',
		'inter',
		'inter-medium',
		'inter-semibold',
		'space-mono',
		'space-mono-bold',
	]) {
		const font = fs.readFileSync(new URL(`../ui/fonts/${name}.ttf`, import.meta.url));
		server.get(`/ui/fonts/${name}.ttf`, async (_request, reply) =>
			reply
				.header('cache-control', 'public, max-age=86400')
				.header('x-content-type-options', 'nosniff')
				.type('font/ttf')
				.send(font)
		);
	}
}
