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
const PUBLIC_URL = 'https://kucedr-cloud.example';
const USERNAME = 'zoë / 東京!';
const PASSWORD = 'correct horse battery staple';

test('config UI registers one administrator and protects browser sessions', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-config-ui-'));
	let server = createServer(directory);
	try {
		const initialRoot = await server.inject({ method: 'GET', url: '/' });
		assert.equal(initialRoot.statusCode, 302);
		assert.equal(initialRoot.headers.location, '/config/register');

		for (const url of ['/config/clients', '/config/provider', '/config/a2a', '/config/setup']) {
			const page = await server.inject(url);
			assert.equal(page.statusCode, 302);
			assert.equal(page.headers.location, '/config/register');
		}

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
		assert.match(html.body, /id="register-setup-token"/);
		assert.doesNotMatch(html.body, new RegExp(ADMIN_TOKEN));
		const prematureLogin = await server.inject({ method: 'GET', url: '/config/login' });
		assert.equal(prematureLogin.statusCode, 302);
		assert.equal(prematureLogin.headers.location, '/config/register');

		assert.equal(
			(await server.inject({ method: 'GET', url: '/config/assets/config.js' })).statusCode,
			200
		);
		assert.equal(
			(await server.inject({ method: 'GET', url: '/config', headers: { origin: PUBLIC_URL } }))
				.statusCode,
			401
		);
		assert.deepEqual(
			(
				await server.inject({
					method: 'GET',
					url: '/config/auth/status',
					headers: { 'sec-fetch-site': 'same-origin' },
				})
			).json(),
			{
				registered: false,
				authenticated: false,
				username: null,
				csrfToken: null,
			}
		);

		const credentials = { username: USERNAME, password: PASSWORD };
		const registrationPayload = { ...credentials, setupToken: ADMIN_TOKEN };
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
					payload: { provider: 'openai', model: 'gpt-test', apiKey: 'provider-secret' },
				})
			).statusCode,
			401
		);
		assert.equal(
			(
				await server.inject({
					method: 'POST',
					url: '/config/auth/register',
					payload: credentials,
				})
			).statusCode,
			403
		);
		const untrustedRegistration = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin: PUBLIC_URL },
			payload: credentials,
		});
		assert.equal(untrustedRegistration.statusCode, 400);
		const wrongSetupToken = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin: PUBLIC_URL },
			payload: { ...credentials, setupToken: 'incorrect-setup-token' },
		});
		assert.equal(wrongSetupToken.statusCode, 401);
		const registration = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin: PUBLIC_URL },
			payload: registrationPayload,
		});
		assert.equal(registration.statusCode, 201);
		const registrationBody = registration.json<{ csrfToken: string; username: string }>();
		assert.equal(registrationBody.username, USERNAME);
		assert.match(registrationBody.csrfToken, /^[A-Za-z0-9_-]{43}$/);
		const cookie = sessionCookie(registration.headers['set-cookie']);
		assert.match(registration.headers['set-cookie'] ?? '', /__Host-kucedr-cloud_config=/);
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
			headers: { accept: 'text/html', cookie: '__Host-kucedr-cloud_config=invalid' },
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
					payload: registrationPayload,
				})
			).statusCode,
			409
		);
		const status = await server.inject({
			method: 'GET',
			url: '/config/auth/status',
			headers: { cookie, 'sec-fetch-site': 'same-origin' },
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
		assert.equal(authenticatedPage.statusCode, 200);
		assert.match(authenticatedPage.body, /href="\/config\/clients"/);
		assert.match(authenticatedPage.body, /href="\/config\/provider"/);
		assert.match(authenticatedPage.body, /href="\/config\/a2a"/);
		assert.doesNotMatch(authenticatedPage.body, /setup-provider-form/);
		const setupPage = await server.inject({
			method: 'GET',
			url: '/config/setup',
			headers: { cookie },
		});
		assert.equal(setupPage.statusCode, 302);
		assert.equal(setupPage.headers.location, '/config/provider');
		const authenticatedLogin = await server.inject({
			method: 'GET',
			url: '/config/login',
			headers: { cookie },
		});
		assert.equal(authenticatedLogin.statusCode, 302);
		assert.equal(authenticatedLogin.headers.location, '/config');
		const authenticatedRegistration = await server.inject({
			method: 'GET',
			url: '/config/register',
			headers: { cookie },
		});
		assert.equal(authenticatedRegistration.statusCode, 302);
		assert.equal(authenticatedRegistration.headers.location, '/config');
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/config/api',
					headers: { cookie, 'sec-fetch-site': 'same-origin' },
				})
			).statusCode,
			200
		);
		for (const url of ['/config/clients', '/config/provider', '/config/a2a']) {
			const page = await server.inject({ method: 'GET', url, headers: { cookie } });
			assert.equal(page.statusCode, 200);
			assert.equal(page.headers['cache-control'], 'no-store');
			const signedOut = await server.inject(url);
			assert.equal(signedOut.statusCode, 302);
			assert.equal(signedOut.headers.location, '/config/login');
		}
		const signedInRoot = await server.inject({ method: 'GET', url: '/', headers: { cookie } });
		assert.equal(signedInRoot.headers.location, '/config');
		assert.equal((await server.inject('/config/assets/page.js')).statusCode, 200);

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
						'x-kucedr-cloud-csrf': registrationBody.csrfToken,
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
						'x-kucedr-cloud-csrf': registrationBody.csrfToken,
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
		assert.equal(completedSetup.headers.location, '/config/provider');
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
						'x-kucedr-cloud-csrf': registrationBody.csrfToken,
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
		assert.equal(removedProviderPage.statusCode, 200);
		assert.equal(
			(
				await server.inject({
					method: 'PUT',
					url: '/config/provider',
					headers: {
						cookie,
						origin: PUBLIC_URL,
						'x-kucedr-cloud-csrf': registrationBody.csrfToken,
					},
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
					headers: {
						cookie,
						origin: PUBLIC_URL,
						'x-kucedr-cloud-csrf': registrationBody.csrfToken,
					},
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
			headers: { cookie, origin: PUBLIC_URL },
		});
		assert.equal(persisted.json<{ authenticated: boolean }>().authenticated, true);

		const logoutWithoutCsrf = await server.inject({
			method: 'DELETE',
			url: '/config/auth/session',
			headers: { cookie, origin: PUBLIC_URL },
		});
		assert.equal(logoutWithoutCsrf.statusCode, 403);
		const logout = await server.inject({
			method: 'DELETE',
			url: '/config/auth/session',
			headers: { cookie, origin: PUBLIC_URL, 'x-kucedr-cloud-csrf': registrationBody.csrfToken },
		});
		assert.equal(logout.statusCode, 204);
		assert.match(logout.headers['set-cookie'] ?? '', /Max-Age=0/);
		assert.equal(
			(
				await server.inject({
					method: 'GET',
					url: '/config/api',
					headers: { cookie, origin: PUBLIC_URL },
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
		const loginResponse = await login(server, `  ${USERNAME.toUpperCase()}  `, PASSWORD);
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

test('authentication and configuration APIs reject requests outside the application origin', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-config-origin-'));
	const server = createServer(directory);
	try {
		for (const [method, url] of [
			['GET', '/config/auth/status'],
			['POST', '/config/auth/register'],
			['POST', '/config/auth/session'],
			['DELETE', '/config/auth/session'],
			['GET', '/config'],
			['GET', '/config/api'],
			['PUT', '/config/provider'],
			['DELETE', '/config/provider'],
			['POST', '/config/clients'],
			['DELETE', '/config/clients/11111111-1111-4111-8111-111111111111'],
		] as const) {
			for (const headers of [
				{},
				{ origin: 'https://external.example' },
				{ origin: 'null' },
				{ origin: PUBLIC_URL, 'sec-fetch-site': 'cross-site' },
				{ origin: PUBLIC_URL, 'sec-fetch-site': 'same-site' },
				{ origin: 'https://external.example', 'sec-fetch-site': 'same-origin' },
			]) {
				const response = await server.inject({ method, url, headers });
				assert.equal(response.statusCode, 403, `${method} ${url} ${JSON.stringify(headers)}`);
				assert.equal(response.headers['set-cookie'], undefined);
				assert.equal(response.headers['cache-control'], 'no-store');
			}
			if (method !== 'GET') {
				const response = await server.inject({
					method,
					url,
					headers: { 'sec-fetch-site': 'same-origin' },
				});
				assert.equal(response.statusCode, 403, `${method} ${url} without Origin`);
			}
		}
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('configuration APIs reject bearer credentials even alongside an authenticated browser session', async () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-config-bearer-'));
	const server = createServer(directory);
	try {
		const registration = await server.inject({
			method: 'POST',
			url: '/config/auth/register',
			headers: { origin: PUBLIC_URL },
			payload: { username: USERNAME, password: PASSWORD, setupToken: ADMIN_TOKEN },
		});
		assert.equal(registration.statusCode, 201);
		const cookie = sessionCookie(registration.headers['set-cookie']);
		const csrf = registration.json<{ csrfToken: string }>().csrfToken;
		for (const [method, url] of [
			['GET', '/config/auth/status'],
			['POST', '/config/auth/register'],
			['POST', '/config/auth/session'],
			['DELETE', '/config/auth/session'],
			['GET', '/config'],
			['GET', '/config/api'],
			['PUT', '/config/provider'],
			['DELETE', '/config/provider'],
			['POST', '/config/clients'],
			['DELETE', '/config/clients/11111111-1111-4111-8111-111111111111'],
		] as const) {
			for (const authorization of [`Bearer ${ADMIN_TOKEN}`, 'Bearer a2a-access-token', '']) {
				for (const session of ['', cookie]) {
					const response = await server.inject({
						method,
						url,
						headers: {
							authorization,
							cookie: session,
							origin: PUBLIC_URL,
							'x-kucedr-cloud-csrf': csrf,
						},
					});
					assert.equal(response.statusCode, 401, `${method} ${url} with Authorization`);
					assert.equal(response.headers['set-cookie'], undefined);
				}
			}
		}
		const status = await server.inject({
			method: 'GET',
			url: '/config/auth/status',
			headers: { cookie, 'sec-fetch-site': 'same-origin' },
		});
		assert.equal(status.statusCode, 200);
		assert.equal(status.json<{ authenticated: boolean }>().authenticated, true);
	} finally {
		await server.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('loopback HTTP uses a non-Secure development cookie', () => {
	const cookie = setConfigurationCookie('token', 'http://127.0.0.1:3000');
	assert.match(cookie, /^kucedr-cloud_config_session=/);
	assert.doesNotMatch(cookie, /; Secure/);
});

function createServer(directory: string) {
	const server = Fastify({ logger: false });
	const store = new ConfigurationStore(directory, CONFIGURATION_KEY);
	const issuer = new OAuthIssuer(store, PUBLIC_URL);
	const limiter = new RequestLimiter();
	registerConfigurationAuthenticationRoutes(server, store, ADMIN_TOKEN, PUBLIC_URL, limiter);
	registerConfigurationUiRoutes(server, store, PUBLIC_URL, issuer, limiter);
	registerConfigurationRoutes(server, store, PUBLIC_URL, limiter);
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
		headers: { origin: PUBLIC_URL },
		payload: { username, password },
	});
}
