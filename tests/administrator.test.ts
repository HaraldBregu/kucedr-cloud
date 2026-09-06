import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerConfigurationAuthenticationRoutes } from '../src/main/config/auth_routes';
import { sessionHash } from '../src/main/config/session';
import { ConfigurationStore } from '../src/main/config/store';
import { RequestLimiter } from '../src/main/oauth/limit';

test('administrator updates validate credentials, revoke sessions, and persist encrypted changes', async () => {
	const key = Buffer.from('77'.repeat(32), 'hex');
	const origin = 'https://administrator.example';
	const username = 'original administrator';
	const password = 'original-password-sentinel';
	const replacementPassword = 'replacement-password-sentinel';
	for (const change of ['username', 'password', 'both', 'concurrent'] as const) {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-administrator-'));
		const server = Fastify({ logger: false });
		const store = new ConfigurationStore(directory, key);
		registerConfigurationAuthenticationRoutes(server, store, origin, new RequestLimiter());
		try {
			const registered = await server.inject({
				method: 'POST',
				url: '/config/auth/register',
				headers: { origin },
				payload: { username, password },
			});
			assert.equal(registered.statusCode, 201);
			const cookie = String(registered.headers['set-cookie']).split(';')[0];
			const headers = { origin, cookie, 'x-kucedr-cloud-csrf': registered.json().csrfToken };
			const secondLogin = await server.inject({
				method: 'POST',
				url: '/config/auth/session',
				headers: { origin },
				payload: { username, password },
			});
			assert.equal(secondLogin.statusCode, 200);
			const secondCookie = String(secondLogin.headers['set-cookie']).split(';')[0];
			const before = store.administrator()!;
			const nextUsername = change === 'password' ? username : 'zoë / 東京!';
			const payload = {
				username: change === 'password' ? username : '  ZOË / 東京!  ',
				currentPassword: password,
				...(change === 'password' || change === 'both' ? { newPassword: replacementPassword } : {}),
			};

			if (change === 'username') {
				for (const [requestHeaders, expected] of [
					[{ origin }, 401],
					[{ ...headers, origin: 'https://external.example' }, 403],
					[{ origin, cookie }, 403],
					[{ ...headers, authorization: 'Bearer forbidden' }, 401],
				] as const) {
					const rejected = await server.inject({
						method: 'PUT',
						url: '/config/administrator',
						headers: requestHeaders,
						payload,
					});
					assert.equal(rejected.statusCode, expected);
				}
				for (const invalid of [
					{ ...payload, currentPassword: 'incorrect-password' },
					{ ...payload, username: '   ' },
					{ ...payload, username: 'x'.repeat(101) },
					{ ...payload, newPassword: 'short' },
					{ ...payload, newPassword: '界'.repeat(400) },
					{ ...payload, username },
				]) {
					const rejected = await server.inject({
						method: 'PUT',
						url: '/config/administrator',
						headers,
						payload: invalid,
						remoteAddress: `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
					});
					assert.equal(rejected.statusCode, 400, rejected.body);
					assert.equal(rejected.headers['set-cookie'], undefined);
					assert.deepEqual(store.administrator(), before);
					assert.equal(store.hasSession(sessionHash(cookie.split('=')[1]), Date.now()), true);
				}
			}

			const responses = await Promise.all(
				Array.from({ length: change === 'concurrent' ? 2 : 1 }, () =>
					server.inject({
						method: 'PUT',
						url: '/config/administrator',
						headers,
						payload,
					})
				)
			);
			const success = responses.find((response) => response.statusCode === 204);
			assert.ok(success, responses.map((response) => response.body).join('\n'));
			assert.match(String(success.headers['set-cookie']), /Max-Age=0/);
			assert.equal(success.headers['cache-control'], 'no-store');
			if (change === 'concurrent') {
				assert.deepEqual(responses.map((response) => response.statusCode).sort(), [204, 409]);
			}
			const after = store.administrator()!;
			assert.equal(after.username, nextUsername);
			assert.equal(after.createdAt, before.createdAt);
			assert.notEqual(after.sessionSecret, before.sessionSecret);
			if (change === 'username' || change === 'concurrent') {
				assert.equal(after.salt, before.salt);
				assert.equal(after.digest, before.digest);
			} else {
				assert.notEqual(after.salt, before.salt);
				assert.notEqual(after.digest, before.digest);
			}
			assert.equal(
				store.updateAdministrator(before, before, sessionHash(cookie.split('=')[1])),
				false
			);
			for (const revokedCookie of [cookie, secondCookie]) {
				const status = await server.inject({
					method: 'GET',
					url: '/config/auth/status',
					headers: { origin, cookie: revokedCookie },
				});
				assert.equal(status.json().authenticated, false);
				assert.equal(status.json().csrfToken, null);
			}
			assert.equal(
				(
					await server.inject({
						method: 'POST',
						url: '/config/auth/session',
						headers: { origin },
						payload: { username, password },
					})
				).statusCode,
				401
			);
			const newPassword =
				change === 'password' || change === 'both' ? replacementPassword : password;
			const freshLogin = await server.inject({
				method: 'POST',
				url: '/config/auth/session',
				headers: { origin },
				payload: { username: nextUsername.toUpperCase(), password: newPassword },
			});
			assert.equal(freshLogin.statusCode, 200);
			const restarted = new ConfigurationStore(directory, key);
			assert.deepEqual(restarted.administrator(), after);
			const disk = fs.readFileSync(path.join(directory, 'secure-config.json'), 'utf8');
			for (const secret of [
				password,
				replacementPassword,
				before.digest,
				after.digest,
				after.sessionSecret,
			]) {
				assert.equal(disk.includes(secret), false);
				assert.equal(success.body.includes(secret), false);
			}
			assert.equal(fs.statSync(path.join(directory, 'secure-config.json')).mode & 0o777, 0o600);
		} finally {
			await server.close();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	}
});
