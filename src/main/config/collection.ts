import { PROVIDERS, type ProviderId } from '../provider/types';
import type { ProviderCollection } from './types';

export function providerCollection(value: unknown): ProviderCollection {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('The encrypted provider configuration is invalid.');
	}
	const stored = value as Partial<ProviderCollection> & { provider?: ProviderId };
	const collection = stored.provider
		? { active: stored.provider, configurations: [stored] }
		: stored;
	if (
		!Array.isArray(collection.configurations) ||
		collection.configurations.some(
			(provider) =>
				!provider ||
				!PROVIDERS.includes(provider.provider) ||
				typeof provider.model !== 'string' ||
				!provider.model.trim() ||
				typeof provider.apiKey !== 'string' ||
				!provider.apiKey.trim()
		) ||
		new Set(collection.configurations.map((provider) => provider.provider)).size !==
			collection.configurations.length ||
		(collection.active !== null &&
			!collection.configurations.some((provider) => provider.provider === collection.active))
	) {
		throw new Error('The encrypted provider configuration is invalid.');
	}
	return {
		active: collection.active as ProviderId | null,
		configurations: collection.configurations.map((provider) => ({
			provider: provider.provider,
			model: provider.model.trim(),
			apiKey: provider.apiKey.trim(),
		})),
	};
}
