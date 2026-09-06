import type { OAuthIssuer } from '../oauth/issuer';
import { RequestLimiter } from '../oauth/limit';
import { createHttpServer } from '../shared/http';
import { registerConfigurationAuthenticationRoutes } from './auth_routes';
import { registerConfigurationRoutes } from './routes';
import { registerConfigurationUiRoutes } from './ui';
import type { ConfigurationStore } from './store';

export function createConfigurationServer(
	store: ConfigurationStore,
	appUrl: string,
	issuer: OAuthIssuer
) {
	const server = createHttpServer();
	const limiter = new RequestLimiter();
	registerConfigurationAuthenticationRoutes(server, store, appUrl, limiter);
	registerConfigurationUiRoutes(server, store, appUrl, issuer, limiter);
	registerConfigurationRoutes(server, store, appUrl, limiter);
	return server;
}
