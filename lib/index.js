// dsh-cost-tracker — host half.
//
// Subscribes to session events, accumulates token usage per (provider, model)
// from `assistant/message` events (usage + message.source), and serves an HTTP
// endpoint the browser half polls. Only DeepSeek routes are billed (provider
// id `deepseek-official`); any other provider/model is reported as unbilled so
// switching to a third-party model stops the meter instead of mis-pricing it.

const name = "dsh-cost-tracker";
/** Services required by the host half. */
const inject = ["sessions", "webServer", "credentials"];

//#region balance
/** DeepSeek account balance endpoint (Bearer token auth). */
const BALANCE_URL = "https://api.deepseek.com/user/balance";
/** Credential reference for the DeepSeek API key (matches the llm-deepseek default). */
const DEEPSEEK_API_KEY_REF = "DEEPSEEK_API_KEY";
/** Balance cache TTL: the account does not change mid-session; 30s is plenty. */
const BALANCE_TTL_MS = 30_000;

/**
 * Fetch the DeepSeek account balance. Returns a normalized payload, or a
 * `{ error }` marker when the key is missing or the request fails (the panel
 * degrades gracefully instead of breaking the whole report).
 */
async function fetchBalance(credentials, logger) {
	let resolved;
	try {
		if (credentials === void 0 || typeof credentials.resolve !== "function") {
			return { error: "credentials 服务不可用" };
		}
		resolved = await credentials.resolve(DEEPSEEK_API_KEY_REF);
	} catch (error) {
		logger.warn("balance: credential resolve failed: %s", error instanceof Error ? error.message : String(error));
		return { error: "凭据解析失败" };
	}
	const apiKey = resolved?.value;
	if (typeof apiKey !== "string" || apiKey === "") {
		return { error: `未配置 ${DEEPSEEK_API_KEY_REF}` };
	}
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15_000);
		try {
			const response = await fetch(BALANCE_URL, {
				headers: {
					"authorization": `Bearer ${apiKey}`,
					"accept": "application/json"
				},
				signal: controller.signal
			});
			if (!response.ok) {
				return { error: `余额接口 HTTP ${response.status}` };
			}
			const data = await response.json();
			const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
			const total = infos.reduce((sum, info) => sum + (Number(info.total_balance) || 0), 0);
			return {
				isAvailable: data?.is_available === true,
				currency: infos[0]?.currency ?? "CNY",
				totalBalance: total,
				balanceInfos: infos.map((info) => ({
					currency: info.currency,
					total: Number(info.total_balance) || 0,
					granted: Number(info.granted_balance) || 0,
					toppedUp: Number(info.topped_up_balance) || 0
				}))
			};
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		logger.warn("balance: request failed: %s", error instanceof Error ? error.message : String(error));
		return { error: "余额接口请求失败" };
	}
}
//#endregion

//#region pricing
/**
 * DeepSeek official rates (CNY per 1M tokens). Three schedules:
 *  - CURRENT: the pre-2026-08-17 price (cache hit / cache miss input / output).
 *  - PEAK: effective 2026-08-17 00:00 Beijing time; peak window is 09:00-12:00
 *    and 14:00-18:00 Beijing.
 *  - OFFPEAK: the rest of the day after 2026-08-17 (half the peak price).
 */
const PRICING_CURRENT = {
	"deepseek-v4-flash": { hit: 0.02, miss: 1.0, out: 2.0 },
	"deepseek-v4-pro": { hit: 0.025, miss: 3.0, out: 6.0 },
	default: { hit: 0.02, miss: 1.0, out: 2.0 }
};
const PRICING_PEAK = {
	"deepseek-v4-flash": { hit: 0.10, miss: 3.0, out: 9.0 },
	"deepseek-v4-pro": { hit: 0.30, miss: 9.0, out: 27.0 },
	default: { hit: 0.10, miss: 3.0, out: 9.0 }
};
const PRICING_OFFPEAK = {
	"deepseek-v4-flash": { hit: 0.05, miss: 1.5, out: 4.5 },
	"deepseek-v4-pro": { hit: 0.15, miss: 4.5, out: 13.5 },
	default: { hit: 0.05, miss: 1.5, out: 4.5 }
};
/** Effective date of the peak/off-peak schedule (Beijing 2026-08-17 00:00 = UTC 2026-08-16 16:00). */
const PEAK_SCHEDULE_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0);

