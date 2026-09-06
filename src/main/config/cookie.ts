import { CONFIGURATION_SESSION_SECONDS } from './session';

export function configurationCookieName(publicUrl: string): string {
	return new URL(publicUrl).protocol === 'https:' ? '__Host-kucedr-cloud_config' : 'kucedr-cloud_config_session';
}

export function readConfigurationCookie(
	header: string | undefined,
	publicUrl: string
): string | undefined {
	const name = configurationCookieName(publicUrl);
	for (const item of header?.split(';') ?? []) {
		const [key, ...value] = item.trim().split('=');
		if (key === name) return value.join('=') || undefined;
	}
	return undefined;
}

export function setConfigurationCookie(token: string, publicUrl: string): string {
	const secure = new URL(publicUrl).protocol === 'https:' ? '; Secure' : '';
	return `${configurationCookieName(publicUrl)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${CONFIGURATION_SESSION_SECONDS}${secure}`;
}

export function clearConfigurationCookie(publicUrl: string): string {
	const secure = new URL(publicUrl).protocol === 'https:' ? '; Secure' : '';
	return `${configurationCookieName(publicUrl)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
