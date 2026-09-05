import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerConfigurationAuthenticationRoutes } from '../src/main/config/auth_routes';
import { setConfigurationCookie } from '../src/main/config/cookie';
import { registerConfigurationRoutes } from '../src/main/config/routes';
import { ConfigurationStore } from '../src/main/config/store';
import { registerConfigurationUiRoutes } from '../src/main/config/ui';
import { OAuthIssuer } from '../src/main/oauth/issuer';
import { RequestLimiter } from '../src/main/oauth/limit';

const ADMIN_TOKEN = 'config-ui-admin-token-123456789012345';
const CONFIGURATION_KEY = Buffer.from('22'.repeat(32), 'hex');
const PUBLIC_URL = 'https://idra.example';
const USERNAME = 'administrator';
const PASSWORD = 'correct horse battery staple';

test('config UI registers one administrator and protects browser sessions', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'idra-config-ui-'));
	let server = createServer(directory);
	try {
		const initialRoot = await server.inject({ method: 'GET', url: '/' });
		assert.equal(initialRoot.statusCode, 302);
		assert.equal(initialRoot.headers.location, '/config/register');

		const protectedPage = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html,application/xhtml+xml' },
		});
		assert.equal(protectedPage.statusCode, 302);
		assert.equal(protectedPage.headers.location, '/config/register');
		assert.equal(protectedPage.headers['cache-control'], 'no-store');
		const html = await server.inject({ method: 'GET', url: '/config/register' });
		assert.equal(html.statusCode, 200);
		assert.match(html.headers['content-type'] ?? '', /^text\/html/);
		assert.match(html.headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
		assert.match(html.headers['content-security-policy'] ?? '', /font-src 'self'/);
		assert.equal((await server.inject('/ui/fonts/archivo.ttf')).statusCode, 200);
		assert.equal(html.headers['cache-control'], 'no-store');
		assert.match(html.body, /Create the administrator/);
		assert.match(html.body, /autocomplete="new-password"/);
		assert.doesNotMatch(html.body, /setup-token|IDRA_ADMIN_TOKEN/);
		assert.doesNotMatch(html.body, new RegExp(ADMIN_TOKEN));
		const prematureLogin = await server.inject({ method: 'GET', url: '/config/login' });
		assert.equal(prematureLogin.statusCode, 302);
		assert.equal(prematureLogin.headers.location, '/config/register');

		assert.equal(
			(await server.inject({ method: 'GET', url: '/config/assets/config.js' })).statusCode,
			200
		);
		assert.equal((await server.inject({ method: 'GET', url: '/config' })).statusCode, 401);
		assert.deepEqual((await server.inject({ method: 'GET', url: '/config/auth/status' })).json(), {
			registered: false,
			authenticated: false,
			username: null,
			csrfToken: null,
		});

		const credentials = { username: USERNAME, password: PASSWORD };
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
					payload: { provider: 'openai', model: 'gpt-test', apiKey: 'provider-secret' },
				})
			).statusCode,
			409
		);
		assert.equal(
			(
				await server.inject({
					method: 'POST',
					url: '/config/auth/register',
					payload: credentials,
				})
			).statusCode,
			401
		);
		const registration = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin: PUBLIC_URL },
			payload: credentials,
		});
		assert.equal(registration.statusCode, 201);
		const registrationBody = registration.json<{ csrfToken: string; username: string }>();
		assert.equal(registrationBody.username, USERNAME);
		assert.match(registrationBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
		const cookie = sessionCookie(registration.headers['set-cookie']);
		assert.match(registration.headers['set-cookie'] ?? '', /__Host-idra_config=/);
		assert.match(registration.headers['set-cookie'] ?? '', /HttpOnly/);
		assert.match(registration.headers['set-cookie'] ?? '', /SameSite=Strict/);
		assert.match(registration.headers['set-cookie'] ?? '', /Secure/);
		const signedOutPage = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html' },
		});
		assert.equal(signedOutPage.statusCode, 302);
		assert.equal(signedOutPage.headers.location, '/config/login');
		const signedOutRoot = await server.inject({ method: 'GET', url: '/' });
		assert.equal(signedOutRoot.statusCode, 302);
		assert.equal(signedOutRoot.headers.location, '/config/login');
		const invalidSession = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html', cookie: '__Host-idra_config=invalid' },
		});
		assert.equal(invalidSession.statusCode, 302);
		assert.equal(invalidSession.headers.location, '/config/login');
		const completedRegistration = await server.inject({
			method: 'GET',
			url: '/config/register',
		});
		assert.equal(completedRegistration.statusCode, 302);
		assert.equal(completedRegistration.headers.location, '/config/login');
		const loginPage = await server.inject({ method: 'GET', url: '/config/login' });
		assert.equal(loginPage.statusCode, 200);
		assert.match(loginPage.body, /<h2>Log in<\/h2>/);

		assert.equal(
			(
				await server.inject({
					method: 'POST',
					url: '/config/auth/register',
					headers: { origin: PUBLIC_URL },
					payload: credentials,
				})
			).statusCode,
			409
		);
		const status = await server.inject({
			method: 'GET',
			url: '/config/auth/status',
			headers: { cookie },
		});
		assert.deepEqual(status.json(), {
			registered: true,
			authenticated: true,
			username: USERNAME,
			csrfToken: registrationBody.csrfToken,
		});
		const authenticatedPage = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html', cookie },
		});
		assert.equal(authenticatedPage.statusCode, 302);
		assert.equal(authenticatedPage.headers.location, '/config/setup');
		const setupPage = await server.inject({
			method: 'GET',
			url: '/config/setup',
			headers: { cookie },
		});
		assert.equal(setupPage.statusCode, 200);
		assert.match(setupPage.body, /Connect a model provider/);
		assert.match(setupPage.body, /id="setup-provider-form"/);
		const authenticatedLogin = await server.inject({
			method: 'GET',
			url: '/config/login',
			headers: { cookie },
		});
		assert.equal(authenticatedLogin.statusCode, 302);
		assert.equal(authenticatedLogin.headers.location, '/config/setup');
		const authenticatedRegistration = await server.inject({
			method: 'GET',
			url: '/config/register',
			headers: { cookie },
		});
		assert.equal(authenticatedRegistration.statusCode, 302);
		assert.equal(authenticatedRegistration.headers.location, '/config/setup');
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/config/api',
					headers: { cookie },
				})
			).statusCode,
			200
		);
		const providerPayload = { provider: 'OpenAI', model: 'gpt-test', apiKey: 'provider-secret' };
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: { cookie },
					payload: providerPayload,
				})
			).statusCode,
			403
		);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: {
						cookie,
						origin: 'https://attacker.example',
						'x-idra-csrf': registrationBody.csrfToken,
					},
					payload: providerPayload,
				})
			).statusCode,
			403
		);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: {
						cookie,
						origin: PUBLIC_URL,
						'x-idra-csrf': registrationBody.csrfToken,
					},
					payload: providerPayload,
				})
			).statusCode,
			200
		);
		const completedSetup = await server.inject({
			method: 'GET',
			url: '/config/setup',
			headers: { cookie },
		});
		assert.equal(completedSetup.statusCode, 302);
		assert.equal(completedSetup.headers.location, '/config');
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/config',
					headers: { accept: 'text/html', cookie },
				})
			).statusCode,
			200
		);
		assert.equal(
			(
				await server.inject({
					method: 'DELETE',
					url: '/config/provider',
					headers: {
						cookie,
						origin: PUBLIC_URL,
						'x-idra-csrf': registrationBody.csrfToken,
					},
				})
			).statusCode,
			200
		);
		const removedProviderPage = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html', cookie },
		});
		assert.equal(removedProviderPage.statusCode, 302);
		assert.equal(removedProviderPage.headers.location, '/config/setup');
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
					payload: providerPayload,
				})
			).statusCode,
			200
		);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
					payload: { provider: 'openai', model: 'gpt-test-2' },
				})
			).statusCode,
			200
		);

		await server.close();
		server = createServer(directory);
		const persisted = await server.inject({
			method: 'GET',
			url: '/config/auth/status',
			headers: { cookie },
		});
		assert.equal(persisted.json<{ authenticated: boolean }>().authenticated, true);

		const logoutWithoutCsrf = await server.inject({
			method: 'DELETE',
			url: '/config/auth/session',
			headers: { cookie },
		});
		assert.equal(logoutWithoutCsrf.statusCode, 403);
		const logout = await server.inject({
			method: 'DELETE',
			url: '/config/auth/session',
			headers: { cookie, origin: PUBLIC_URL, 'x-idra-csrf': registrationBody.csrfToken },
		});
		assert.equal(logout.statusCode, 204);
		assert.match(logout.headers['set-cookie'] ?? '', /Max-Age=0/);
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/config/api',
					headers: { cookie },
				})
			).statusCode,
			401
		);
		const loggedOutPage = await server.inject({
			method: 'GET',
			url: '/config',
			headers: { accept: 'text/html', cookie },
		});
		assert.equal(loggedOutPage.statusCode, 302);
		assert.equal(loggedOutPage.headers.location, '/config/login');

		const wrongUsername = await login(server, 'someone-else', PASSWORD);
		const wrongPassword = await login(server, USERNAME, 'this password is incorrect');
		assert.equal(wrongUsername.statusCode, 401);
		assert.equal(wrongPassword.statusCode, 401);
		assert.equal(wrongUsername.body, wrongPassword.body);
		const loginResponse = await login(server, USERNAME, PASSWORD);
		assert.equal(loginResponse.statusCode, 200);

		const stored = fs.readFileSync(path.join(directory, 'secure-config.json'), 'utf8');
		assert.doesNotMatch(stored, new RegExp(PASSWORD));
		assert.doesNotMatch(stored, new RegExp(ADMIN_TOKEN));
		assert.doesNotMatch(stored, /provider-secret/);
		assert.doesNotMatch(stored, new RegExp(cookie.split('=')[1]));
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('loopback HTTP uses a non-Secure development cookie', () => {
	const cookie = setConfigurationCookie('token', 'http://127.0.0.1:3000');
	assert.match(cookie, /^idra_config_session=/);
	assert.doesNotMatch(cookie, /; Secure/);
});

function createServer(directory: string) {
	const server = Fastify({ logger: false });
	const store = new ConfigurationStore(directory, CONFIGURATION_KEY);
	const issuer = new OAuthIssuer(store, PUBLIC_URL);
	const limiter = new RequestLimiter();
	registerConfigurationAuthenticationRoutes(server, store, ADMIN_TOKEN, PUBLIC_URL, limiter);
	registerConfigurationUiRoutes(server, store, ADMIN_TOKEN, PUBLIC_URL, issuer, limiter);
	registerConfigurationRoutes(server, store, ADMIN_TOKEN, PUBLIC_URL, limiter);
	return server;
}

function sessionCookie(header: string | string[] | undefined): string {
	assert.equal(typeof header, 'string');
	return header.split(';', 1)[0];
}

function login(server: ReturnType<typeof createServer>, username: string, password: string) {
	return server.inject({
		method: 'POST',
		url: '/config/auth/session',
		payload: { username, password },
	});
}
