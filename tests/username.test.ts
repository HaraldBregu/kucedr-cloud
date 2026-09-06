import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUsername } from '../src/main/config/username';

test('usernames accept chosen names and preserve case-insensitive sign-in', () => {
	for (const [input, expected] of [
		['A', 'a'],
		[' Zoë / 東京! ', 'zoë / 東京!'],
		['ADMIN.Name', 'admin.name'],
		['a'.repeat(100), 'a'.repeat(100)],
	]) {
		assert.equal(normalizeUsername(input), expected);
	}
	for (const input of ['', '   ', 'a'.repeat(101)]) {
		assert.equal(normalizeUsername(input), undefined);
	}
});
