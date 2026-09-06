export function decodeConfigurationKey(value: string): Buffer {
	const hexadecimal = /^[0-9a-f]{64}$/i.test(value);
	const base64url = /^[A-Za-z0-9_-]{43}$/.test(value);
	if (!hexadecimal && !base64url) {
		throw new Error('KUCEDR_CLOUD_ENCRYPTION_KEY must encode exactly 32 random bytes.');
	}
	const key = hexadecimal ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64url');
	if (key.length !== 32) {
		throw new Error('KUCEDR_CLOUD_ENCRYPTION_KEY must encode exactly 32 random bytes.');
	}
	return key;
}
