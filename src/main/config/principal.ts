import type { FastifyRequest } from 'fastify';
import { readConfigurationCookie } from './cookie';
import { sessionHash } from './session';
import type { ConfigurationStore } from './store';

export type ConfigurationPrincipal = { subject: string; token: string };

export function configurationPrincipal(
	request: FastifyRequest,
	store: ConfigurationStore,
	publicUrl: string
): ConfigurationPrincipal | undefined {
	if (request.headers.authorization !== undefined) return undefined;
	const token = readConfigurationCookie(request.headers.cookie, publicUrl);
	const administrator = store.administrator();
	if (!token || !administrator || !store.hasSession(sessionHash(token), Date.now()))
		return undefined;
	return { subject: administrator.username, token };
}
