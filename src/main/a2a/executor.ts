import { createHash, randomUUID } from 'node:crypto';
import {
	AgentEvent,
	type AgentExecutor,
	type ExecutionEventBus,
	type RequestContext,
} from '@a2a-js/sdk/server';
import { RequestMalformedError, TaskNotCancelableError } from '@a2a-js/sdk/errors';
import {
	Role,
	TaskState,
	type Artifact,
	type Message,
	type Part,
	type TaskStatus,
} from '@a2a-js/sdk';
import type { AgentSendOptions } from '../agent/agent';
import type { McpServer } from '../mcp/types';
import type { AgentResponseEvent, AgentRunStopReason } from '../shared/agent_types';

const MAX_MESSAGE_BYTES = 32 * 1024;
const EXTERNAL_TOOLS = ['read', 'write', 'edit'];

export interface AgentPort {
	send(message: string, agentId: string, options: AgentSendOptions): Promise<string>;
	cancel(runId: string): boolean;
	configureMcp?(servers: McpServer[]): void;
}

interface ActiveRun {
	contextId: string;
	eventBus: ExecutionEventBus;
	terminal: boolean;
	artifactStarted: boolean;
	pendingDelta?: string;
}

export class KucedrCloudExecutor implements AgentExecutor {
	private readonly activeRuns = new Map<string, ActiveRun>();

	constructor(
		private readonly agent: AgentPort,
		private readonly workspaceDirectory: string
	) {}

	async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
		const message = textMessage(requestContext.userMessage);
		if (!isUuid(requestContext.contextId)) {
			throw new RequestMalformedError('message.contextId must be a UUID when provided.');
		}
		const userName = requestContext.context.user?.userName ?? '';
		if (!requestContext.context.user?.isAuthenticated || !userName) {
			throw new RequestMalformedError('An authenticated A2A client is required.');
		}
		const state: ActiveRun = {
			contextId: requestContext.contextId,
			eventBus,
			terminal: false,
			artifactStarted: false,
		};
		this.activeRuns.set(requestContext.taskId, state);
		eventBus.publish(
			AgentEvent.task({
				id: requestContext.taskId,
				contextId: requestContext.contextId,
				status: status(TaskState.TASK_STATE_SUBMITTED),
				artifacts: requestContext.task?.artifacts ?? [],
				history: requestContext.task?.history ?? [],
				metadata: {},
			})
		);
		eventBus.publish(
			AgentEvent.statusUpdate({
				taskId: requestContext.taskId,
				contextId: requestContext.contextId,
				status: status(TaskState.TASK_STATE_WORKING),
				metadata: {},
			})
		);

		try {
			const response = await this.agent.send(message, 'main', {
				type: 'default',
				runId: requestContext.taskId,
				sessionId: scopedSessionId(userName, requestContext.contextId),
				streaming: true,
				contextMode: 'workspace',
				interactionMode: 'default',
				toolsAllow: EXTERNAL_TOOLS,
				workspaceRoot: this.workspaceDirectory,
				streamEvent: (event) => this.handleEvent(requestContext.taskId, event),
			});
			if (!state.terminal) {
				if (!state.pendingDelta && !state.artifactStarted && response)
					state.pendingDelta = response;
				this.finish(requestContext.taskId, 'end_turn');
			}
		} catch {
			if (!state.terminal) this.finish(requestContext.taskId, 'error');
		} finally {
			this.activeRuns.delete(requestContext.taskId);
		}
	}

	async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
		const state = this.activeRuns.get(taskId);
		if (!state || state.terminal || !this.agent.cancel(taskId)) {
			throw new TaskNotCancelableError(`Task not cancelable: ${taskId}`);
		}
		state.eventBus = eventBus;
		this.finish(taskId, 'cancelled');
	}

	private handleEvent(taskId: string, event: AgentResponseEvent): void {
		const state = this.activeRuns.get(taskId);
		if (!state || state.terminal) return;
		if (event.type === 'text_delta') {
			if (state.pendingDelta !== undefined) this.publishDelta(taskId, state.pendingDelta, false);
			state.pendingDelta = event.delta;
		}
		if (event.type === 'run_finished') this.finish(taskId, event.stopReason);
	}

	private publishDelta(taskId: string, delta: string, lastChunk: boolean): void {
		const state = this.activeRuns.get(taskId);
		if (!state) return;
		const artifact: Artifact = {
			artifactId: 'response',
			name: 'Response',
			description: 'kucedr-cloud response',
			parts: [textPart(delta)],
			metadata: {},
			extensions: [],
		};
		state.eventBus.publish(
			AgentEvent.artifactUpdate({
				taskId,
				contextId: state.contextId,
				artifact,
				append: state.artifactStarted,
				lastChunk,
				metadata: {},
			})
		);
		state.artifactStarted = true;
	}

	private finish(taskId: string, reason: AgentRunStopReason): void {
		const run = this.activeRuns.get(taskId);
		if (!run || run.terminal) return;
		run.terminal = true;
		if (run.pendingDelta !== undefined) this.publishDelta(taskId, run.pendingDelta, true);
		const state =
			reason === 'end_turn'
				? TaskState.TASK_STATE_COMPLETED
				: reason === 'cancelled'
					? TaskState.TASK_STATE_CANCELED
					: TaskState.TASK_STATE_FAILED;
		run.eventBus.publish(
			AgentEvent.statusUpdate({
				taskId,
				contextId: run.contextId,
				status: status(
					state,
					state === TaskState.TASK_STATE_FAILED
						? agentMessage(taskId, run.contextId, 'kucedr-cloud run failed.')
						: state === TaskState.TASK_STATE_CANCELED
							? agentMessage(taskId, run.contextId, 'Task canceled.')
							: undefined
				),
				metadata: {},
			})
		);
	}
}

function textMessage(message: Message): string {
	if (message.role !== Role.ROLE_USER || message.parts.length === 0) {
		throw new RequestMalformedError('message must contain user text parts.');
	}
	const text = message.parts.map((part) => {
		if (part.content?.$case !== 'text' || (part.mediaType && part.mediaType !== 'text/plain')) {
			throw new RequestMalformedError('Only text/plain message parts are supported.');
		}
		return part.content.value;
	});
	const joined = text.join('\n');
	if (Buffer.byteLength(joined, 'utf8') > MAX_MESSAGE_BYTES) {
		throw new RequestMalformedError('Message text exceeds the 32 KiB limit.');
	}
	return joined;
}

function textPart(value: string): Part {
	return {
		content: { $case: 'text', value },
		mediaType: 'text/plain',
		filename: '',
		metadata: {},
	};
}

function status(state: TaskState, message?: Message): TaskStatus {
	return { state, message, timestamp: new Date().toISOString() };
}

function agentMessage(taskId: string, contextId: string, text: string): Message {
	return {
		messageId: randomUUID(),
		contextId,
		taskId,
		role: Role.ROLE_AGENT,
		parts: [textPart(text)],
		metadata: {},
		extensions: [],
		referenceTaskIds: [],
	};
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function scopedSessionId(userName: string, contextId: string): string {
	const digest = createHash('sha256').update(userName).update('\0').update(contextId).digest('hex');
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
