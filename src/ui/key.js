export function generateAccessKey(random = crypto) {
	const bytes = new Uint8Array(32);
	random.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `kucedr-cloud_${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}
