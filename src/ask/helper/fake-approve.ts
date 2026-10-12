#!/usr/bin/env bun
// Test fake of the swiftui helper: reads --request <path>, approves every key under a ttl.
export {};

const args = process.argv;
const i = args.indexOf("--request");
const reqPath = i !== -1 ? args[i + 1] : undefined;
if (!reqPath) {
	console.error("fake-approve: --request <path> required");
	process.exit(2);
}
if (process.env.FAKE_APPROVE_MODE === "deny") {
	console.log(JSON.stringify({ decision: "deny" }));
	process.exit(0);
}
if (process.env.FAKE_APPROVE_MODE === "crash") {
	process.exit(1);
}
const req = JSON.parse(await Bun.file(reqPath).text());
const keys: Record<string, string> = {};
for (const k of req.keys) keys[k.alias] = "ttl";
console.log(JSON.stringify({ decision: "approve", ttl: "10m", renew_existing: false, keys }));
