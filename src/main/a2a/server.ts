import Fastify, { type FastifyInstance } from 'fastify';
import { userDataLocation } from '../shared/user_data_location';
import { ConfigurationStore } from '../config/store';
import { registerConfigurationAuthenticationRoutes } from '../config/auth_routes';
import { registerConfigurationRoutes } from '../config/routes';
import { registerConfigurationUiRoutes } from '../config/ui';
import { OAuthIssuer } from '../oauth/issuer';
import { RequestLimiter } from '../oauth/limit';
import { registerOAuthRoutes } from '../oauth/routes';
import type { AgentPort } from './executor';
import { registerA2aRoutes } from './routes';
import { resolveSecureA2aConfig } from './secure_config';

interface A2aServerOptions {
	adminToken?: string | null;
	configurationKey?: string | null;
	dataDirectory?: string;
	publicUrl?: string | null;
}

export async function createA2aServer(
	agent: AgentPort,
	options: A2aServerOptions = {}
): Promise<FastifyInstance> {
	const config = resolveSecureA2aConfig({
		adminToken: options.adminToken,
		configurationKey: options.configurationKey,
		dataDirectory: options.dataDirectory ?? userDataLocation(),
		publicUrl: options.publicUrl,
	});
	const server = Fastify({
		bodyLimit: 100 * 1024,
		logger: {
			redact: [
				'req.headers.authorization',
				'req.headers.cookie',
				'req.headers.x-kucedr-cloud-csrf',
				'req.body.apiKey',
				'req.body.client_assertion',
				'req.body.password',
				'req.body.setupToken',
			],
		},
	});
	const store = new ConfigurationStore(config.dataDirectory, config.encryptionKey);
	const issuer = new OAuthIssuer(store, config.publicUrl);
	const limiter = new RequestLimiter();
	registerOAuthRoutes(server, issuer);
	registerConfigurationAuthenticationRoutes(
		server,
		store,
		config.adminToken,
		config.publicUrl,
		limiter
	);
	registerConfigurationUiRoutes(
		server,
		store,
		config.publicUrl,
		issuer,
		limiter
	);
	registerConfigurationRoutes(server, store, config.publicUrl, limiter);
	await registerA2aRoutes(
		server,
		agent,
		{
			token: '',
			publicUrl: config.publicUrl,
			tasksDirectory: config.tasksDirectory,
			workspaceDirectory: config.workspaceDirectory,
		},
		issuer
	);
	return server;
}
