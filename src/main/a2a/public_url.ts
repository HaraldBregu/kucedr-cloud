import net from 'node:net';

export function resolvePublicUrl(value: string, setting = 'KUCEDR_CLOUD_PUBLIC_URL'): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error(`${setting} must be a valid URL origin.`);
	}
	const loopback =
		url.hostname === 'localhost' ||
		url.hostname === '[::1]' ||
		url.hostname === '::1' ||
		(net.isIP(url.hostname) === 4 && url.hostname.startsWith('127.'));
	if (
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
	) {
		throw new Error(
			`${setting} must be an HTTPS origin without credentials, path, query, or fragment; HTTP is allowed only for loopback access.`
		);
	}
	return url.origin;
}
