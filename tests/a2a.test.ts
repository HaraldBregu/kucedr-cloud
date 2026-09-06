import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import {
	Role,
	TaskState,
	type ListTasksRequest,
	type Message,
	type Part,
	type SendMessageRequest,
} from '@a2a-js/sdk';
import { RequestMalformedError } from '@a2a-js/sdk/errors';
import {
	DefaultExecutionEventBus,
	DefaultRequestHandler,
	RequestContext,
	ServerCallContext,
	type AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import { resolveA2aConfig } from '../src/main/a2a/config';
import { KucedrCloudExecutor, type AgentPort } from '../src/main/a2a/executor';
import { createAgentCard } from '../src/main/a2a/card';
import { createServers } from '../src/main/runtime';
import { createTaskStore } from '../src/main/a2a/store';
import type { AgentSendOptions } from '../src/main/agent/agent';
import type { AgentResponseEvent, AgentRunStopReason } from '../src/main/shared/agent_types';
import { createApiServer } from '../src/main/server';
import { ConfigurationStore } from '../src/main/config/store';
import { OAuthError } from '../src/main/oauth/error';
import { OAuthIssuer } from '../src/main/oauth/issuer';
import { registerOAuthRoutes } from '../src/main/oauth/routes';

const AGENT_TOKEN = 'agent-token-123456789012345678901';
const ADMIN_TOKEN = 'admin-token-for-tests-1234567890123456';
const CONFIGURATION_KEY = '11'.repeat(32);
const A2A_HEADERS = {
	authorization: `Bearer ${AGENT_TOKEN}`,
	'a2a-version': '1.0',
};

test('A2A configuration is disabled or validates paired secure settings', async () => {
	const directory = path.join(os.tmpdir(), 'kucedr-cloud-a2a-config');
	assert.equal(
		resolveA2aConfig({ dataDirectory: directory, token: null, publicUrl: null }),
		undefined
	);
	assert.throws(
		() => resolveA2aConfig({ dataDirectory: directory, token: AGENT_TOKEN, publicUrl: null }),
		/configured together/
	);
	assert.throws(
		() =>
			resolveA2aConfig({
				dataDirectory: directory,
				token: null,
				publicUrl: 'https://kucedr-cloud.example',
			}),
		/configured together/
	);
	assert.throws(
		() =>
			resolveA2aConfig({
				dataDirectory: directory,
				token: 'é'.repeat(15),
				publicUrl: 'https://kucedr-cloud.example',
			}),
		/32 UTF-8 bytes/
	);

	const unicodeToken = 'é'.repeat(16);
	assert.deepEqual(
		resolveA2aConfig({
			dataDirectory: directory,
			token: unicodeToken,
			publicUrl: 'https://kucedr-cloud.example:8443',
		}),
		{
			token: unicodeToken,
			publicUrl: 'https://kucedr-cloud.example:8443',
			tasksDirectory: path.join(directory, 'a2a', 'tasks'),
			workspaceDirectory: path.join(directory, 'workspace'),
		}
	);
	for (const publicUrl of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
		assert.equal(
			resolveA2aConfig({ dataDirectory: directory, token: AGENT_TOKEN, publicUrl })?.publicUrl,
			publicUrl
		);
	}
	for (const publicUrl of [
		'http://kucedr-cloud.example',
		'https://kucedr-cloud.example/a2a',
		'https://kucedr-cloud.example?query=yes',
		'https://kucedr-cloud.example#fragment',
		'https://user:secret@kucedr-cloud.example',
		'ftp://kucedr-cloud.example',
	]) {
		assert.throws(
			() => resolveA2aConfig({ dataDirectory: directory, token: AGENT_TOKEN, publicUrl }),
			/HTTPS origin/
		);
	}

	const disabledDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-disabled-'));
	const server = await createApiServer(unusedAgent(), {
		dataDirectory: disabledDirectory,
		storageApiToken: null,
		agentToken: null,
		publicUrl: null,
	});
	server.log.level = 'silent';
	try {
		assert.equal(
			(await server.inject({ method: 'GET', url: '/.well-known/agent-card.json' })).statusCode,
			404
		);
		assert.equal((await server.inject({ method: 'GET', url: '/a2a/tasks' })).statusCode, 404);
	} finally {
		await server.close();
		fs.rmSync(disabledDirectory, { recursive: true, force: true });
	}
});

test('production separates private application routes from public OAuth and A2A', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-only-'));
	await assert.rejects(
		createServers(unusedAgent(), {
			dataDirectory: directory,
			configurationKey: null,
			publicUrl: null,
		}),
		/KUCEDR_CLOUD_CONFIG_KEY/
	);

	const { application, a2a: server } = await createServers(unusedAgent(), {
		dataDirectory: directory,
		configurationKey: CONFIGURATION_KEY,
		publicUrl: 'https://kucedr-cloud.example',
	});
	server.log.level = 'silent';
	try {
		assert.equal(
			(await server.inject({ method: 'GET', url: '/.well-known/agent-card.json' })).statusCode,
			200
		);
		const challenge = await server.inject({
			method: 'GET',
			url: '/a2a',
			headers: { 'a2a-version': '1.0' },
		});
		assert.equal(challenge.statusCode, 401);
		assert.match(
			challenge.headers['www-authenticate'] ?? '',
			/resource_metadata="https:\/\/kucedr-cloud\.example\/\.well-known\/oauth-protected-resource\/a2a"/
		);
		assert.doesNotMatch(
			(
				await server.inject({
					method: 'GET',
					url: '/a2a/tasks',
					headers: { 'a2a-version': '1.0' },
				})
			).headers['www-authenticate'] ?? '',
			/resource_metadata=/
		);
		const configPage = await application.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html' },
		});
		assert.equal(configPage.statusCode, 302);
		assert.equal(configPage.headers.location, '/config/register');
		assert.equal(configPage.headers['cache-control'], 'no-store');
		assert.equal((await application.inject('/a2a/tasks')).statusCode, 404);
		assert.equal((await application.inject('/.well-known/agent-card.json')).statusCode, 404);
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/a2a',
					headers: { 'a2a-version': '1.0', cookie: '__Host-kucedr-cloud_config=not-an-a2a-token' },
				})
			).statusCode,
			401
		);
		for (const [method, url] of [
			['GET', '/'],
			['GET', '/config'],
			['GET', '/config/login'],
			['GET', '/config/register'],
			['GET', '/config/setup'],
			['GET', '/config/assets/config.js'],
			['GET', '/config/auth/status'],
			['POST', '/config/auth/register'],
			['POST', '/config/auth/session'],
			['DELETE', '/config/auth/session'],
			['GET', '/config/api'],
			['PUT', '/config/provider'],
			['POST', '/config/clients'],
			['GET', '/ui/fonts/inter.ttf'],
			['GET', '/access'],
			['GET', '/storage-test'],
			['GET', '/ui/app.js'],
			['GET', '/storage'],
			['GET', '/settings'],
			['GET', '/files'],
			['GET', '/provider'],
			['GET', '/mcp'],
			['GET', '/health'],
			['POST', '/agents/messages'],
		] as const) {
			const response = await server.inject({ method, url });
			assert.equal(response.statusCode, 404, `${method} ${url}`);
		}
	} finally {
		await Promise.all([application.close(), server.close()]);
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('OAuth metadata and token errors follow the client-credentials profile', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-oauth-metadata-'));
	const server = Fastify();
	const issuer = new OAuthIssuer(
		new ConfigurationStore(directory, Buffer.from(CONFIGURATION_KEY, 'hex')),
		'https://kucedr-cloud.example'
	);
	registerOAuthRoutes(server, issuer);
	try {
		const metadata = (
			await server.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })
		).json<Record<string, unknown>>();
		assert.equal('response_types_supported' in metadata, false);
		await assert.rejects(
			issuer.issue({ grant_type: 'authorization_code' }),
			(error: unknown) => error instanceof OAuthError && error.code === 'unsupported_grant_type'
		);
		await assert.rejects(
			issuer.issue({ grant_type: 'client_credentials', resource: 'https://other.example/a2a' }),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_target'
		);
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test(
	'A2A HTTP routes expose discovery while enforcing protocol, authentication, and allowlists',
	{ timeout: 15_000 },
	async (context) => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-http-'));
		const secret = 'internal-tool-secret-sentinel';
		const calls: Array<{ message: string; options: AgentSendOptions }> = [];
		const agent: AgentPort = {
			async send(message, agentId, options) {
				calls.push({ message, options });
				emit(options, {
					type: 'reasoning_summary',
					id: 'reasoning',
					title: secret,
					summary: secret,
					state: 'completed',
					agentId,
					runId: options.runId ?? '',
				});
				emit(options, {
					type: 'tool_call_input',
					iteration: 0,
					toolCallId: 'tool-call',
					toolName: 'read',
					input: { secret },
					argsText: secret,
					name: 'Read file',
					serviceKind: 'tool',
					agentId,
					runId: options.runId ?? '',
				});
				emit(options, {
					type: 'text_delta',
					delta: 'Hello from kucedr-cloud',
					agentId,
					runId: options.runId ?? '',
				});
				emit(options, finished('end_turn', agentId, options.runId ?? ''));
				return 'Hello from kucedr-cloud';
			},
			cancel() {
				return true;
			},
		};
		const server = await createApiServer(agent, {
			accessControl: true,
			dataDirectory: directory,
			storageApiToken: ADMIN_TOKEN,
			agentToken: AGENT_TOKEN,
			publicUrl: 'https://kucedr-cloud.example',
		});
		server.log.level = 'silent';

		try {
			try {
				await server.listen({ host: '127.0.0.1', port: 0 });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EPERM') {
					context.skip('The execution sandbox does not allow local listening sockets.');
					return;
				}
				throw error;
			}
			const address = server.server.address();
			assert.ok(address && typeof address === 'object');
			const baseUrl = `http://127.0.0.1:${address.port}`;

			const cardResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
			assert.equal(cardResponse.status, 200);
			assert.match(cardResponse.headers.get('content-type') ?? '', /^application\/json/);
			assert.equal(cardResponse.headers.get('cache-control'), 'public, max-age=300');
			assert.equal(cardResponse.headers.get('access-control-allow-origin'), null);
			const card = (await cardResponse.json()) as Record<string, any>;
			assert.equal(card.name, 'kucedr-cloud');
			assert.deepEqual(card.supportedInterfaces, [
				{
					url: 'https://kucedr-cloud.example/a2a',
					protocolBinding: 'HTTP+JSON',
					protocolVersion: '1.0',
				},
			]);
			assert.deepEqual(card.capabilities, {
				streaming: true,
				pushNotifications: false,
				extendedAgentCard: false,
			});
			assert.deepEqual(card.defaultInputModes, ['text/plain']);
			assert.deepEqual(card.defaultOutputModes, ['text/plain']);
			assert.deepEqual(card.skills, [
				{
					id: 'workspace-assistance',
					name: 'Workspace assistance',
					description: 'Answer questions and read, create, or edit files in a private workspace.',
					tags: ['assistant', 'files', 'workspace'],
					examples: ['Summarize the files in the workspace.'],
					inputModes: ['text/plain'],
					outputModes: ['text/plain'],
				},
			]);
			assert.equal(card.securitySchemes.bearerAuth.httpAuthSecurityScheme.scheme, 'Bearer');
			assert.deepEqual(card.securityRequirements, [{ schemes: { bearerAuth: {} } }]);
			for (const authorization of [
				undefined,
				'',
				'Basic value',
				'Bearer',
				'Bearer wrong',
				'Bearer a b',
			]) {
				const response = await fetch(`${baseUrl}/a2a/tasks`, {
					headers: {
						'a2a-version': '1.0',
						...(authorization === undefined ? {} : { authorization }),
					},
				});
				assert.equal(response.status, 401);
				assert.equal(response.headers.get('www-authenticate'), 'Bearer');
			}

			for (const url of ['/provider', '/storage']) {
				const response = await fetch(`${baseUrl}${url}`, {
					headers: { authorization: `Bearer ${AGENT_TOKEN}` },
				});
				assert.equal(response.status, 401);
				assert.equal(response.headers.get('www-authenticate'), 'Bearer');
			}
			const consoleResponse = await fetch(`${baseUrl}/agents/messages`, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${AGENT_TOKEN}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ message: 'must not run' }),
			});
			assert.equal(consoleResponse.status, 401);
			assert.equal(calls.length, 0);
			assert.equal(
				(
					await fetch(`${baseUrl}/a2a/tasks`, {
						headers: { ...A2A_HEADERS, authorization: `Bearer ${ADMIN_TOKEN}` },
					})
				).status,
				401
			);

			for (const version of [undefined, '0.3', '2.0']) {
				const response = await fetch(`${baseUrl}/a2a/tasks`, {
					headers: {
						authorization: `Bearer ${AGENT_TOKEN}`,
						...(version ? { 'a2a-version': version } : {}),
					},
				});
				assert.equal(response.status, 400);
				assert.match(response.headers.get('content-type') ?? '', /^application\/a2a\+json/);
			}
			const listed = await fetch(`${baseUrl}/a2a/tasks`, { headers: A2A_HEADERS });
			assert.equal(listed.status, 200);
			assert.match(listed.headers.get('content-type') ?? '', /^application\/a2a\+json/);
			assert.deepEqual(await listed.json(), {
				tasks: [],
				nextPageToken: '',
				pageSize: 50,
				totalSize: 0,
			});

			const unsupportedContent = await fetch(`${baseUrl}/a2a/message:send`, {
				method: 'POST',
				headers: { ...A2A_HEADERS, 'content-type': 'text/plain' },
				body: '{}',
			});
			assert.equal(unsupportedContent.status, 400);
			assert.match(unsupportedContent.headers.get('content-type') ?? '', /^application\/a2a\+json/);
			assert.match(await unsupportedContent.text(), /CONTENT_TYPE_NOT_SUPPORTED/);

			for (const [method, route] of [['DELETE', '/a2a/tasks/task']] as const) {
				const response = await fetch(`${baseUrl}${route}`, { method, headers: A2A_HEADERS });
				assert.equal(response.status, 404);
			}
			const extendedCard = await fetch(`${baseUrl}/a2a/extendedAgentCard`, {
				headers: A2A_HEADERS,
			});
			assert.equal(extendedCard.status, 400);
			assert.match(await extendedCard.text(), /UNSUPPORTED_OPERATION/);
			for (const [method, route] of [
				['GET', '/a2a/tasks/task/pushNotificationConfigs'],
				['POST', '/a2a/tasks/task/pushNotificationConfigs'],
			] as const) {
				const response = await fetch(`${baseUrl}${route}`, {
					method,
					headers: {
						...A2A_HEADERS,
						...(method === 'POST' ? { 'content-type': 'application/a2a+json' } : {}),
					},
					...(method === 'POST' ? { body: '{}' } : {}),
				});
				assert.equal(response.status, 400);
				assert.match(await response.text(), /PUSH_NOTIFICATION_NOT_SUPPORTED/);
			}

			const streamResponse = await fetch(`${baseUrl}/a2a/message:stream`, {
				method: 'POST',
				headers: {
					...A2A_HEADERS,
					'content-type': 'application/a2a+json',
					accept: 'text/event-stream',
				},
				body: JSON.stringify(protoRequest(['hello'])),
			});
			assert.equal(streamResponse.status, 200);
			assert.equal(streamResponse.headers.get('content-type'), 'text/event-stream');
			assert.equal(streamResponse.headers.get('cache-control'), 'no-cache');
			assert.equal(streamResponse.headers.get('x-accel-buffering'), 'no');
			const streamBody = await streamResponse.text();
			const events = sseEvents(streamBody);
			assert.deepEqual(
				events.map((event) => Object.keys(event)[0]),
				['task', 'statusUpdate', 'artifactUpdate', 'statusUpdate']
			);
			assert.equal(events[1]?.statusUpdate.status.state, 'TASK_STATE_WORKING');
			assert.equal(events[2]?.artifactUpdate.artifact.parts[0].text, 'Hello from kucedr-cloud');
			assert.equal(events[3]?.statusUpdate.status.state, 'TASK_STATE_COMPLETED');
			assert.equal(streamBody.includes(secret), false);
			assert.equal(calls.length, 1);
			assert.deepEqual(calls[0]?.options.toolsAllow, ['read', 'write', 'edit']);
			assert.equal(calls[0]?.options.workspaceRoot, path.join(directory, 'workspace'));
		} finally {
			await server.close();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	}
);

