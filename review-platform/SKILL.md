---
name: review-platform
description: "Use when locating, reading, or triggering AI code review on the internal review platform (opencode.jubaozan.cn): find review jobs by MR URL, branch, or HEAD SHA; read findings, gate verdicts, and feedback state; submit finding feedback; request re-review or new-SHA verification. Use before claiming any change is reviewed, blocked, fixed, or a false positive on the platform."
---

# 代码评审平台（review-platform）

内部 AI 代码评审平台，MCP 入口 `http://opencode.jubaozan.cn/api/mcp`，共 15 个工具。

**核心模型：评审单位是 MR（源分支 → 目标分支的 diff），不是分支、不是仓库、不是 commit。**

## 一、核心模型（实测 2026-10-15，全量 389 个任务）

| 事实 | 证据 |
|---|---|
| 只有两种任务模式 | `REVIEW` 374 个（**全部带 `mrIid`**）/ `SCAN` 16 个（全部无 `mrIid`） |
| `REVIEW` = MR diff 评审 | `dedupKey = GITLAB:<projectPath>!<mrIid>@<headSha>`，字段含 `sourceBranch → targetBranch` |
| `SCAN` = 单 ref 全库扫描 | `sourceBranch == targetBranch == ref`，无 diff、无 MR 上下文 |
| 无 MR 的分支从不被评审 | `mrIid` 为空的 16 个任务全部是 `SCAN`，无例外 |
| 每次 push 都触发 | 同一 MR 最多 11 个任务（按 `headSha` 区分） |
| 触发是自动的 | 最近 24h 新增 34 个任务，跨 16 个项目、多作者 |

近期有评审活动的项目（16 个，括号内为 `projectId`）：

```text
order-center/order(48), order-center/order-reviews, order-center/order-search,
order-center/express-service(110), trade-center/mall-extend-service,
trade-center/trade-api, trade-center/flow-monitor, trade-center/multi-level-cache,
marketing-center/marketing-service(89), marketing-center/coupon,
marketing-center/activity(215), marketing-center/raffle-service,
marketing-center/marketing-data-service, ai-demo, liubinjing/ai-demo
```

其余 `projectId` 用 `list_review_jobs(projectPath="group/repo")` 从返回值取。

---

## 二、触发评审

### 方式 A：push 时建 MR（推荐，唯一能产生 diff 评审的路径）

```bash
git push origin HEAD \
  -o merge_request.create \
  -o merge_request.target=master \
  -o merge_request.title="改动标题"
```

平台 webhook 自动建 `REVIEW` 任务，无需人工触发。目标分支不限于 `master`（实测存在 `develop`、`develop.12.30` 等）。

### 方式 B：MR 已存在，主动请求验证

```text
request_review_verification(platform="GITLAB", projectId="48",
                            mrIid=2304, expectedHeadSha="<完整40位SHA>")
```

**前置条件（实测）：MR 必须已存在** —— 传不存在的 MR 返回 `REJECTED` + `METADATA_UNAVAILABLE`。服务端核对远端 HEAD，不匹配即拒；`ACCEPTED` 仅表示入队，`REUSED_*` 仅表示复用既有运行。

### 方式 C：全库扫描（不推荐）

`create_scan(projectId, repositoryUrl, ref)` 扫整个 ref 的全库，**不做 diff 对比**；实测 12/16 失败（OCR 超时、`git checkout --detach` 参数冲突、`simsun.ttc` 等字体文件超 2MB 扫描上限）。仅在项目未接入 webhook、确实需要存量排查时使用，并用 `get_scan_status` 以 ≥5s 间隔轮询。

---

## 三、查询链路（四步）

1. **定位任务** — `resolve_review_context(platform, projectPath | mrUrl | mrIid | sourceBranch | headSha)`
   同分支多次 push 会返回 `AMBIGUOUS`（实测 10 个候选），加 `headSha` 或 `mrUrl` 唯一锁定。
