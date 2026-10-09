> Historical snapshot (2026-10-08/09), preserved verbatim below. Its P-stage plan, Bun.password KDF and vault shape are not current implementation claims.
> Current intent/status/navigation: [feature index](../../features/INDEX.md), [product](../../features/product.md), [architecture](../../features/architecture.md).

# junethekey — Agent 凭据经纪人（P0+P1 规格）

> 项目名 `junethekey`（2026-10-08 admin 定名，Jun is the key —— 人是授权的关键）；CLI 二进制名 `jtk`（repo 长名 + bin 短名惯例）。
> 状态：**已定稿** —— admin 逐条审阅完毕，Q1–Q6 全部关闭；全文对齐审计完成（2026-10-08）。下一步：建 repo（day-1 public，Apache-2.0）→ 挂 JG 卡 → P0 开工。
> 日期：2026-10-08。调研依据：/tmp/agent-vault-prior-art.md（竞品扫描）、/tmp/secret-gate（源码精读）。

## 0. 一句话定位

本地优先的开源凭据经纪人：daemon 持有密钥，按「principal × credential × 时刻」的策略矩阵决定（agent、人、token 统一为 principal）
**自动放行 / 问人 / 拒绝**，手机一键批准或拒绝 —— **默认零部署**：手机经 tailnet/LAN 直连 daemon 内建审批页；要真·离屏推送再部署 **relay**（自托管公网/tailnet 可达，或 junethekey 云 relay 订阅）。值永不出本机（只进请求方子进程 env）。

## 1. 背景与动机

- 1Password Service Account 只有 vault 级 scope，无法按 record 授权；无审批钩子；无公开 REST API。
- opk 当日被 SA 限流（1,000 reads/day 账号合计）暴露了外置后端的预算脆弱性。
- 完全开源诉求：摆脱对 1Password 的绑定，本地 vault 为一等公民，1Password 以后只是 adapter。
- 竞品结论（prior-art 报告）：无任何产品同时具备「个人尺度 + 本地优先 + 策略矩阵 + TTL grant + 手机审批」。
  最接近的 secret-gate（13★ MIT）有 Telegram 审批但无策略层、无身份认证、值过服务器。

## 2. 与最接近竞品的差异化（README 对比表素材）

| 维度 | secret-gate | junethekey |
|---|---|---|
| 后端 | 1Password Connect server（容器） | 本地加密 vault（零外部依赖） |
| 部署 | server + 公网 webhook | 单二进制 daemon + unix socket |
| 身份 | `machine` 自报字符串，API 无认证 | agent 注册 ed25519 密钥对，挑战-响应签名 |
| 签发 token | ❌（借 1Password SA，vault 级只读） | ✅ jtk 自签：scope **field/json.path → vault**、`:r`/`:w`、TTL 任意（临时或长期） |
| 策略 | 无（每次都问） | allow/ask/deny 矩阵 + TTL grant + first-use/value-changed |
| 审批通道 | Telegram（第三方） | **默认零部署**：tailnet/LAN 直连内建审批页；进阶 relay（自托管/云订阅）换真推送，P2 起 PWA/App + Touch ID |
| 值的路径 | 过服务器 HTTP 下发 | 永不出本机；审批通知只带 (agent, alias, reason) |
| 审计 | 日志 | append-only JSONL + hash chain |
| 策略调试 | 无 | `why` / `simulate`，dry-run 与 live 共用 evaluate() |

借鉴保留：一次性取值 token 协议、`search`/`inspect_fields` 无值发现接口、
`exec_with_secret`（值注入子进程 env，agent 不见值）、ssh-agent TTL 联动（P2）。

## 3. 核心概念

