import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import { clearConfigurationCookie, setConfigurationCookie } from './cookie';
import { equalText } from './equal';
import { hashPassword } from './password';
import { configurationPrincipal } from './principal';
import { csrfToken, newSession, sessionHash } from './session';
import type { ConfigurationStore } from './store';
import type { AdministratorCredentials } from './types';
import { normalizeUsername } from './username';

interface CredentialsBody {
	password: string;
	username: string;
}

const credentialsSchema = {
	body: {
		type: 'object',
		required: ['username', 'password'],
		additionalProperties: false,
		properties: {
			username: { type: 'string', minLength: 1, maxLength: 100 },
			password: { type: 'string', minLength: 1, maxLength: 1024 },
		},
	},
} as const;

export function registerConfigurationAuthenticationRoutes(
	server: FastifyInstance,
	store: ConfigurationStore,
	adminToken: string,
	publicUrl: string,
	limiter: RequestLimiter
): void {
	server.get('/config/auth/status', async (request, reply) => {
		const administrator = store.administrator();
		const principal = configurationPrincipal(request, store, adminToken, publicUrl);
		const session = principal?.method === 'ui-session' ? principal : undefined;
		return reply.header('cache-control', 'no-store').send({
			registered: Boolean(administrator),
			authenticated: Boolean(session),
			username: session?.subject ?? null,
			csrfToken: session && administrator ? csrfToken(session.token, administrator) : null,
		});
	});

	server.post<{ Body: CredentialsBody }>(
		'/config/auth/register',
		{ schema: credentialsSchema },
		async (request, reply) => {
			reply.header('cache-control', 'no-store');
			if (!limiter.consume(`config-register:${request.ip}`, 5, 60_000)) {
				return reply.code(429).header('retry-after', '60').send({ error: 'Too Many Requests' });
			}
			const bearer = equalText(request.headers.authorization ?? '', `Bearer ${adminToken}`);
			if (!bearer && request.headers.origin !== publicUrl) {
				return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'Unauthorized' });
			}
			if (store.administrator())
				return reply.code(409).send({ error: 'Registration is complete.' });
			const username = normalizeUsername(request.body.username);
			if (!username) {
				return reply
					.code(400)
					.send({ error: 'Use 3–64 lowercase letters, numbers, dots, dashes, or underscores.' });
			}
			if (
				request.body.password.length < 12 ||
				Buffer.byteLength(request.body.password, 'utf8') > 1024
			) {
				return reply.code(400).send({ error: 'Password must be 12–1024 UTF-8 bytes.' });
			}
			const salt = randomBytes(16).toString('base64url');
			const administrator: AdministratorCredentials = {
				version: 1,
				createdAt: new Date().toISOString(),
				digest: await hashPassword(request.body.password, salt),
				salt,
				sessionSecret: randomBytes(32).toString('base64url'),
				username,
			};
			if (!store.setAdministrator(administrator)) {
				return reply.code(409).send({ error: 'Registration is complete.' });
			}
			const session = newSession();
			store.addSession(session.record, Date.now());
			request.log.info({ event: 'config.administrator.registered', username });
			return reply
				.code(201)
				.header('set-cookie', setConfigurationCookie(session.token, publicUrl))
				.send({ username, csrfToken: csrfToken(session.token, administrator) });
		}
	);

	server.post<{ Body: CredentialsBody }>(
		'/config/auth/session',
		{ schema: credentialsSchema },
		async (request, reply) => {
			reply.header('cache-control', 'no-store');
			if (!limiter.consume(`config-login:${request.ip}`, 10, 60_000)) {
				return reply.code(429).header('retry-after', '60').send({ error: 'Too Many Requests' });
			}
			const administrator = store.administrator();
			const username = normalizeUsername(request.body.username) ?? '';
			const salt = administrator?.salt ?? Buffer.alloc(16).toString('base64url');
			const digest = await hashPassword(request.body.password, salt);
			if (
				!administrator ||
				!equalText(username, administrator.username) ||
				!equalText(digest, administrator.digest)
			) {
				return reply.code(401).send({ error: 'Invalid username or password.' });
			}
			const session = newSession();
			store.addSession(session.record, Date.now());
			request.log.info({ event: 'config.session.created', username });
			return reply
				.header('set-cookie', setConfigurationCookie(session.token, publicUrl))
				.send({ username, csrfToken: csrfToken(session.token, administrator) });
		}
	);

	server.delete('/config/auth/session', async (request, reply) => {
		reply.header('cache-control', 'no-store');
		const principal = configurationPrincipal(request, store, adminToken, publicUrl);
		if (!principal || principal.method !== 'ui-session') {
			return reply.code(401).send({ error: 'Unauthorized' });
		}
		if (!validCsrf(request, principal.token, store, publicUrl)) {
			return reply.code(403).send({ error: 'Forbidden' });
		}
		store.deleteSession(sessionHash(principal.token));
		request.log.info({ event: 'config.session.deleted', username: principal.subject });
		return reply.code(204).header('set-cookie', clearConfigurationCookie(publicUrl)).send();
	});
}

function validCsrf(
	request: FastifyRequest,
	token: string,
	store: ConfigurationStore,
	publicUrl: string
): boolean {
	const administrator = store.administrator();
	const submitted = request.headers['x-kucedr-cloud-csrf'];
	return Boolean(
		administrator &&
		request.headers.origin === publicUrl &&
		typeof submitted === 'string' &&
		equalText(submitted, csrfToken(token, administrator))
	);
}
