import { describe, expect, test } from "bun:test";
import { approvalBlockedReason } from "./webauthn.ts";

describe("approval gate (fail-closed, no password)", () => {
	test("an available platform authenticator with a credential allows approval", () => {
		expect(approvalBlockedReason({ available: true, credentials: 1 })).toBeUndefined();
	});

	test("no platform authenticator blocks approval and names the fallback channels", () => {
		const reason = approvalBlockedReason({ available: false, credentials: 1 });
		expect(reason).toContain("CLI");
		expect(reason).toContain("mygo");
	});

	test("zero credentials blocks approval with an enrollment hint", () => {
		expect(approvalBlockedReason({ available: true, credentials: 0 })).toContain("还没有审批凭据");
	});
});