test('A2A executor validates text input, preserves order, and exposes only response artifacts', async () => {
	const calls: Array<{ message: string; options: AgentSendOptions }> = [];
	const secret = 'executor-internal-secret';
	const agent: AgentPort = {
		async send(message, agentId, options) {
			calls.push({ message, options });
			emit(options, {
				type: 'tool_call_result',
				iteration: 0,
				toolCallId: 'tool-call',
				toolName: 'read',
				input: { path: secret },
				output: secret,
				outputText: secret,
				status: 'ok',
				durationMs: 1,
				name: 'Read file',
				serviceKind: 'tool',
				agentId,
				runId: options.runId ?? '',
			});
			emit(options, {
				type: 'text_delta',
				delta: 'First ',
				agentId,
				runId: options.runId ?? '',
			});
			emit(options, {
				type: 'text_delta',
				delta: 'second',
				agentId,
				runId: options.runId ?? '',
			});
			emit(options, finished('end_turn', agentId, options.runId ?? ''));
			return 'First second';
		},
		cancel() {
			return true;
		},
	};
	const workspace = path.join(os.tmpdir(), 'kucedr-cloud-a2a-workspace');
	const executor = new KucedrCloudExecutor(agent, workspace);
	const taskId = randomUUID();
	const contextId = randomUUID();
	const events = await execute(
		executor,
		requestContext([textPart('one'), textPart('two')], taskId, contextId)
	);
	assert.equal(calls[0]?.message, 'one\ntwo');
	assert.equal(calls[0]?.options.runId, taskId);
	assert.match(
		calls[0]?.options.sessionId ?? '',
		/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
	);
	assert.notEqual(calls[0]?.options.sessionId, contextId);
	assert.deepEqual(calls[0]?.options.toolsAllow, ['read', 'write', 'edit']);
	assert.equal(calls[0]?.options.workspaceRoot, workspace);
	assert.deepEqual(
		events.map((event) => event.kind),
		['task', 'statusUpdate', 'artifactUpdate', 'artifactUpdate', 'statusUpdate']
	);
	const artifactEvents = events.filter((event) => event.kind === 'artifactUpdate');
	assert.deepEqual(
		artifactEvents.map((event) => ({
			text: event.data.artifact?.parts[0]?.content?.value,
			append: event.data.append,
			lastChunk: event.data.lastChunk,
		})),
		[
			{ text: 'First ', append: false, lastChunk: false },
			{ text: 'second', append: true, lastChunk: true },
		]
	);
	assert.equal(JSON.stringify(events).includes(secret), false);

	const exactLimit = 'a'.repeat(16_384);
	await execute(executor, requestContext([textPart(exactLimit), textPart('b'.repeat(16_383))]));
	assert.equal(Buffer.byteLength(calls.at(-1)?.message ?? ''), 32 * 1024);
	await assert.rejects(
		execute(executor, requestContext([textPart(exactLimit), textPart('b'.repeat(16_384))])),
		RequestMalformedError
	);
	await assert.rejects(
		execute(
			executor,
			requestContext([
				{
					content: { $case: 'data', value: { secret } },
					mediaType: 'application/json',
					filename: '',
					metadata: {},
				},
			])
		),
		RequestMalformedError
	);
	await assert.rejects(
		execute(executor, requestContext([textPart('hello')], randomUUID(), 'not-a-uuid')),
		RequestMalformedError
	);
	await execute(
		executor,
		requestContext([textPart('hello')], randomUUID(), randomUUID(), 'client-message-1')
	);
});

