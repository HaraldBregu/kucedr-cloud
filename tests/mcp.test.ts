import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { McpManager } from '../src/main/agent/core/mcp';
import { readMcp } from '../src/main/mcp/read';
import type { McpDocument, McpServer } from '../src/main/mcp/types';
import { writeMcp } from '../src/main/mcp/write';
import { createApiServer } from '../src/main/server';

const document: McpDocument = {
	servers: [
		{
			id: 'tavily',
			transport: 'http',
			url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=test-key',
			enabled: true,
		},
		{
			id: 'local',
			transport: 'stdio',
			command: 'node',
			args: ['server.js'],
			enabled: false,
		},
	],
};

test('MCP store persists HTTP and stdio configuration securely', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-mcp-store-'));
	try {
		writeMcp(directory, document);
		assert.deepEqual(readMcp(directory), document);
		assert.equal(fs.statSync(path.join(directory, 'mcp.json')).mode & 0o777, 0o600);
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('MCP manager ignores disabled manual servers', async () => {
	const manager = new McpManager();
	manager.configure([document.servers[1] as McpServer]);
	try {
		assert.deepEqual(await manager.tools(), []);
		assert.deepEqual(manager.errors, []);
	} finally {
		await manager.close();
	}
});

test('authenticated MCP API replaces the complete manual document', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-mcp-api-'));
	let configured: McpServer[] = [];
	const server = await createApiServer(
		{
			async send() {
				return '';
			},
			cancel() {
				return true;
			},
			configureMcp(servers) {
				configured = servers;
			},
		},
		{ dataDirectory: directory, storageApiToken: 'mcp-token' }
	);
	server.log.level = 'silent';
	const headers = { authorization: 'Bearer mcp-token' };
	try {
		assert.equal((await server.inject({ method: 'GET', url: '/mcp' })).statusCode, 401);
		const saved = await server.inject({ method: 'PUT', url: '/mcp', headers, payload: document });
		assert.equal(saved.statusCode, 200);
		assert.deepEqual(configured, document.servers);
		assert.deepEqual(
			(await server.inject({ method: 'GET', url: '/mcp', headers })).json(),
			document
		);
		await server.inject({ method: 'PUT', url: '/mcp', headers, payload: { servers: [] } });
		assert.deepEqual(configured, []);
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