| 概念 | 定义 |
|---|---|
| Principal | `agent:<name>`（机器，持 ed25519 私钥）、`user:<name>`（人/设备，**同机制持钥** —— 老婆的笔记本、你的手机都是 principal）、`group:<name>`、`user`（本人默认） |
| Token | `token:<name>` —— jtk 自签通行证（把 1Password SA 做对）：scope 内联权限后缀、可多条叠加：`--scope jtk://dev/zai:r --scope jtk://dev/db/credentials.password:w`；粒度 vault → item → field → **json.path** 全谱；`r`=read `w`=write（可 `rw`）；TTL 任意（临时或长期，上限 `settings.token_max_ttl`）；**签发 = 范围内预授权**，`deny` 规则仍可覆盖，全程审计；daemon 只存 SHA-256，明文签发时显示一次 |
| Resource | credential alias（如 `DEEPSEEK_API_KEY`）或**规范地址** `jtk://<vault>/<item>/<field>[.json.path]`；均支持 `ZAI_*`、`jtk://dev/*` 通配与 tag 匹配（`*:sensitivity=high`） |
| 地址（ref） | `jtk://` 是每个存储项的规范寻址（借鉴 `op://`）；alias 只是给地址起的友好名（本质是软链）。**路径即 jq**（2026-10-08 admin 定）：点路径 `jtk://gcp/prod-sa/key.client_email` 本就是 jq 子集；复杂查询 `?jq=` 内嵌地址（供软链/scope 引用），人手更顺的写法是 CLI `--jq`：`jtk get jtk://dev/gcp-sa --jq '.keys[] | select(.type=="service_account")'`。**field/jq 寻址在 get、规则匹配、软链目标、token scope 一律通用** |
| jq 边界 | jq 只作用于**单个 item 的 fields 对象**或**单个 field 的值**，不跨 item —— 策略/scope 按 vault/item/field 前缀匹配，查询部分不参与匹配；对整个 item 跑 jq 视为 **item 级访问**（field 级 scope 不放行）。实现用 jq-wasm（P3 可换宿主内置） |
| Decision | `allow`（进 grant 缓存）/ `ask`（等人）/ `deny` |
| Grant | {principal, resource(请求名), value_hash(解析后值), expiry, rule_id, approved_by, approved_via}，短时效可撤销 |
| Policy | config.json 内 `rules` 数组（有序，**last-match-wins**：通用在前、特例在后），无匹配 → `settings.default_decision`；`jtk config` 唯一写入口 |
| 审批请求 | {req_id, principal, resource(s), reason, expires_at（机器 15m / owner 人路由 24h）}，pending 队列 |

TTL 档位：`once` / `5m` / `15m` / `1h` / `24h` / `always`（always = 30d 衰减，可配）。
approve 时可 `--ttl` 覆盖，默认取规则值。

关键语义（tuning 的精髓）：
- **first-use**：新 (agent, alias) 组合首次必问；批过进 grant
- **value-changed**：值轮换后（grant.value_hash ≠ 当前）重新问，防授权漂移
- **ask_on 条件**：规则可声明 `ask_on: [first-use, value-changed]`，只在这些时刻问，其余 TTL 内 allow

## 4. 策略模型（P0 交付物：纯库，无 daemon）

单 JSON 管理（仿 opkv2 收敛偏好）：`~/.config/junethekey/config.json` 一个文件装下 settings + agents 注册表 + rules；`jtk config` 是唯一写入口（校验 + 0600 原子写）。

```json
{
  "version": 1,
  "settings": {
    "request_ttl": "15m",
    "request_ttl_human": "24h",
    "token_max_ttl": "8760h",
    "always_decay": "720h",
    "auto_lock": "30m",
    "default_decision": "ask"
  },
  "principals": [
    { "name": "speedtest",   "kind": "agent", "group": "cron",   "public_key": "ed25519:9f3a…" },
    { "name": "hermes-cron", "kind": "agent", "group": "cron",   "public_key": "ed25519:c21b…" },
    { "name": "xy-laptop",   "kind": "user",  "group": "family", "public_key": "ed25519:77de…" }
  ],
  "rules": [
    { "id": "cron-bulk",        "principal": "group:cron",      "resource": "*_API_KEY",           "decide": "allow", "ttl": "24h" },
    { "id": "speedtest-zai",    "principal": "agent:speedtest", "resource": "ZAI_*",               "decide": "ask",   "ttl": "1h", "ask_on": ["first-use", "value-changed"] },
    { "id": "high-sensitivity", "principal": "*",               "resource": "*:sensitivity=high", "decide": "ask",   "ttl": "once" }
  ]
}
```

