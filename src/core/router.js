const DEFAULT_MAX_ATTEMPTS = 3;
function normalized(value) {
    return value.trim().toLowerCase();
}
function supportsReasoning(model, effort) {
    if (effort === undefined || model.reasoning === undefined)
        return true;
    return model.reasoning.efforts.some(candidate => normalized(candidate.id) === normalized(effort));
}
export function estimateInputTokens(options) {
    if (options.inputTokens !== undefined && Number.isFinite(options.inputTokens) && options.inputTokens >= 0) {
        return Math.ceil(options.inputTokens);
    }
    const systemLength = options.system?.length ?? 0;
    const messageLength = (options.messages ?? [])
        .reduce((total, message) => total + JSON.stringify(message.content).length, 0);
    return Math.ceil((systemLength + messageLength) / 4);
}
function fitsContext(model, inputTokens, maxTokens, defaultContextWindow) {
    const contextWindow = model.contextLength ?? defaultContextWindow;
    return inputTokens + maxTokens <= contextWindow;
}
function accountSupportsModel(account, model) {
    return account.modelAliases?.some(alias => normalized(alias) === normalized(model)) ?? false;
}
function accountHealth(account) {
    const status = normalized(account.status ?? '');
    if (account.disabled
        || account.unavailable
        || account.quotaAutoDisabled
        || status === 'disabled'
        || status === 'inactive'
        || status === 'blocked'
        || status === 'unavailable'
        || status === 'error'
        || status === 'failed')
        return 'unavailable';
    const failed = account.failed ?? 0;
    const success = account.success ?? 0;
    if (failed > 0)
        return 'degraded';
    if (success > 0)
        return 'healthy';
    return 'unknown';
}
function healthRank(health) {
    switch (health) {
        case 'healthy': return 3;
        case 'degraded': return 2;
        case 'unknown': return 1;
        case 'unavailable': return 0;
    }
}
function compareCandidates(left, right, strategy) {
    const leftRemaining = left.remainingPercent ?? -1;
    const rightRemaining = right.remainingPercent ?? -1;
    const health = healthRank(right.health) - healthRank(left.health);
    const quota = rightRemaining - leftRemaining;
    const priority = right.priority - left.priority;
    if (strategy === 'quota') {
        if (quota !== 0)
            return quota;
        if (health !== 0)
            return health;
        if (priority !== 0)
            return priority;
    }
    else if (strategy === 'quality') {
        if (health !== 0)
            return health;
        if (priority !== 0)
            return priority;
        if (quota !== 0)
            return quota;
    }
    else {
        if (health !== 0)
            return health;
        if (quota !== 0)
            return quota;
        if (priority !== 0)
            return priority;
    }
    return left.model.localeCompare(right.model, undefined, { numeric: true, sensitivity: 'base' });
}
function scoreWindows(windows) {
    if (windows.length === 0)
        return { remaining: null, exhausted: false };
    const values = windows
        .map(window => window.remainingPercent)
        .filter((value) => value !== null);
    return {
        remaining: values.length === 0 ? null : Math.min(...values),
        exhausted: windows.some(window => window.exhausted),
    };
}
function quotaForModel(model, snapshot) {
    const accounts = snapshot.accounts.filter(account => !account.disabled
        && !account.unavailable
        && !account.quotaAutoDisabled
        && (account.modelAliases === undefined || accountSupportsModel(account, model)));
    if (accounts.length === 0 && snapshot.accounts.length > 0) {
        return { remaining: null, exhausted: true, priority: 0, health: 'unavailable' };
    }
    const scores = [];
    for (const account of accounts) {
        const report = snapshot.quota[account.authIndex];
        if (report === undefined) {
            scores.push({
                remaining: null,
                exhausted: false,
                priority: account.priority ?? 0,
                health: accountHealth(account),
            });
            continue;
        }
        const modelWindows = report.windows.filter(window => normalized(window.id) === normalized(model) || normalized(window.label).includes(normalized(model)));
        const windows = modelWindows.length > 0 ? modelWindows : report.windows;
        scores.push({
            ...scoreWindows(windows),
            priority: account.priority ?? 0,
            health: accountHealth(account),
        });
    }
    if (accounts.length === 0) {
        for (const report of Object.values(snapshot.quota)) {
            const modelWindows = report.windows.filter(window => normalized(window.id) === normalized(model) || normalized(window.label).includes(normalized(model)));
            scores.push({
                ...scoreWindows(modelWindows.length > 0 ? modelWindows : report.windows),
                priority: 0,
                health: 'unknown',
            });
        }
    }
    const healthy = scores.filter(score => !score.exhausted);
    if (healthy.length === 0) {
        return scores[0] ?? { remaining: null, exhausted: false, priority: 0, health: 'unknown' };
    }
    return healthy.sort((left, right) => {
        if (healthRank(right.health) !== healthRank(left.health)) {
            return healthRank(right.health) - healthRank(left.health);
        }
        const leftRemaining = left.remaining ?? -1;
        const rightRemaining = right.remaining ?? -1;
        if (rightRemaining !== leftRemaining)
            return rightRemaining - leftRemaining;
        return right.priority - left.priority;
    })[0] ?? { remaining: null, exhausted: false, priority: 0, health: 'unknown' };
}
function issueStatus(issues) {
    if (issues.some(issue => issue.severity === 'blocked'))
        return 'blocked';
    if (issues.length > 0)
        return 'warning';
    return 'ready';
}
function preflightCpaRequest(options, snapshot, quota) {
    const configured = snapshot.models.find(model => normalized(model.id) === normalized(options.model));
    const inputTokens = estimateInputTokens(options);
    const maxTokens = options.maxTokens ?? snapshot.defaultMaxTokens;
    const contextWindow = configured?.contextLength ?? snapshot.defaultContextWindow;
    const issues = [];
    if (configured === undefined)
        issues.push({ code: 'MODEL_NOT_SYNCED', severity: 'warning' });
    const effort = options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort);
    if (configured !== undefined && !supportsReasoning(configured, effort)) {
        issues.push({ code: 'REASONING_UNSUPPORTED', severity: 'blocked' });
    }
    if (!fitsContext(configured ?? { id: options.model }, inputTokens, maxTokens, snapshot.defaultContextWindow)) {
        issues.push({ code: 'CONTEXT_WINDOW_EXCEEDED', severity: 'blocked' });
    }
    if (configured?.maxCompletionTokens !== undefined && maxTokens > configured.maxCompletionTokens) {
        issues.push({ code: 'MAX_COMPLETION_EXCEEDED', severity: 'warning' });
    }
    if (snapshot.accounts.length > 0 && quota.exhausted) {
        issues.push({ code: 'QUOTA_EXHAUSTED', severity: 'warning' });
    }
    if (quota.health === 'unavailable') {
        issues.push({ code: 'ACCOUNT_UNAVAILABLE', severity: 'warning' });
    }
    return {
        model: options.model,
        inputTokens,
        maxTokens,
        contextWindow,
        status: issueStatus(issues),
        issues,
    };
}
function candidateReasons(model, options, snapshot, quota) {
    const reasons = [];
    const effort = options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort);
    const inputTokens = estimateInputTokens(options);
    const maxTokens = options.maxTokens ?? snapshot.defaultMaxTokens;
    const reasoningFits = supportsReasoning(model, effort);
    const contextFits = fitsContext(model, inputTokens, maxTokens, snapshot.defaultContextWindow);
    if (!reasoningFits)
        reasons.push('reasoning-unsupported');
    if (!contextFits)
        reasons.push('context-window-exceeded');
    if (quota.exhausted)
        reasons.push('quota-exhausted');
    else if (quota.remaining === null)
        reasons.push('quota-unknown');
    else
        reasons.push('quota-available');
    if (quota.health === 'degraded')
        reasons.push('health-degraded');
    if (quota.health === 'unknown')
        reasons.push('health-unknown');
    return {
        eligible: reasoningFits && contextFits && !quota.exhausted,
        reasons,
    };
}
function routeCandidate(model, options, snapshot) {
    const quota = quotaForModel(model.id, snapshot);
    const result = candidateReasons(model, options, snapshot, quota);
    return {
        model: model.id,
        eligible: result.eligible,
        remainingPercent: quota.remaining,
        priority: quota.priority,
        health: quota.health,
        reasons: result.reasons,
    };
}
export function planCpaRoute(options, snapshot, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
    const requestedQuota = quotaForModel(options.model, snapshot);
    const preflight = preflightCpaRequest(options, snapshot, requestedQuota);
    const requestedCandidate = {
        model: options.model,
        eligible: true,
        remainingPercent: requestedQuota.remaining,
        priority: requestedQuota.priority,
        health: requestedQuota.health,
        reasons: ['requested'],
    };
    const alternatives = snapshot.models
        .filter(model => normalized(model.id) !== normalized(options.model))
        .map(model => routeCandidate(model, options, snapshot));
    const eligible = alternatives
        .filter(candidate => candidate.eligible)
        .sort((left, right) => compareCandidates(left, right, snapshot.routingStrategy ?? 'balanced'));
    const models = [options.model, ...eligible.map(candidate => candidate.model)]
        .slice(0, Math.max(1, maxAttempts));
    return {
        requestedModel: options.model,
        models,
        candidates: [requestedCandidate, ...alternatives],
        preflight,
    };
}
export function selectCpaModels(options, snapshot, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
    return [...planCpaRoute(options, snapshot, maxAttempts).models];
}
