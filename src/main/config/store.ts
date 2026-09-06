import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { importJWK, type JWK } from 'jose';
import type { ProviderConfiguration, ProviderId } from '../provider/types';
import { publicProvider } from '../provider/public';
import { providerCollection } from './collection';
import { seal } from './seal';
import type {
	AdministratorCredentials,
	ConfigurationSession,
	PublicConfiguration,
	ProviderCollection,
	SealedValue,
	StoredClient,
	StoredConfiguration,
} from './types';
import { unseal } from './unseal';

const FILE_NAME = 'secure-config.json';

export class ConfigurationStore {
	private document: StoredConfiguration;
	private readonly filePath: string;

	constructor(
		private readonly directory: string,
		private readonly encryptionKey: Buffer
	) {
		this.filePath = path.join(path.resolve(directory), FILE_NAME);
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		fs.chmodSync(path.dirname(this.filePath), 0o700);
		if (fs.existsSync(this.filePath)) {
			if (fs.lstatSync(this.filePath).isSymbolicLink()) {
				throw new Error('The secure configuration cannot be a symbolic link.');
			}
			this.document = this.parse(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
			unseal(this.document.signingPrivateKey, this.encryptionKey, 'signing-key');
			if (this.document.administrator) this.administrator();
			return;
		}

		const pair = generateKeyPairSync('ed25519');
		const keyId = randomUUID();
		const publicKey = pair.publicKey.export({ format: 'jwk' }) as JWK;
		const privateKey = pair.privateKey.export({ format: 'jwk' }) as JWK;
		this.document = {
			version: 1,
			assertions: [],
			clients: [],
			sessions: [],
			signingPublicKey: { ...publicKey, alg: 'EdDSA', use: 'sig', kid: keyId },
			signingPrivateKey: seal(
				{ ...privateKey, alg: 'EdDSA', use: 'sig', kid: keyId },
				this.encryptionKey,
				'signing-key'
			),
		};
		this.write();
	}

	administrator(): AdministratorCredentials | undefined {
		if (!this.document.administrator) return undefined;
		const value = unseal(this.document.administrator, this.encryptionKey, 'administrator');
		if (!this.validAdministrator(value)) {
			throw new Error('The encrypted administrator credentials are invalid.');
		}
		return structuredClone(value);
	}

	setAdministrator(administrator: AdministratorCredentials): boolean {
		if (this.document.administrator) return false;
		this.document.administrator = seal(administrator, this.encryptionKey, 'administrator');
		this.write();
		return true;
	}

	addSession(session: ConfigurationSession, now: number): void {
		this.document.sessions = this.document.sessions
			.filter((stored) => stored.expiresAt > now)
			.slice(-7);
		this.document.sessions.push(session);
		this.write();
	}

	hasSession(tokenHash: string, now: number): boolean {
		return this.document.sessions.some(
			(session) => session.tokenHash === tokenHash && session.expiresAt > now
		);
	}

	deleteSession(tokenHash: string): boolean {
		const sessions = this.document.sessions.filter((session) => session.tokenHash !== tokenHash);
		if (sessions.length === this.document.sessions.length) return false;
		this.document.sessions = sessions;
		this.write();
		return true;
	}

	publicConfiguration(): PublicConfiguration {
		const collection = this.providers();
		return {
			clients: this.document.clients.map(({ publicKey: _publicKey, ...client }) => ({ ...client })),
			provider: publicProvider(this.provider()),
			providers: collection.configurations.map((provider) => ({
				...publicProvider(provider),
				active: provider.provider === collection.active,
			})),
		};
	}

	providers(): ProviderCollection {
		if (!this.document.provider) return { active: null, configurations: [] };
		return providerCollection(unseal(this.document.provider, this.encryptionKey, 'provider'));
	}

	provider(id?: string): ProviderConfiguration | undefined {
		const collection = this.providers();
		return collection.configurations.find(
			(provider) => provider.provider === (id ?? collection.active)
		);
	}

	setProvider(provider: ProviderConfiguration): void {
		const collection = this.providers();
		if (!collection.configurations.length) collection.active = provider.provider;
		const index = collection.configurations.findIndex(
			(saved) => saved.provider === provider.provider
		);
		if (index === -1) collection.configurations.push(provider);
		else collection.configurations[index] = provider;
		this.document.provider = seal(collection, this.encryptionKey, 'provider');
		this.write();
	}

	activateProvider(id: ProviderId): boolean {
		const collection = this.providers();
		if (!collection.configurations.some((provider) => provider.provider === id)) return false;
		collection.active = id;
		this.document.provider = seal(collection, this.encryptionKey, 'provider');
		this.write();
		return true;
	}

	deleteProvider(id?: ProviderId): boolean {
		const collection = this.providers();
		const selected = id ?? collection.active;
		const remaining = collection.configurations.filter(
			(provider) => provider.provider !== selected
		);
		if (remaining.length === collection.configurations.length) return false;
		if (collection.active === selected) collection.active = null;
		collection.configurations = remaining;
		this.document.provider = seal(collection, this.encryptionKey, 'provider');
		this.write();
		return true;
	}

	clients(): StoredClient[] {
		return structuredClone(this.document.clients);
	}

	client(clientId: string): StoredClient | undefined {
		const client = this.document.clients.find((value) => value.clientId === clientId);
		return client ? structuredClone(client) : undefined;
	}

	addClient(name: string, publicKey: JWK, keyThumbprint: string): StoredClient {
		const client: StoredClient = {
			clientId: randomUUID(),
			createdAt: new Date().toISOString(),
			keyThumbprint,
			name,
			publicKey,
		};
		this.document.clients.push(client);
		this.write();
		return structuredClone(client);
	}

	deleteClient(clientId: string): boolean {
		const remaining = this.document.clients.filter((client) => client.clientId !== clientId);
		if (remaining.length === this.document.clients.length) return false;
		this.document.clients = remaining;
		this.write();
		return true;
	}

	consumeAssertion(clientId: string, jti: string, expiresAt: number, now: number): boolean {
		const key = createHash('sha256').update(clientId).update('\0').update(jti).digest('base64url');
		const assertions = this.document.assertions.filter((assertion) => assertion.expiresAt >= now);
		if (assertions.some((assertion) => assertion.key === key) || assertions.length >= 10_000) {
			return false;
		}
		assertions.push({ expiresAt, key });
		this.document.assertions = assertions;
		this.write();
		return true;
	}

	publicSigningKey(): JWK {
		return structuredClone(this.document.signingPublicKey);
	}

	async privateSigningKey(): Promise<Awaited<ReturnType<typeof importJWK>>> {
		const value = unseal(this.document.signingPrivateKey, this.encryptionKey, 'signing-key');
		return importJWK(value as JWK, 'EdDSA');
	}

	private parse(value: unknown): StoredConfiguration {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error('The secure configuration is invalid.');
		}
		const document = value as Partial<StoredConfiguration>;
		const assertions = document.assertions ?? [];
		const sessions = document.sessions ?? [];
		if (
			document.version !== 1 ||
			!Array.isArray(assertions) ||
			assertions.some(
				(assertion) =>
					!assertion ||
					!Number.isInteger(assertion.expiresAt) ||
					typeof assertion.key !== 'string' ||
					!/^[A-Za-z0-9_-]{43}$/.test(assertion.key)
			) ||
			!Array.isArray(document.clients) ||
			!Array.isArray(sessions) ||
			sessions.some(
				(session) =>
					!session ||
					typeof session.createdAt !== 'string' ||
					!Number.isInteger(session.expiresAt) ||
					typeof session.tokenHash !== 'string' ||
					!/^[A-Za-z0-9_-]{43}$/.test(session.tokenHash)
			) ||
			!this.sealed(document.signingPrivateKey) ||
			!document.signingPublicKey ||
			typeof document.signingPublicKey !== 'object' ||
			(document.provider !== undefined && !this.sealed(document.provider)) ||
			(document.administrator !== undefined && !this.sealed(document.administrator)) ||
			document.clients.some(
				(client) =>
					!client ||
					typeof client.clientId !== 'string' ||
					typeof client.createdAt !== 'string' ||
					typeof client.keyThumbprint !== 'string' ||
					typeof client.name !== 'string' ||
					!client.publicKey ||
					typeof client.publicKey !== 'object'
			)
		) {
			throw new Error('The secure configuration is invalid.');
		}
		return structuredClone({ ...document, assertions, sessions } as StoredConfiguration);
	}

	private validAdministrator(value: unknown): value is AdministratorCredentials {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const administrator = value as Partial<AdministratorCredentials>;
		return (
			administrator.version === 1 &&
			typeof administrator.createdAt === 'string' &&
			typeof administrator.digest === 'string' &&
			/^[A-Za-z0-9_-]{86}$/.test(administrator.digest) &&
			typeof administrator.salt === 'string' &&
			/^[A-Za-z0-9_-]{22}$/.test(administrator.salt) &&
			typeof administrator.sessionSecret === 'string' &&
			/^[A-Za-z0-9_-]{43}$/.test(administrator.sessionSecret) &&
			typeof administrator.username === 'string'
		);
	}

	private sealed(value: unknown): value is SealedValue {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const sealed = value as Partial<SealedValue>;
		return (
			typeof sealed.iv === 'string' &&
			typeof sealed.tag === 'string' &&
			typeof sealed.value === 'string'
		);
	}

	private write(): void {
		const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporaryPath, `${JSON.stringify(this.document, null, 2)}\n`, {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			});
			fs.renameSync(temporaryPath, this.filePath);
			fs.chmodSync(this.filePath, 0o600);
		} finally {
			fs.rmSync(temporaryPath, { force: true });
		}
	}
}
