# dsh-memoir-sqlite

[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

中文 · [English](./README.en.md) · [更新日志](./CHANGELOG.md)

**DeepSeek Harness（DSH）的 SQLite 跨会话项目记忆插件。** 它仅收录明确的记忆要求、长期偏好与长期规则纠正，在新会话中注入有界且缓存友好的 Hot Memory，并通过对中文友好的本地 BM25 排序召回长尾历史。

本项目 Fork 自 [`dsh-memoir`](https://github.com/Qinling-Melon-Farmers/dsh-memoir)，保留其 Hot Memory、中文 BM25、生命周期与原生 Web GUI，并把结构化单一事实源替换为 Node 内置 `node:sqlite`。无需 ORM、embedding、向量数据库或云端记忆服务。

> [!IMPORTANT]
> 当前源码版适用于 `@deepseek-ai/dsh 0.2.0-rc.1`、`0.2.0-rc.2` 和 `0.2.1-rc.2`。它与原版 `dsh-memoir` 提供同名工具和 UI，不应在同一 profile 中同时启用。

从源码构建后，通过 `link:` 或 tarball 安装；详细命令见下方“安装与兼容性”。记忆保存在本机，不会随插件升级或卸载自动删除。

## 为什么选择 dsh-memoir

| 能力 | 用户得到什么 |
| --- | --- |
| 本地优先 | SQLite 单一事实源与项目内 `PROJECT_MEMORY.md` 投影；不上传记忆，不依赖外部服务 |
| 按证据收录 | 响应明确的记忆要求、纠正、确认流程和已验证的可复用经验，不追加轮末检查 |
| 有界 Hot Memory | 只把高价值记忆放进 system prompt，受 token 预算硬限制；同一会话冻结前缀以提高 prompt-prefix cache 命中 |
| BM25 排序召回 | 中文短语、英文关键词、代码标识符和路径都可检索；跨项目 Top-K 与查询 LRU 缓存共用同一引擎 |
| 可治理的记忆 | 重要度、置顶、标签、归档、恢复和 supersede 生命周期；相似写入必须显式更新、替代或并存 |
| 可追溯 | Agent 写入记录可信 session/turn 来源，Web 面板可复制并尽力跳回原会话 |
| 完整 Web GUI | 中英双语项目/全局浏览、排序搜索、编辑、Hot Memory 预览、诊断和实时设置；可独立选择 Agent 侧中文或英文 |

适合需要“新 Agent 接手时继续理解项目”的个人或本地开发工作流。它不是原始聊天记录备份、多人云同步服务或向量语义知识库。

![dsh-memoir v0.6.1 按项目折叠的全局记忆](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-global-project-groups-zh.png)

## 工作原理

```text
明确的记忆要求 / 长期偏好 / 规则纠正
    │  按需调用记忆工具
    ▼
memoir_record / memoir_update
    │
    ├── $DSH_HOME/dsh-memoir-sqlite/memory.db  完整结构化历史（SSOT）
    ├── <项目>/PROJECT_MEMORY.md      可读、可提交的投影
    └── Retrieval Index              倒排索引 + BM25 + 查询缓存
              │
              ├── Hot Memory Selector ──> 有界 system-prompt 注入
              └── memoir_read / Web ────> 按需召回长尾历史
```

SQLite 保存项目、条目、版本及增删改审计；`PROJECT_MEMORY.md` 只是可读投影。完整历史与 Hot Memory 是两层数据：

- **Full Memory** 保留全部记录，用于 GUI、人工审阅、Markdown 投影和排序检索。
- **Hot Memory** 只选择预算内的 actions 和 lessons；不会把整个 `PROJECT_MEMORY.md` 塞进 prompt。
- **Session Snapshot** 在会话内冻结注入文本。新写入立即可被工具和 GUI 读取，但自动注入从下一个新会话开始更新。

## Agent 工具与记忆生命周期

| 工具 | 用途 |
| --- | --- |
| `memoir_record` | 写入 work / lessons / actions / note；写前返回可解释的相似或冲突候选 |
| `memoir_update` | 保留 id 和创建时间，更新正文、分类、重要度、标签与生命周期 |
| `memoir_read` | 在 project（默认）/ global / all 范围内进行 compact 或 full 的本地排序召回 |

每条记忆可设 1–5 重要度，默认 **3** 代表中性优先级；置顶会获得额外 Hot Memory 权重。默认只召回 `active`，被归档或替代的历史仍可检查和恢复，不会被自动删除。

相似记忆治理复用 BM25 候选，再融合标题相似度与 Token Jaccard。插件只提示疑似重复或冲突，不自行判断真伪；调用者必须选择：

- `update`：原地更新现有记录；
- `supersede`：保留旧历史并标记已被新记录替代；
- `force-record`：确认两条都应存在。

## 按证据收录

插件不注册轮末监听，不再为沉淀追加模型调用或维护回复。旧 autoDistill 配置仍可读取，但统一解析为 false；频率字段不再生效，设置页也不再提供对应控件。

仅在用户明确要求记住、明确纠正长期规则、确认长期流程、反复表达一致的长期偏好，或给出验证过且可复用的解决办法时保存，每项用一句简短规则。自动写入每轮最多一条，同一主题优先更新或替代；不从一次选择或临时状态推断偏好，不自动记录任务进度或一次性结果。遇到相关业务、重复问题、接续任务或接手旧项目时主动读取少量记忆，先用少量 compact 摘要，确需细节再扩大范围；跨项目条目只在明确适用时引用。收录条件仍由提示词引导模型，并非数据库语义硬过滤。

已有记忆保留并可查询；自动注入只选择 actions 和 lessons，不带入 work 和 note。默认 Hot Memory 估算预算为目标 300、上限 500，不含插件说明和工具描述；memoir_read 默认返回 3 条。显式 profile 和自定义预算仍然有效。读取 v1–v3 设置文件时不改写原文件：旧设置中保存的原默认 900/1200 组合和查询条数 8 会迁移为 300/500 和 3，自定义值保留；再次保存时写入 v4。

插件更新需要宿主重新加载，已有冻结提示快照在新会话刷新。language 设置可实时切换 Agent 侧文案，不影响 Web 界面语言。

## 本地召回与缓存

- 中文 2/3-gram + 英文单词 + 代码/路径标识符分词；
- BM25 文档侧保留真实词频，标题 2.5× 加权，另有精确短语、分类与时间权重；
- 标题与正文独立长度归一化；
- project / global / all 共用去重后的全局 Top-K；
- epoch 感知、1 小时时间桶的 LRU 查询缓存；`limit` 与输出详略不进入缓存键，因此不同输出形态共享排序结果；
- GUI 和 `memoir_read` 使用同一个 RetrievalEngine，并暴露 hits、misses、evictions、命中率与最近查询耗时。

固定质量集的 Top-5 命中率为 100%，仓库门禁要求不低于 90%。

## Web GUI

安装到 DSH 的 `web` profile 后，Memoir 通过官方 slot 注册原生「记忆」会话视图和「记忆」Settings 分区；布局、导航与卸载生命周期均由 DSH shell 管理，不再通过 DOM 选择器接管旧侧边栏。rc.1 的设置页按 `retainedBy.mainView` 识别当前项目，来源会话通过 `uiWorkspace.openSession` 打开。

- 项目记忆与所有项目的全局记忆；全局视图按项目默认折叠并显示完整生命周期计数；
- 状态、分类和关键词筛选，BM25 分数展示；
- 新增、编辑、置顶、归档、恢复和替代；
- session/turn 来源复制与尽力跳转；
- Hot Memory Inspector：下一会话将继承什么；
- Retrieval Diagnostics：索引、查询缓存、最近查询和会话快照；
- 常驻 `记忆浏览 / 记忆设置 / Hot Memory / 诊断` 二级导航，各功能区拥有独立有界滚动位置；
- 每批渐进展示 20 条记忆或 20 个项目，长正文默认折叠为六行并可显式展开；
- 使用 DSH 原生 composer-overlay 契约，长列表可完整滚动且最后一项不会被对话输入框遮挡；
- 页签支持方向键、Home、End，项目折叠具备 `aria-expanded` 与清晰焦点状态；
- GUI 跟随 `<html lang>` 在中文和英文间即时切换；Agent 侧语言由独立的 `language` 设置控制。

<details>
<summary>查看更多 GUI 截图</summary>

![v0.6.1 常驻功能导航与实时设置](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-settings-navigation-zh.png)

![v0.6.1 对话视图滚动到底且避让输入框](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.1/picture/v0.6.1-conversation-scroll-zh.png)

![DSH alpha.2 原生记忆会话视图](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.6.0/picture/v0.6.0-alpha2-native-zh.png)

![记忆生命周期与相似治理](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.4-memory-management-zh.png)

![Settings 设置卡](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.6-settings-card-zh.png)

![侧边栏对齐](https://raw.githubusercontent.com/Qinling-Melon-Farmers/dsh-memoir/v0.5.6/picture/v0.5.5-sidebar-parity-zh.png)

</details>

## 安装与兼容性

需要 Node.js `^22.19.0 || >=24.0.0` 以及 DSH `0.2.0-rc.1`、`0.2.0-rc.2` 或 `0.2.1-rc.2`。兼容范围通过顶层 `engines.dsh` 声明供宿主启动检查，旧版元数据与两个 DSH peer 保持相同范围。源码使用 pnpm：

```bash
git clone https://github.com/choco9527/dsh-memoir-sqlite.git
cd dsh-memoir-sqlite
pnpm install --frozen-lockfile
pnpm run build
dsh plugin --profile web add "link:/absolute/path/dsh-memoir-sqlite"
```

重启对应 DSH profile 后生效。也可执行 `pnpm pack`，再让 App 构建脚本安装生成的 tarball。

0.1.1 选择性迁入上游 0.9.3 的提示词原文保护和 Hot Memory 硬预算修复。记忆中的 `{{...}}` 不再执行变量替换；标题、正文和分组开销全部计入预算，无法容纳的候选会让位于后续较短记忆。SQLite 数据格式、已有记忆及克制收录规则不变，无需迁移或清空数据库。构建与测试 SDK 固定为 `0.2.1-rc.2`；旧 0.1.2 alpha 宿主缺少原文保护接口，继续使用插件 0.1.0。

## 存储、隐私与安全边界

```text
$DSH_HOME/dsh-memoir-sqlite/memory.db    SQLite 单一事实源、版本与审计
$DSH_HOME/dsh-memoir-sqlite/settings.json GUI 运行时设置覆盖
<项目>/PROJECT_MEMORY.md                 从 SQLite 生成的人类可读投影
```

- 无云端记忆库、embedding API 或向量数据库；
- 浏览器提交任意绝对路径不能获得写权限，面板写入只接受可信活动工作区或已存在的项目桶；
- 浏览器手工记录不能伪造可信 session/turn 来源；
- SQLite 使用 WAL；跨进程写入另有独占锁保护完整的读取—修改—提交过程；
- 每次新增、修改和删除都写入 `entry_revisions` 审计表，条目版本单调递增；
- Windows 路径键大小写归一化，展示路径保留原样；
- `PROJECT_MEMORY.md` 可能被你提交到 Git，敏感内容是否进入仓库由使用者决定。

首次以默认路径启动时，空数据库会自动导入旧的 `$DSH_HOME/dsh-memoir.json`；也可通过 Store API 显式导入其他旧文件。导入不会修改旧 JSON。建议升级前备份数据库、旧 JSON 与项目 Markdown，卸载插件不会主动删除它们。

## 配置

嵌入式宿主可通过启动配置 `pathRelocations: [{ from, to }]` 提供已完成的工作区迁移。旧、新路径读取同一份项目记忆；设置页和 Markdown 写入使用新路径，不依赖旧目录、软链接或旧 App。已有条目的 ID、来源和审计记录保留，下一次记忆修改时将合并后的项目索引持久化。映射必须是绝对非根目录，禁止重复来源、链式映射和循环；此配置不在设置页开放。

以下字段都可写在 `cordis.patch.yml` 的 memoir `config` 中；除已停用的 `autoDistill*`、`enabled` 和 `showConversationView` 外，也可从记忆面板或 Settings 设置卡即时修改并持久化。

| 字段 | 默认值 | 作用 |
| --- | ---: | --- |
| `enabled` | `true` | 工具、路由和 prompt 注入总开关 |
| `showConversationView` | `true` | 是否注册会话顶部的“记忆”视图；Settings 分区始终保留 |
| `language` | `zh` | Agent 可见的 prompt、工具 schema/结果、投影标题与错误语言；可选 `zh` / `en` |
| `announceToAgent` | `true` | 向 Agent 公告记忆工具与规则 |
| `autoDistill*` | — | 旧版兼容字段；轮末检查已停用 |
| `hotMemoryTokens` | `300` | Hot Memory 常规目标预算 |
| `hotMemoryMaxTokens` | `500` | 任何会话都不能超过的硬上限 |
| `readDefaultLimit` | `3` | `memoir_read` 默认结果数 |
| `readMaxLimit` | `30` | 单次召回实时上限 |
| `sessionSnapshotMax` | `128` | 会话冻结快照 LRU 容量 |
| `queryCacheSize` | `128` | BM25 查询 LRU 容量 |

缩小缓存容量会立即淘汰最旧项；已冻结会话不会因预算修改而重写，以维持 prompt 前缀稳定。“恢复启动配置”会删除 Web 覆盖并回到 profile 的启动值。

## 性能与验证

Fork 保留上游有界 Hot Memory、查询缓存和中文 BM25 质量集，并新增 SQLite schema、WAL、权限、版本审计、损坏备份、跨连接可见性和旧 JSON 导入测试。上游 JSON 版本的历史基准仍保留在 [`bench/report.md`](./bench/report.md)，SQLite 版本发布前会单独重跑持久化基准，避免把旧数字当成当前结果。

## 常见问题

**会自动总结所有聊天吗？**<br>
不会。符合条件的回合只提醒筛选长期价值；没有合格候选时不调用记忆工具。写入通过公开工具进行，过程可观察、可审查。

**为什么新记忆的重要度总是 3？**<br>
3 是 1–5 标度的中性默认值，避免未显式评分的内容被当成低价值或最高优先级。可在工具参数或 GUI 中调整，置顶另有独立权重。

**为什么当前会话没有立刻重新注入刚写的记忆？**<br>
会话内 Hot Memory 快照刻意冻结以保护 prompt-prefix cache。刚写内容可立即被 `memoir_read` 和 GUI 看见，新会话会自动重建并注入。

**它会把完整记忆都塞进上下文吗？**<br>
不会。只有受 `hotMemoryMaxTokens` 约束的 Hot Memory 自动注入；完整历史按需检索。

**安装后为什么看不到界面？**<br>
确认命令包含 `--profile web`，然后彻底重启 `dsh web`，仅刷新浏览器页面不够。

## 开发与贡献

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm run bench
```

提交前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。版本变化见 [CHANGELOG.md](./CHANGELOG.md)。本 Fork 基于上游 `dsh-memoir@0.6.1`，Apache-2.0 许可证与原作者版权声明保持不变。

Apache-2.0
