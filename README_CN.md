# agy-codex-rescue 🛡️

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-brightgreen.svg)](package.json)

> **Antigravity (`agy`) Agent 智能体工作流与 OpenAI Codex CLI 之间的安全沙箱桥接工具。**

`agy-codex-rescue` 赋予自主 AI 智能体（如 Antigravity / Claude）调用本地 OpenAI Codex CLI 作为辅助深度推理引擎的能力。用于复杂代码生成、顽固疑难 Bug 诊断、底层算法重构与未提交变更的第二意见代码审查——**在严密沙箱保护与整洁上下文前提下实现**。

---

## 🌟 为什么需要 Codex Rescue？

在复杂软件工程场景中，主控 Agent 偶尔会陷入推理死循环、遇到生僻框架细节或需要外部独立审查。然而，若直接裸跑 OpenAI Codex CLI，往往会面临诸多工程与安全痛点：

| 核心维度 | 裸跑 Codex CLI | 使用 `codex-rescue` |
| :--- | :--- | :--- |
| **沙箱安全性** | 易产生交互式人工审批阻塞，或误用危险的全局全开模式 | **默认强制严格只读沙箱 (`read-only`)**；仅显式加 `--write` 才开放工作区写权限 |
| **执行安全性** | Shell 字符串拼接存在转义风险与系统参数长度上限 | **使用 `child_process.spawn(shell: false)`**；Prompt 通过 stdin 管道输入，杜绝注入 |
| **会话追溯** | Session UUID 易丢失，上下文难以无缝接续 | **原子化写入状态存储**；支持基于工作区或 Job ID 快速接续会话 (`--resume`) |
| **输出整洁度** | 混杂大量内部 Rust Tracing 报错与连接诊断日志 | **智能日志过滤**；输出结构化 Markdown 报告（摘要、结论、代码位置定位、后续操作） |
| **Agent 协作** | 需人工拼装复杂指令 | **原生集成 Antigravity Skill** (`skills/codex-rescue/SKILL.md`)，开箱即用 |
| **依赖负担** | 需引入大量第三方 npm 或 Python 库 | **零外部依赖**（纯 Node.js 18+ 标准库实现） |

---

## 🏗️ 架构设计

```
   ┌──────────────────────────────────────────────┐
   │         Antigravity Agent (`agy`)            │
   └──────────────────────┬───────────────────────┘
                          │ Skill / run_command
                          ▼
   ┌──────────────────────────────────────────────┐
   │            bin/codex-rescue CLI              │
   ├──────────────────────┬───────────────────────┤
   │  lib/engine.mjs      │  lib/state.mjs        │
   │  - 严格沙箱管控      │  - 原子化 jobs.json   │
   │  - stdin 管道注入    │  - 会话寻址与校验     │
   │  - 事件流解析        │  - 工件产物持久化     │
   └──────────┬───────────┴───────────┬───────────┘
              │ Spawn (shell: false)  │ Render
              ▼                       ▼
   ┌──────────────────────┐  ┌────────────────────┐
   │   OpenAI Codex CLI   │  │   lib/render.mjs   │
   │  (--sandbox read-only│  │   - 过滤系统杂音   │
   │   -a never exec)     │  │   - 结构化渲染     │
   └──────────────────────┘  └────────────────────┘
```

---

## 🚀 快速安装与配置

### 方式一：一键安装脚本（推荐）

执行项目内置的幂等安装脚本：
```bash
bash install.sh
```

安装脚本将自动：
1. 创建软链接 `bin/codex-rescue` 到 `~/.local/bin/codex-rescue`（或 `$PREFIX/bin`）。
2. 将 Antigravity Skill 链接至检测到的 Agent 技能目录：
   - `~/.gemini/antigravity-cli/skills/codex-rescue`
   - `~/.gemini/config/skills/codex-rescue`
   - `~/.claude/skills/codex-rescue`（若存在）。
3. 自动执行环境与授权完整性校验。

### 方式二：全局 npm 链接

```bash
cd /path/to/agy-codex-rescue
npm link
```

### 验证环境可用性

```bash
codex-rescue setup
```

