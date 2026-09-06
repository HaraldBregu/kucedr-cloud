import type { ResolvedProvider, StoredProvider } from '../shared/provider_types';
import { providerBaseUrl } from '../provider/base';
import { configuredProvider } from '../config/provider';

export function getProvider(id: string): StoredProvider | undefined {
	const configured = configuredProvider(id.trim());
	if (!configured || id.trim() !== configured.provider) return undefined;
	return {
		id: configured.provider,
		name: configured.provider,
		apiKey: configured.apiKey,
		baseUrl: providerBaseUrl(configured.provider),
	};
}

export function getResolvedProvider(providerId: string | undefined): ResolvedProvider | undefined {
	const provider = providerId ? getProvider(providerId) : undefined;
	if (!provider) return undefined;
	return { id: provider.id, apiKey: provider.apiKey, baseURL: provider.baseUrl };
}
