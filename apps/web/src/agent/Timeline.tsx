import type { PanelState } from "./reducer";

const CONNECTION_LABEL: Record<PanelState["connection"], string> = {
	connecting: "连接中…",
	open: "已连接",
	closed: "已断开 — 正在重连",
};

/** The agent activity view: what was asked, what was decided, what the session holds now. */
export function Timeline({ state }: { state: PanelState }) {
	return (
		<div className="mx-auto w-full max-w-[640px] p-5">
			<div className="flex items-center justify-between">
				<h1 className="text-base font-semibold">Agent 活动</h1>
				<span data-testid="connection" className="text-xs text-muted-foreground">
					{CONNECTION_LABEL[state.connection]}
				</span>
			</div>

			<div data-testid="counts" className="mt-3 grid grid-cols-3 gap-2 text-center">
				<Count label="待决" value={state.pending.length} />
				<Count label="已授权" value={state.grants.length} />
				<Count label="session" value={state.sessions.length} />
			</div>

			<div data-testid="granted-area" className="mt-4 text-xs text-muted-foreground">
				<div className="mb-1 text-[10px]">当前持有的 key</div>
				{state.grants.length === 0 ? <div>（还没有 grant）</div> : null}
				{state.grants.map((row) => (
					<div key={row.alias} className="flex items-center justify-between py-0.5">
						<span className="font-mono">{row.alias}</span>
						<span>{row.status}</span>
					</div>
				))}
			</div>

			<div className="mt-4">
				<div className="mb-1 text-[10px] text-muted-foreground">ask 时间线</div>
				{state.timeline.length === 0 ? <div className="text-xs text-muted-foreground">（还没有记录）</div> : null}
				<ul data-testid="timeline" className="divide-y">
					{state.timeline.map((item) => (
						<li key={item.id} className="flex items-center gap-3 py-2 text-sm">
							<span className="w-16 shrink-0 text-xs text-muted-foreground">
								{new Date(item.at).toLocaleTimeString()}
							</span>
							<span className="min-w-0 flex-1 truncate font-mono text-xs">{item.principal}</span>
							<span className="text-xs text-muted-foreground">{item.keyCount} keys</span>
							<span className={item.decision === "approve" ? "text-xs" : "text-xs text-destructive"}>
								{item.decision === "approve" ? "批准" : "拒绝"}
							</span>
							<span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{item.via}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function Count({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-md border py-2">
			<div className="text-lg font-semibold">{value}</div>
			<div className="text-[10px] text-muted-foreground">{label}</div>
		</div>
	);
}
