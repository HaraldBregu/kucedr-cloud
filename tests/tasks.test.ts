import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	Role,
	TaskState,
	type Artifact,
	type ListTasksRequest,
	type Message,
	type Task,
} from '@a2a-js/sdk';
import { RequestMalformedError } from '@a2a-js/sdk/errors';
import { ServerCallContext } from '@a2a-js/sdk/server';
import { PersistentTaskStore, createTaskStore } from '../src/main/a2a/store';

const context = new ServerCallContext({
	requestedVersion: '1.0',
	user: { isAuthenticated: true, userName: 'client-a' },
});
const otherContext = new ServerCallContext({
	requestedVersion: '1.0',
	user: { isAuthenticated: true, userName: 'client-b' },
});

test('PersistentTaskStore saves, loads, filters, and paginates secure task files', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-tasks-'));
	const directory = path.join(root, 'a2a', 'tasks');

	try {
		const store = await createTaskStore(directory);
		assert.equal(fs.statSync(directory).mode & 0o777, 0o700);

		const tasks = [
			createTask('task-a', 'context-a', TaskState.TASK_STATE_COMPLETED, '2026-08-16T08:00:00Z'),
			createTask('task-b', 'context-a', TaskState.TASK_STATE_FAILED, '2026-08-16T09:00:00Z'),
			createTask('task-c', 'context-b', TaskState.TASK_STATE_COMPLETED, '2026-08-16T10:00:00Z'),
		];
		for (const task of tasks) await store.save(task, context);

		const files = fs.readdirSync(directory);
		assert.equal(files.length, 3);
		assert.ok(files.every((name) => name.endsWith('.json')));
		assert.ok(
			files.every((name) => (fs.statSync(path.join(directory, name)).mode & 0o777) === 0o600)
		);
		assert.equal(
			files.some((name) => name.includes('task-')),
			false
		);
		assert.equal(
			files.some((name) => name.endsWith('.tmp')),
			false
		);

		const loaded = await store.load('task-a', context);
		assert.deepEqual(loaded, tasks[0]);
		loaded?.artifacts.splice(0);
		assert.equal((await store.load('task-a', context))?.artifacts.length, 1);
		assert.equal(await store.load('../outside', context), undefined);
		assert.equal(await store.load('task-a', otherContext), undefined);
		assert.deepEqual((await store.list(listRequest(), otherContext)).tasks, []);
		await assert.rejects(store.save(tasks[0], otherContext), RequestMalformedError);

		const filtered = await store.list(
			listRequest({
				contextId: 'context-a',
				status: TaskState.TASK_STATE_COMPLETED,
				statusTimestampAfter: '2026-08-16T08:00:00Z',
				includeArtifacts: true,
			}),
			context
		);
		assert.deepEqual(
			filtered.tasks.map((task) => task.id),
			['task-a']
		);
		assert.equal(filtered.tasks[0]?.artifacts.length, 1);

		const firstPage = await store.list(
			listRequest({ pageSize: 2, includeArtifacts: false, historyLength: 1 }),
			context
		);
		assert.deepEqual(
			firstPage.tasks.map((task) => task.id),
			['task-c', 'task-b']
		);
		assert.equal(firstPage.totalSize, 3);
		assert.equal(firstPage.pageSize, 2);
		assert.ok(firstPage.nextPageToken);
		assert.doesNotMatch(firstPage.nextPageToken, /task-[abc]/);
		assert.ok(firstPage.tasks.every((task) => task.artifacts.length === 0));
		assert.ok(firstPage.tasks.every((task) => task.history.length === 1));

		const secondPage = await store.list(
			listRequest({ pageSize: 2, pageToken: firstPage.nextPageToken }),
			context
		);
		assert.deepEqual(
			secondPage.tasks.map((task) => task.id),
			['task-a']
		);
		assert.equal(secondPage.totalSize, 3);
		assert.equal(secondPage.nextPageToken, '');
		await assert.rejects(
			store.list(listRequest({ pageToken: 'not-a-cursor' }), context),
			RequestMalformedError
		);
		await assert.rejects(
			store.list(listRequest({ pageSize: 101 }), context),
			RequestMalformedError
		);
		await assert.rejects(
			store.list(listRequest({ historyLength: 101 }), context),
			RequestMalformedError
		);

		const recreated = new PersistentTaskStore(directory);
		assert.deepEqual(await recreated.load('task-b', context), tasks[1]);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('PersistentTaskStore prunes expired terminal tasks and fails interrupted tasks on restart', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kucedr-cloud-a2a-recovery-'));
	const directory = path.join(root, 'a2a', 'tasks');

	try {
		const store = new PersistentTaskStore(directory);
		const old = createTask(
			'old-terminal',
			'context-a',
			TaskState.TASK_STATE_COMPLETED,
			new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString()
		);
		const active = createTask(
			'interrupted',
			'context-a',
			TaskState.TASK_STATE_WORKING,
			new Date().toISOString()
		);
		await store.save(old, context);
		await store.save(active, context);

		assert.equal(await store.load('old-terminal', context), undefined);
		assert.equal(
			(await store.load('interrupted', context))?.status?.state,
			TaskState.TASK_STATE_WORKING
		);

		const restarted = new PersistentTaskStore(directory);
		const recovered = await restarted.load('interrupted', context);
		assert.equal(recovered?.status?.state, TaskState.TASK_STATE_FAILED);
		assert.match(text(recovered?.status?.message), /server restarted/i);
		assert.doesNotMatch(text(recovered?.status?.message), /stack|provider|token|secret/i);
		assert.equal(
			fs.readdirSync(directory).some((name) => name.endsWith('.tmp')),
			false
		);

		const startupExpired = createTask(
			'startup-expired',
			'context-a',
			TaskState.TASK_STATE_COMPLETED,
			new Date().toISOString()
		);
		await restarted.save(startupExpired, context);
		const startupExpiredFile = fs
			.readdirSync(directory)
			.map((name) => path.join(directory, name))
			.find((filePath) => fs.readFileSync(filePath, 'utf8').includes('startup-expired'));
		assert.ok(startupExpiredFile);
		const persisted = JSON.parse(fs.readFileSync(startupExpiredFile, 'utf8')) as {
			task: { status: { timestamp: string } };
		};
		persisted.task.status.timestamp = new Date(
			Date.now() - 31 * 24 * 60 * 60 * 1_000
		).toISOString();
		fs.writeFileSync(startupExpiredFile, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });

		const prunedAtStartup = await createTaskStore(directory);
		assert.equal(await prunedAtStartup.load('startup-expired', context), undefined);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function createTask(id: string, contextId: string, state: TaskState, timestamp: string): Task {
	const message = createMessage(`message-${id}`, id, contextId, `request-${id}`);
	const artifact: Artifact = {
		artifactId: `artifact-${id}`,
		name: 'response',
		description: '',
		parts: [
			{
				content: { $case: 'text', value: `response-${id}` },
				metadata: undefined,
				filename: '',
				mediaType: 'text/plain',
			},
		],
		metadata: undefined,
		extensions: [],
	};
	return {
		id,
		contextId,
		status: { state, message: undefined, timestamp },
		artifacts: [artifact],
		history: [message, createMessage(`followup-${id}`, id, contextId, `followup-${id}`)],
		metadata: undefined,
	};
}

function createMessage(
	messageId: string,
	taskId: string,
	contextId: string,
	value: string
): Message {
	return {
		messageId,
		taskId,
		contextId,
		role: Role.ROLE_USER,
		parts: [
			{
				content: { $case: 'text', value },
				metadata: undefined,
				filename: '',
				mediaType: 'text/plain',
			},
		],
		metadata: undefined,
		extensions: [],
		referenceTaskIds: [],
	};
}

function listRequest(overrides: Partial<ListTasksRequest> = {}): ListTasksRequest {
	return {
		tenant: '',
		contextId: '',
		status: TaskState.TASK_STATE_UNSPECIFIED,
		pageToken: '',
		statusTimestampAfter: undefined,
		...overrides,
	};
}

function text(message: Message | undefined): string {
	return (
		message?.parts
			.map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
			.join('') ?? ''
	);
}