test('A2A executor emits exactly one sanitized terminal state for every run outcome', async () => {
	for (const [reason, expected] of [
		['end_turn', TaskState.TASK_STATE_COMPLETED],
		['cancelled', TaskState.TASK_STATE_CANCELED],
		['timeout', TaskState.TASK_STATE_FAILED],
		['budget_exhausted', TaskState.TASK_STATE_FAILED],
		['max_tool_calls', TaskState.TASK_STATE_FAILED],
		['max_iterations', TaskState.TASK_STATE_FAILED],
		['max_tokens', TaskState.TASK_STATE_FAILED],
		['error', TaskState.TASK_STATE_FAILED],
	] as const) {
		const agent: AgentPort = {
			async send(_message, agentId, options) {
				emit(options, finished(reason, agentId, options.runId ?? ''));
				emit(options, finished('error', agentId, options.runId ?? ''));
				return '';
			},
			cancel() {
				return true;
			},
		};
		const events = await execute(
			new KucedrCloudExecutor(agent, '/workspace'),
			requestContext([textPart('run')])
		);
		const terminal = terminalStates(events);
		assert.deepEqual(terminal, [expected], reason);
	}

	const runtimeSecret = 'provider-secret-runtime-error';
	const events = await execute(
		new KucedrCloudExecutor(
			{
				async send() {
					throw new Error(runtimeSecret);
				},
				cancel() {
					return false;
				},
			},
			'/workspace'
		),
		requestContext([textPart('fail')])
	);
	assert.deepEqual(terminalStates(events), [TaskState.TASK_STATE_FAILED]);
	assert.equal(JSON.stringify(events).includes(runtimeSecret), false);
	assert.match(JSON.stringify(events), /kucedr-cloud run failed/);
});

