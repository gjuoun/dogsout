import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResolver } from "./helper/fake-1p.ts";
import {
	isOnePasswordRef,
	type OnePasswordClient,
	parseOnePasswordRef,
	refFailureMessage,
	sdkResolver,
	serviceAccountToken,
} from "./onepassword.ts";

describe("1password reference grammar", () => {
	test("accepts the 3- and 4-segment forms", () => {
		const plain = parseOnePasswordRef("op://dev/api_key/abc123");
		expect(plain.isOk()).toBe(true);
		if (plain.isOk()) {
			expect(plain.value).toMatchObject({ vault: "dev", item: "api_key", field: "abc123" });
			expect(plain.value.section).toBeUndefined();
		}
		const sectioned = parseOnePasswordRef("op://dev/login/github/password");
		expect(sectioned.isOk()).toBe(true);
		if (sectioned.isOk())
			expect(sectioned.value).toMatchObject({ vault: "dev", item: "login", section: "github", field: "password" });
	});

	test("rejects everything that is not a complete reference", () => {
		for (const bad of [
			"op:/x",
			"op://dev",
			"op://dev/item",
			"op://dev/it em/f",
			"op://dev/item/",
			"op://dev/a/b?x",
			"op://dev/a/b#frag",
			"op://dev//f",
			"https://dev/a/b",
		]) {
			expect(parseOnePasswordRef(bad).isErr()).toBe(true);
		}
	});

	test("isOnePasswordRef is the cheap prefix test", () => {
		expect(isOnePasswordRef("op://dev/api_key/x")).toBe(true);
		expect(isOnePasswordRef("dogsout://dev/api_key/x")).toBe(false);
		expect(isOnePasswordRef("sk-live")).toBe(false);
	});
});

describe("service account token", () => {
	test("prefers the env var", () => {
		const r = serviceAccountToken({ OP_SERVICE_ACCOUNT_TOKEN: "  ops_env  " });
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe("ops_env");
	});

	test("missing token names both sources and carries no value", () => {
		const r = serviceAccountToken({}, { tokenFile: "/nonexistent/dogsout/sa-token" });
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error.kind).toBe("missing-token");
			const message = refFailureMessage(r.error);
			expect(message).toContain("OP_SERVICE_ACCOUNT_TOKEN");
			expect(message).toContain("sa-token");
		}
	});
});

describe("fake resolver helper", () => {
	test("answers a batch and records one call line per reference", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dogsout-1p-fake-"));
		const map = join(dir, "map.json");
		const calls = join(dir, "calls.txt");
		await Bun.write(map, JSON.stringify({ "op://dev/a/b": "first", "op://dev/a/c": "second" }));
		const saved = { map: process.env.FAKE_1P_MAP, calls: process.env.FAKE_1P_CALLS, mode: process.env.FAKE_1P_MODE };
		process.env.FAKE_1P_MAP = map;
		process.env.FAKE_1P_CALLS = calls;
		delete process.env.FAKE_1P_MODE;
		try {
			const resolver = createResolver();
			const r = await resolver.resolve(["op://dev/a/b", "op://dev/a/c"]);
			expect(r.isOk()).toBe(true);
			if (r.isOk()) {
				expect(r.value.get("op://dev/a/b")).toBe("first");
				expect(r.value.get("op://dev/a/c")).toBe("second");
			}
			const lines = (await Bun.file(calls).text()).trim().split("\n");
			expect(lines.length).toBe(2);
		} finally {
			if (saved.map === undefined) delete process.env.FAKE_1P_MAP;
			else process.env.FAKE_1P_MAP = saved.map;
			if (saved.calls === undefined) delete process.env.FAKE_1P_CALLS;
			else process.env.FAKE_1P_CALLS = saved.calls;
			if (saved.mode === undefined) delete process.env.FAKE_1P_MODE;
			else process.env.FAKE_1P_MODE = saved.mode;
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("missing-token mode is the typed failure", async () => {
		process.env.FAKE_1P_MODE = "missing-token";
		try {
			const r = await createResolver().resolve(["op://dev/a/b"]);
			expect(r.isErr()).toBe(true);
			if (r.isErr()) expect(r.error.kind).toBe("missing-token");
		} finally {
			delete process.env.FAKE_1P_MODE;
		}
	});
});
describe("sdk resolver", () => {
	function fakeSdk(behaviour: { value?: string; error?: string; throwOnInit?: string }) {
		const seen: { refs: string[][]; clients: number } = { refs: [], clients: 0 };
		const createClient = async (): Promise<OnePasswordClient> => {
			seen.clients++;
			if (behaviour.throwOnInit) throw new Error(behaviour.throwOnInit);
			return {
				secrets: {
					async resolveAll(refs: string[]) {
						seen.refs.push(refs);
						const individualResponses: Record<string, { content?: { secret?: string }; error?: { message?: string } }> =
							{};
						for (const ref of refs) {
							individualResponses[ref] =
								behaviour.error !== undefined
									? { error: { message: behaviour.error } }
									: { content: { secret: behaviour.value ?? "secret-for-" + ref } };
						}
						return { individualResponses };
					},
				},
			};
		};
		return { seen, createClient };
	}

	test("creates one client per process and one batch per resolve", async () => {
		const sdk = fakeSdk({});
		const resolver = sdkResolver({ createClient: sdk.createClient, token: "ops_test", timing: false });
		const first = await resolver.resolve(["op://dev/a/b", "op://dev/a/c", "op://dev/a/b"]);
		const second = await resolver.resolve(["op://dev/a/d"]);
		expect(first.isOk()).toBe(true);
		expect(second.isOk()).toBe(true);
		expect(sdk.seen.clients).toBe(1);
		expect(sdk.seen.refs.length).toBe(2);
		expect(sdk.seen.refs[0]).toEqual(["op://dev/a/b", "op://dev/a/c"]);
		if (first.isOk()) expect(first.value.get("op://dev/a/b")).toBe("secret-for-op://dev/a/b");
	});

	test("a per-reference error fails the batch with the reference and no value", async () => {
		const sdk = fakeSdk({ error: "no value" });
		const resolver = sdkResolver({ createClient: sdk.createClient, token: "ops_test", timing: false });
		const r = await resolver.resolve(["op://dev/a/b"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error.kind).toBe("resolve");
			if (r.error.kind === "resolve") {
				expect(r.error.ref).toBe("op://dev/a/b");
				expect(r.error.message).toContain("no value");
			}
		}
	});

	test("a failed init is a typed error and is not cached", async () => {
		const sdk = fakeSdk({ throwOnInit: "invalid service account token" });
		const resolver = sdkResolver({ createClient: sdk.createClient, token: "ops_test", timing: false });
		const r = await resolver.resolve(["op://dev/a/b"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr() && r.error.kind === "resolve") expect(r.error.message).toContain("invalid service account token");
	});

	test("timing line goes to stderr only when enabled", async () => {
		const sdk = fakeSdk({});
		const written: string[] = [];
		const original = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string) => {
			written.push(String(chunk));
			return true;
		}) as typeof process.stderr.write;
		try {
			await sdkResolver({ createClient: sdk.createClient, token: "ops_test", timing: true }).resolve(["op://dev/a/b"]);
			await sdkResolver({ createClient: sdk.createClient, token: "ops_test", timing: false }).resolve(["op://dev/a/b"]);
		} finally {
			process.stderr.write = original;
		}
		const timing = written.filter((line) => line.startsWith("1password: init="));
		expect(timing.length).toBe(1);
		expect(timing[0]).toContain("refs=1");
	});
});
