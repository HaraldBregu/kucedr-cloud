import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import { createConfigurationAuthentication } from './auth';
import { clearConfigurationCookie } from './cookie';
import { equalText } from './equal';
import { hashPassword } from './password';
import { configurationPrincipal } from './principal';
import { sessionHash } from './session';
import type { ConfigurationStore } from './store';
import { normalizeUsername } from './username';

interface AccountBody {
	username: string;
	currentPassword: string;
	newPassword?: string;
}

export function registerAdministratorRoutes(
	server: FastifyInstance,
	store: ConfigurationStore,
	publicUrl: string,
	limiter: RequestLimiter
): void {
	server.put<{ Body: AccountBody }>(
		'/config/administrator',
		{
			onRequest: createConfigurationAuthentication(store, publicUrl, limiter),
			schema: {
				body: {
					type: 'object',
					required: ['username', 'currentPassword'],
					additionalProperties: false,
					properties: {
						username: { type: 'string', minLength: 1, maxLength: 100 },
						currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
						newPassword: { type: 'string', minLength: 12, maxLength: 1024 },
					},
				},
			},
		},
		async (request, reply) => {
			reply.header('cache-control', 'no-store');
			if (!limiter.consume(`config-account:${request.ip}`, 5, 60_000)) {
				return reply.code(429).header('retry-after', '60').send({ error: 'Too Many Requests' });
			}
			const administrator = store.administrator();
			const principal = configurationPrincipal(request, store, publicUrl);
			if (!administrator || !principal) return reply.code(401).send({ error: 'Unauthorized' });
			const username = normalizeUsername(request.body.username);
			if (!username)
				return reply
					.code(400)
					.send({ error: 'Choose a nonblank username of up to 100 characters.' });
			const newPassword = request.body.newPassword;
			if (
				newPassword &&
				(newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 1024)
			) {
				return reply
					.code(400)
					.send({
						error: 'Password must contain at least 12 characters and at most 1024 UTF-8 bytes.',
					});
			}
			const currentDigest = await hashPassword(request.body.currentPassword, administrator.salt);
			if (!equalText(currentDigest, administrator.digest)) {
				return reply.code(400).send({ error: 'Current password is incorrect.' });
			}
			if (username === administrator.username && !newPassword) {
				return reply.code(400).send({ error: 'Change your username or enter a new password.' });
			}
			const salt = newPassword ? randomBytes(16).toString('base64url') : administrator.salt;
			const replacement = {
				...administrator,
				username,
				salt,
				digest: newPassword ? await hashPassword(newPassword, salt) : administrator.digest,
				sessionSecret: randomBytes(32).toString('base64url'),
			};
			if (!store.updateAdministrator(administrator, replacement, sessionHash(principal.token))) {
				return reply
					.code(409)
					.send({ error: 'Your account or session changed. Log in again before retrying.' });
			}
			request.log.info({ event: 'config.administrator.updated' });
			return reply.code(204).header('set-cookie', clearConfigurationCookie(publicUrl)).send();
		}
	);
}
