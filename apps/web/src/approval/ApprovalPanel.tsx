import type { AskRequest } from "@dogsout/api-client";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { approvedCount, type Choice, DEFAULT_UI_TIER, headerTime, TTL_LABELS, TTL_TIERS, type UiTier } from "./model";

export interface ApprovalPanelProps {
	request: AskRequest;
	choices: Record<string, Choice>;
	tier: UiTier;
	onChoice: (alias: string, choice: Choice) => void;
	onTier: (tier: UiTier) => void;
	onApprove: () => void;
	onDeny: () => void;
	/** True while the WebAuthn assertion / POST is in flight. */
	busy?: boolean;
	/** Set when no platform authenticator is available: approving is impossible, fail closed. */
	blockedReason?: string;
}

/**
 * The approval window, in the browser. Same three regions as the design mockup:
 * header (principal + session + time), decision area (per-key three-state + six-tier TTL +
 * approve-N / deny-all), and a read-only "already held" list that never feeds the decision.
 */
export function ApprovalPanel(props: ApprovalPanelProps) {
	const { request, choices, tier, onChoice, onTier, onApprove, onDeny, busy, blockedReason } = props;
	const count = approvedCount(request, choices);
	const disabled = busy === true || blockedReason !== undefined;

	return (
		<div className="mx-auto w-full max-w-[520px] p-5">
			<div className="flex items-baseline justify-between gap-3">
				<div className="text-sm font-semibold">{request.principal}</div>
				<div className="text-xs text-muted-foreground">{headerTime(request.at)}</div>
			</div>
			<div className="font-mono text-xs text-muted-foreground">session {request.session}</div>
			<Separator className="my-3" />

			<div data-testid="decision-area" className="flex flex-col gap-1">
				{request.keys.map((key) => (
					<div key={key.alias} className="flex items-center gap-3 py-1">
						<Badge variant="outline" className="text-[10px]">
							NEW
						</Badge>
						<div className="min-w-0 flex-1">
							<div className="truncate font-mono text-sm font-semibold">{key.alias}</div>
							<div className="truncate text-xs text-muted-foreground">{key.note ?? key.address}</div>
						</div>
						<ToggleGroup
							type="single"
							value={choices[key.alias] ?? "deny"}
							onValueChange={(value) => value && onChoice(key.alias, value as Choice)}
							className="w-[186px] shrink-0"
							aria-label={key.alias}
						>
							<ToggleGroupItem value="approve" className="flex-1 text-xs">
								批准
							</ToggleGroupItem>
							<ToggleGroupItem value="once" className="flex-1 text-xs">
								本次
							</ToggleGroupItem>
							<ToggleGroupItem value="deny" className="flex-1 text-xs">
								拒绝
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
				))}
			</div>

			<Separator className="my-3" />

			<div className="flex items-center gap-3">
				<span className="text-xs text-muted-foreground">TTL</span>
				<ToggleGroup
					type="single"
					value={tier}
					onValueChange={(value) => value && onTier(value as UiTier)}
					className="flex-1"
					aria-label="ttl"
				>
					{TTL_TIERS.map((t) => (
						<ToggleGroupItem key={t} value={t} className="flex-1 text-xs">
							{TTL_LABELS[t]}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>

			<Separator className="my-3" />

			<div className="flex items-center gap-3">
				<Button variant="outline" size="lg" onClick={onDeny} disabled={busy === true}>
					全部拒绝
				</Button>
				<Button size="lg" className="flex-1" onClick={onApprove} disabled={disabled || count === 0}>
					<span aria-hidden="true" className="mr-1">
						◉
					</span>
					批准 {count} 个
				</Button>
			</div>
			{blockedReason === undefined ? null : (
				<p role="alert" className="mt-2 text-xs text-destructive">
					{blockedReason}
				</p>
			)}

			<Separator className="my-3" />
			<div data-testid="granted-area" className="text-xs text-muted-foreground">
				<div className="mb-1 text-[10px]">本 session 已持有的 key</div>
				{(request.granted ?? []).map((row) => (
					<div key={row.alias} className="flex items-center justify-between py-0.5">
						<span className="font-mono">{row.alias}</span>
						<span>{row.status}</span>
					</div>
				))}
			</div>
		</div>
	);
}

export { DEFAULT_UI_TIER };
