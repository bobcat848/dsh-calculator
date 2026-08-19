// dsh-calculator — browser half.
//
// Renders a cost card into the frame-wide `shell.overlay` slot (top-right
// floating card, collapsible to a pill). The host half accumulates token
// usage per (provider, model) from live session events and serves
// /dsh-calculator; this half polls that endpoint and shows the current
// session's spend plus the caller's local-day total across all sessions
// (per model, DeepSeek routes billed; third-party models unbilled).
// UI language follows the browser locale (zh / en); the caller's timezone is
// sent as a UTC-offset query so the "today" boundary matches the user's clock.
window.__ModuleLoader__.load({
	id: "dsh-calculator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region i18n
		const I18N = {
			zh: {
				title: "DeepSeek API 费用",
				close: "关闭面板",
				endpointError: "统计端点暂不可用：",
				loading: "加载中…",
				balance: "账户余额",
				available: "可用",
				balanceUnavailable: "余额不可用：",
				balanceBreakdown: (currency, granted, toppedUp) => `${currency} · 赠送 ${granted} · 充值 ${toppedUp}`,
				todayTotal: (dayLabel) => `当天全部会话累计（${dayLabel}）`,
				sessionsCount: (count, tokens) => `${count} 个会话 · ${tokens} tokens`,
				thirdParty: "第三方模型（未计费）",
				thirdPartyNote: (models) => `${models} — 非 DeepSeek 渠道，不计入费用`,
				currentSession: "当前会话",
				noTokens: "暂无 token 用量记录",
				unbilled: "（未计费）",
				note: "估算口径：DeepSeek 官方峰谷价（高峰 09:00–12:00 / 14:00–18:00，其余时段半价；缓存命中/未命中输入、输出分档）。输出含推理 token，与普通输出同价。与官方账单可能存在差异。",
				noteNoBilled: "当前会话没有 DeepSeek 计费记录；第三方模型调用不计费。",
				fabTitle: (amount) => `今日累计费用 ${amount}，点击查看详情`
			},
			en: {
				title: "DeepSeek API Spend",
				close: "Close panel",
				endpointError: "Stats endpoint unavailable: ",
				loading: "Loading…",
				balance: "Account Balance",
				available: "available",
				balanceUnavailable: "Balance unavailable: ",
				balanceBreakdown: (currency, granted, toppedUp) => `${currency} · granted ${granted} · topped-up ${toppedUp}`,
				todayTotal: (dayLabel) => `Today's total, all sessions (${dayLabel})`,
				sessionsCount: (count, tokens) => `${count} session(s) · ${tokens} tokens`,
				thirdParty: "Third-party models (unbilled)",
				thirdPartyNote: (models) => `${models} — non-DeepSeek routes, not billed`,
				currentSession: "Current Session",
				noTokens: "No token usage recorded",
				unbilled: " (unbilled)",
				note: "Estimated at official DeepSeek peak/off-peak rates (peak 09:00–12:00 & 14:00–18:00, off-peak at half price; cache-hit / cache-miss input, output). Output includes reasoning tokens at the output rate. May differ from the official bill.",
				noteNoBilled: "No DeepSeek billing records in this session; third-party calls are not billed.",
				fabTitle: (amount) => `Today's total ${amount}, click for details`
			}
		};
		/** Pick the language bundle from the browser locale (default: English). */
		const lang = (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language.toLowerCase().startsWith("zh"))
			? "zh"
			: "en";
		const T = I18N[lang];
		/** The caller's UTC offset in minutes (local = UTC + offset). */
		const tzOffsetMinutes = () => -new Date().getTimezoneOffset();
		//#endregion

		//#region formatting
		function fmtCny(value) {
			return `¥${value.toFixed(4)}`;
		}

		/** Compact CNY for the pill: 2 decimals at ¥1+, 3 decimals below. */
		function fmtCompactCny(value) {
			const n = Number(value);
			if (!Number.isFinite(n) || n <= 0) return "¥0.00";
			return `¥${n >= 1 ? n.toFixed(2) : n.toFixed(3)}`;
		}

		/** Balance formatting: always two decimal places (e.g. ¥65.82, ¥100.00). */
		function fmtBalance(value) {
			return `¥${Number(value).toFixed(2)}`;
		}

		function fmtTokens(n) {
			if (!Number.isFinite(n) || n <= 0) return "0";
			if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
			return String(n);
		}

		/** Short display label for a model row. */
		function modelLabel(row) {
			const short = row.model.includes("/") ? row.model.split("/").pop() : row.model;
			return short;
		}
		//#endregion

		//#region styles
		const CSS = `
html [data-shell-overlay]{z-index:60}
.dsh-cost-root{box-sizing:border-box;position:fixed;top:12px;right:12px;width:320px;max-height:calc(100vh - 24px);padding:16px 14px;overflow-y:auto;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;pointer-events:auto;z-index:1200;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 8px 24px rgb(0 0 0 / .18)}
.dsh-cost-fab{box-sizing:border-box;position:fixed;top:12px;right:12px;z-index:1200;pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:8px 14px;box-shadow:0 4px 16px rgb(0 0 0 / .14);font-variant-numeric:tabular-nums}
.dsh-cost-fab:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-cost-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-cost-title{font-size:14px;font-weight:600;margin:0}
.dsh-cost-close{cursor:pointer;background:transparent;border:none;color:var(--dsw-alias-label-secondary);font-size:16px;padding:2px 6px;border-radius:6px}
.dsh-cost-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-cost-card{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px}
.dsh-cost-cardLabel{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 4px}
.dsh-cost-big{font-size:20px;font-weight:700;letter-spacing:.2px;color:var(--dsw-alias-state-business-primary);font-variant-numeric:tabular-nums}
.dsh-cost-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:2px 0 0}
.dsh-cost-dl{margin:8px 0 0;display:flex;flex-direction:column;gap:3px}
.dsh-cost-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;font-variant-numeric:tabular-nums}
.dsh-cost-row dt{color:var(--dsw-alias-label-secondary);margin:0}
.dsh-cost-row dd{margin:0;color:var(--dsw-alias-label-primary)}
.dsh-cost-unbilled{color:var(--dsw-alias-state-error-primary)}
.dsh-cost-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-cost-note{font-size:11px;color:var(--dsw-alias-label-tertiary);margin:0;padding:0 2px}
.dsh-cost-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0;padding:8px 2px}
`;
		const tagId = "dsh-calculator/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-calculator";
			tag.dataset.pluginCss = tagId;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region components
		const POLL_MS = 5000;

		/** One model row: label, billed amount, token buckets. */
		function ModelRow({ row }) {
			const label = modelLabel(row);
			const tokens = row.uncachedInput + row.cacheRead + row.output;
			return react.createElement("div", { className: "dsh-cost-row" },
				react.createElement("dt", null,
					label,
					row.billed ? null : react.createElement("span", { className: "dsh-cost-unbilled" }, T.unbilled)
				),
				react.createElement("dd", null,
					row.billed ? fmtCny(row.costCny) : "—",
					" · ",
					fmtTokens(tokens),
					" tok"
				)
			);
		}

		function CostPanel({ sessions }) {
			const [open, setOpen] = react.useState(true);
			const [report, setReport] = react.useState(null);
			const [error, setError] = react.useState("");

			// Current session id from the sessions service snapshot.
			const list = react.useSyncExternalStore(
				(cb) => sessions.list.subscribe(cb),
				() => sessions.list.getSnapshot()
			);
			const currentId = list?.current;

			react.useEffect(() => {
				let alive = true;
				const poll = async () => {
					try {
						const res = await fetch(`/dsh-calculator?tzOffset=${tzOffsetMinutes()}`, { cache: "no-store" });
						if (!res.ok) throw new Error(`HTTP ${res.status}`);
						const data = await res.json();
						if (!alive) return;
						setReport(data);
						setError("");
					} catch (err) {
						if (!alive) return;
						setError(err instanceof Error ? err.message : String(err));
					}
				};
				poll();
				const timer = window.setInterval(poll, POLL_MS);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, []);

			if (!open) {
				const amount = report !== null && report !== void 0 ? fmtCompactCny(report.totalCostCny) : null;
				return react.createElement("div", {
					className: "dsh-cost-fab",
					title: amount !== null ? T.fabTitle(amount) : T.title,
					onClick: () => setOpen(true)
				}, amount !== null ? amount : T.title);
			}

			const head = react.createElement("div", { className: "dsh-cost-head" },
				react.createElement("h3", { className: "dsh-cost-title" }, T.title),
				react.createElement("button", {
					className: "dsh-cost-close",
					title: T.close,
					onClick: () => setOpen(false)
				}, "×")
			);

			if (error !== "") {
				return react.createElement("div", { className: "dsh-cost-root" },
					head,
					react.createElement("p", { className: "dsh-cost-empty" }, `${T.endpointError}${error}`)
				);
			}

			if (report === null) {
				return react.createElement("div", { className: "dsh-cost-root" },
					head,
					react.createElement("p", { className: "dsh-cost-empty" }, T.loading)
				);
			}

			const session = currentId !== void 0 ? (report.sessions ?? {})[currentId] : void 0;
			const models = session?.models ?? [];
			const costCny = session?.costCny ?? 0;
			const totalTokens = models.reduce((sum, row) => sum + row.uncachedInput + row.cacheRead + row.output, 0);

			// Account balance from the host (may be an error marker).
			const balance = report.balance;
			const balanceError = balance !== void 0 && balance !== null && typeof balance === "object" && "error" in balance
				? balance.error
				: null;

			// Global (local-day, all sessions) figures from the report.
			const globalModels = report.models ?? [];
			const globalBilled = globalModels.filter((row) => row.billed);
			const globalUnbilled = globalModels.filter((row) => !row.billed);
			const globalCost = report.totalCostCny ?? 0;
			const globalTokens = globalModels.reduce((sum, row) => sum + row.uncachedInput + row.cacheRead + row.output, 0);
			const dayLabel = report.dayLabel ?? "";
			const sessionCount = Object.keys(report.sessions ?? {}).length;

			return react.createElement("div", { className: "dsh-cost-root" },
				head,
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" },
						T.balance,
						balance !== null && balance !== void 0 && typeof balance === "object" && "isAvailable" in balance
							? (balance.isAvailable ? react.createElement("span", { className: "dsh-cost-badge" }, T.available) : null)
							: null
					),
					balanceError !== null
						? react.createElement("p", { className: "dsh-cost-sub dsh-cost-unbilled" }, `${T.balanceUnavailable}${balanceError}`)
						: react.createElement("div", { className: "dsh-cost-big" }, fmtBalance(balance?.totalBalance ?? 0)),
					balanceError === null && balance !== null && balance !== void 0 && typeof balance === "object" && "totalBalance" in balance
						? react.createElement("p", { className: "dsh-cost-sub" },
							balance.balanceInfos && balance.balanceInfos.length > 0
								? T.balanceBreakdown(balance.currency, fmtBalance(balance.balanceInfos[0].granted), fmtBalance(balance.balanceInfos[0].toppedUp))
								: balance.currency
						)
						: null
				),
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, T.todayTotal(dayLabel)),
					react.createElement("div", { className: "dsh-cost-big" }, fmtCny(globalCost)),
					react.createElement("p", { className: "dsh-cost-sub" },
						T.sessionsCount(sessionCount, fmtTokens(globalTokens))
					),
					globalModels.length > 0 ? react.createElement("dl", { className: "dsh-cost-dl" },
						globalModels.map((row, i) => react.createElement(ModelRow, { row, key: `${row.provider}/${row.model}/${i}` }))
					) : null
				),
				globalUnbilled.length > 0 ? react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, T.thirdParty),
					react.createElement("p", { className: "dsh-cost-sub" },
						T.thirdPartyNote(globalUnbilled.map((row) => modelLabel(row)).join("、"))
					)
				) : null,
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, T.currentSession),
					react.createElement("div", { className: "dsh-cost-big" }, fmtCny(costCny)),
					react.createElement("p", { className: "dsh-cost-sub" },
						models.length > 0 ? `${fmtTokens(totalTokens)} tokens` : T.noTokens
					),
					models.length > 0 ? react.createElement("dl", { className: "dsh-cost-dl" },
						models.map((row, i) => react.createElement(ModelRow, { row, key: `${row.provider}/${row.model}/${i}` }))
					) : null
				),
				react.createElement("p", { className: "dsh-cost-note" },
					globalBilled.length > 0 ? T.note : T.noteNoBilled
				)
			);
		}
		//#endregion

		/** Services required by this plugin. */
		const inject = ["slots", "sessions"];

		/**
		 * Client plugin body: register the cost panel into the frame-wide
		 * `shell.overlay` slot (top-right floating card; collapsible).
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const injected = {
				sessions: ctx.sessions
			};
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-calculator",
				order: 100,
				label: () => T.title,
				inject: () => injected
			}, function CostTrackerOverlay() {
				return react.createElement(CostPanel, injected);
			})), "dsh-calculator: overlay panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
