import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestLimiter } from '../oauth/limit';
import { csrfToken } from './session';
import { equalText } from './equal';
import { configurationPrincipal } from './principal';
import type { ConfigurationStore } from './store';

type ConfigurationAuthentication = (
	request: FastifyRequest,
	reply: FastifyReply
) => Promise<unknown>;

export function createConfigurationAuthentication(
	store: ConfigurationStore,
	adminToken: string,
	publicUrl: string,
	limiter: RequestLimiter
): ConfigurationAuthentication {
	return async (request, reply): Promise<unknown> => {
		reply.header('cache-control', 'no-store');
		if (!limiter.consume(`config:${request.ip}`, 30, 60_000)) {
			return reply.code(429).header('retry-after', '60').send({ error: 'Too Many Requests' });
		}
		const principal = configurationPrincipal(request, store, adminToken, publicUrl);
		if (!principal) {
			return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'Unauthorized' });
		}
		if (principal.method === 'ui-session' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
			const administrator = store.administrator();
			const origin = request.headers.origin;
			const submitted = request.headers['x-kucedr-cloud-csrf'];
			if (
				!administrator ||
				origin !== publicUrl ||
				typeof submitted !== 'string' ||
				!equalText(submitted, csrfToken(principal.token, administrator))
			) {
				return reply.code(403).send({ error: 'Forbidden' });
			}
		}
	};
}
