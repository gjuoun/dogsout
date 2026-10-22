import type { AskRequest, PendingAsk } from "@jtk/api-client";
import { getAsks, postAsksByIdDecision } from "@jtk/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ApprovalPanel } from "~/approval/ApprovalPanel";
import {
	approvedCount,
	type Choice,
	DEFAULT_UI_TIER,
	decisionFor,
	defaultChoices,
	firstPending,
	type UiTier,
} from "~/approval/model";
import {
	approvalBlockedReason,
	assertHuman,
	fetchAuthStatus,
	platformAuthenticatorAvailable,
	registerThisDevice,
} from "~/auth/webauthn";

export const Route = createFileRoute("/")({ component: ApprovePage });

/**
 * Approval page: one pending ask at a time (mockup semantics). The ask is created by a
 * blocked `POST /ask`; this page is the human answering it, after a WebAuthn touch.
 */
function ApprovePage() {
	const [pending, setPending] = useState<PendingAsk | undefined>(undefined);
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const [tier, setTier] = useState<UiTier>(DEFAULT_UI_TIER);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | undefined>(undefined);
	const [gate, setGate] = useState<{ available: boolean; credentials: number } | undefined>(undefined);

	const load = useCallback(async () => {
		const { data } = await getAsks();
		const next = firstPending(data ?? []);
		setPending((current) => {
			if (next?.id !== current?.id) {
				setChoices(next ? defaultChoices(next.request as AskRequest) : {});
				setTier(DEFAULT_UI_TIER);
			}
			return next;
		});
	}, []);

	const loadGate = useCallback(async () => {
		try {
			const [status, available] = await Promise.all([fetchAuthStatus(), platformAuthenticatorAvailable()]);
			setGate({ available, credentials: status.credentials });
		} catch (e) {
			setGate({ available: false, credentials: 0 });
			setNotice(String(e));
		}
	}, []);

	useEffect(() => {
		void load();
		void loadGate();
		const timer = setInterval(() => void load(), 2000);
		return () => clearInterval(timer);
	}, [load, loadGate]);

	const blockedReason = gate === undefined ? undefined : approvalBlockedReason(gate);

	if (pending === undefined) {
		return (
			<div className="mx-auto flex w-full max-w-[520px] flex-col gap-3 p-6 text-sm text-muted-foreground">
				<p>
					没有等待审批的请求 — 等待 agent 发起 ask（<code className="font-mono text-xs">POST /ask</code>）。
				</p>
				{gate !== undefined && gate.credentials === 0 ? (
					<RegisterButton
						onDone={async () => {
							setNotice(undefined);
							await loadGate();
						}}
						onError={setNotice}
					/>
				) : null}
				{notice === undefined ? null : (
					<p role="alert" className="text-xs text-destructive">
						{notice}
					</p>
				)}
			</div>
		);
	}

	const request = pending.request as AskRequest;
	const count = approvedCount(request, choices);

	const send = async (decision: ReturnType<typeof decisionFor>, token?: string) => {
		setBusy(true);
		setNotice(undefined);
		try {
			const { error } = await postAsksByIdDecision({
				path: { id: pending.id },
				body: decision,
				...(token === undefined ? {} : { headers: { "x-jtk-assertion": token } }),
			});
			if (error) setNotice(typeof error === "string" ? error : JSON.stringify(error));
			else setPending(undefined);
		} finally {
			setBusy(false);
		}
	};

	const approve = async () => {
		if (blockedReason !== undefined) {
			setNotice(blockedReason);
			return;
		}
		try {
			const token = await assertHuman();
			await send(decisionFor(request, choices, tier), token);
		} catch (e) {
			setNotice(String(e));
		}
	};

	return (
		<div className="py-6">
			<ApprovalPanel
				request={request}
				choices={choices}
				tier={tier}
				onChoice={(alias, choice) => setChoices((prev) => ({ ...prev, [alias]: choice }))}
				onTier={setTier}
				onApprove={() => void approve()}
				onDeny={() => void send({ decision: "deny" })}
				busy={busy}
				{...(blockedReason === undefined ? {} : { blockedReason })}
			/>
			{gate !== undefined && gate.credentials === 0 ? (
				<div className="mx-auto max-w-[520px] px-5">
					<RegisterButton
						onDone={async () => {
							setNotice(undefined);
							await loadGate();
						}}
						onError={setNotice}
					/>
				</div>
			) : null}
			{count > 0 ? null : (
				<p className="mx-auto max-w-[520px] px-5 text-xs text-muted-foreground">
					全部拒绝会以裸 deny 结束这次 ask（fail-closed）。
				</p>
			)}
			{notice === undefined ? null : (
				<p role="alert" className="mx-auto max-w-[520px] px-5 pt-2 text-xs text-destructive">
					{notice}
				</p>
			)}
		</div>
	);
}

function RegisterButton(props: { onDone: () => Promise<void>; onError: (message: string) => void }) {
	const [busy, setBusy] = useState(false);
	return (
		<button
			type="button"
			className="rounded-md border px-3 py-2 text-sm"
			disabled={busy}
			onClick={async () => {
				setBusy(true);
				try {
					await registerThisDevice();
					await props.onDone();
				} catch (e) {
					props.onError(String(e));
				} finally {
					setBusy(false);
				}
			}}
		>
			{busy ? "注册中…" : "注册这台设备（Touch ID / passkey）"}
		</button>
	);
}
