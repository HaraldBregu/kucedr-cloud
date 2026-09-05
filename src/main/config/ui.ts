import fs from 'node:fs';
import { registerFontRoutes } from '../fonts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import type { OAuthIssuer } from '../oauth/issuer';
import { createConfigurationAuthentication } from './auth';
import { configurationPrincipal } from './principal';
import { configurationResponse } from './response';
import type { ConfigurationStore } from './store';

const html = fs.readFileSync(new URL('../../ui/config.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('../../ui/config.js', import.meta.url), 'utf8');
const configStyles = fs.readFileSync(new URL('../../ui/config.css', import.meta.url), 'utf8');
const sharedStyles = fs.readFileSync(new URL('../../ui/styles.css', import.meta.url), 'utf8');

export function registerConfigurationUiRoutes(
	server: FastifyInstance,
	store: ConfigurationStore,
	adminToken: string,
	publicUrl: string,
	issuer: OAuthIssuer,
	limiter: RequestLimiter
): void {
	registerFontRoutes(server);
	const authenticate = createConfigurationAuthentication(store, adminToken, publicUrl, limiter);
	const sendPage = (reply: FastifyReply) =>
		reply
			.header('cache-control', 'no-store')
			.header(
				'content-security-policy',
				"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
			)
			.header('referrer-policy', 'no-referrer')
			.header('x-content-type-options', 'nosniff')
			.header('x-frame-options', 'DENY')
			.type('text/html; charset=utf-8')
			.send(html);
	server.get('/', async (_request, reply) =>
		reply
			.header('cache-control', 'no-store')
			.redirect(store.administrator() ? '/config/login' : '/config/register')
	);
	server.get('/config/assets/styles.css', async (_request, reply) =>
		reply.header('cache-control', 'no-store').type('text/css').send(sharedStyles)
	);
	server.get('/config/assets/config.css', async (_request, reply) =>
		reply.header('cache-control', 'no-store').type('text/css').send(configStyles)
	);
	server.get('/config/assets/config.js', async (_request, reply) =>
		reply.header('cache-control', 'no-store').type('application/javascript').send(script)
	);
	server.get('/config', async (request, reply) => {
		if (request.headers.accept?.toLowerCase().includes('text/html')) {
			const principal = configurationPrincipal(request, store, adminToken, publicUrl);
			if (principal?.method !== 'ui-session') {
				return reply
					.header('cache-control', 'no-store')
					.header('vary', 'Accept')
					.redirect(store.administrator() ? '/config/login' : '/config/register');
			}
			if (!store.provider()) {
				return reply
					.header('cache-control', 'no-store')
					.header('vary', 'Accept')
					.redirect('/config/setup');
			}
			return sendPage(reply.header('vary', 'Accept'));
		}
		await authenticate(request, reply);
		if (reply.sent) return;
		return reply.header('vary', 'Accept').send(configurationResponse(store, issuer));
	});
	server.get('/config/api', { onRequest: authenticate }, async (_request, reply) =>
		reply.header('cache-control', 'no-store').send(configurationResponse(store, issuer))
	);
	server.get('/config/register', async (request, reply) => {
		if (configurationPrincipal(request, store, adminToken, publicUrl)?.method === 'ui-session') {
			return reply
				.header('cache-control', 'no-store')
				.redirect(store.provider() ? '/config' : '/config/setup');
		}
		if (store.administrator()) {
			return reply.header('cache-control', 'no-store').redirect('/config/login');
		}
		return sendPage(reply);
	});
	server.get('/config/login', async (request, reply) => {
		if (configurationPrincipal(request, store, adminToken, publicUrl)?.method === 'ui-session') {
			return reply
				.header('cache-control', 'no-store')
				.redirect(store.provider() ? '/config' : '/config/setup');
		}
		if (!store.administrator()) {
			return reply.header('cache-control', 'no-store').redirect('/config/register');
		}
		return sendPage(reply);
	});
	server.get('/config/setup', async (request, reply) => {
		if (configurationPrincipal(request, store, adminToken, publicUrl)?.method !== 'ui-session') {
			return reply
				.header('cache-control', 'no-store')
				.redirect(store.administrator() ? '/config/login' : '/config/register');
		}
		if (store.provider()) {
			return reply.header('cache-control', 'no-store').redirect('/config');
		}
		return sendPage(reply);
	});
}
