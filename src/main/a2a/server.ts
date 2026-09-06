import type { OAuthIssuer } from '../oauth/issuer';
import { registerOAuthRoutes } from '../oauth/routes';
import { createHttpServer } from '../shared/http';
import type { A2aConfig } from './config';
import type { AgentPort } from './executor';
import { registerA2aRoutes } from './routes';

export async function createA2aServer(agent: AgentPort, config: A2aConfig, issuer: OAuthIssuer) {
	const server = createHttpServer();
	registerOAuthRoutes(server, issuer);
	await registerA2aRoutes(server, agent, config, issuer);
	return server;
}
