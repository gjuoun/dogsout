// mockups/jtk-approve.swift — jtk-approve 审批窗 MOCKUP（GitHub issue #3 / JW-164，2026-10-09 二次修订）
// 假数据、无 vault / policy / ask channel；编译：swiftc -O -o jtk-approve mockups/jtk-approve.swift
// 模拟的 helper 契约：jtk 写请求 JSON → 拉起本 helper → 弹窗 → decision JSON 走 stdout → 退出。
// 窗口分区：决策区（新请求：三态开关 + 六档 TTL + Touch ID 批准）与只读已授权段（session grant + policy 放行，不参与决策）。
// --selftest：无头确定性 decision JSON（只含决策区），不建窗口、不触 Touch ID。

import SwiftUI
import LocalAuthentication

// MARK: - 假请求（mockup 数据）

struct KeyRequest {
    let alias: String
    let note: String
}

/// 已授权段只读行：session grant（剩余状态）或 policy allow 放行。无开关、不参与决策、不进 JSON。
struct GrantedRow {
    let alias: String
    let status: String
}

struct AskRequest {
    let principal = "claude-code@laptop"
    let session = "sess_9f2ac31e"
    let at = "2026-10-09 21:14 EDT" // 固定假时间戳：保持 --selftest 确定性

    // 决策区：本次新请求的 key
    let keys = [
        KeyRequest(alias: "gh", note: "github.com PAT · repo read"),
        KeyRequest(alias: "openai", note: "api.openai.com · env"),
        KeyRequest(alias: "anthropic", note: "console.anthropic.com · env"),
        KeyRequest(alias: "aws", note: "sts staging · env"),
    ]

    // 已授权段：本 session 已持有的 key（三种行各至少一行）
    let granted = [
        GrantedRow(alias: "hf", status: "剩 47m"),
        GrantedRow(alias: "gemini", status: "长期·30d衰减"),
        GrantedRow(alias: "speedtest", status: "本地规则放行·不询问"),
    ]
}

// MARK: - 决策模型

/// 逐 key 三态（需求方拍板语义 A）：拒绝 / 仅本次（不落 grant）/ 批准=按所选 TTL。
/// "keep"（存量维持现状）为 F3 预留词表——已授权段只读展示，不参与决策。
enum KeyChoice: String {
    case deny = "deny"
    case once = "once"
    case ttl = "ttl"
}

let ttlOptions = ["once", "10m", "1h", "24h", "30d", "always"] // 六档；长期 = always 档（30 天衰减，spec always_decay）
let ttlLabels = ["本次", "10m", "1h", "24h", "30d", "长期"]

final class Model: ObservableObject {
    let request = AskRequest()
    @Published var choice: [String: KeyChoice] = [:]
    @Published var ttlIndex = 1 // 默认 10m（2026-10-09 需求方拍板）

    init() {
        for k in request.keys { choice[k.alias] = .ttl }
    }

    var approvedCount: Int { request.keys.filter { choice[$0.alias] != .deny }.count }
    var selectedTTL: String { ttlOptions[ttlIndex] }

    /// decision JSON 草案（仅供 F2 参考，不落 contracts/）：
    /// {"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"<alias>":"ttl"|"once"|"deny"}}
    /// 只含决策区 key；已授权段纯展示不进 JSON。renew_existing 与 "keep" 为 F3 预留；
    /// mockup 恒输出 false、永不产生 "keep"。选档「本次」时 ◉ 行落 once。
    func decisionJSON(decision: String) -> String {
        if decision == "deny" { return "{\"decision\":\"deny\"}" }
        var parts: [String] = []
        for k in request.keys {
            let raw = choice[k.alias] ?? .deny
            let v = (raw == .ttl && selectedTTL == "once") ? KeyChoice.once : raw
            parts.append("\"\(k.alias)\":\"\(v.rawValue)\"")
        }
        let keys = parts.joined(separator: ",")
        return "{\"decision\":\"approve\",\"ttl\":\"\(selectedTTL)\",\"renew_existing\":false,\"keys\":{\(keys)}}"
    }

    func emit(_ json: String) {
        print(json)
        fflush(stdout)
        exit(0)
    }

    /// 批准流程：Touch ID 确认（同窗锚定）；canEvaluatePolicy=false 时退化为普通确认。
    /// 失败/取消：窗口留在原地，可重试。--selftest 不经过这里。
    func approve() {
        let ctx = LAContext()
        if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
            ctx.evaluatePolicy(.deviceOwnerAuthentication,
                               localizedReason: "批准 \(approvedCount) 个 key 的凭据访问") { ok, _ in
                DispatchQueue.main.async {
                    if ok { self.emit(self.decisionJSON(decision: "approve")) }
                }
            }
        } else {
            emit(decisionJSON(decision: "approve"))
        }
    }
}

// MARK: - 视图

/// 逐 key 三态分段控件（2026-10-09 实机反馈替掉裸圆圈 ◉/◐/○）：
/// 「批准 | 本次 | 拒绝」，系统 segmented 样式（选中段蓝底白字）；语义不变。
struct KeyChoicePicker: View {
    @ObservedObject var model: Model
    let alias: String

