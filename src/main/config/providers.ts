import type { FastifyInstance, onRequestHookHandler } from 'fastify';
import { normalizeProvider } from '../provider/normalize';
import { publicProvider } from '../provider/public';
import { PROVIDERS, type ProviderId } from '../provider/types';
import type { ConfigurationStore } from './store';

interface ProviderBody {
	apiKey?: string;
	model: string;
	provider: string;
}

export function registerProviderConfigurationRoutes(
	server: FastifyInstance,
	store: ConfigurationStore,
	authenticate: onRequestHookHandler
): void {
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
			const provider = normalizeProvider(request.body.provider);
			const apiKey = request.body.apiKey?.trim();
			const model = request.body.model.trim();
			if (!provider) {
				return reply.code(400).send({ error: 'Provider must be OpenAI, Anthropic, or DeepSeek.' });
			}
			const existing = store.provider(provider);
			if (!model) return reply.code(400).send({ error: 'A model is required.' });
			if (!apiKey && !existing) {
				return reply.code(400).send({ error: 'An API key is required for this provider.' });
			}
			store.setProvider({
				provider,
				model,
				apiKey: apiKey || existing?.apiKey || '',
			});
			request.log.info({ event: 'config.provider.updated', provider });
			return reply
				.header('cache-control', 'no-store')
				.send(publicProvider(store.provider(provider)));
		}
	);
	server.put<{ Body: { provider: ProviderId } }>(
		'/config/provider/active',
		{
			...options,
			schema: {
				body: {
					type: 'object',
					required: ['provider'],
					additionalProperties: false,
					properties: { provider: { type: 'string', enum: PROVIDERS } },
				},
			},
		},
		async (request, reply) => {
			if (!store.activateProvider(request.body.provider)) {
				return reply.code(404).send({ error: 'Save this provider before activating it.' });
			}
			request.log.info({ event: 'config.provider.activated', provider: request.body.provider });
			return reply.header('cache-control', 'no-store').send(store.publicConfiguration().provider);
		}
	);
	for (const route of ['/config/provider', '/config/provider/:provider']) {
		server.delete<{ Params: { provider?: ProviderId } }>(
			route,
			{
				...options,
				schema: {
					params: { type: 'object', properties: { provider: { type: 'string', enum: PROVIDERS } } },
				},
			},
			async (request, reply) => {
				const deleted = store.deleteProvider(request.params.provider);
				request.log.info({
					event: 'config.provider.deleted',
					provider: request.params.provider,
					deleted,
				});
				return reply.header('cache-control', 'no-store').send({ deleted });
			}
		);
	}
}
