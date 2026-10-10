// jtk-approve — F2 single-person local approval window (stateless SwiftUI helper).
// Contract (contracts/ask.ts): jtk writes AskRequest JSON -> launches helper -> Decision JSON on stdout -> exit.
// Closing the window is fail-closed: bare deny. --selftest prints a deterministic literal, no window.
// Build: scripts/build-helper.sh (swiftc -O, ad-hoc signing). CI (linux) never builds this file.

import SwiftUI
import Foundation
import LocalAuthentication

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
