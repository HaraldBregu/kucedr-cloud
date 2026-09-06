import type { FastifyReply, FastifyRequest } from 'fastify';

export function createApplicationAuthentication(publicUrl: string) {
	return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
		reply.header('cache-control', 'no-store');
		if (request.headers.authorization !== undefined) {
			return reply.code(401).send({ error: 'Use the application session.' });
		}
		const origin = request.headers.origin;
		const site = request.headers['sec-fetch-site'];
		const read = ['GET', 'HEAD'].includes(request.method);
		if (
			(origin !== undefined && origin !== publicUrl) ||
			(site !== undefined && site !== 'same-origin') ||
			(read ? origin !== publicUrl && site !== 'same-origin' : origin !== publicUrl)
		) {
			return reply.code(403).send({ error: 'Use the application on its configured origin.' });
		}
	};
}
