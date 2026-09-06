import { Agent } from './agent/agent';
import { createServers } from './runtime';

const agent = new Agent({ mcpEnabled: false });
const { application, a2a } = await createServers(agent);

try {
	await application.listen({
		port: Number(process.env.KUCEDR_CLOUD_APP_PORT ?? 3001),
		host: process.env.KUCEDR_CLOUD_APP_LISTEN_ADDRESS?.trim() || '127.0.0.1',
	});
	await a2a.listen({
		port: Number(process.env.KUCEDR_CLOUD_PORT ?? 3000),
		host: process.env.KUCEDR_CLOUD_LISTEN_ADDRESS?.trim() || '127.0.0.1',
	});
} catch (error) {
	agent.destroy();
	await Promise.all([application.close(), a2a.close()]);
	throw error;
}

const shutdown = async (): Promise<void> => {
	agent.destroy();
	await Promise.all([application.close(), a2a.close()]);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
