export function accessSessionHeader(session: string, secure: boolean): string {
	return [
		`kucedr-cloud_session=${session}`,
		'HttpOnly',
		'SameSite=Strict',
		'Path=/',
		'Max-Age=31536000',
		...(secure ? ['Secure'] : []),
	].join('; ');
}
