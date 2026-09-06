import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Role, TaskState, type SendMessageRequest, type StreamResponse } from '@a2a-js/sdk';
import { ClientFactory, RestTransportFactory } from '@a2a-js/sdk/client';
import { importJWK, SignJWT, type JWK } from 'jose';
import { createA2aServer } from '../src/main/a2a/server';
import type { AgentSendOptions } from '../src/main/agent/agent';
import { ConfigurationStore } from '../src/main/config/store';
import { OAuthError } from '../src/main/oauth/error';
import { OAuthIssuer } from '../src/main/oauth/issuer';

test('the official A2A REST client discovers kucedr-cloud and streams continuous contexts', async (context) => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-client-'));
	const adminToken = 'official-client-admin-token-32-bytes-long';
	const configurationKey = '22'.repeat(32);
	const requests: Array<{ message: string; options: AgentSendOptions }> = [];
	const agent = {
		async send(message: string, agentId: string, options: AgentSendOptions): Promise<string> {
			requests.push({ message, options });
			const runId = options.runId ?? 'missing-run';
			options.streamEvent?.({ type: 'text_delta', delta: `${message}:`, agentId, runId });
			options.streamEvent?.({ type: 'text_delta', delta: 'done', agentId, runId });
			options.streamEvent?.({
				type: 'run_finished',
				stopReason: 'end_turn',
				outputChars: message.length + 5,
				agentId,
				runId,
			});
			return `${message}:done`;
		},
		cancel(): boolean {
			return true;
		},
	};

	let port: number;
	try {
		port = await new Promise<number>((resolve, reject) => {
			const probe = net.createServer();
			probe.once('error', reject);
			probe.listen({ host: '127.0.0.1', port: 0 }, () => {
				const address = probe.address();
				assert.ok(address && typeof address === 'object');
				probe.close((error) => (error ? reject(error) : resolve(address.port)));
			});
		});
	} catch (error) {
		fs.rmSync(directory, { recursive: true, force: true });
		if ((error as NodeJS.ErrnoException).code === 'EPERM') {
			context.skip('The execution sandbox does not allow local listening sockets.');
			return;
		}
		throw error;
	}

	const baseUrl = `http://127.0.0.1:${port}`;
	const server = await createA2aServer(agent, {
		adminToken,
		configurationKey,
		dataDirectory: directory,
		publicUrl: baseUrl,
	});
	server.log.level = 'silent';

	try {
		try {
			await server.listen({ host: '127.0.0.1', port });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EPERM') {
				context.skip('The execution sandbox does not allow local listening sockets.');
				return;
			}
			throw error;
		}
		const providerSecret = 'provider-secret-must-never-be-returned';
		const administrator = await fetch(`${baseUrl}/config/auth/register`, {
			method: 'POST',
			headers: { origin: baseUrl, 'content-type': 'application/json' },
			body: JSON.stringify({
				setupToken: adminToken,
				username: 'administrator',
				password: 'correct horse battery staple',
			}),
		});
		assert.equal(administrator.status, 201);
		const session = (await administrator.json()) as { csrfToken: string };
		const cookie = administrator.headers.get('set-cookie')?.split(';', 1)[0];
		assert.ok(cookie);
		const adminHeaders = {
			cookie,
			origin: baseUrl,
			'content-type': 'application/json',
			'x-kucedr-cloud-csrf': session.csrfToken,
		};
		assert.equal((await fetch(`${baseUrl}/a2a/tasks`, { headers: { cookie } })).status, 401);
		assert.equal(
			(await fetch(`${baseUrl}/a2a/tasks`, {
				headers: { authorization: `Bearer ${adminToken}` },
			})).status,
			401
		);
		const configuredProvider = await fetch(`${baseUrl}/config/provider`, {
			method: 'PUT',
			headers: adminHeaders,
			body: JSON.stringify({ provider: 'openai', model: 'test-model', apiKey: providerSecret }),
		});
		assert.equal(configuredProvider.status, 200);
		const providerBody = await configuredProvider.text();
		assert.doesNotMatch(providerBody, new RegExp(providerSecret));
		assert.deepEqual(JSON.parse(providerBody), {
			configured: true,
			hasApiKey: true,
			provider: 'openai',
			model: 'test-model',
		});
		assert.doesNotMatch(
			fs.readFileSync(path.join(directory, 'secure-config.json'), 'utf8'),
			new RegExp(providerSecret)
		);

		const cardResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
		assert.equal(cardResponse.status, 200);
		const card = (await cardResponse.json()) as Record<string, any>;
		assert.equal(card.supportedInterfaces[0].url, `${baseUrl}/a2a`);
		assert.equal(card.supportedInterfaces[0].protocolBinding, 'HTTP+JSON');
		assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
		assert.equal(
			card.securitySchemes.oauth2.oauth2SecurityScheme.flows.clientCredentials.tokenUrl,
			`${baseUrl}/a2a/oauth/token`
		);
		assert.equal(
			card.securitySchemes.oauth2.oauth2SecurityScheme.oauth2MetadataUrl,
			`${baseUrl}/.well-known/oauth-authorization-server`
		);

		const challenge = await fetch(`${baseUrl}/a2a`, {
			headers: { 'a2a-version': '1.0' },
		});
		assert.equal(challenge.status, 401);
		assert.match(
			challenge.headers.get('www-authenticate') ?? '',
			/resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/a2a"/
		);

		const pair = generateKeyPairSync('ed25519');
		const publicKey = pair.publicKey.export({ format: 'jwk' }) as JWK;
		const privateKey = pair.privateKey.export({ format: 'jwk' }) as JWK;
		const registered = await fetch(`${baseUrl}/config/clients`, {
			method: 'POST',
			headers: adminHeaders,
			body: JSON.stringify({ name: 'official-sdk-test', publicKeyJwk: publicKey }),
		});
		assert.equal(registered.status, 201);
		const registration = (await registered.json()) as { clientId: string };
		const now = Math.floor(Date.now() / 1000);
		const assertion = await new SignJWT()
			.setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
			.setIssuer(registration.clientId)
			.setSubject(registration.clientId)
			.setAudience(`${baseUrl}/a2a/oauth/token`)
			.setIssuedAt(now)
			.setExpirationTime(now + 120)
			.setJti(randomUUID())
			.sign(await importJWK(privateKey, 'EdDSA'));
		const tokenForm = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: registration.clientId,
			client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
			client_assertion: assertion,
			scope: 'a2a.invoke',
			resource: `${baseUrl}/a2a`,
		});
		const tokenResponse = await fetch(`${baseUrl}/a2a/oauth/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: tokenForm,
		});
		const tokenBody = await tokenResponse.text();
		assert.equal(tokenResponse.status, 200, tokenBody);
		assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
		const token = JSON.parse(tokenBody) as {
			access_token: string;
			expires_in: number;
			scope: string;
			token_type: string;
		};
		assert.equal(token.token_type, 'Bearer');
		assert.equal(token.scope, 'a2a.invoke');
		assert.equal(token.expires_in, 300);
		const replay = await fetch(`${baseUrl}/a2a/oauth/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: tokenForm,
		});
		assert.equal(replay.status, 400);
		assert.deepEqual(await replay.json(), {
			error: 'invalid_client',
			error_description: 'Client authentication failed.',
		});
		const restartedIssuer = new OAuthIssuer(
			new ConfigurationStore(directory, Buffer.from(configurationKey, 'hex')),
			baseUrl
		);
		await assert.rejects(
			restartedIssuer.issue(Object.fromEntries(tokenForm)),
			(error: unknown) => error instanceof OAuthError && error.code === 'invalid_client'
		);
		assert.equal(
			(
				await fetch(`${baseUrl}/config`, {
					headers: { authorization: `Bearer ${token.access_token}` },
				})
			).status,
			401
		);

		const client = await new ClientFactory({
			transports: [new RestTransportFactory()],
		}).createFromUrl(baseUrl);
		const requestOptions = {
			serviceParameters: { Authorization: `Bearer ${token.access_token}` },
		};
		const firstRequest: SendMessageRequest = {
			tenant: '',
			message: {
				messageId: randomUUID(),
				contextId: '',
				taskId: '',
				role: Role.ROLE_USER,
				parts: [
					{
						content: { $case: 'text', value: 'first' },
						mediaType: 'text/plain',
						filename: '',
						metadata: {},
					},
				],
				metadata: {},
				extensions: [],
				referenceTaskIds: [],
			},
			configuration: undefined,
			metadata: {},
		};
		const firstEvents: StreamResponse[] = [];
		for await (const event of client.sendMessageStream(firstRequest, requestOptions)) {
			firstEvents.push(event);
		}

		assert.deepEqual(
			firstEvents.map((event) => event.payload?.$case),
			['task', 'statusUpdate', 'artifactUpdate', 'artifactUpdate', 'statusUpdate']
		);
		assert.equal(firstEvents[0].payload?.$case, 'task');
		if (firstEvents[0].payload?.$case !== 'task') assert.fail('Expected the initial task event.');
		const firstTask = firstEvents[0].payload.value;
		assert.equal(firstTask.status?.state, TaskState.TASK_STATE_SUBMITTED);
		assert.equal(firstEvents.at(-1)?.payload?.$case, 'statusUpdate');
		if (firstEvents.at(-1)?.payload?.$case !== 'statusUpdate') {
			assert.fail('Expected a terminal status update.');
		}
		assert.equal(firstEvents.at(-1)?.payload.value.status?.state, TaskState.TASK_STATE_COMPLETED);
		assert.equal(
			firstEvents
				.filter((event) => event.payload?.$case === 'artifactUpdate')
				.flatMap((event) =>
					event.payload?.$case === 'artifactUpdate'
						? (event.payload.value.artifact?.parts ?? []).map((part) =>
								part.content?.$case === 'text' ? part.content.value : ''
							)
						: []
				)
				.join(''),
			'first:done'
		);

		const secondRequest: SendMessageRequest = {
			...firstRequest,
			message: {
				...firstRequest.message!,
				messageId: randomUUID(),
				contextId: firstTask.contextId,
				parts: [
					{
						content: { $case: 'text', value: 'second' },
						mediaType: 'text/plain',
						filename: '',
						metadata: {},
					},
				],
			},
		};
		const secondEvents: StreamResponse[] = [];
		for await (const event of client.sendMessageStream(secondRequest, requestOptions)) {
			secondEvents.push(event);
		}
		assert.equal(secondEvents[0].payload?.$case, 'task');
		if (secondEvents[0].payload?.$case !== 'task') assert.fail('Expected the follow-up task.');
		assert.equal(secondEvents[0].payload.value.contextId, firstTask.contextId);
		assert.notEqual(secondEvents[0].payload.value.id, firstTask.id);
		assert.deepEqual(
			requests.map((request) => request.message),
			['first', 'second']
		);
		assert.equal(requests[0]?.options.runId, firstTask.id);
		assert.equal(requests[1]?.options.runId, secondEvents[0].payload.value.id);
		assert.match(
			requests[0]?.options.sessionId ?? '',
			/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
		);
		assert.equal(requests[1]?.options.sessionId, requests[0]?.options.sessionId);
		assert.notEqual(requests[0]?.options.sessionId, firstTask.contextId);

		const revoked = await fetch(`${baseUrl}/config/clients/${registration.clientId}`, {
			method: 'DELETE',
			headers: { cookie, origin: baseUrl, 'x-kucedr-cloud-csrf': session.csrfToken },
		});
		assert.equal(revoked.status, 200);
		assert.deepEqual(await revoked.json(), { deleted: true });
		assert.equal(
			(
				await fetch(`${baseUrl}/a2a/tasks`, {
					headers: {
						authorization: `Bearer ${token.access_token}`,
						'a2a-version': '1.0',
					},
				})
			).status,
			401
		);
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
