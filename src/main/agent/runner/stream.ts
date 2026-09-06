import { getResolvedProvider } from '../settings_store';
import { getModelId, getModelOptions, getProviderId } from '../agent_store';
import {
	addAssistantMessage,
	addToolResults,
	isExhausted,
	recordTurn,
	tryAppendRun,
	toResult,
	type SessionState,
	persist,
	sessionDir,
} from '../session';
import { buildSystemPrompt, buildWorkspaceContext } from '../system';
import type { Config, RuntimeEvent, RuntimeInput, Tool } from '../types';
import { runModelTurn } from './run_model_turn';
import { runToolCalls } from './run_tool_calls';
import { filterTools } from './filter_tools';
import { formatToolOutput } from './format_tool_output';
import type { KeyedLimiter } from '../limiter';
import type { KeyedMutex } from '../mutex';
import { builtinTools } from './builtin_tools';
import { workspaceTools } from '../workspace/tools';
import { subagentsTool } from '../tools/subagents';

export interface StreamOptions {
	tools?: Tool[];
	workspaceRoot?: string;
	instructions?: string;
	streaming?: boolean;
	resources?: KeyedMutex;
	mcpTools?: () => Promise<Tool[]>;
	providerLimiter?: KeyedLimiter;
	subagentLimiter?: KeyedLimiter;
	ephemeral?: boolean;
}

const MAX_TOOL_CALLS = 100;
const MAX_TOOL_OUTPUT_BYTES = 2_000_000;
const MAX_PAID_TOOL_CALLS = 3;
const MAX_BOT_WEB_TOOL_CALLS = 8;

export async function* stream(
	config: Config,
	session: SessionState,
	input: RuntimeInput,
	signal: AbortSignal,
	options: StreamOptions = {}
): AsyncGenerator<RuntimeEvent> {
	let terminal = false;
	try {
		for await (const event of loop(config, session, input, signal, options)) {
			if (!options.ephemeral) tryAppendRun(session, event);
			yield event;
			if (event.type === 'run_finished') terminal = true;
		}
	} catch (error) {
		const errorEvent = {
			type: 'run_error',
			message: error instanceof Error ? error.message : String(error),
		} as const;
		if (!options.ephemeral) tryAppendRun(session, errorEvent);
		yield errorEvent;
		if (!terminal) {
			session.stopReason = signal.aborted
				? signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
					? 'timeout'
					: 'cancelled'
				: 'error';
			const event = { type: 'run_finished', result: toResult(session, 'success') } as const;
			if (!options.ephemeral) tryAppendRun(session, event);
			yield event;
			terminal = true;
		}
		if (!signal.aborted) throw error;
		return;
	}
	if (!terminal) {
		session.stopReason = signal.aborted
			? signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
				? 'timeout'
				: 'cancelled'
			: 'error';
		const event = { type: 'run_finished', result: toResult(session, 'success') } as const;
		if (!options.ephemeral) tryAppendRun(session, event);
		yield event;
		terminal = true;
	}
}

