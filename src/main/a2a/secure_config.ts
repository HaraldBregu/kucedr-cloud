import path from 'node:path';
import { decodeConfigurationKey } from '../config/key';
import { resolvePublicUrl } from './public_url';

export interface SecureA2aConfig {
	appUrl: string;
	dataDirectory: string;
	encryptionKey: Buffer;
	publicUrl: string;
	tasksDirectory: string;
	workspaceDirectory: string;
}

interface SecureA2aConfigInput {
	appUrl?: string | null;
	configurationKey?: string | null;
	dataDirectory: string;
	publicUrl?: string | null;
}

export function resolveSecureA2aConfig(input: SecureA2aConfigInput): SecureA2aConfig {
	const appUrl =
		input.appUrl === undefined
			? process.env.KUCEDR_CLOUD_APP_URL?.trim() || 'http://127.0.0.1:3001'
			: input.appUrl?.trim();
	const rawKey =
		input.configurationKey === undefined
			? process.env.KUCEDR_CLOUD_ENCRYPTION_KEY?.trim()
			: input.configurationKey?.trim();
	const publicUrl =
		input.publicUrl === undefined
			? process.env.KUCEDR_CLOUD_PUBLIC_URL?.trim()
			: input.publicUrl?.trim();
	if (!rawKey) throw new Error('KUCEDR_CLOUD_ENCRYPTION_KEY is required.');
	if (!publicUrl) throw new Error('KUCEDR_CLOUD_PUBLIC_URL is required.');
	if (!appUrl) throw new Error('KUCEDR_CLOUD_APP_URL is required.');
	const resolvedAppUrl = resolvePublicUrl(appUrl, 'KUCEDR_CLOUD_APP_URL');
	const resolvedPublicUrl = resolvePublicUrl(publicUrl);
	if (resolvedAppUrl === resolvedPublicUrl) {
		throw new Error('KUCEDR_CLOUD_APP_URL must differ from KUCEDR_CLOUD_PUBLIC_URL.');
	}
	const dataDirectory = path.resolve(input.dataDirectory);
	return {
		appUrl: resolvedAppUrl,
		dataDirectory,
		encryptionKey: decodeConfigurationKey(rawKey),
		publicUrl: resolvedPublicUrl,
		tasksDirectory: path.join(dataDirectory, 'a2a', 'tasks'),
		workspaceDirectory: path.join(dataDirectory, 'workspace'),
	};
}
