import path from 'node:path';
import { decodeConfigurationKey } from '../config/key';
import { resolvePublicUrl } from './public_url';

export interface SecureA2aConfig {
	adminToken: string;
	appUrl: string;
	dataDirectory: string;
	encryptionKey: Buffer;
	publicUrl: string;
	tasksDirectory: string;
	workspaceDirectory: string;
}

interface SecureA2aConfigInput {
	adminToken?: string | null;
	appUrl?: string | null;
	configurationKey?: string | null;
	dataDirectory: string;
	publicUrl?: string | null;
}

export function resolveSecureA2aConfig(input: SecureA2aConfigInput): SecureA2aConfig {
	const adminToken =
		input.adminToken === undefined
			? process.env.KUCEDR_CLOUD_ADMIN_TOKEN?.trim()
			: input.adminToken?.trim();
	const appUrl =
		input.appUrl === undefined
			? process.env.KUCEDR_CLOUD_APP_URL?.trim() || 'http://127.0.0.1:3001'
			: input.appUrl?.trim();
	const rawKey =
		input.configurationKey === undefined
			? process.env.KUCEDR_CLOUD_CONFIG_KEY?.trim()
			: input.configurationKey?.trim();
	const publicUrl =
		input.publicUrl === undefined
			? process.env.KUCEDR_CLOUD_PUBLIC_URL?.trim()
			: input.publicUrl?.trim();
	if (!adminToken || Buffer.byteLength(adminToken, 'utf8') < 32) {
		throw new Error('KUCEDR_CLOUD_ADMIN_TOKEN must contain at least 32 UTF-8 bytes.');
	}
	if (!rawKey) throw new Error('KUCEDR_CLOUD_CONFIG_KEY is required.');
	if (!publicUrl) throw new Error('KUCEDR_CLOUD_PUBLIC_URL is required.');
	if (!appUrl) throw new Error('KUCEDR_CLOUD_APP_URL is required.');
	const resolvedAppUrl = resolvePublicUrl(appUrl, 'KUCEDR_CLOUD_APP_URL');
	const resolvedPublicUrl = resolvePublicUrl(publicUrl);
	if (resolvedAppUrl === resolvedPublicUrl) {
		throw new Error('KUCEDR_CLOUD_APP_URL must differ from KUCEDR_CLOUD_PUBLIC_URL.');
	}
	const dataDirectory = path.resolve(input.dataDirectory);
	return {
		adminToken,
		appUrl: resolvedAppUrl,
		dataDirectory,
		encryptionKey: decodeConfigurationKey(rawKey),
		publicUrl: resolvedPublicUrl,
		tasksDirectory: path.join(dataDirectory, 'a2a', 'tasks'),
		workspaceDirectory: path.join(dataDirectory, 'workspace'),
	};
}
