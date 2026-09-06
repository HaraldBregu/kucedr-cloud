import type { FastifyInstance } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import { normalizeProvider } from '../provider/normalize';
import { createConfigurationAuthentication } from './auth';
import { normalizePublicKey } from './jwk';
import type { ConfigurationStore } from './store';

interface ProviderBody {
	apiKey?: string;
	model: string;
	provider: string;
}

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
	server.put<{ Body: ProviderBody }>(
		'/config/provider',
		{
			...options,
			schema: {
				body: {
					type: 'object',
					required: ['provider', 'model'],
					additionalProperties: false,
					properties: {
						provider: { type: 'string', minLength: 1, maxLength: 50 },
						model: { type: 'string', minLength: 1, maxLength: 200 },
						apiKey: { type: 'string', minLength: 1, maxLength: 4096 },
					},
				},
			},
		},
		async (request, reply) => {
			if (!store.administrator()) {
				return reply.code(409).send({ error: 'Administrator registration is required.' });
			}
			const existing = store.provider();
			const provider = normalizeProvider(request.body.provider);
			const apiKey = request.body.apiKey?.trim();
			const model = request.body.model.trim();
			if (!provider) {
				return reply.code(400).send({ error: 'Provider must be OpenAI, Anthropic, or DeepSeek.' });
			}
			if (!model) return reply.code(400).send({ error: 'A model is required.' });
			if (!apiKey && (!existing || existing.provider !== provider)) {
				return reply.code(400).send({ error: 'An API key is required for this provider.' });
			}
			store.setProvider({
				provider,
				model,
				apiKey: apiKey ?? existing?.apiKey ?? '',
			});
			request.log.info({ event: 'config.provider.updated', provider });
			return reply.header('cache-control', 'no-store').send(store.publicConfiguration().provider);
		}
	);
	server.delete('/config/provider', options, async (request, reply) => {
		const deleted = store.deleteProvider();
		request.log.info({ event: 'config.provider.deleted', deleted });
		return reply.header('cache-control', 'no-store').send({ deleted });
	});
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