走查（决策语义的直观版）：
- speedtest 要 `ZAI_API_KEY` → 命中 cron-bulk 与 speedtest-zai 两行 → **后写的赢** → 手机问；批后 1h 内自动放行
- hermes-cron 要 `DEEPSEEK_API_KEY` → 只命中 cron-bulk → 自动放行，grant 24h
- 新 agent 忘写进清单 → 零命中 → `settings.default_decision` = ask → 手机问，顺手补注册

`jtk config` 子命令族：show / set / rule add|rm / principal add|rm / test —— 手编文件可以但不推荐（config 改前校验、原子写）。

evaluate(principal, resource, state) → Decision + matched rule + reason。纯函数：
- 输入：policy（规则集）、grants（当前授权态）、credential 元数据（tags、value_hash）
- 输出：`allow(hit=rule)` / `ask(reason=first-use|value-changed|no-grant)` / `deny(rule)`
- **dry-run（simulate/why）与 live 走同一个 evaluate()**（借鉴 credential-broker-mcp）

CLI（P0 即可用，无 daemon）：
- `jtk simulate <principal> <resource>` — 打印决策与命中规则
- `jtk why <principal> <resource>` — 决策 + 当前 grant 态 + TTL 剩余
- `jtk test` — 对 config.json 跑策略 fixtures（JSON 用例 → 期望决策），像 convention test 一样进 CI

P0 验收：last-match-wins、通配、tag、first-use、value-changed、TTL 过期/衰减、simulate/why 全部单测绿。

## 5. Broker（P1）

### 5.1 组成

| 组件 | 说明 |
|---|---|
| daemon | unix socket（0600）+ JSONL 协议；单二进制 `jtk`，首次 get 自动拉起（仿 opkv2） |
| relay server | `jtk relay` 单二进制 —— **进阶部署件（默认不需要）**：部署后 daemon 出站连它、手机收真推送/回传批拒（§5.3） |
| vault v0 | `~/.config/junethekey/vault.enc`：明文 JSON **层级模型** {version, vaults:{<vault>:{items:{<item>:{fields:{<field>: value}, tags, owner?, updated_at}}}}}，Argon2id(master) → AES-256-GCM；0600 原子写 |
| principal 注册表 | 公钥 + group + kind（agent/user）记在 config.json 的 `principals` 数组（`jtk config principal add` 唯一写入口）；私钥是各 principal 侧独立文件 `~/.config/junethekey/keys/<name>.key`（0600，绝不入 JSON） |
| 审批队列 | daemon RAM；pending 15m 过期 |
| grant 持久层 | `grants.json`（纯元数据、无值；重启保留授权）；v0 JSON，抽 Store 接口留 SQLite 后路 |
| 审计 | append-only JSONL + SHA-256 hash chain（每行含 prev_hash） |

### 5.2 协议 ops

