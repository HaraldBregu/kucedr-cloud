import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAccessRoutes } from './access/routes';
import { createAdminAuthentication } from './admin/authenticate';
import type { AgentSendOptions } from './agent/agent';
import { resolveA2aConfig } from './a2a/config';
import { registerA2aRoutes } from './a2a/routes';
import type { AgentPort } from './a2a/executor';
import { registerProviderRoutes } from './provider/routes';
import { registerMcpRoutes } from './mcp/routes';
import type { AgentResponseEvent } from './shared/agent_types';
import { userDataLocation } from './shared/user_data_location';
import { registerStorageRoutes } from './storage/routes';
import { registerUiRoutes } from './ui';

interface AgentRequest {
	message: string;
	sessionId?: string;
}

interface ServerOptions {
	accessControl?: boolean;
	agentToken?: string | null;
	dataDirectory?: string;
	publicUrl?: string | null;
	storageApiToken?: string | null;
}

export async function createApiServer(
	agent: AgentPort,
	options: ServerOptions = {}
): Promise<FastifyInstance> {
	const server = Fastify({ logger: { redact: ['req.headers.authorization'] } });
	const dataDirectory = options.dataDirectory ?? userDataLocation();
	const a2aConfig = resolveA2aConfig({
		dataDirectory,
		token: options.agentToken,
		publicUrl: options.publicUrl,
	});
	const adminToken = options.storageApiToken?.trim();
	const accessControl = options.accessControl ?? options.storageApiToken !== null;
	const adminAuthentication = createAdminAuthentication(dataDirectory, adminToken);
	if (a2aConfig) await registerA2aRoutes(server, agent, a2aConfig);

	registerUiRoutes(server, { accessControl, adminToken, dataDirectory });
	server.get('/health', async () => ({ status: 'ok' }));
	if (accessControl) registerAccessRoutes(server, dataDirectory, adminToken);
	if (accessControl || adminToken) {
		registerStorageRoutes(server, dataDirectory, adminAuthentication);
		registerProviderRoutes(server, dataDirectory, adminAuthentication);
		registerMcpRoutes(server, dataDirectory, adminAuthentication, agent);
	}

	server.post<{ Body: AgentRequest }>(
		'/agents/messages',
		{
			...(accessControl || adminToken ? { onRequest: adminAuthentication } : {}),
			schema: {
				body: {
					type: 'object',
					required: ['message'],
					additionalProperties: false,
					properties: {
						message: { type: 'string', minLength: 1 },
						sessionId: { type: 'string', minLength: 1 },
					},
				},
			},
		},
		async (request, reply) => {
			const runId = randomUUID();
			let completed = false;

			request.raw.once('aborted', () => {
				if (!completed) agent.cancel(runId);
			});
			reply.raw.once('close', () => {
				if (!completed && !reply.raw.writableEnded) agent.cancel(runId);
			});

			reply.hijack();
			reply.raw.writeHead(200, {
				'cache-control': 'no-cache, no-transform',
				'content-type': 'application/x-ndjson; charset=utf-8',
				'x-accel-buffering': 'no',
			});
			reply.raw.flushHeaders();

			const write = (event: AgentResponseEvent | { type: 'error'; message: string }): void => {
				if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(event)}\n`);
			};

			try {
				await agent.send(request.body.message, 'main', {
					type: 'default',
					runId,
					...(request.body.sessionId ? { sessionId: request.body.sessionId } : {}),
					streaming: true,
					contextMode: 'workspace',
					interactionMode: 'default',
					streamEvent: write,
				});
			} catch (error) {
				write({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			} finally {
				completed = true;
				reply.raw.end();
			}
		}
	);

	return server;
}
