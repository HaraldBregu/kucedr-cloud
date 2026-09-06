export function clearAccessSessionHeader(secure: boolean): string {
	return [
		'kucedr-cloud_session=',
		'HttpOnly',
		'SameSite=Strict',
		'Path=/',
		'Max-Age=0',
		'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
		...(secure ? ['Secure'] : []),
	].join('; ');
}