hello(principal, nonce 签名) → get(resources[]（alias 或 jtk:// 地址，支持通配展开）, reason?) → 返回值或 req_id；批量 = 一条审批问整批；hello 也可 `--token`/env `JTK_TOKEN` 认证 → principal `token:<name>`，scope 内免 ask（deny 规则仍覆盖）
身份来源：`--as <principal>`（机器可用别名 `--agent`）或 env `JTK_PRINCIPAL`——加载该 principal 私钥签名，daemon 对照 config.json 公钥验签；人与设备同机制
pending / approve(req_id, ttl?) / deny(req_id) / grants(增删查) / why / simulate
agents add/list/revoke / token issue/ls/revoke / vault set/link/unlink/import-env/export/rotate / audit(verify/tail) / flush / status / stop

CLI 面向人：`jtk get DEEPSEEK_API_KEY --agent speedtest [--timeout 120s]`、
`jtk get 'ZAI_*,DEEPSEEK_API_KEY' --agent speedtest`（批量+通配，一条审批）、
`jtk run --env DEEPSEEK_API_KEY -- cmd`（值只进子进程 env）、
`jtk pending/approve/deny`（手机 SSH 进来就用这三条）。
选择语法分工（2026-10-08 admin 定）：**名字用 glob，值用 jq** —— 规则/批量/get 的名字选择一律 glob（策略保持声明式可测，不嵌 jq 程序）；复杂选择的逃生门是管道：`jtk ls --json | jq -r '…' | jtk get --stdin`（ls --json 与 get --stdin 进 P1）。

### 5.3 审批流（2026-10-08 admin 定：默认零部署直连，relay 为进阶件）

**默认链路（零部署）**：手机与 daemon 同处 tailnet/LAN —— daemon 内建极简审批页（HTTP），手机浏览器打开即一键批/拒（可存 PWA 到主屏）。
**进阶链路（部署 relay）**：要真·离屏推送（通知栏按钮）时部署 `jtk relay`（公网或 tailnet 可达处）。

1. agent 调 get → evaluate() → allow 且有有效 grant → 直接返值（热路径 <10ms）
2. ask → daemon 建 pending（principal, resource, reason, req_id）
3. 手机收到审批：**默认**经 tailnet 打开 daemon 内建审批页；**部署了 relay** 则经 daemon→relay 出站连接 + ntfy 推到通知栏（Approve/Deny 按钮 http 回调 relay）
4. 一键批/拒（可改 TTL）→ daemon 建 grant → 值下发请求方 → 审计落盘
5. deny → 立即失败 + 审计
6. **owner 路由**：credential 可标 `owner`（如老婆的账号 `owner:user:xy`）—— ask 路由到 owner 的审批通道、由 owner 批准，grant 记 approved_by；human 路由 pending 默认 24h（`settings.request_ttl_human`），机器 15m
7. fallback：SSH 手动 `jtk pending/approve/deny`（排查用）

一次性取值 token（借鉴 secret-gate）：approve 产出单次取值凭据，取值即焚 —— P1 实现，push 审批复用。

**relay server（同 repo `jtk relay`，进阶部署件，P1 同 repo 交付）**：
- 形态：**自托管**（公网 VPS 或 tailnet 可达处，如 qinglong）或 **junethekey 云 relay（订阅制，cloud service 第一块商用件 —— 云版即我们托管的同一二进制）**
- daemon↔relay：daemon **出站**长连接（WebSocket）—— 无需公网入口、不被 NAT 挡；自动重连/退避；enrollment 用 relay token（`jtk relay enroll`）
- relay↔手机：配对码 pairing；P1 走 ntfy 推送（通知栏按钮），P2 起 PWA（Web Push）→ iOS App
- **relay 全程只见 (principal, resource, reason)，不见值**（§7 红线）；TLS 强制

### 5.4 值与授权记录的存放（2026-10-08 admin 定）

- **值零冗余**：授权值不落盘 —— vault.enc 是唯一存值处；get 时当场解密、交付即清，daemon RAM 不长期驻留。不做 opkv2 式盘缓存：本地 vault 解密免费无限次，缓存零收益纯增泄露面。
- **grant 元数据落盘、不含值**：`grants.json` 只存 {principal, resource, value_hash(解析后值), expiry, rule_id, approved_by, approved_via}。value_hash 是指纹，高熵 API key 无法反推。重启不丢授权、不重复打扰人；值轮换（指纹失配）才重新问。
- **存储演进**：v0 全 JSON（grants.json + vault.enc 内部 JSON）；后续有规模需求时迁 SQLite —— 代码里先抽 Store 接口，迁移不动协议与 CLI。

### 5.5 soft link 键（2026-10-08 admin 增，1Password 做不到的）

- alias 的本质是**软链**：`ZAI_API_KEY → jtk://dev/zai/api_key` —— **一处存值、多处引用**（1Password 只能复制副本，rotation 漂移；这里改一处全链即时生效）。link 目标就是 jtk:// 地址（也可链到另一 alias）
- 解析：get 到 link → 沿链解到最终值；链允许嵌套，写入时校验（唯一写入口强制）：**无环、链深 ≤8**
- 策略按**请求名**（alias 或 jtk:// 地址）匹配 —— 同一把 key 在不同 agent 眼里可以有不同名字、不同策略（`speedtest 的 ZAI_MAIN` allow、真身 `zai-master` ask-only 都行）；审批通知与审计同时显示 link 与真身
- grant.value_hash 记**解析后**的值 → 链接目标轮换时所有引用方指纹自动失配、按 ask_on 重新问（rotation 自动触发重确认，安全加分）
- rm 有 inbound 链接的 alias 默认拒绝并列出依赖（`--force` 覆盖）—— 防止悄悄弄断别人在用的引用
- owner 就近：link 自身有 owner 用自己的，否则继承 canonical（owner 路由不被链接绕过）
- CLI：`jtk vault link <alias> --to jtk://dev/zai/api_key` / `jtk vault unlink <alias>`；`jtk ls` 显示 `alias → target`（`--json` 机器可读）
- 软链目标两种：**静态**（固定地址）或**动态**（`--to 'jtk://dev/gcp-sa?jq=.keys[0].client_email'` —— 每次 get 现场求值，内容变则结果变、指纹失配自动重问）

### 5.6 导入导出（2026-10-08 admin 增）

**导入** —— `jtk vault import-env <file.env> --vault dev --item misc`，逐行处理：
- `KEY=直接值` → 存为 field（直接赋值入库）
- `KEY=jtk://…` → 注册为 alias/软链
- `KEY=op://…` 等未知 scheme → P3 的 1Password adapter 再接；v0 跳过并告警

**导出** —— `jtk vault export [--vault dev]` 四种格式：

| --format | 内容 | 用途 |
|---|---|---|
| `env-ref` | `ZAI_API_KEY=jtk://dev/zai/api_key` | refs.env 精神续作——**只有引用没有值**，可提交、可分享 |
| `json-ref` | `{"ZAI_API_KEY": "jtk://…"}` | 程序消费的引用表 |
| `env` / `json` | 明文值 | 迁移他用；**必须 `--reveal`**，且写审计事件 |

往返保证：`export env-ref` → `import-env` → `export env-ref` 逐字节一致（CI 用例）。

**get 也接受地址**：`jtk get jtk://dev/zai/api_key --agent speedtest`（与 alias 等价，策略按请求名匹配不变）；`jtk run --from jtk://dev/zai -- cmd` 可把一个 item 的全部 fields 摊平注入 env。

### 5.7 临时/长期 token（2026-10-08 admin 增：把 1Password SA 做对）

- 签发（2026-10-08 admin 定语法）：`jtk token issue --for qinglong-speedtest --scope jtk://dev/zai:r --scope jtk://dev/gcp-sa/key.client_email:r --ttl 90d` —— token 明文**只显示一次**，daemon 只存 SHA-256
- scope 粒度全谱：`jtk://dev`（vault）→ `jtk://dev/zai`（item）→ `jtk://dev/zai/api_key`（field）→ `jtk://dev/gcp-sa/key.client_email`（json.path）；**权限内联后缀** `:r` / `:w` / `:rw`，每条 scope 自带权限，多条 `--scope` 取并集；write 可对范围内 field 执行 set/rotate
- 有效期：任意 TTL —— 临时（1h/24h）或长期（90d/1y），上限 `settings.token_max_ttl`（默认 1 年）；到期即失效，续期 = 重签
- 语义：**签发 = 范围内预授权**（无人值守场景不弹 ask，也不触发 value-changed 重问 —— 诚实语义：你签的时候就是批准）；`deny` 规则仍可压过 token；每次使用写审计（principal、scope、last_used_at）
- 与 grant 的区别：grant 是「某 principal × 某资源」的授权记录；token 是**自带 scope 的 principal** —— 签发动作本身就是那次人工批准
- 使用：`jtk --token <tok> get jtk://dev/zai/api_key` 或 env `JTK_TOKEN`（本机 cron 即刻可用）；远端 VPS/CI 经 tailnet 监听或 SSH 转发连 daemon（P2 提供 `--listen`）
- 吊销：`jtk token revoke <name>` 立即失效（删 hash 行，下次请求即拒）

## 6. 目录布局

```text
junethekey/
├── contracts/         # zod 4 schemas 唯一事实源：config/规则/协议帧/Decision/Grant（§6.1）
├── src/
│   ├── policy/        # P0 纯库：规则、evaluate、simulate、fixtures（无 IO、无模块级可变态）
│   ├── vault/         # vault.enc 读写、Argon2id+AES-GCM、import/export
│   ├── identity/      # principal 注册、ed25519 挑战-响应
│   ├── daemon/        # unix socket、协议、审批队列、grant RAM 态、内建审批页
│   ├── relay/         # `jtk relay` 子命令：WS、pairing、ntfy 推送、审批回传
│   ├── audit/         # JSONL + hash chain
│   └── cli/           # 子命令分发（bin: jtk）
├── config.example.json  # 配置示例（真实 config 在 ~/.config/junethekey/config.json）
├── package.json       # bin: {"jtk": "src/cli/main.ts"}；bun test / biome
└── tsconfig.json      # strict
```

运行时 **Bun + TypeScript（strict）**（2026-10-09 admin 定，替代此前的 Go 方案）。加密栈全原生：Argon2id = `Bun.password`、ed25519 = `node:crypto`、AES-256-GCM = WebCrypto；jq 查询 = jq-wasm（~1-2MB，P3 可换宿主内置）；schema = zod 4；进程内错误 = neverthrow；lint/format = biome；测试 = bun test。分发：**npm 主通道 + `bun --compile` 副产物**（VPS）；未来出口（Rust 类型 / txiki 小二进制 / MicroTS）见 §6.1 与开放问题 Q7，均不需现在投入。

**contracts 层（2026-10-08 admin 定，2026-10-09 定源）**：所有跨边界类型（config schema、规则、协议帧、Decision/Grant）收敛到 `contracts/`，以 **zod 4 schema 为唯一事实源**（沿用 jun-agent `{Name}Schema` 约定）——TS 静态类型 `z.infer`、TS 运行时校验 `z.parse`（同一份定义，零重复）；`z.toJSONSchema()`（zod 4 内建、第一方）构建时导出 JSON Schema 产物 commit 进 repo，未来 Rust 组件经 typify 出 struct + serde 自动校验、QuickJS/txiki 通道用 ajv（纯 JS）吃同一份产物 —— **schema 写一次，validation 全平台是投影**；CI 加 parity 快照测试防漂移。判别联合（Decision/协议帧）↔ JSON Schema `anyOf` ↔ Rust enum 三方干净映射。前提纪律沿用 jun-agent：边界只传 plain data。

**代码风格纪律（2026-10-08 定，2026-10-09 翻成 TS 版）**：
- biome（lint+format）CI 必过；CONTRIBUTING 首条写「Clear is better than clever」
- 错误：进程内一律 **neverthrow Result**（jun-agent 惯例，typed failure）；边界只传 plain data（failures 折成 plain object）
- **纯核心**：`policy/` 无 IO、无模块级可变态，evaluate 输入输出全是值 —— 可读性由表驱动测试背书
- 窄接口缝：Store/Notifier 等窄接口，未来换 SQLite/1Password adapter 不动核心
- 禁 cleverness：不用装饰器/反射/动态 import 魔法；文件 kebab-case、相对导入带 `.ts`（Bun 惯例）

## 7. 安全与威胁模型（诚实边界，借鉴 credential-broker-mcp 的文档纪律）

- 防的是：**误授权、授权漂移、无审计的访问** —— 不是防已攻陷的同 uid 进程
- 同 uid 攻击者可读 agent 私钥/socket → 边界写进 README 第一章
- master password 只在解锁时进内存；daemon 空闲锁定（可配 auto-lock）
- 审批通知只带 (principal, resource, reason)，绝不带值；日志无值（同 opkv2 A9 卫生标准）
- hash chain 防审计篡改（本地攻击面内 best-effort）

## 8. 与 opk / opkv2 的关系

- 三者并行期共存：opk（Bun）日常位 → junethekey 接管；opkv2 保留为 1Password 专用工具
- 迁移：`jtk vault import-env`（值行由 opkv2 get 导出后直接赋值导入；refs.env 里的 `op://` 行 v0 跳过并告警，P3 的 1Password adapter 接管）
- P3：opkv2 的 onepw SDK backend 移植为 junethekey 的 1Password adapter（vault 后端接口化）

## 9. 阶段与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | policy 纯库 + simulate/why/test | 全部规则语义单测绿；fixtures 可当 CI |
| P1 | daemon + vault + 身份 + **内建审批页（手机 tailnet 直连）** + relay 部署件（ntfy 真推送） + 审计 + token | E2E 主路径：ask → 手机（tailnet 直连审批页）一键 approve → run 注入 env；部署 relay 后通知栏按钮同样通；deny/过期/错密码/导入 34 keys/审计链 verify；link 解析 + rotation 重问；jtk:// 地址 + jq 取值 + env-ref 往返；token 签发/越权/过期/revoke 即拒 |
| P2 | Touch ID + grant 衰减管理 + relay PWA（Web Push）→ iOS App | 手机原生体验；ssh-agent TTL 联动 |
| P3 | MCP server（search/inspect/request/exec_with_secret）+ 1Password adapter + Hermes/jun 集成 | 任一 MCP 客户端可用；opkv2 退役评估 |

远期方向：hosted 云服务 —— **云 relay 即第一块商用件**（订阅制），后续托管 sync/backup；依据见开放问题 Q2。

## 10. 开放问题

- ~~Q1 命名~~ 已定（2026-10-08）：repo/项目名 **junethekey**（GitHub 查重 0 冲突）；CLI 二进制名 **jtk**
- ~~Q2 repo 公开时机 + license~~ 已定（2026-10-08）：**day-1 直接 public**（build in public），README 骨架 + secret-gate 对比表随首个 commit 就位；**license = Apache-2.0** —— admin 远期计划做自家 cloud service，Apache 的专利授权 + 商标条款利于商用路径；2026-10-08 复核后维持 Apache-2.0、暂不上 CLA（护城河放运营与功能，社区最大化）。远期 hosted 版只要求 Store 接口与协议层可替换，P0/P1 不为云做任何提前设计（YAGNI，仅保证不堵死）；**relay 定位（2026-10-08 复核）：默认零部署**（tailnet/LAN 直连内建审批页），**自托管 relay 为进阶件随 P1 同 repo 交付，云 relay（订阅）为商用件**——云版即我们托管的同一二进制
- ~~Q3 策略语言~~ 已定（2026-10-08）：单 JSON（config.json，`jtk config` 唯一写入口，仿 opkv2 收敛偏好），不引入 YAML/CEL/Rego
- ~~Q4 batch / field 粒度~~ 已定（2026-10-08）：**批量 P1**（一次多个名字，glob 通配展开，**整批一条审批**）；field/json.path 级寻址与 token scope 已随层级模型（§5.1）**进 P1**；P3 的 field 级仅指 1Password adapter 的字段映射
- ~~Q5 签名细节~~ 已定（2026-10-08）：**每连接一次**挑战-响应，之后同连接请求免签（同 uid 攻击者可直接读私钥，每请求签名属仪式性加固，威胁模型不覆盖同 uid）
- ~~Q6 vault 版本历史~~ 已定（2026-10-08）：P2 再做；v0 只有 updated_at，出错的兜底是 1Password 里仍保有原件
- ~~Q7 语言~~ 已定（2026-10-09）：**全 Bun/TS + npm 分发**（主通道 npm、`bun --compile` 副产物）；曾短暂定 Go 后翻转 —— 决定性因素：web/relay/手机端一仓同类型、zod 4 第一方 JSON Schema 出口、Bun 原生 argon2id、npm 分发先例（bw/claude-code）；QuickJS/txiki 与 MicroTS 列为未来可选通道
