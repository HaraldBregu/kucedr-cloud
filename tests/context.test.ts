import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Agent } from '../src/main/agent/agent';
import { buildWorkspaceContext } from '../src/main/agent/system/build_workspace_context';
import { AGENT_TEMPLATE } from '../src/main/agent/system/template';

test('Agent creation seeds only the hardcoded AGENTS.md without overwriting it', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-agent-context-'));
	const previousDataDirectory = process.env.KUCEDR_CLOUD_DATA_DIR;
	process.env.KUCEDR_CLOUD_DATA_DIR = directory;
	try {
		new Agent();
		const workspace = path.join(directory, 'workspace');
		assert.deepEqual(fs.readdirSync(workspace), ['AGENTS.md']);
		assert.equal(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), AGENT_TEMPLATE);
		assert.equal(fs.statSync(path.join(workspace, 'AGENTS.md')).mode & 0o777, 0o600);

		fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'custom guidance');
		new Agent();
		assert.equal(fs.readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8'), 'custom guidance');
	} finally {
		if (previousDataDirectory === undefined) delete process.env.KUCEDR_CLOUD_DATA_DIR;
		else process.env.KUCEDR_CLOUD_DATA_DIR = previousDataDirectory;
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test('workspace context reads only AGENTS.md', async () => {
	const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-workspace-context-'));
	try {
		fs.writeFileSync(path.join(workspace, 'AGENTS.md'), 'current guidance');
		fs.writeFileSync(path.join(workspace, 'SOUL.md'), 'legacy content');
		const context = await buildWorkspaceContext({ location: workspace });
		assert.match(context, /current guidance/);
		assert.doesNotMatch(context, /legacy content|SOUL\.md/);
	} finally {
		fs.rmSync(workspace, { recursive: true, force: true });
	}
});
