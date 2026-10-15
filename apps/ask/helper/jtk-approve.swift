// jtk-approve — F2 single-person local approval window (stateless SwiftUI helper).
// Contract (packages/type-contracts/src/ask.ts): jtk writes AskRequest JSON -> launches helper -> Decision JSON on stdout -> exit.
// Closing the window is fail-closed: bare deny. --selftest prints a deterministic literal, no window.
// --se-* modes serve the vault v2 Secure Enclave slot (see the block above --request).
// Build: apps/ask/build.sh (swiftc -O, ad-hoc signing). CI (linux) never builds this file.

import SwiftUI
import Foundation
import LocalAuthentication
import CryptoKit

struct AskedKey: Codable {
	let alias: String
	let address: String
	let note: String
	let value_hash: String
}

struct GrantedRow: Codable {
	let alias: String
	let status: String
}

struct AskRequest: Codable {
	let principal: String
	let session: String
	let at: String
	let keys: [AskedKey]
	let granted: [GrantedRow]
}

enum KeyChoice: String {
	case deny = "deny"
	case once = "once"
	case ttl = "ttl"
}

let ttlOptions = ["once", "10m", "1h", "24h", "30d", "always"]
let ttlLabels = ["本次", "10m", "1h", "24h", "30d", "长期"]

func emit(_ json: String) {
	FileHandle.standardOutput.write((json + "\n").data(using: .utf8)!)
	exit(0)
}

func decisionJSON(approved: Bool, choices: [String: KeyChoice], ttl: String) -> String {
	if !approved { return "{\"decision\":\"deny\"}" }
	let keys = choices
		.map { "\"\($0.key)\":\"\($0.value.rawValue)\"" }
		.sorted()
		.joined(separator: ",")
	return "{\"decision\":\"approve\",\"ttl\":\"\(ttl)\",\"renew_existing\":false,\"keys\":{\(keys)}}"
}

// --selftest: deterministic headless decision (contract reference literal)
if CommandLine.arguments.contains("--selftest") {
	print("{\"decision\":\"approve\",\"ttl\":\"10m\",\"renew_existing\":false,\"keys\":{\"gh\":\"ttl\",\"openai\":\"once\",\"aws\":\"deny\"}}")
	exit(0)
}

// --se-*: Secure Enclave mode for the vault v2 Touch ID slot (PRD §2.1). JSON over stdin/stdout, no window.
//   --se-create            -> {"blob","pub"}  P-256 key minted inside the SE (.privateKeyUsage + .userPresence); no keychain
//   --se-ecdh  <- {"blob","peer","reason"} -> {"shared"}  Touch ID (login-password fallback), only the shared secret leaves
//   --se-probe <- {"blob"} -> {"usable"}  never shows UI (interactionNotAllowed); a foreign blob is false
//   --se-selftest          -> {"se":"ok"}  create + non-interactive probe, no Touch ID
// A tampered blob can make CryptoKit trap: jtk runs every call in its own process and treats a crash as failure.
func seFail(_ msg: String) -> Never {
	FileHandle.standardError.write(("jtk-approve: " + msg + "\n").data(using: .utf8)!)
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

if let seMode = CommandLine.arguments.first(where: { $0.hasPrefix("--se-") }) {
	switch seMode {
	case "--se-create":
		let key = seMint()
		seEmit(["blob": key.dataRepresentation.base64EncodedString(), "pub": key.publicKey.x963Representation.base64EncodedString()])
	case "--se-ecdh":
		let input = seInput()
		guard let peerB64 = input["peer"] as? String, let peerRaw = Data(base64Encoded: peerB64) else { seFail("missing peer") }
		let ctx = LAContext()
		ctx.localizedReason = (input["reason"] as? String) ?? "unlock your jtk vault"
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
		seFail("unknown mode \(seMode)")
	}
}
// --request <path>: read the AskRequest
var request = AskRequest(
	principal: "unknown", session: "unknown", at: "",
	keys: [], granted: []
)
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--request"), i + 1 < args.count {
	let url = URL(fileURLWithPath: args[i + 1])
	if let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode(AskRequest.self, from: data) {
		request = decoded
	}
}

