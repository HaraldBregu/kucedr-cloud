import type { FastifyInstance } from 'fastify';
import { isAdminAuthenticated } from '../admin/authenticated';
import { clearAccessSessionHeader } from './clear';
import { accessSessionHeader } from './header';
import { readAccess } from './read';
import { createAccessSession } from './session';
import { verifyAccessKey } from './verify';
import { writeAccess } from './write';

interface AccessBody {
	accessKey: string;
}

export function registerAccessRoutes(
	server: FastifyInstance,
	dataDirectory: string,
	adminToken?: string
): void {
	server.get('/access/status', async (request, reply) => {
		reply.header('cache-control', 'no-store');
		return {
			configured: Boolean(readAccess(dataDirectory)),
			authenticated: isAdminAuthenticated(request, dataDirectory, adminToken),
		};
	});
	server.post<{ Body: AccessBody }>(
		'/access/session',
		{
			schema: {
				body: {
					type: 'object',
					required: ['accessKey'],
					additionalProperties: false,
					properties: {
						accessKey: {
							type: 'string',
							pattern: '^kucedr-cloud_[A-Za-z0-9_-]{43}$',
						},
					},
				},
			},
		},
		async (request, reply) => {
			const existing = readAccess(dataDirectory);
			if (!existing) writeAccess(dataDirectory, request.body.accessKey);
			else if (!verifyAccessKey(dataDirectory, request.body.accessKey)) {
				return reply.code(401).send({ error: 'Invalid access key.' });
			}
			const secure = request.protocol === 'https';
			return reply
				.header('cache-control', 'no-store')
				.header('set-cookie', accessSessionHeader(createAccessSession(dataDirectory), secure))
				.code(204)
				.send();
		}
	);
	server.delete('/access/session', async (request, reply) => {
		return reply
			.header('cache-control', 'no-store')
			.header('set-cookie', clearAccessSessionHeader(request.protocol === 'https'))
			.code(204)
			.send();
	});
}
