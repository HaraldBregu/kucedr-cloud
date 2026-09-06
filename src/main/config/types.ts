import type { JWK } from 'jose';
import type {
	ProviderConfiguration,
	ProviderId,
	PublicProviderConfiguration,
} from '../provider/types';

export interface SealedValue {
	iv: string;
	tag: string;
	value: string;
}

export interface StoredClient {
	clientId: string;
	createdAt: string;
	keyThumbprint: string;
	name: string;
	publicKey: JWK;
}

export interface StoredAssertion {
	expiresAt: number;
	key: string;
}

export interface AdministratorCredentials {
	createdAt: string;
	digest: string;
	salt: string;
	sessionSecret: string;
	username: string;
	version: 1;
}

export interface ConfigurationSession {
	createdAt: string;
	expiresAt: number;
	tokenHash: string;
}

export interface StoredConfiguration {
	administrator?: SealedValue;
	assertions: StoredAssertion[];
	clients: StoredClient[];
	provider?: SealedValue;
	sessions: ConfigurationSession[];
	signingPrivateKey: SealedValue;
	signingPublicKey: JWK;
	version: 1;
}

export interface OAuthConfiguration {
	issuer: string;
	resource: string;
	scope: string;
	tokenEndpoint: string;
	tokenEndpointAuthMethod: 'private_key_jwt';
}

export interface ProviderCollection {
	active: ProviderId | null;
	configurations: ProviderConfiguration[];
}

export interface PublicConfiguration {
	providers: Array<PublicProviderConfiguration & { active: boolean }>;
	clients: Array<Omit<StoredClient, 'publicKey'>>;
	provider: {
		configured: boolean;
		hasApiKey: boolean;
		model: string | null;
		provider: ProviderConfiguration['provider'] | null;
	};
}

export interface ConfigurationResponse extends PublicConfiguration {
	oauth: OAuthConfiguration;
}
