import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GrantMeta } from "../../contracts/grant.ts";
import { grantUsable } from "../policy/evaluate.ts";
import { consumeGrant, endSessionGrants, loadGrants, recordApproval, revokeByAlias } from "./grants.ts";
import { closeSession, openSession, recordApprovals, takeReplay } from "./session.ts";

let home = "";
const NOW = new Date("2026-10-10T12:00:00.000Z");
const SETTINGS = { always_decay: "720h" };

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "jtk-sess-"));
});

afterAll(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("grants store", () => {
	test("approval lands in a 0600 grants.json and is usable", async () => {
		const g = await recordApproval(
			home,
			{ principal: "p1", alias: "gh", address: "jtk://dev/gh/pat", valueHash: "aa11", ttl: "1h", via: "swiftui" },
			SETTINGS,
			NOW,
		);
		expect(g.isOk()).toBe(true);
		const file = await loadGrants(home);
		expect(file.isOk() && file.value.grants.length).toBe(1);
		expect((statSync(join(home, "grants.json")).mode & 0o777) === 0o600).toBe(true);
		const meta: GrantMeta | undefined = file.isOk() ? file.value.grants[0] : undefined;
		expect(meta && grantUsable(meta, "aa11", [], NOW).ok).toBe(true);
	});

	test("once grants are consumed on first use and refuse reuse", async () => {
		const g = await recordApproval(
			home,
			{ principal: "p1", alias: "one", address: "jtk://dev/one/x", valueHash: "bb22", ttl: "once", via: "cli" },
			SETTINGS,
			NOW,
		);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) {
			expect(g.value.expires_at).toBe("2026-10-10T12:00:00.000Z");
			const used = await consumeGrant(home, g.value.id);
			expect(used.isOk()).toBe(true);
			const file = await loadGrants(home);
			const meta = file.isOk() ? file.value.grants.find((x) => x.id === g.value.id) : undefined;
			expect(meta && grantUsable(meta, "bb22", [], NOW).ok).toBe(false);
		}
	});

	test("rotation invalidates regardless of remaining ttl", async () => {
		const g = await recordApproval(
			home,
			{ principal: "p2", alias: "rot", address: "jtk://dev/rot/x", valueHash: "cc33", ttl: "24h", via: "swiftui" },
			SETTINGS,
			NOW,
		);
		expect(g.isOk()).toBe(true);
		const file = await loadGrants(home);
		const meta = file.isOk() ? file.value.grants.find((x) => x.alias === "rot") : undefined;
		expect(meta && grantUsable(meta, "dd44", [], NOW).ok).toBe(false);
	});

	test("revokeByAlias removes exactly that principal+alias", async () => {
		const r = await revokeByAlias(home, "p2", "rot");
		expect(r.isOk() && r.value).toBe(1);
		const r2 = await revokeByAlias(home, "p2", "rot");
		expect(r2.isOk() && r2.value).toBe(0);
	});
});

describe("session lifecycle", () => {
	test("open → approvals remembered → resume replays exactly once → end withdraws grants", async () => {
		const manifest = { id: "sess_a", principal: "agent@x", groups: [], invites: ["gh"] };
		const opened = await openSession(home, manifest, NOW);
		expect(opened.isOk()).toBe(true);

		const g = await recordApproval(
			home,
			{
				principal: "agent@x",
				alias: "gh",
				address: "jtk://dev/gh/pat",
				valueHash: "aa11",
				ttl: "session",
				via: "manifest-invite",
				session: "sess_a",
			},
			SETTINGS,
			NOW,
		);
		expect(g.isOk()).toBe(true);

		const rec = await recordApprovals(home, "sess_a", ["gh"]);
		expect(rec.isOk()).toBe(true);

		const replay1 = await takeReplay(home, "sess_a");
		expect(replay1.isOk() && replay1.value).toEqual(["gh"]);
		const replay2 = await takeReplay(home, "sess_a");
		expect(replay2.isErr()).toBe(true);

		const withdrawn = await endSessionGrants(home, "sess_a");
		expect(withdrawn.isOk() && withdrawn.value).toBe(1);
		const closed = await closeSession(home, "sess_a");
		expect(closed.isOk()).toBe(true);

		const file = await loadGrants(home);
		const leftover = file.isOk() ? file.value.grants.some((x) => x.session === "sess_a") : true;
		expect(leftover).toBe(false);
	});
});
