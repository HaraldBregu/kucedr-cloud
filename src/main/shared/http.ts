import Fastify from 'fastify';

export function createHttpServer() {
	return Fastify({
		bodyLimit: 100 * 1024,
		logger: {
			redact: [
				'req.headers.authorization',
				'req.headers.cookie',
				'req.headers.x-kucedr-cloud-csrf',
				'req.body.apiKey',
				'req.body.client_assertion',
				'req.body.password',
			],
		},
	});
}
