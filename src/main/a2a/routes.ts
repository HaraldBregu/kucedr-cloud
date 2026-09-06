import fastifyExpress from '@fastify/express';
import { AgentCard as A2aAgentCard } from '@a2a-js/sdk';
import { DefaultRequestHandler } from '@a2a-js/sdk/server';
import { restHandler } from '@a2a-js/sdk/server/express';
import { Router } from 'express';
import type { FastifyInstance } from 'fastify';
import { createBearerAuthentication } from './auth';
import { rejectUnsupportedCapabilities } from './capabilities';
import { createAgentCard } from './card';
import type { A2aConfig } from './config';
import { KucedrCloudExecutor, type AgentPort } from './executor';
import { includeListResponseFields } from './list';
import { createTaskStore } from './store';
import type { OAuthIssuer } from '../oauth/issuer';
import { RequestIdentity } from '../oauth/identity';
import { RequestLimiter } from '../oauth/limit';
import { createOAuthAuthentication } from '../oauth/auth';
import { createTokenRouter } from '../oauth/token';

export async function registerA2aRoutes(
	server: FastifyInstance,
	agent: AgentPort,
	config: A2aConfig,
	issuer?: OAuthIssuer
): Promise<void> {
	await server.register(fastifyExpress);
	const card = createAgentCard(
		config.publicUrl,
		issuer
			? {
					metadataUrl: issuer.metadataUrl,
					tokenEndpoint: issuer.tokenEndpoint,
					scope: issuer.scope,
				}
			: undefined
	);
	const taskStore = await createTaskStore(config.tasksDirectory);
	const handler = new DefaultRequestHandler(
		card,
		taskStore,
		new KucedrCloudExecutor(agent, config.workspaceDirectory)
	);

	server.get('/.well-known/agent-card.json', async (_request, reply) => {
		return reply.header('cache-control', 'public, max-age=300').send(A2aAgentCard.toJSON(card));
	});

	const router = Router();
	const identity = new RequestIdentity();
	const limiter = new RequestLimiter();
	if (issuer) router.use(createTokenRouter(issuer, limiter));
	router.use(
		issuer
			? createOAuthAuthentication(issuer, identity, limiter)
			: createBearerAuthentication(config.token, identity)
	);
	router.use((_request, response, next) => {
		response.setHeader('Cache-Control', 'no-store');
		next();
	});
	router.use(rejectUnsupportedCapabilities());
	router.use(includeListResponseFields());
	router.use(
		restHandler({
			requestHandler: handler,
			userBuilder: identity.user,
		})
	);
	server.use('/a2a', router);
}