async function* loop(
	config: Config,
	session: SessionState,
	input: RuntimeInput,
	signal: AbortSignal,
	options: StreamOptions
): AsyncGenerator<RuntimeEvent> {
	const provider = getResolvedProvider(input.providerId ?? getProviderId());
	const modelId = input.model ?? getModelId(provider?.id);
	const modelOptions = getModelOptions();
	const contextMode = input.contextMode;
	const runId = input.runId ?? session.id;

	if (!provider || !modelId) throw new Error('Agent requires a configured provider and model.');

	const baseTools =
		options.workspaceRoot !== undefined
			? workspaceTools(options.workspaceRoot)
			: options.tools
				? [...options.tools]
				: builtinTools();
	const mcpTools = options.mcpTools ? await options.mcpTools() : [];
	let tools = filterTools([...baseTools, ...mcpTools], input.toolsAllow, input.toolsDeny);
	if (!options.tools && options.subagentLimiter) {
		tools = filterTools(
			[
				...tools,
				subagentsTool({
					config,
					parentInput: input,
					availableTools: tools,
					limiter: options.subagentLimiter,
					resources: options.resources,
					providerLimiter: options.providerLimiter,
				}),
			],
			input.toolsAllow,
			input.toolsDeny
		);
	}

	yield {
		type: 'run_started',
		sessionId: session.id,
		interactionMode: input.interactionMode,
		model: modelId,
		providerId: provider.id,
		tools: tools.map((tool) => tool.id),
	};

	{
		let toolOutputBytes = 0;
		let paidToolCalls = 0;
		let botWebToolCalls = 0;
		while (true) {
			if (signal.aborted) return;
			const systemPrompt = await buildSystemPrompt(
				config,
				tools,
				options.instructions,
				contextMode
			);
			const workspaceContext =
				contextMode === 'workspace' && options.instructions === undefined
					? await buildWorkspaceContext(config)
					: '';
			const runtimeContext = [workspaceContext].filter(Boolean).join('\n\n');
			const messages = session.messages;
			const turn = yield* runModelTurn(
				input,
				provider,
				modelId,
				systemPrompt,
				messages,
				tools,
				signal,
				modelOptions,
				undefined,
				undefined,
				runtimeContext ? [{ role: 'user', content: runtimeContext }] : [],
				options.streaming ?? true,
				options.providerLimiter,
				input.deferPersist && !options.ephemeral ? () => persist(session) : undefined
			);

			recordTurn(session, turn);

			yield {
				type: 'assistant_message',
				content: turn.content,
				toolCalls: turn.toolCalls,
			};
			addAssistantMessage(
				session,
				turn.content,
				turn.toolCalls,
				turn.providerItems,
				{
					inputTokens: turn.usage?.inputTokens ?? 0,
					outputTokens: turn.usage?.outputTokens ?? 0,
				},
				!options.ephemeral
			);

			if (turn.toolCalls.length === 0) {
				const result = toResult(session, 'success');
				yield { type: 'run_finished', result };
				return;
			}

			if (session.toolCalls.length + turn.toolCalls.length > MAX_TOOL_CALLS) {
				session.stopReason = 'max_tool_calls';
				yield { type: 'run_finished', result: toResult(session, 'success') };
				return;
			}
			const paidTools = new Set(['create_image', 'create_video', 'create_sound']);
			const requestedPaidCalls = turn.toolCalls.filter((call) => paidTools.has(call.name)).length;
			if (paidToolCalls + requestedPaidCalls > MAX_PAID_TOOL_CALLS) {
				session.stopReason = 'budget_exhausted';
				yield { type: 'run_finished', result: toResult(session, 'success') };
				return;
			}
			paidToolCalls += requestedPaidCalls;
			const requestedBotWebCalls =
				input.agentId === 'channels'
					? turn.toolCalls.filter(
							(call) => call.name === 'search_web' || call.name === 'fetch_web_page'
						).length
					: 0;
			if (botWebToolCalls + requestedBotWebCalls > MAX_BOT_WEB_TOOL_CALLS) {
				session.stopReason = 'budget_exhausted';
				yield { type: 'run_finished', result: toResult(session, 'success') };
				return;
			}
			botWebToolCalls += requestedBotWebCalls;

			if (isExhausted(session)) {
				session.stopReason = 'max_iterations';
				const result = toResult(session, 'error_max_turns');
				yield { type: 'run_finished', result };
				return;
			}

			let outputBudgetExceeded = false;
			for await (const event of runToolCalls(
				tools,
				turn.toolCalls,
				signal,
				session.runContext.fileAccess,
				{
					runId,
					interactionMode: input.interactionMode,
					...(input.approvalWindowId === undefined ? {} : { windowId: input.approvalWindowId }),
				},
				options.resources
			)) {
				yield event;
				if (event.type !== 'tool_call_end') continue;
				toolOutputBytes += Buffer.byteLength(formatToolOutput(event.output), 'utf8');
				if (toolOutputBytes > MAX_TOOL_OUTPUT_BYTES) {
					outputBudgetExceeded = true;
					break;
				}
			}
			addToolResults(session, turn.toolCalls, !options.ephemeral);
			if (outputBudgetExceeded) {
				session.stopReason = 'budget_exhausted';
				yield { type: 'run_finished', result: toResult(session, 'success') };
				return;
			}
		}
	}
}
