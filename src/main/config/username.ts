export function normalizeUsername(value: string): string | undefined {
	const username = value.trim().toLowerCase();
	return username && value.trim().length <= 100 ? username : undefined;
}