    var body: some View {
        Picker(alias, selection: Binding(
            get: { model.choice[alias] ?? .deny },
            set: { model.choice[alias] = $0 }
        )) {
            Text("批准").tag(KeyChoice.ttl)
            Text("本次").tag(KeyChoice.once)
            Text("拒绝").tag(KeyChoice.deny)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 190)
    }
}

struct KeyRow: View {
    let key: KeyRequest
    @ObservedObject var model: Model

    var body: some View {
        HStack(spacing: 10) {
            Text("NEW")
                .font(.system(size: 9, weight: .bold))
                .padding(.horizontal, 4).padding(.vertical, 2)
                .background(Color.orange.opacity(0.18)).cornerRadius(3)
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(key.alias).font(.system(size: 13, weight: .semibold, design: .monospaced))
                Text(key.note).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Spacer()
            KeyChoicePicker(model: model, alias: key.alias)
        }.padding(.vertical, 4)
    }
}

/// 已授权段只读行：alias 左、状态右，无任何控件。
struct GrantedRowView: View {
    let row: GrantedRow

    var body: some View {
        HStack {
            Text(row.alias).font(.system(size: 12, weight: .medium, design: .monospaced))
            Spacer()
            Text(row.status).font(.system(size: 11)).foregroundStyle(.secondary)
        }.padding(.vertical, 2)
    }
}

/// NSViewRepresentable 包指纹图形（SF Symbol touchid），把 Touch ID 宿主视图锚进本窗。
struct TouchIDGlyph: NSViewRepresentable {
    func makeNSView(context: Context) -> NSImageView {
        let iv = NSImageView()
        iv.image = NSImage(systemSymbolName: "touchid", accessibilityDescription: "Touch ID")
        iv.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 22, weight: .regular)
        iv.contentTintColor = .secondaryLabelColor
        return iv
    }
    func updateNSView(_ nsView: NSImageView, context: Context) {}
}

struct ContentView: View {
    @ObservedObject var model: Model

    var body: some View {
        VStack(spacing: 0) {
            // header：principal + session id（明示）+ 时间
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(model.request.principal).font(.system(size: 14, weight: .bold))
                    Spacer()
                    Text(model.request.at).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Text("session \(model.request.session)")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 10)
            Divider()

            // ── 决策区：新请求清单 + TTL（已授权段不受这里任何控件影响）──
            VStack(spacing: 2) {
                ForEach(model.request.keys, id: \.alias) { key in
                    KeyRow(key: key, model: model)
                }
            }.padding(.vertical, 8)
            Divider()

            HStack {
                Text("TTL").font(.system(size: 12)).foregroundStyle(.secondary)
                Picker("TTL", selection: $model.ttlIndex) {
                    ForEach(ttlLabels.indices, id: \.self) { i in Text(ttlLabels[i]) }
                }.pickerStyle(.segmented).labelsHidden()
            }.padding(.vertical, 10)
            Divider()

            // 按钮：指纹图形与批准按钮同行、与全部拒绝等高对齐；全部拒绝 → deny JSON；批准 N 个 → Touch ID
            // 全部拒绝内容自适应 + secondary 灰底；批准侧 prominent 主按钮吃剩余宽度（视觉主权重）。
            HStack(alignment: .center, spacing: 14) {
                Button {
                    model.emit(model.decisionJSON(decision: "deny"))
                } label: { Text("全部拒绝") }
                .buttonStyle(.bordered)
                .controlSize(.large)
                HStack(spacing: 8) {
                    TouchIDGlyph()
                    Button { model.approve() } label: {
                        Text("批准 \(model.approvedCount) 个").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }.padding(.top, 12)

            // ── 只读已授权段：本 session 已持有的 key，纯展示 ──
            Divider().padding(.top, 14)
            VStack(alignment: .leading, spacing: 4) {
                Text("本 session 已持有的 key")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
                ForEach(model.request.granted, id: \.alias) { row in
                    GrantedRowView(row: row)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 6)
        }
        .padding(18)
        .frame(width: 460)
    }
}

// MARK: - 启动

// --selftest 最先分流：无头、确定性、不建 NSApplication、不触 Touch ID。
if CommandLine.arguments.contains("--selftest") {
    let m = Model()
    m.choice["gh"] = .ttl
    m.choice["openai"] = .once
    m.choice["anthropic"] = .deny
    m.choice["aws"] = .ttl
    print(m.decisionJSON(decision: "approve"))
    fflush(stdout)
    exit(0)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = Model()
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 560),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false)
        win.title = "jtk-approve"
        let host = NSHostingView(rootView: ContentView(model: model))
        win.contentView = host
        let fit = host.fittingSize // 按内容自适应高度，宽固定 460
        win.setContentSize(NSSize(width: 460, height: fit.height + 28))
        win.center()
        win.makeKeyAndOrderFront(nil)
        window = win
        NSApp.activate(ignoringOtherApps: true) // 唯一的激活打磨；其余 out of scope
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // 窗口关闭 = 无显式决定 → fail-closed，落 deny JSON。
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        model.emit(model.decisionJSON(decision: "deny"))
        return .terminateNow // unreachable：emit 内部 exit(0)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // helper：无 dock 图标
app.run()
