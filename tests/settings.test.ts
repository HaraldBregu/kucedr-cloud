import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SettingsService } from '../src/main/shared/settings';

test('SettingsService manages a persistent JSON settings file', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-settings-'));
	const filePath = path.join(directory, 'settings.json');
	const previousDataDirectory = process.env.KUCEDR_CLOUD_DATA_DIR;

	try {
		const settings = new SettingsService(filePath);
		assert.deepEqual(settings.getAll(), {});
		assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {});

		const value = { theme: 'dark' };
		settings.set('appearance', value);
		value.theme = 'light';
		assert.deepEqual(settings.get('appearance'), { theme: 'dark' });
		assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {});

		settings.save();
		const reloaded = new SettingsService(filePath);
		const all = reloaded.getAll();
		assert.deepEqual(all, { appearance: { theme: 'dark' } });
		(all.appearance as { theme: string }).theme = 'light';
		assert.deepEqual(reloaded.get('appearance'), { theme: 'dark' });

		const defaultDirectory = path.join(directory, 'default');
		process.env.KUCEDR_CLOUD_DATA_DIR = defaultDirectory;
		new SettingsService();
		assert.deepEqual(
			JSON.parse(fs.readFileSync(path.join(defaultDirectory, 'settings.json'), 'utf8')),
			{}
		);
	} finally {
		if (previousDataDirectory === undefined) delete process.env.KUCEDR_CLOUD_DATA_DIR;
		else process.env.KUCEDR_CLOUD_DATA_DIR = previousDataDirectory;
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
