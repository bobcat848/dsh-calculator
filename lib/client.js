// dsh-cost-tracker — browser half.
//
// Renders an "API 费用" card in the layout's `aside` slot (rightmost column).
// The host half accumulates token usage per (provider, model) from live session
// events and serves /dsh-cost-tracker; this half polls that endpoint and shows
// ONLY the current session's spend (per model, DeepSeek routes billed; any
// third-party model listed as unbilled).
window.__ModuleLoader__.load({
	id: "dsh-cost-tracker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region formatting
		function fmtCny(value) {
			return `¥${value.toFixed(4)}`;
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
.dsh-cost-root{box-sizing:border-box;height:100%;padding:16px 14px;overflow-y:auto;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
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
		const tagId = "dsh-cost-tracker/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-cost-tracker";
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
					row.billed ? null : react.createElement("span", { className: "dsh-cost-unbilled" }, "（未计费）")
				),
				react.createElement("dd", null,
					row.billed ? fmtCny(row.costCny) : "—",
					" · ",
					fmtTokens(tokens),
					" tok"
				)
			);
		}

		function CostPanel({ sessions, closeAside }) {
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
						const res = await fetch("/dsh-cost-tracker", { cache: "no-store" });
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

			const head = react.createElement("div", { className: "dsh-cost-head" },
				react.createElement("h3", { className: "dsh-cost-title" }, "DeepSeek API 费用"),
				react.createElement("button", {
					className: "dsh-cost-close",
					title: "关闭面板",
					onClick: () => closeAside()
				}, "×")
			);

			if (error !== "") {
				return react.createElement("div", { className: "dsh-cost-root" },
					head,
					react.createElement("p", { className: "dsh-cost-empty" }, `统计端点暂不可用：${error}`)
				);
			}

			if (report === null || currentId === void 0) {
				return react.createElement("div", { className: "dsh-cost-root" },
					head,
					react.createElement("p", { className: "dsh-cost-empty" }, "加载中…")
				);
			}

			const session = (report.sessions ?? {})[currentId];
			const models = session?.models ?? [];
			const costCny = session?.costCny ?? 0;
			const totalTokens = models.reduce((sum, row) => sum + row.uncachedInput + row.cacheRead + row.output, 0);

			// Account balance from the host (may be an error marker).
			const balance = report.balance;
			const balanceError = balance !== void 0 && balance !== null && typeof balance === "object" && "error" in balance
				? balance.error
				: null;

			// Global (all-sessions) figures from the report.
			const globalModels = report.models ?? [];
			const globalBilled = globalModels.filter((row) => row.billed);
			const globalUnbilled = globalModels.filter((row) => !row.billed);
			const globalCost = report.totalCostCny ?? 0;
			const globalTokens = globalModels.reduce((sum, row) => sum + row.uncachedInput + row.cacheRead + row.output, 0);
			const sessionCount = Object.keys(report.sessions ?? {}).length;

			return react.createElement("div", { className: "dsh-cost-root" },
				head,
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" },
						"账户余额",
						balance !== null && balance !== void 0 && typeof balance === "object" && "isAvailable" in balance
							? (balance.isAvailable ? react.createElement("span", { className: "dsh-cost-badge" }, "可用") : null)
							: null
					),
					balanceError !== null
						? react.createElement("p", { className: "dsh-cost-sub dsh-cost-unbilled" }, `余额不可用：${balanceError}`)
						: react.createElement("div", { className: "dsh-cost-big" }, fmtBalance(balance?.totalBalance ?? 0)),
					balanceError === null && balance !== null && balance !== void 0 && typeof balance === "object" && "totalBalance" in balance
						? react.createElement("p", { className: "dsh-cost-sub" },
							balance.balanceInfos && balance.balanceInfos.length > 0
								? `${balance.currency} · 赠送 ${fmtBalance(balance.balanceInfos[0].granted)} · 充值 ${fmtBalance(balance.balanceInfos[0].toppedUp)}`
								: balance.currency
						)
						: null
				),
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, "全部会话累计"),
					react.createElement("div", { className: "dsh-cost-big" }, fmtCny(globalCost)),
					react.createElement("p", { className: "dsh-cost-sub" },
						`${sessionCount} 个会话 · ${fmtTokens(globalTokens)} tokens`
					),
					globalModels.length > 0 ? react.createElement("dl", { className: "dsh-cost-dl" },
						globalModels.map((row, i) => react.createElement(ModelRow, { row, key: `${row.provider}/${row.model}/${i}` }))
					) : null
				),
				globalUnbilled.length > 0 ? react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, "第三方模型（未计费）"),
					react.createElement("p", { className: "dsh-cost-sub" },
						globalUnbilled.map((row) => modelLabel(row)).join("、"),
						" — 非 DeepSeek 渠道，不计入费用"
					)
				) : null,
				react.createElement("div", { className: "dsh-cost-card" },
					react.createElement("p", { className: "dsh-cost-cardLabel" }, "当前会话"),
					react.createElement("div", { className: "dsh-cost-big" }, fmtCny(costCny)),
					react.createElement("p", { className: "dsh-cost-sub" },
						models.length > 0 ? `${fmtTokens(totalTokens)} tokens` : "暂无 token 用量记录"
					),
					models.length > 0 ? react.createElement("dl", { className: "dsh-cost-dl" },
						models.map((row, i) => react.createElement(ModelRow, { row, key: `${row.provider}/${row.model}/${i}` }))
					) : null
				),
				react.createElement("p", { className: "dsh-cost-note" },
					globalBilled.length > 0
						? "估算口径：DeepSeek 官方价（缓存命中/未命中输入、输出分档，8/17 起按峰谷时段计费）。输出含推理 token，与普通输出同价。与官方账单可能存在差异。"
						: "当前会话没有 DeepSeek 计费记录；第三方模型调用不计费。"
				)
			);
		}
		//#endregion

		/** Services required by this plugin. */
		const inject = ["slots", "layout", "sessions"];

		/**
		 * Client plugin body: register the cost panel into the layout's `aside` slot.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const injected = {
				closeAside: () => {
					ctx.layout.closeAside();
				},
				sessions: ctx.sessions
			};
			ctx.effect(() => ctx.slots.inject("aside", () => ctx.slots.register({
				name: "aside",
				inject: () => injected
			}, function CostTrackerAside() {
				return react.createElement(CostPanel, injected);
			})), "dsh-cost-tracker: aside panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