2. **看状态与门禁** — `get_review_job_detail(jobId)`（verdict / score / 缺陷计数 / 最近 run）；列表用 `list_review_jobs(projectPath, author, state)`。
3. **读缺陷** — `list_run_findings(jobId, runId)` 绑不可变 `runId`，翻页期间集合与编号不漂移（`list_findings(jobId)` 按任务查，无 run 时返回空）。
4. **读证据** — `get_finding_context(jobId, runId, occurrenceId)` 取完整原始证据、当前有效反馈及来源、历史规则快照、run 门禁决策。

需要精确恢复现场时用 `restore_review_context(jobId, runId, expectedHeadSha, expectedFeedbackId/Version)`，返回 checkpoint 供后续核对。

---

## 四、工具速查（15 个）

### 只读（10）

| 工具 | 用途 |
|---|---|
| `resolve_review_context` | 按 MR/分支/SHA 精确定位任务与最新 run；唯一命中返回 `selected`，多个返回 `AMBIGUOUS` |
| `list_review_jobs` | 任务列表，按 `projectPath` / `author` / `state` 过滤，含门禁 verdict、score、缺陷计数 |
| `get_review_job_detail` | 单任务详情 + 最近一次 run 的状态汇总 |
| `list_findings` | 按任务查缺陷明细（文件、行号、规则、描述、级别） |
| `list_run_findings` | 按 `runId` 稳定分页查缺陷，支持 `severity` / `filePath` / `directory` 过滤 |
| `get_finding_context` | 单条缺陷的完整证据链 + 当前有效反馈 + 规则快照 |
| `restore_review_context` | 恢复固定 run 上下文，校验 `headSha` 与反馈 ID/版本，不自动切到最新 run |
| `compare_review_runs` | 显式两次 run 对比：`NEW` / `PERSISTING` / `RESOLVED` / `NOT_REVIEWED` |
| `get_project_review_rules` | 项目实际生效的评审规则内容、来源、版本、SHA-256 |
| `get_scan_status` | 扫描进度轮询（阶段 + planned/reviewed/failed/excluded/pending 计数） |

### 写入与触发（5）

| 工具 | 用途 |
|---|---|
| `submit_finding_feedback` | 提交缺陷反馈并重算保存门禁（详见第六节） |
| `request_review_verification` | 对指定新 SHA 的 MR 请求评审验证（幂等，可复用运行） |
| `re_review` | 强制重新评审；**仅对门禁阻塞且已提交反馈的任务有效**，否则返回冲突 |
| `create_scan` | 发起手动全库扫描（异步，`DUPLICATE` 时返回既有 jobId） |
| `cancel_scan` | 终止进行中的扫描 |

---

## 五、语义边界（硬约束，禁止过度解读）

平台在工具描述里显式否定了更强的解读。**向用户汇报时不得输出被否定那一列的结论：**

| 平台返回值 | 不得解读为 |
|---|---|
| `compare_review_runs` → `RESOLVED` | 已修复 —— 仅表示后次已评审范围内未再检出 |
| `request_review_verification` → `ACCEPTED` | 已通过 —— 仅表示已入队 |
| `REUSED_RUNNING` / `REUSED_COMPLETED` | 修复或门禁通过 —— 仅表示复用了既有运行 |
| `restore_review_context` → `READY` | 已修复或门禁通过 |
| 反馈已保存（`feedbackWrite=SAVED`） | 整次 run 门禁已更新 —— 保存与门禁重算是两件事 |
| 通知 `DISPATCH_RETURNED` | 已送达 —— 不保证投递成功 |
| 单条缺陷反馈已确认 | 该缺陷单独阻塞整次 run 门禁 |
| 历史规则快照缺失 | 用当前规则替代（禁止，历史 run 必须用当时的规则快照） |

`get_finding_context` / `restore_review_context` 都**不触发**评审、反馈或规则激活；`compare_review_runs` 不读取线程当前状态作为历史事实。

---