final class ApproveModel: ObservableObject {
	let request: AskRequest
	@Published var choice: [String: KeyChoice] = [:]
	@Published var ttlIndex = 1 // default 10m (2026-10-09 ruling)
	@Published var closed = false

	init(_ r: AskRequest) {
		request = r
		for k in r.keys { choice[k.alias] = .ttl }
	}

	var selectedTTL: String { ttlOptions[ttlIndex] }

	func approveWithTouchID() {
		let ctx = LAContext()
		var err: NSError?
		if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {
			ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "批准 \(request.keys.count) 个凭据请求") { ok, _ in
				DispatchQueue.main.async {
					if ok { emit(decisionJSON(approved: true, choices: self.choice, ttl: self.selectedTTL)) }
					// failure: stay open, retry in place
				}
			}
		} else {
			// no biometry available (dev mac): plain approve
			emit(decisionJSON(approved: true, choices: choice, ttl: selectedTTL))
		}
	}

	func denyAll() {
		emit(decisionJSON(approved: false, choices: [:], ttl: selectedTTL))
	}
}

struct KeyRow: View {
	let alias: String
	let note: String
	@Binding var choice: KeyChoice

	var body: some View {
		HStack {
			VStack(alignment: .leading) {
				Text(alias).font(.system(.body, design: .monospaced).weight(.semibold))
				Text(note).font(.caption).foregroundStyle(.secondary)
			}
			Spacer()
			Picker("", selection: $choice) {
				Text("批准").tag(KeyChoice.ttl)
				Text("本次").tag(KeyChoice.once)
				Text("拒绝").tag(KeyChoice.deny)
			}
			.pickerStyle(.segmented)
			.frame(width: 200)
		}
		.padding(.vertical, 3)
	}
}

struct ContentView: View {
	@StateObject var model: ApproveModel

	var body: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("jtk — 凭据请求").font(.headline)
			Text("\(model.request.principal) · session \(model.request.session)")
				.font(.caption).foregroundStyle(.secondary)

			Divider()
			ForEach(model.request.keys, id: \.alias) { k in
				KeyRow(alias: k.alias, note: k.note.isEmpty ? k.address : k.note, choice: Binding(
					get: { model.choice[k.alias] ?? .deny },
					set: { model.choice[k.alias] = $0 }
				))
			}

			if !model.request.granted.isEmpty {
				Divider()
				Text("已授权（只读）").font(.caption).foregroundStyle(.secondary)
				ForEach(model.request.granted, id: \.alias) { g in
					HStack {
						Text(g.alias).font(.system(.caption, design: .monospaced))
						Spacer()
						Text(g.status).font(.caption).foregroundStyle(.secondary)
					}
				}
			}

			Divider()
			HStack {
				Picker("TTL", selection: $model.ttlIndex) {
					ForEach(ttlLabels.indices, id: \.self) { i in
						Text(ttlLabels[i]).tag(i)
					}
				}
				.pickerStyle(.segmented)
				Spacer()
				Button("全部拒绝") { model.denyAll() }
				Button("批准 \(model.request.keys.count) 个") { model.approveWithTouchID() }
					.keyboardShortcut(.return)
			}
		}
		.padding(16)
		.frame(minWidth: 560)
		.onDisappear {
			// window closed without a decision: fail-closed deny
			if !model.closed { model.denyAll() }
		}
	}
}

let model = ApproveModel(request)
let app = NSApplication.shared
let delegate = AppDelegateClosure(onClose: { model.denyAll() })
app.delegate = delegate
let window = NSWindow(
	contentRect: NSRect(x: 0, y: 0, width: 600, height: 420),
	styleMask: [.titled, .closable],
	backing: .buffered, defer: false
)
window.contentView = NSHostingView(rootView: ContentView(model: model))
window.center()
window.makeKeyAndOrderFront(nil)
app.run()

final class AppDelegateClosure: NSObject, NSApplicationDelegate {
	let onClose: () -> Void
	init(onClose: @escaping () -> Void) { self.onClose = onClose; super.init() }
	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
	func applicationWillFinishLaunching(_ notification: Notification) {}
	func applicationDidHide(_ notification: Notification) {}
	deinit { onClose() }
}