输出示例：
```text
=====================================
 🛡️  CODEX-RESCUE ENVIRONMENT SETUP  
=====================================
 [PASS]  Node.js Runtime: v22.23.1 (compatible >= 18)
 [PASS]  Git Version Control: git version 2.43.0
 [PASS]  Codex CLI Executable: /home/harvest/.rpty/bin/codex (codex-cli 0.162.1)
 [PASS]  Codex Authentication: Logged in using ChatGPT
 [PASS]  State Store Directory: Writable at /home/harvest/.config/agy-codex-rescue
-------------------------------------
Result: Ready to use! Codex rescue bridge is properly configured.
=====================================
```

---

## 💻 CLI 命令与使用说明

### 1. `task` — 执行深度诊断与代码编写

```bash
codex-rescue task "<prompt>" [options]
```

#### 参数选项：
- `--write`：开启工作区写入权限（默认：严格只读 `read-only`）。
- `--resume [job-id]`：接续先前的会话（默认接续当前工作区的最新一次任务）。
- `--fresh`：强制开启新会话，不复用历史会话。
- `--model <name>`：指定 Codex 使用的模型（例如 `o3-mini`）。
- `--effort <level>`：设置思考推演深度（`low`, `medium`, `high`）。
- `--dir <path>`：指定执行的工作区目录（默认：当前目录）。
- `--json`：以 JSON 格式输出机器可解析数据。

#### 实用范例：
```bash
# 安全只读诊断：
codex-rescue task "分析 tests/auth.test.js 为什么在并发测试时出现超时"

# 明确授权写入修复：
codex-rescue task "修复 tests/auth.test.js 中的并发超时并补充单测" --write

# 多轮追问，保留上下文：
codex-rescue task "这个修复方案在高并发场景下是否存在锁竞争？" --resume
```

### 2. `review` — 代码审查

审计当前 Git 仓库中的代码变更：
```bash
# 审查本地工作区未提交的所有修改：
codex-rescue review --scope working-tree

# 与 main 分支基线进行比对审查：
codex-rescue review --scope branch --base main
```

### 3. `status` 与 `result` — 任务查询与产物读取

```bash
# 查看当前工作区最近一次任务状态
codex-rescue status

# 读取特定任务的完整 Markdown 结果报告
codex-rescue result job-20261014141000-abc
```

### 4. `list` — 查看历史任务

```bash
codex-rescue list
```

---

## 🤖 与 Antigravity Agent (`agy`) 协作工作流

安装技能后，`agy` 即可在推理受阻时自动或手动协同 Codex CLI：

```text
用户: "在 heavy_matrix.cpp 中存在一个偶发性的死锁，排查很久了，能请 Codex 辅助定位吗？"

Agent 调度执行:
run_command("codex-rescue task '分析 heavy_matrix.cpp 中的锁获取顺序，定位潜在死锁点' --dir .")

Codex Rescue 返回结构化 Markdown:
## 🛡️ Codex Rescue Execution Summary
- Status: ✅ Success
- Mode / Sandbox: task / read-only
- Duration: 5.18s

## 📋 Verdict
heavy_matrix.cpp:142 与 heavy_matrix.cpp:218 存在锁反转风险。

## 🔍 Findings & Analysis
...

Agent 与用户确认后决定是否使用 `--write` 进行自动修复。
```

---

## 🔒 安全保障与沙箱机制

1. **默认严格只读**：默认传递 `--sandbox read-only --ask-for-approval never`，模型无法修改磁盘。
2. **写权限按需开启**：仅当显式附带 `--write` 时开启 `--sandbox workspace-write`。
3. **禁用全局越权**：严格拦截任何 `danger-full-access` 及类似后门指令。
4. **子进程防注入**：使用 `child_process.spawn(shell: false)` 与参数数组，Prompt 均走 stdin 管道传输。
5. **原子化状态存储**：使用同卷临时文件与 POSIX 原子 `renameSync`，防止并发崩溃损坏数据。

详细安全策略参见 [SECURITY.md](file:///home/harvest/project/agy-codex-rescue/SECURITY.md)。

---

## 🧪 自动化测试

运行纯离线单元与功能测试套件：
```bash
npm test
```

运行端到端 Smoke 集成测试：
```bash
npm run smoke
```

---

## 📄 开源许可证

本项目基于 [MIT](file:///home/harvest/project/agy-codex-rescue/LICENSE) 许可证开源 © 2026 harvest
