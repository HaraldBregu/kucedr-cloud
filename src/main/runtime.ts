import type { AgentPort } from './a2a/executor';
import { createA2aServer } from './a2a/server';
import { resolveSecureA2aConfig } from './a2a/secure_config';
import { createConfigurationServer } from './config/server';
import { ConfigurationStore } from './config/store';
import { OAuthIssuer } from './oauth/issuer';
import { userDataLocation } from './shared/user_data_location';

interface ServerOptions {
	adminToken?: string | null;
	appUrl?: string | null;
	configurationKey?: string | null;
	dataDirectory?: string;
	publicUrl?: string | null;
}

export async function createServers(agent: AgentPort, options: ServerOptions = {}) {
	const config = resolveSecureA2aConfig({
		...options,
		dataDirectory: options.dataDirectory ?? userDataLocation(),
	});
	const store = new ConfigurationStore(config.dataDirectory, config.encryptionKey);
	const issuer = new OAuthIssuer(store, config.publicUrl);
	const application = createConfigurationServer(store, config.adminToken, config.appUrl, issuer);
	const a2a = await createA2aServer(
		agent,
		{
			token: '',
			publicUrl: config.publicUrl,
			tasksDirectory: config.tasksDirectory,
			workspaceDirectory: config.workspaceDirectory,
		},
		issuer
	);
	return { application, a2a };
}
