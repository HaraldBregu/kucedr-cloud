import type { FastifyInstance } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import { createConfigurationAuthentication } from './auth';
import { normalizePublicKey } from './jwk';
import { registerProviderConfigurationRoutes } from './providers';
import type { ConfigurationStore } from './store';

interface ClientBody {
	name: string;
	publicKeyJwk: unknown;
}

export function registerConfigurationRoutes(
	server: FastifyInstance,
	store: ConfigurationStore,
	publicUrl: string,
	limiter: RequestLimiter
): void {
	const authenticate = createConfigurationAuthentication(store, publicUrl, limiter);
	const options = { onRequest: authenticate };
	registerProviderConfigurationRoutes(server, store, authenticate);
	server.post<{ Body: ClientBody }>(
		'/config/clients',
		{
			...options,
			schema: {
				body: {
					type: 'object',
					required: ['name', 'publicKeyJwk'],
					additionalProperties: false,
					properties: {
						name: { type: 'string', minLength: 1, maxLength: 100 },
						publicKeyJwk: { type: 'object', additionalProperties: true },
					},
				},
			},
		},
		async (request, reply) => {
			const name = request.body.name.trim();
			if (!name) return reply.code(400).send({ error: 'A client name is required.' });
			try {
				const normalized = await normalizePublicKey(request.body.publicKeyJwk);
				const client = store.addClient(name, normalized.key, normalized.thumbprint);
				request.log.info({ event: 'config.client.created', clientId: client.clientId });
				const { publicKey: _publicKey, ...result } = client;
				return reply.code(201).header('cache-control', 'no-store').send(result);
			} catch {
				return reply.code(400).send({ error: 'publicKeyJwk must be an Ed25519 public JWK.' });
			}
		}
	);
	server.delete<{ Params: { clientId: string } }>(
		'/config/clients/:clientId',
		{
			...options,
			schema: {
				params: {
					type: 'object',
					required: ['clientId'],
					properties: { clientId: { type: 'string', format: 'uuid' } },
				},
			},
		},
		async (request, reply) => {
			const deleted = store.deleteClient(request.params.clientId);
			request.log.info({
				event: 'config.client.deleted',
				clientId: request.params.clientId,
				deleted,
			});
			return reply.header('cache-control', 'no-store').send({ deleted });
		}
	);
}
