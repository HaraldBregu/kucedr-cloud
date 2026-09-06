import { Agent } from './agent/agent';
import { createA2aServer } from './a2a/server';

const agent = new Agent({ mcpEnabled: false });
const server = await createA2aServer(agent);

await server.listen({
	port: Number(process.env.KUCEDR_CLOUD_PORT ?? 3000),
	host: process.env.KUCEDR_CLOUD_LISTEN_ADDRESS?.trim() || '127.0.0.1',
});

const shutdown = async (): Promise<void> => {
	agent.destroy();
	await server.close();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