/** Whether a UTC timestamp falls in the Beijing peak window (09-12 and 14-18). */
function isPeak(ms) {
	const beijingHour = (new Date(ms).getUTCHours() + 8) % 24;
	return (beijingHour >= 9 && beijingHour < 12) || (beijingHour >= 14 && beijingHour < 18);
}

/**
 * Normalize a usage/accumulator record into the three billed buckets.
 * Accepts both the event-level shape (`assistant/message` events carry
 * inputTokens/outputTokens/cacheReadTokens) and the accumulator shape
 * (uncachedInput/output/cacheRead). DeepSeek's `outputTokens` already
 * includes reasoning tokens, so reasoning is billed at the output rate.
 */
function bucketsOf(usage) {
	const uncachedInput = usage.uncachedInputTokens ?? usage.inputTokens ?? usage.uncachedInput ?? 0;
	const output = usage.outputTokens ?? usage.output ?? 0;
	const cacheRead = usage.cacheReadTokens ?? usage.cacheRead ?? 0;
	return { uncachedInput, output, cacheRead };
}

/** Merge one usage record into a per-model accumulator (mutates `acc`). */
function accumulate(acc, usage) {
	const { uncachedInput, output, cacheRead } = bucketsOf(usage);
	acc.uncachedInput += uncachedInput;
	acc.output += output;
	acc.cacheRead += cacheRead;
	acc.calls += 1;
}
//#endregion

/**
 * Plugin body: wire the event subscription, backfill existing sessions, and
 * register the stats endpoint.
 * @param ctx - plugin context.
 */
