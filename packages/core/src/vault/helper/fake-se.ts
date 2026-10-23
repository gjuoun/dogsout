#!/usr/bin/env bun
// TEST-ONLY fake of the Secure Enclave mode of dogsout-approve (--se-create / --se-ecdh / --se-probe).
// The "blob" here is the raw PKCS8 private key — NOT a chip-bound handle. Never use outside tests;
// it is selected only through DOGSOUT_SE_HELPER. FAKE_SE_MODE=deny makes --se-ecdh exit 1 (cancelled Touch ID).
export {};

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const b64 = (u: ArrayBuffer) => Buffer.from(new Uint8Array(u)).toString("base64");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const mode = process.argv[2];

async function readJson(): Promise<Record<string, string>> {
	return JSON.parse(await new Response(Bun.stdin.stream()).text());
}

if (mode === "--se-create") {
	const kp = await crypto.subtle.generateKey(P256, true, ["deriveBits"]);
	const blob = b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
	const pub = b64(await crypto.subtle.exportKey("raw", kp.publicKey));
	console.log(JSON.stringify({ blob, pub }));
} else if (mode === "--se-ecdh") {
	const req = await readJson();
	if (process.env.FAKE_SE_MODE === "deny") {
		console.error("fake-se: user cancelled");
		process.exit(1);
	}
	const priv = await crypto.subtle.importKey("pkcs8", bytes(req.blob ?? ""), P256, false, ["deriveBits"]);
	const peer = await crypto.subtle.importKey("raw", bytes(req.peer ?? ""), P256, false, []);
	const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, priv, 256);
	console.log(JSON.stringify({ shared: b64(shared) }));
} else if (mode === "--se-probe") {
	const req = await readJson();
	try {
		await crypto.subtle.importKey("pkcs8", bytes(req.blob ?? ""), P256, false, ["deriveBits"]);
		console.log(JSON.stringify({ usable: true }));
	} catch {
		console.log(JSON.stringify({ usable: false }));
	}
} else {
	console.error("fake-se: --se-create | --se-ecdh | --se-probe");
	process.exit(2);
}
