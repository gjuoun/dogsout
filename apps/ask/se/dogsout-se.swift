// dogsout-se — the vault's Secure Enclave slot (PRD §2.1). No UI, no window, no approval.
// JSON over stdin/stdout; any non-zero exit, crash or garbage is a failure for the caller
// (packages/core/src/vault/se.ts spawns one process per call and treats a crash as failure).
//   --se-create            -> {"blob","pub"}  P-256 key minted inside the SE (.privateKeyUsage + .userPresence); no keychain
//   --se-ecdh  <- {"blob","peer","reason"} -> {"shared"}  Touch ID (login-password fallback), only the shared secret leaves
//   --se-probe <- {"blob"} -> {"usable"}  never shows UI (interactionNotAllowed); a foreign blob is false
//   --se-selftest          -> {"se":"ok"}  create + non-interactive probe, no Touch ID
// A tampered blob can make CryptoKit trap: dogsout runs every call in its own process and treats a crash as failure.
// Build: apps/ask/build.sh (swiftc -O, ad-hoc signing). CI (linux) never builds this file.

import Foundation
import LocalAuthentication
import CryptoKit

func seFail(_ msg: String) -> Never {
	FileHandle.standardError.write(("dogsout-se: " + msg + "\n").data(using: .utf8)!)
	exit(1)
}

func seEmit(_ obj: [String: Any]) -> Never {
	let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write("\n".data(using: .utf8)!)
	exit(0)
}

func seInput() -> [String: Any] {
	let raw = FileHandle.standardInput.readDataToEndOfFile()
	guard let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { seFail("bad JSON on stdin") }
	return obj
}

func seBlob(_ input: [String: Any]) -> Data {
	guard let s = input["blob"] as? String, let d = Data(base64Encoded: s) else { seFail("missing blob") }
	return d
}

func seMint() -> SecureEnclave.P256.KeyAgreement.PrivateKey {
	guard SecureEnclave.isAvailable else { seFail("secure enclave unavailable") }
	var cfErr: Unmanaged<CFError>?
	guard let access = SecAccessControlCreateWithFlags(
		nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], &cfErr
	) else { seFail("access control: \(String(describing: cfErr))") }
	do { return try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access) }
	catch { seFail("create: \(error)") }
}

/// Usable on THIS Mac without any UI: loading succeeds and a key operation asks for interaction.
func seUsable(_ blob: Data) -> Bool {
	let ctx = LAContext()
	ctx.interactionNotAllowed = true
	guard let key = try? SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob, authenticationContext: ctx) else {
		return false
	}
	do {
		_ = try key.sharedSecretFromKeyAgreement(with: P256.KeyAgreement.PrivateKey().publicKey)
		return true
	} catch {
		let ns = error as NSError
		return ns.domain == LAErrorDomain && ns.code == LAError.notInteractive.rawValue
	}
}

let seMode = CommandLine.arguments.dropFirst().first(where: { $0.hasPrefix("--se-") }) ?? ""
switch seMode {
case "--se-create":
	let key = seMint()
	seEmit(["blob": key.dataRepresentation.base64EncodedString(), "pub": key.publicKey.x963Representation.base64EncodedString()])
case "--se-ecdh":
	let input = seInput()
	guard let peerB64 = input["peer"] as? String, let peerRaw = Data(base64Encoded: peerB64) else { seFail("missing peer") }
	let ctx = LAContext()
	ctx.localizedReason = (input["reason"] as? String) ?? "unlock your dogsout vault"
	do {
		let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: seBlob(input), authenticationContext: ctx)
		let peer = try P256.KeyAgreement.PublicKey(x963Representation: peerRaw)
		let secret = try key.sharedSecretFromKeyAgreement(with: peer)
		seEmit(["shared": secret.withUnsafeBytes { Data($0) }.base64EncodedString()])
	} catch { seFail("ecdh: \(error)") }
case "--se-probe":
	seEmit(["usable": seUsable(seBlob(seInput()))])
case "--se-selftest":
	let key = seMint()
	if seUsable(key.dataRepresentation) { seEmit(["se": "ok"]) }
	seFail("selftest: freshly minted key not usable")
default:
	seFail("usage: dogsout-se --se-create | --se-ecdh | --se-probe | --se-selftest")
}
