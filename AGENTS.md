# AGENTS 指南

本文件用于指导后续 AI / 开发者在 `codex-usage-core` 项目开发中的协作方式。本项目定位为 `codex-companion` 与 `dev-ledger` 共享的 Codex 本地用量核心包，开发时必须优先保证数据口径、隐私边界、版本同步和下游兼容性清晰可靠。

## 1. 基本原则

- 全程使用中文交流、说明和用户可见文案。
- 文档先行，先理解需求、数据来源、指标定义、验证样例和下游使用方式，再动手改代码。
- 本项目专注 Codex，不把 Claude Code、Cursor、GitHub Copilot 等其他工具作为首版 provider 规划或实现。
- 以事实来源为准：Codex 本地会话数据、脱敏 fixture、下游项目文档和代码之间若有冲突，先统一口径，再继续实现。
- 不臆测业务规则、统计口径、字段含义和时间范围；缺字段时先查代码和脱敏样例，资料没有再补约定或向用户确认。
- 不提交原始 Codex session、用户输入正文、模型输出正文、私有仓库源码或敏感绝对路径。
- 项目对外必须明确为非官方工具，不使用 OpenAI、Codex 官方 logo 或容易造成官方背书误解的视觉资产。

## 2. 工作方式

- 开发前先执行 `git status`，确认当前工作区状态。
- 每个任务开始时先判断：这是核心类型调整、reset 规则调整、session 解析、校验脚本、fixture、文档修订，还是工程清理。
- 改动应保持聚焦，只处理当前任务相关的文件和行为。
- 涉及统计口径、阈值、检测规则、字段含义或隐私边界变化时，同步更新 README、开发记录和必要 fixture。
- 代码完成后至少执行 `npm run build` 和 `npm run test`。
- 每次有效修改后都要进行 Git 同步，至少包括：检查变更、更新开发记录、提交 commit；如远端可用，再执行 push。

## 3. 下游同步要求

- 本项目是 `codex-companion` 和 `dev-ledger` 的共享核心依赖。
- 每次核心包升级后，必须同步升级依赖它的两个项目：
  - `D:\MyFile\Obisidian\LifeInHand\1. 项目\个人品牌-学习进步\CodeLib\MyCode\codex-companion`
  - `D:\MyFile\Obisidian\LifeInHand\1. 项目\个人品牌-学习进步\CodeLib\MyCode\dev-ledger`
- 下游升级必须分别提交版本号、依赖锁文件、开发记录和验证结果。
- 如果当轮无法同步升级任一依赖项目，必须在本项目 `DEVELOPMENT_LOG.md` 写明阻塞原因、受影响版本和补救计划。
- 不允许在下游长期保留与本项目重复且分叉的 reset engine；新增 reset 规则必须优先落在本项目。

## 4. 版本号与 Git 同步

- 开发迭代版本：`vX.Y.Z-dev.N`
- 正式发布版本：`vX.Y.Z`
- commit message 必须带开发版本号，格式：`vX.Y.Z-dev.N type(scope): description`。
- 常用类型：`feat`、`fix`、`docs`、`refactor`、`chore`、`test`。
- 提交时只提交本次任务相关文件，不混入生成物、原始数据或无关脏文件。

## 5. 开发记录

- 每次有效更新都必须更新 `DEVELOPMENT_LOG.md`。
- 开发记录要写清楚版本号、日期、变更类型、开发原因、实现方式、当前结果和验证方式。
- 涉及统计口径、阈值、检测规则、数据源、字段含义、时间范围、算法参数或配置开关时，必须写清适用范围、触发条件、排除条件、关键字段、数值阈值和至少一个验证样例。

## 6. 交付标准

- `npm run build` 通过。
- `npm run test` 通过。
- reset 规则必须有脱敏 fixture 覆盖。
- 对外输出类型不能包含原始会话正文。
- 结果说明要交代改了什么、验证了什么、下游升级到哪个版本。