## 六、反馈提交

```text
submit_finding_feedback(jobId, runId, occurrenceId, verdict, scope,
                        reason?, expectedFeedbackId?, expectedVersion, confirmProjectScope?)
```

| 参数 | 规则 |
|---|---|
| `verdict` | `VALID` / `FALSE_POSITIVE` / `WRONG_SEVERITY` / `DUPLICATE` / `NOT_ACTIONABLE` |
| `scope` | `CURRENT_REVIEW`（仅本次）/ `EXACT_CODE`（相同代码）/ `PROJECT_RULE`（写项目规则，**必须 `confirmProjectScope=true`**） |
| `reason` | 最多 2000 字符；`FALSE_POSITIVE` / `NOT_ACTIONABLE` 必须非空 |
| `expectedVersion` / `expectedFeedbackId` | 乐观锁，比较**目标直接反馈**，不使用继承来源 checkpoint；无直接反馈传空 ID + 版本 `0`，已有初始反馈传正 ID + 版本 `0` |

投递失败可伴随 `SAVED`（反馈已存、通知未达）；**不得重发反馈补投递**。

---

## 七、已知失败模式（实测）

| 报错文案 | 处置 |
|---|---|
| `LLM 探针未通过 ... request timed out` | 平台侧 LLM 探针超时，非本仓库问题；确认平台 LLM 配置/网络后重试 |
| `HTTP 429 ... 速率限制` / `AccountQuotaExceeded` | 平台侧 LLM 配额或限速，文案会给出重置时间；等待后重试 |
| `git clone ... 403` / `401` | 平台侧仓库凭据失效，需平台管理员处理 |
| `OCR process timed out` | 全库扫描遇到超大文件/超预算；改用 MR 评审路径 |
| `Strict SCM metadata is unavailable`（`METADATA_UNAVAILABLE`） | MR 不存在或远端不可达；先确认 MR 已创建 |

---

## 八、接入与探测

配置写入 `~/.omp/agent/mcp.json`（Windows：`C:/Users/<user>/.omp/agent/mcp.json`）：

```json
{
  "mcpServers": {
    "review-platform": {
      "type": "http",
      "url": "http://opencode.jubaozan.cn/api/mcp"
    }
  }
}
```

**改配置后必须重启 session** —— MCP 工具在 session 启动时注入，不热加载。

该端点是有状态 Streamable HTTP，手动探测需先握手取 `Mcp-Session-Id`：

```bash
SID=$(curl -s -i -X POST http://opencode.jubaozan.cn/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}' \
  | tr -d '\r' | awk -F': ' '/^Mcp-Session-Id:/{print $2}')
curl -s -X POST http://opencode.jubaozan.cn/api/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

不带 `Accept: text/event-stream` 会被拒（`Invalid Accept header. Expected TEXT_EVENT_STREAM`）；不带 session id 调用 `tools/list` 返回 400。

---

## 红色警告

| 想法 | 正确处理 |
|---|---|
| "用 `create_scan` 做分支对比评审" | 错。`SCAN` 是单 ref 全库、无 diff；要 diff 必须走 MR |
| "分支 push 了就会自动评审" | 错。实测所有 `REVIEW` 任务都带 `mrIid`，无 MR 不评审 |
| "`RESOLVED` 说明修复生效了" | 错。仅说明后次已评审范围内未再检出；要确认修复须固定 `runId` 对比并读缺陷 |
| "反馈提交成功 = 门禁放行" | 错。反馈保存与门禁重算分离，且整次 run 门禁不由单条缺陷反馈决定 |
| "`ACCEPTED` 就是评审通过" | 错。仅表示已入队 |
| "没重启 session 也能用新 MCP 工具" | 错。工具在 session 启动时注入 |
| "端点无鉴权所以可以随便调用写接口" | 错。`re_review` / `cancel_scan` / `submit_finding_feedback` 会真实改变团队评审状态与门禁，只在有明确依据时调用 |