function apply(ctx) {
	const logger = ctx.logger("dsh-cost-tracker");
	/** sessionId -> Map<"provider/model", accumulator> */
	const perSession = /* @__PURE__ */ new Map();
	/** Map<"provider/model", accumulator> over every session (folded on demand). */
	const globalTotals = /* @__PURE__ */ new Map();

	const keyOf = (provider, model) => `${provider}/${model}`;

	/**
	 * Record one assistant/message event into the ledger. Buckets are keyed by
	 * (provider, model) AND pricing period (current / peak / off-peak), so each
	 * event's tokens are priced under the schedule in force at its timestamp.
	 *
	 * Fork/child sessions carry a COPY of the parent's event log (identical
	 * message ids), so a globally unique `message.id` set is kept: a request is
	 * billed once across the whole corpus. Per-session maps still record every
	 * occurrence (the current-session view shows that session's log), but the
	 * all-sessions total derives from the deduplicated global map.
	 */
	const seenMessageIds = /* @__PURE__ */ new Set();
	const record = (sessionId, event) => {
		if (event.type !== "assistant/message") return;
		const usage = event.data?.usage;
		if (usage === void 0) return;
		const source = event.data?.message?.source;
		if (source === void 0 || source.kind !== "model") return;
		const provider = typeof source.provider === "string" && source.provider !== "" ? source.provider : "unknown";
		const model = typeof source.model === "string" && source.model !== "" ? source.model : "unknown";
		const ms = typeof event.time === "number" && event.time > 0 ? event.time : Date.now();
		const period = ms >= PEAK_SCHEDULE_START_MS ? (isPeak(ms) ? "peak" : "off") : "current";
		const key = keyOf(provider, model);

		// Per-session bucket (always recorded; drives the current-session view).
		let sess = perSession.get(sessionId);
		if (sess === void 0) {
			sess = /* @__PURE__ */ new Map();
			perSession.set(sessionId, sess);
		}
		let acc = sess.get(key);
		if (acc === void 0) {
			acc = { provider, model, uncachedInput: 0, output: 0, cacheRead: 0, calls: 0, period };
			sess.set(key, acc);
		}
		accumulate(acc, usage);

		// Global bucket: deduplicate by message.id so fork-copied events are
		// not double-billed across sessions.
		const messageId = event.data?.message?.id;
		if (typeof messageId === "string" && messageId !== "") {
			if (seenMessageIds.has(messageId)) return;
			seenMessageIds.add(messageId);
		}
		let g = globalTotals.get(key);
		if (g === void 0) {
			g = { provider, model, uncachedInput: 0, output: 0, cacheRead: 0, calls: 0, period };
			globalTotals.set(key, g);
		}
		accumulate(g, usage);
	};

	// Live events after boot.
	ctx.on("session/event", (session, event) => {
		try {
			record(session.id, event);
		} catch (error) {
			logger.warn("record failed: %s", error instanceof Error ? error.message : String(error));
		}
	});

	// Backfill sessions already loaded at boot (current + resumed).
	const backfilled = /* @__PURE__ */ new Set();
	for (const session of ctx.sessions.list()) {
		backfilled.add(session.id);
		try {
			for (const event of session.events) record(session.id, event);
		} catch (error) {
			logger.warn("backfill failed for %s: %s", session.id, error instanceof Error ? error.message : String(error));
		}
	}

	// Best-effort backfill of persisted history through sessionQuery (when mounted).
	// `readSession` returns the LIVE snapshot for sessions already in memory, so
	// skip those to avoid double-counting the same events.
	const query = ctx.get("sessionQuery");
	if (query !== void 0 && typeof query.listSessions === "function" && typeof query.readSession === "function") {
		query.listSessions()
			.then(async (records) => {
				for (const rec of records) {
					if (backfilled.has(rec.header.id)) continue;
					backfilled.add(rec.header.id);
					try {
						const loaded = await query.readSession(rec.header.id);
						for (const event of loaded.events) record(rec.header.id, event);
					} catch {
						// skip unreadable history rows; live ledger stays authoritative
					}
				}
				logger.info("history backfill complete (%d sessions)", records.length);
			})
			.catch((error) => logger.warn("history backfill failed: %s", error instanceof Error ? error.message : String(error)));
	}

	/** Cost of one accumulator under its recorded pricing period. */
	const accCost = (acc) => {
		if (acc.provider !== "deepseek-official") return null;
		const table = acc.period === "peak" ? PRICING_PEAK : acc.period === "off" ? PRICING_OFFPEAK : PRICING_CURRENT;
		const rates = table[acc.model] ?? table.default;
		return (acc.uncachedInput / 1e6) * rates.miss
			+ (acc.cacheRead / 1e6) * rates.hit
			+ (acc.output / 1e6) * rates.out;
	};

	/** Serialize one accumulator to a report row. */
	const rowOf = (acc) => ({
		provider: acc.provider,
		model: acc.model,
		calls: acc.calls,
		uncachedInput: acc.uncachedInput,
		output: acc.output,
		cacheRead: acc.cacheRead,
		period: acc.period,
		costCny: accCost(acc) ?? 0,
		billed: accCost(acc) !== null
	});

	/** Build the full report snapshot. */
	const buildReport = () => {
		const models = [...globalTotals.values()]
			.map(rowOf)
			.sort((a, b) => b.costCny - a.costCny);
		const totalCost = models.reduce((sum, row) => sum + (row.billed ? row.costCny : 0), 0);
		const sessions = {};
		for (const [sessionId, map] of perSession) {
			sessions[sessionId] = {
				costCny: [...map.values()].reduce((sum, acc) => sum + (accCost(acc) ?? 0), 0),
				models: [...map.values()].map(rowOf)
			};
		}
		return {
			generatedAt: Date.now(),
			totalCostCny: totalCost,
			models,
			sessions
		};
	};

	// Balance cache: `{ at, payload }`; refetch after BALANCE_TTL_MS.
	let balanceCache = null;

	/** Resolve the balance with a short TTL, degrading to `{ error }` on failure. */
	const resolveBalance = async () => {
		const now = Date.now();
		if (balanceCache !== null && now - balanceCache.at < BALANCE_TTL_MS) {
			return balanceCache.payload;
		}
		const payload = await fetchBalance(ctx.get("credentials"), logger);
		balanceCache = { at: now, payload };
		return payload;
	};

	// Stats endpoint for the browser half (exact path; avoids the /api gateway prefix).
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-cost-tracker",
		handler: async (_req, res) => {
			const balance = await resolveBalance();
			const body = JSON.stringify({
				...buildReport(),
				balance
			});
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store"
			});
			res.end(body);
		}
	}), "dsh-cost-tracker: stats route");
}

export { apply, inject, name };
