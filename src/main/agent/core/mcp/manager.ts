import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServer } from '../../../mcp/types';
import type { Tool } from '../../types';
import { mcpResult } from './result';

export class McpManager {
	private clients: Client[] = [];
	private servers: McpServer[] = [];
	private loading?: Promise<Tool[]>;
	private resetting: Promise<void> = Promise.resolve();
	readonly errors: Error[] = [];

	configure(servers: McpServer[]): void {
		if (JSON.stringify(servers) === JSON.stringify(this.servers)) return;
		this.resetting = this.close();
		this.servers = structuredClone(servers);
		this.loading = undefined;
		this.errors.length = 0;
	}

	async tools(): Promise<Tool[]> {
		await this.resetting;
		this.loading ??= this.load();
		return this.loading;
	}

	async close(): Promise<void> {
		await Promise.allSettled(this.clients.map((client) => client.close()));
		this.clients = [];
	}

	private async load(): Promise<Tool[]> {
		const groups = await Promise.all(
			this.servers
				.filter((server) => server.enabled)
				.map((server) =>
					this.connect(server).catch((error) => {
						this.errors.push(error instanceof Error ? error : new Error(String(error)));
						return [];
					})
				)
		);
		return groups.flat();
	}

	private async connect(server: McpServer): Promise<Tool[]> {
		const client = new Client({ name: 'kucedr-cloud', version: '1.0.2' });
		const transport =
			server.transport === 'stdio'
				? new StdioClientTransport({
						command: server.command,
						args: server.args,
						stderr: 'pipe',
					})
				: new StreamableHTTPClientTransport(new URL(server.url), {
						...(server.headers ? { requestInit: { headers: server.headers } } : {}),
					});
		await client.connect(transport);
		this.clients.push(client);
		const { tools } = await client.listTools();
		return tools.map((candidate): Tool => ({
			id: `mcp__${server.id}__${candidate.name}`,
			name: candidate.annotations?.title ?? candidate.name,
			description: candidate.description ?? `MCP tool ${candidate.name}`,
			schema: candidate.inputSchema,
			parseInput(input: unknown): Record<string, unknown> {
				if (!input || typeof input !== 'object' || Array.isArray(input)) {
					throw new Error('MCP tool input must be an object.');
				}
				return input as Record<string, unknown>;
			},
			async run(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
				const result = await client.callTool(
					{ name: candidate.name, arguments: input },
					undefined,
					{ signal, timeout: 120_000 }
				);
				return mcpResult(result);
			},
		}));
	}
}
