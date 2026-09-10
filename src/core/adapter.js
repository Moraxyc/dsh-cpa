import { assertUsableApiKey, attributionHeaders, ToolCallId, contentHasImage, EMPTY_RESPONSE_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError, ProviderRequestId, ReasoningEffortId, } from '@deepseek-ai/dsh-llm';
import { chatCompletionsUrl } from './config.js';
import { isFunction, isJsonRecord, isNonEmptyString, isString } from './json.js';
const DONE = '[DONE]';
const EMPTY_RESPONSE = EMPTY_RESPONSE_CODE;
const FALLBACK_ERROR_CODES = new Set([
    'QUOTA',
    'RATE_LIMIT',
    'SERVER',
    'TRANSPORT',
    'EMPTY_RESPONSE',
    'STREAM_CLOSED',
    'HTTP_408',
    'HTTP_502',
    'HTTP_503',
    'HTTP_504',
]);
function providerRetryAfterMs(value) {
    if (value === null)
        return undefined;
    if (/^\d+$/.test(value)) {
        const delay = Number(value) * 1000;
        return Number.isFinite(delay) && delay > 0 ? delay : undefined;
    }
    const delay = Date.parse(value) - Date.now();
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}
function requestId(headers) {
    const value = headers.get('x-request-id')
        ?? headers.get('x-cpa-request-id')
        ?? headers.get('x-cli-proxy-request-id');
    return value === null || value.length === 0 ? undefined : ProviderRequestId(value);
}
export function parseCpaTraceId(value) {
    if (!isString(value))
        return undefined;
    const trimmed = value.trim();
    if (trimmed.length <= 15)
        return undefined;
    const separator = trimmed.indexOf('-', 14);
    if (separator !== 14 || !/^\d{14}$/.test(trimmed.slice(0, 14)))
        return undefined;
    const tail = trimmed.slice(15);
    const requestSeparator = tail.lastIndexOf('-');
    if (requestSeparator <= 0 || requestSeparator === tail.length - 1)
        return undefined;
    const authIndex = tail.slice(0, requestSeparator);
    const requestIdValue = tail.slice(requestSeparator + 1);
    if (authIndex.length === 0 || !/^[0-9a-f]{8}$/i.test(requestIdValue))
        return undefined;
    return {
        traceId: trimmed,
        authIndex,
        requestId: ProviderRequestId(requestIdValue),
    };
}
function cpaTrace(headers) {
    return parseCpaTraceId(headers.get('x-cpa-trace-id') ?? undefined);
}
function responseRequestId(headers) {
    return requestId(headers) ?? cpaTrace(headers)?.requestId;
}
function httpErrorCode(status, detail) {
    if (status === 401 || status === 403)
        return 'AUTH';
    if (isQuotaExceededError(detail))
        return 'QUOTA';
    if (status === 429)
        return 'RATE_LIMIT';
    if (status === 400) {
        if (isContextWindowExceededError(detail))
            return 'CONTEXT_WINDOW_EXCEEDED';
        return 'INVALID_REQUEST';
    }
    if (status >= 500)
        return 'SERVER';
    return `HTTP_${status}`;
}
function modelInfo(provider, model) {
    const name = model.displayName ?? model.id;
    const info = {
        provider,
        id: model.id,
        name,
        inputModalities: ['text'],
    };
    if (model.id !== name)
        info.description = model.id;
    return info;
}
function flattenText(blocks) {
    let text = '';
    for (const block of blocks) {
        if (block.type === 'text')
            text += block.text;
    }
    return text;
}
function assertTextOnly(blocks) {
    if (contentHasImage(blocks)) {
        throw new LlmError('CPA does not support images', 'UNSUPPORTED_CONTENT');
    }
}
function serializeAssistant(message) {
    const text = flattenText(message.content);
    const toolCalls = message.content
        .filter((block) => block.type === 'tool-call')
        .map(block => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.arguments },
    }));
    const wire = { role: 'assistant', content: text };
    if (toolCalls.length > 0)
        wire.tool_calls = toolCalls;
    return wire;
}
export function serializeMessages(messages) {
    const wire = [];
    for (const message of messages) {
        assertTextOnly(message.content);
        if (message.role === 'system') {
            wire.push({ role: 'system', content: flattenText(message.content) });
            continue;
        }
        if (message.role === 'assistant') {
            wire.push(serializeAssistant(message));
            continue;
        }
        const toolResults = message.content.filter((block) => block.type === 'tool-result');
        const text = flattenText(message.content);
        if (text.length > 0 || toolResults.length === 0) {
            wire.push({ role: 'user', content: text });
        }
        for (const result of toolResults) {
            wire.push({
                role: 'tool',
                tool_call_id: result.toolCallId,
                content: flattenText(result.content) || '(no output)',
            });
        }
    }
    return wire;
}
export function serializeRequest(options) {
    const messages = [];
    if (options.system !== undefined) {
        messages.push({ role: 'system', content: options.system });
    }
    messages.push(...serializeMessages(options.messages));
    const request = {
        model: options.model,
        messages,
        stream: true,
    };
    const tools = options.tools?.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        },
    }));
    if (tools !== undefined && tools.length > 0)
        request.tools = tools;
    if (options.reasoningEffort !== undefined)
        request.reasoning_effort = options.reasoningEffort;
    if (options.temperature !== undefined)
        request.temperature = options.temperature;
    if (options.maxTokens !== undefined)
        request.max_tokens = options.maxTokens;
    if (options.stop !== undefined)
        request.stop = options.stop;
    return request;
}
async function* ssePayloads(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    const flush = () => {
        if (data.length === 0)
            return undefined;
        const payload = data.join('\n');
        data = [];
        return payload;
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line === '') {
                const payload = flush();
                if (payload !== undefined) {
                    yield payload;
                    if (payload === DONE)
                        return;
                }
            }
            else if (line.startsWith('data:')) {
                data.push(line.slice(5).replace(/^ /, ''));
            }
        }
    }
    const payload = flush();
    if (payload !== undefined)
        yield payload;
}
export async function* parseSse(stream) {
    let done = false;
    for await (const payload of ssePayloads(stream)) {
        if (payload === DONE) {
            done = true;
            yield payload;
            return;
        }
        yield payload;
    }
    if (!done) {
        throw new LlmError('stream ended without [DONE]', 'STREAM_CLOSED');
    }
}
function mapFinishReason(reason) {
    switch (reason) {
        case 'stop': return { kind: 'stop' };
        case 'tool_calls': return { kind: 'tool-calls' };
        case 'length': return { kind: 'max-tokens' };
        default:
            return {
                kind: 'error',
                failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
            };
    }
}
function mapUsage(usage) {
    const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens;
    const mapped = {
        inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
        outputTokens: usage.completion_tokens,
    };
    if (cacheRead !== undefined)
        mapped.cacheReadTokens = cacheRead;
    if (reasoning !== undefined)
        mapped.reasoningTokens = reasoning;
    return mapped;
}
function closeBlock(block) {
    switch (block.kind) {
        case 'text': return { type: 'text', text: block.text };
        case 'reasoning': return { type: 'reasoning', text: block.text };
        case 'tool-call': return {
            type: 'tool-call',
            id: ToolCallId(block.callId ?? ''),
            name: block.name ?? '',
            arguments: block.text,
        };
    }
}
export async function* translate(payloads) {
    let nextIndex = 0;
    let textBlock;
    let reasoningBlock;
    const toolBlocks = new Map();
    const order = [];
    let pendingFinish;
    let pendingUsage;
    const open = (kind) => {
        const block = { index: nextIndex, kind, text: '' };
        nextIndex += 1;
        order.push(block);
        return block;
    };
    for await (const payload of payloads) {
        if (payload === DONE) {
            for (const block of order) {
                yield { type: 'block-end', index: block.index, block: closeBlock(block) };
            }
            if (pendingUsage)
                yield { type: 'usage', usage: pendingUsage };
            const reason = pendingFinish ?? { kind: 'stop' };
            yield {
                type: 'finish',
                reason: reason.kind === 'stop' && order.length === 0
                    ? {
                        kind: 'error',
                        failure: { message: 'empty response', code: EMPTY_RESPONSE },
                    }
                    : reason,
            };
            return;
        }
        let chunk;
        try {
            chunk = JSON.parse(payload);
        }
        catch {
            throw new LlmError(`malformed SSE: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE');
        }
        for (const choice of chunk.choices ?? []) {
            const delta = choice.delta ?? {};
            const reasoning = isString(delta.reasoning_content)
                ? delta.reasoning_content
                : isString(delta.reasoning?.content)
                    ? delta.reasoning.content
                    : undefined;
            if (isNonEmptyString(reasoning)) {
                if (!reasoningBlock) {
                    reasoningBlock = open('reasoning');
                    yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' };
                }
                reasoningBlock.text += reasoning;
                yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning };
            }
            const content = delta.content;
            if (isNonEmptyString(content)) {
                if (!textBlock) {
                    textBlock = open('text');
                    yield { type: 'block-start', index: textBlock.index, blockType: 'text' };
                }
                textBlock.text += content;
                yield { type: 'text-delta', index: textBlock.index, text: content };
            }
            for (const call of delta.tool_calls ?? []) {
                const callIndex = call.index ?? 0;
                let block = toolBlocks.get(callIndex);
                if (!block) {
                    block = open('tool-call');
                    toolBlocks.set(callIndex, block);
                    yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
                }
                if (call.id !== undefined)
                    block.callId = call.id;
                if (call.function?.name !== undefined)
                    block.name = call.function.name;
                const fragment = call.function?.arguments ?? '';
                block.text += fragment;
                const deltaEvent = {
                    type: 'tool-call-delta',
                    index: block.index,
                    id: ToolCallId(block.callId ?? ''),
                    argumentsDelta: fragment,
                };
                if (block.name !== undefined)
                    deltaEvent.name = block.name;
                yield deltaEvent;
            }
            if (isString(choice.finish_reason)) {
                pendingFinish = mapFinishReason(choice.finish_reason);
            }
        }
        if (chunk.usage)
            pendingUsage = mapUsage(chunk.usage);
    }
    throw new LlmError('stream ended without [DONE]', 'STREAM_CLOSED');
}
async function readError(response) {
    let message = `CPA HTTP ${response.status}`;
    let detail = '';
    try {
        const body = await response.json();
        const parsed = isJsonRecord(body) ? body : null;
        const error = isJsonRecord(parsed?.error) ? parsed.error : null;
        message = isNonEmptyString(error?.message)
            ? error.message
            : isNonEmptyString(parsed?.message)
                ? parsed.message
                : message;
        detail = [error?.code, error?.type, error?.message, parsed?.message]
            .filter((value) => isString(value))
            .join(' ');
    }
    catch {
        // Keep the HTTP status line for malformed error bodies.
    }
    const delay = providerRetryAfterMs(response.headers.get('retry-after'));
    const trace = cpaTrace(response.headers);
    const id = responseRequestId(response.headers);
    const options = { status: response.status };
    if (delay !== undefined)
        options.providerRetryAfterMs = delay;
    if (id !== undefined)
        options.requestId = id;
    if (trace !== undefined)
        options.authIndex = trace.authIndex;
    throw new LlmError(message, httpErrorCode(response.status, detail), options);
}
export class CpaAdapter extends LlmAdapter {
    options;
    constructor(options) {
        super();
        this.options = options;
    }
    providerInfo(provider) {
        return { id: provider, name: 'CLI Proxy API' };
    }
    listModels(provider) {
        return Promise.resolve(this.options.getModels().map(model => modelInfo(provider, model)));
    }
    resolveModel(provider, model, _signal) {
        const configured = this.options.getModels().find(entry => entry.id === model);
        const resolved = configured === undefined
            ? { provider, id: model, name: model, inputModalities: ['text'] }
            : modelInfo(provider, configured);
        resolved.context = {
            contextWindow: configured?.contextLength ?? this.options.defaultContextWindow,
        };
        resolved.defaultMaxTokens = configured?.maxCompletionTokens ?? this.options.defaultMaxTokens;
        const reasoning = configured?.reasoning;
        if (reasoning !== undefined) {
            const efforts = reasoning.efforts.map(effort => {
                const info = {
                    id: ReasoningEffortId(effort.id),
                    name: effort.name,
                };
                if (effort.description !== undefined)
                    info.description = effort.description;
                return info;
            });
            const reasoningInfo = { efforts };
            if (reasoning.defaultEffort !== undefined) {
                reasoningInfo.defaultEffort = ReasoningEffortId(reasoning.defaultEffort);
            }
            resolved.reasoning = reasoningInfo;
        }
        return Promise.resolve(resolved);
    }
    async *stream(options) {
        let models = [options.model];
        let routePlan;
        try {
            const resolved = await this.options.resolveRoute?.(options);
            if (resolved !== undefined) {
                if (Array.isArray(resolved)) {
                    if (resolved.length > 0)
                        models = [...new Set([options.model, ...resolved])];
                }
                else if (isRoutePlan(resolved) && resolved.models.length > 0) {
                    routePlan = resolved;
                    models = [...new Set([options.model, ...resolved.models])];
                }
            }
        }
        catch {
            // Routing is advisory; a stale or unavailable management API must not block chat.
        }
        let lastError;
        let previousModel;
        let previousErrorCode;
        for (const [index, model] of models.entries()) {
            let emitted = false;
            const context = {
                requestedModel: options.model,
                attempt: index + 1,
                route: models,
                preflight: routePlan?.preflight,
                fallbackFrom: previousModel,
                fallbackReason: previousErrorCode,
            };
            try {
                for await (const event of this.streamAttempt({ ...options, model }, context)) {
                    emitted = true;
                    yield event;
                }
                return;
            }
            catch (error) {
                lastError = error;
                previousModel = model;
                previousErrorCode = errorCode(error);
                if (emitted || !isFallbackError(error) || model === models[models.length - 1])
                    throw error;
            }
        }
        if (lastError !== undefined)
            throw lastError;
    }
    async *streamAttempt(options, context) {
        const apiKey = await this.options.resolveApiKey();
        const url = chatCompletionsUrl(this.options.baseURL);
        const body = serializeRequest(options);
        const payload = JSON.stringify(body);
        const headers = {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
            ...attributionHeaders(),
        };
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers,
                body: payload,
                signal: options.signal,
            });
        }
        catch (error) {
            if (options.signal?.aborted) {
                const failure = new LlmError('aborted', 'ABORTED', { cause: error });
                await this.reportExecution(this.executionEvent(options, context, undefined, 'failure', failure.code));
                throw failure;
            }
            const failure = new LlmError('request failed', 'TRANSPORT', { cause: error });
            await this.reportExecution(this.executionEvent(options, context, undefined, 'failure', failure.code));
            throw failure;
        }
        if (!response.ok) {
            const trace = cpaTrace(response.headers);
            let failure;
            try {
                await readError(response);
            }
            catch (error) {
                failure = error;
            }
            await this.reportExecution(this.executionEvent(options, context, trace, 'failure', errorCode(failure)));
            throw failure;
        }
        const trace = cpaTrace(response.headers);
        if (!response.body) {
            const failure = new LlmError('empty response', 'EMPTY_RESPONSE');
            await this.reportExecution(this.executionEvent(options, context, trace, 'failure', failure.code));
            throw failure;
        }
        let executionUsage;
        let completed = false;
        let failureCode;
        try {
            for await (const event of translate(parseSse(response.body))) {
                if (event.type === 'finish' && event.reason.kind === 'error') {
                    throw new LlmError(event.reason.failure.message, event.reason.failure.code);
                }
                if (event.type === 'usage' && event.usage !== undefined)
                    executionUsage = event.usage;
                yield event;
            }
            completed = true;
        }
        catch (error) {
            failureCode = errorCode(error);
            throw error;
        }
        finally {
            const execution = this.executionEvent(options, context, trace, completed ? 'success' : 'failure', failureCode);
            if (executionUsage !== undefined) {
                execution.inputTokens = executionUsage.inputTokens;
                execution.outputTokens = executionUsage.outputTokens;
            }
            await this.reportExecution(execution);
        }
    }
    executionEvent(options, context, trace, outcome, failureCode) {
        const execution = {
            sessionId: options.sessionId,
            provider: this.options.provider,
            model: options.model,
            purpose: options.purpose,
            outcome,
            requestedModel: context.requestedModel,
            attempt: context.attempt,
            route: [...context.route],
            preflightStatus: context.preflight?.status,
            preflightIssues: context.preflight?.issues.map(issue => issue.code),
            fallbackFrom: context.fallbackFrom,
            fallbackReason: context.fallbackReason,
            errorCode: failureCode,
        };
        if (trace !== undefined) {
            execution.authIndex = trace.authIndex;
            execution.traceId = trace.traceId;
            execution.requestId = trace.requestId;
        }
        return execution;
    }
    async reportExecution(execution) {
        try {
            await this.options.onExecution?.(execution);
        }
        catch {
            // Execution telemetry must not replace the provider result.
        }
    }
}
function errorCode(cause) {
    if (!isJsonRecord(cause) || !isString(cause.code))
        return undefined;
    return cause.code;
}
function isRoutePlan(value) {
    return !Array.isArray(value);
}
function isFallbackError(cause) {
    if (!isJsonRecord(cause) || !isString(cause.code))
        return false;
    return FALLBACK_ERROR_CODES.has(cause.code);
}
export function resolveApiKey(ctx, ref, provided) {
    return async () => {
        const configured = isFunction(provided) ? await provided() : provided;
        if (configured !== undefined && configured !== null && configured !== '') {
            return assertUsableApiKey(configured, 'dsh-cpa', ref);
        }
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(ref);
            if (hit !== undefined) {
                return assertUsableApiKey(hit.value, 'dsh-cpa', ref);
            }
        }
        throw new LlmError(`no API key for ${ref}`, 'MISSING_CREDENTIAL');
    };
}