test('A2A request handler supports immediate and blocking sends, polling, listing, subscription, and cancellation', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-handler-'));
	const gates = new Map<string, ReturnType<typeof deferred>>();
	const starts = new Map<string, ReturnType<typeof deferred>>();
	const runs = new Map<string, string>();
	const cancellations: string[] = [];
	const agent: AgentPort = {
		async send(message, agentId, options) {
			runs.set(options.runId ?? '', message);
			starts.get(message)?.resolve();
			await gates.get(message)?.promise;
			emit(options, {
				type: 'text_delta',
				delta: `done:${message}`,
				agentId,
				runId: options.runId ?? '',
			});
			emit(options, finished('end_turn', agentId, options.runId ?? ''));
			return `done:${message}`;
		},
		cancel(runId) {
			cancellations.push(runId);
			const message = runs.get(runId);
			if (!message) return false;
			gates.get(message)?.resolve();
			return true;
		},
	};

	try {
		const handler = new DefaultRequestHandler(
			createAgentCard('https://kucedr-cloud.example'),
			await createTaskStore(path.join(directory, 'tasks')),
			new KucedrCloudExecutor(agent, path.join(directory, 'workspace'))
		);
		const context = new ServerCallContext({
			requestedVersion: '1.0',
			user: { isAuthenticated: true, userName: 'handler-test-client' },
		});

		const immediateGate = deferred();
		const immediateStart = deferred();
		gates.set('immediate', immediateGate);
		starts.set('immediate', immediateStart);
		const immediate = await handler.sendMessage(
			sendRequest(['immediate'], sendConfiguration(true)),
			context
		);
		assert.ok('id' in immediate);
		assert.notEqual(immediate.status?.state, TaskState.TASK_STATE_COMPLETED);
		await immediateStart.promise;

		const polled = await handler.getTask(
			{ tenant: '', id: immediate.id, historyLength: undefined },
			context
		);
		assert.equal(polled.id, immediate.id);
		assert.equal(polled.contextId, immediate.contextId);
		assert.ok(
			polled.status?.state === TaskState.TASK_STATE_SUBMITTED ||
				polled.status?.state === TaskState.TASK_STATE_WORKING
		);

		const listRequest: ListTasksRequest = {
			tenant: '',
			contextId: immediate.contextId,
			status: TaskState.TASK_STATE_UNSPECIFIED,
			pageToken: '',
			statusTimestampAfter: undefined,
			includeArtifacts: true,
		};
		const listed = await handler.listTasks(listRequest, context);
		assert.deepEqual(
			listed.tasks.map((task) => task.id),
			[immediate.id]
		);

		const subscription = handler.resubscribe({ tenant: '', id: immediate.id }, context);
		const subscribedEvent = subscription.next();
		const canceled = await handler.cancelTask(
			{ tenant: '', id: immediate.id, metadata: {} },
			context
		);
		assert.equal(canceled.status?.state, TaskState.TASK_STATE_CANCELED);
		assert.deepEqual(cancellations, [immediate.id]);
		let subscriptionResult = await subscribedEvent;
		const subscriptionStates: TaskState[] = [];
		while (!subscriptionResult.done) {
			const payload = subscriptionResult.value.payload;
			if (payload?.$case === 'statusUpdate' || payload?.$case === 'task') {
				const state = payload.value.status?.state;
				if (state !== undefined) subscriptionStates.push(state);
				if (state === TaskState.TASK_STATE_CANCELED) break;
			}
			subscriptionResult = await subscription.next();
		}
		assert.equal(subscriptionStates.at(-1), TaskState.TASK_STATE_CANCELED);
		await subscription.return(undefined);

		for (const [message, configuration] of [
			['omitted', undefined],
			['false', sendConfiguration(false)],
		] as const) {
			const gate = deferred();
			gates.set(message, gate);
			const pending = handler.sendMessage(sendRequest([message], configuration), context);
			assert.equal(await settlesThisTurn(pending), false);
			gate.resolve();
			const result = await pending;
			assert.ok('id' in result);
			assert.equal(result.status?.state, TaskState.TASK_STATE_COMPLETED);
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

function unusedAgent(): AgentPort {
	return {
		async send() {
			return 'unused';
		},
		cancel() {
			return false;
		},
	};
}

function protoRequest(parts: string[]): Record<string, unknown> {
	return {
		message: {
			messageId: randomUUID(),
			role: 'ROLE_USER',
			parts: parts.map((text) => ({ text, mediaType: 'text/plain' })),
		},
	};
}

function sseEvents(body: string): Array<Record<string, any>> {
	return body
		.split('\n\n')
		.map((block) =>
			block
				.split('\n')
				.find((line) => line.startsWith('data: '))
				?.slice(6)
		)
		.filter((data): data is string => data !== undefined)
		.map((data) => JSON.parse(data) as Record<string, any>);
}

function textPart(value: string): Part {
	return {
		content: { $case: 'text', value },
		mediaType: 'text/plain',
		filename: '',
		metadata: {},
	};
}

function requestContext(
	parts: Part[],
	taskId = randomUUID(),
	contextId = randomUUID(),
	messageId: string = randomUUID()
): RequestContext {
	const message: Message = {
		messageId,
		contextId: '',
		taskId: '',
		role: Role.ROLE_USER,
		parts,
		metadata: {},
		extensions: [],
		referenceTaskIds: [],
	};
	return new RequestContext(
		{ tenant: '', message, configuration: undefined, metadata: {} },
		taskId,
		contextId,
		new ServerCallContext({
			requestedVersion: '1.0',
			user: { isAuthenticated: true, userName: 'executor-test-client' },
		})
	);
}

async function execute(
	executor: KucedrCloudExecutor,
	context: RequestContext
): Promise<AgentExecutionEvent[]> {
	const events: AgentExecutionEvent[] = [];
	const eventBus = new DefaultExecutionEventBus();
	eventBus.on('event', (event) => events.push(event));
	await executor.execute(context, eventBus);
	return events;
}

function emit(options: AgentSendOptions, event: AgentResponseEvent): void {
	options.streamEvent?.(event);
}

function finished(
	stopReason: AgentRunStopReason,
	agentId: string,
	runId: string
): AgentResponseEvent {
	return { type: 'run_finished', stopReason, outputChars: 0, agentId, runId };
}

function terminalStates(events: AgentExecutionEvent[]): TaskState[] {
	const terminal = new Set([
		TaskState.TASK_STATE_COMPLETED,
		TaskState.TASK_STATE_CANCELED,
		TaskState.TASK_STATE_FAILED,
		TaskState.TASK_STATE_REJECTED,
	]);
	return events.flatMap((event) => {
		if (event.kind !== 'statusUpdate') return [];
		const state = event.data.status?.state;
		return state !== undefined && terminal.has(state) ? [state] : [];
	});
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function sendRequest(
	parts: string[],
	configuration: SendMessageRequest['configuration']
): SendMessageRequest {
	return {
		tenant: '',
		message: {
			messageId: randomUUID(),
			contextId: '',
			taskId: '',
			role: Role.ROLE_USER,
			parts: parts.map(textPart),
			metadata: {},
			extensions: [],
			referenceTaskIds: [],
		},
		configuration,
		metadata: {},
	};
}

function sendConfiguration(
	returnImmediately: boolean
): NonNullable<SendMessageRequest['configuration']> {
	return {
		acceptedOutputModes: [],
		taskPushNotificationConfig: undefined,
		returnImmediately,
	};
}

async function settlesThisTurn(promise: Promise<unknown>): Promise<boolean> {
	return Promise.race([
		promise.then(() => true),
		new Promise<false>((resolve) => setImmediate(() => resolve(false))),
	]);
}
