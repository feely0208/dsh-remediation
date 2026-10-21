# @deepwhale-cn/dsh-remediation

[![dshfind 收录](https://dshfind.com/api/badge/feely0208/dsh-remediation?lang=zh)](https://dshfind.com/zh/plugins/feely0208/dsh-remediation)

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/feely0208/dsh-remediation)

**检查报告只说「哪有问题」，改法还得自己查 —— 这个插件把「改成什么样、大概多久、改完怎么验」直接给出来。**

**关键词**：整改建议 · 修复建议 · 漏洞修复 · 合规整改 · 怎么改 · 整改清单 · 修复方案 · 改前改后 · 检查报告解读 · 一键整改

---

## 不装会怎样

你跑完一轮检查，拿到一份几十条的 JSON 报告：`LOG-RETENTION-SHORT`、`FIN-AUTH-PLAINTEXT`、
`MED-EMR-RETENTION-1`……每条都有一句「请整改」。然后呢？

- 改到什么值才算合规？日志留存写 90 天还是 180 天？
- 这条规则对应的是哪个文件、哪一行？改配置还是改代码？
- 这条要写文档，模板长什么样？
- 改完了怎么确认真的改掉了，而不是「看着像改了」？
- 哪些能直接机械改，哪些必须业务决策？

这些事现在都得自己一条条查法条、翻代码、问同事。**dsh-remediation 就是把这个空档补上**：
它不新增任何判据，只读你已有的检查报告，把每条问题翻译成**能照着做的改法**——
具体步骤、改前 → 改后片段、预计工时、改完重跑哪条命令。
对声明过 `autoApply` 的规则（如 LICENSE、日志留存天数），还能机械改掉：
默认 dry-run，确认后 `--apply` 才落盘，先备份、只碰声明过的文件。

```
dsh-cn-log-retention / dsh-industry-medical / ...  = 查【哪有问题】
dsh-remediation                                    = 告诉你【到底怎么改、改完怎么验】
dsh-fix-verify                                     = 复核【改前 → 改后】问题少了没有
```

---

## 先说清楚它是什么、不是什么

**是**：

- 一个「检查报告 → 整改清单」的转换器：输入任意 guard 插件的 `--json` 报告，输出按严重度排序的整改清单；
- 每条命中尽量配：**问题**（title + ruleId + 文件:行）、**依据**（source）、**具体改法**（步骤 / 改前改后片段）、**预计工时**、**改完怎么验**（重跑哪条命令、哪个 ruleId 应消失）；
- 一份**可交付的 Markdown 整改清单**（`--out`），能直接放进整改报告附件；
- 对 recipe 里声明了 `autoApply` 的规则，提供**有边界的机械修改**：默认 dry-run 只打印「将改什么」，`--apply` 才写盘。

**不是**：

- ❌ **不是扫描器** —— 它没有 `rules/`，不新增判据；问题从报告来，验证靠重跑原插件；
- ❌ **不替你判断违规** —— 报告和建议都是提示确认，不是安全结论、合规结论或违规判定；
- ❌ **不保证「照做就合规」** —— 改法给的是常见落地路径，具体条款适用、业务取舍仍需人工确认；
- ❌ **不乱改文件** —— 只处理 recipe 里声明过的 `autoApply`，未声明的文件一个字节都不碰；
- ❌ **不编假改法** —— 没有 recipe 的规则会明说「本条暂无专用改法」，回引原报告 advice，并提示 `--list-recipes`。

---

## 安装与使用

```bash
# 通常随深鲸守护插件一起安装；单独装：
dsh plugin --profile web add @deepwhale-cn/dsh-remediation

# 1) 跑任意守护插件，拿 JSON 报告
dsh-cn-log-retention --root ./my-project --json > report.json
#   也可以用一键体检的总报告
dsh-guard-suite --json > report.json

# 2) 生成整改清单（默认只打印，不改文件）
dsh-remediation --input report.json --root ./my-project

# 3) 另存可交付的 Markdown
dsh-remediation --input report.json --root ./my-project --out ./整改材料/

# 4) 先看哪些能机械改（dry-run），确认后再落盘
dsh-remediation --input report.json --root ./my-project
dsh-remediation --input report.json --root ./my-project --apply

# 5) 列出已覆盖的规则 id 与一句话改法
dsh-remediation --list-recipes

# 6) JSON 输出（给 CI / 二次处理）
dsh-remediation --input report.json --root ./my-project --json
```

`--rules-from <目录>` 可以追加自己的 recipe 目录（目录下放 `*.json`，可重复指定）。

### 输出长什么样

```
  深鲸守护 · 整改建议 v0.1.0
  ──────────────────────────────────────────────────────────────
  输入     report.json
  项目     /path/to/my-project
  命中     5 条（高 3 · 中 2） · 有专用改法 4 条 · 暂无专用改法 1 条
  自动修改 3 条可机械修改 · dry-run（文件未改动）

  【高】3 条

  1. 🔴 日志留存期短于法定 6 个月
     规则    LOG-RETENTION-SHORT · logger.js:2
     依据    《中华人民共和国网络安全法》第二十一条第（三）项 —— 网络日志不少于六个月
     现状    maxDays: 7
     改法
       1) 确认命中的是合规日志留存配置，不是排障用的短期轮转 —— 两者要分开配置。
       2) 把留存天数改为 ≥180 天（6 个月按 180 天算）。
       ...
     改前 → 改后（yaml）
       - retentionDays: 30
       + retentionDays: 180  # 网络安全法：网络日志不少于 6 个月
     工时    5 分钟
     验证    重跑 dsh-cn-log-retention --root <项目>，LOG-RETENTION-SHORT 应消失
     自动修改 ⏳ 可机械修改（dry-run）：将改写 1 个文件（1 处）；加 --apply 才落盘
```

没有 recipe 的规则长这样（不会编一个假改法）：

```
     改法    本条暂无专用改法。
             原报告建议：<该 finding 的 advice 原文>
             可用 --list-recipes 查看已覆盖的规则；这条需要按上面的建议人工判断。
     工时    待评估（暂无专用改法）
     验证    按原报告建议人工处理后，重跑原命令，确认 XXX 不再出现
```

---

## autoApply 的安全边界

| 边界 | 行为 |
|---|---|
| 默认模式 | **dry-run**：只计算「会改哪个文件、改哪一行」，不写盘 |
| 落盘条件 | 必须显式 `--apply` |
| 备份 | 写盘前先备份为 `<file>.bak-<YYYYmmdd-HHMMSS>`；同一文件一次运行只留一份原始备份 |
| 修改范围 | 只处理 recipe 里声明的 `autoApply`：`newFile` 只创建声明路径，`setValue` 只改 glob 命中的文件 |
| 路径约束 | 所有目标必须落在 `--root` 之内，越界直接拒绝 |
| 已存在文件 | `newFile` 遇到同名文件不覆盖 |
| 找不到匹配 | `setValue` 的 pattern 匹配不到时不臆造修改，明确报告「未找到可改写的位置」 |
| 不做的事 | 不改未声明文件、不执行任意脚本、不联网、不删除文件 |

两种 `autoApply`：

```json
{"type": "newFile", "path": "LICENSE", "template": "mit"}
```

```json
{"type": "setValue",
 "glob": "**/*.{yml,yaml,json,env,conf,properties}",
 "pattern": "((?:retentionDays|maxDays)\\s*[:=]\\s*[\"']?)(\\d{1,3})",
 "after": "180"}
```

`setValue` 的约定：pattern **最后一个捕获组**是要被替换的值；`after` 是替换后的文本。
这样 `retentionDays: 30` 会变成 `retentionDays: 180`，而 key 保持原样。

---

## recipes：已覆盖的规则（42 条）

recipe 是本插件唯一的资产：每条规则一份，写清改法、工时、验证命令，可选声明 `autoApply`。
`--list-recipes` 可以随时查看当前版本覆盖了哪些规则。

### 行业/地方 high 规则（15 条，全覆盖）

| 插件 | 规则 |
|---|---|
| 医疗 | `MED-EMR-RETENTION-1` `MED-EMR-RETENTION-2` `MED-EMR-AUDIT-TRAIL-1` `MED-EMR-AUDIT-TRAIL-2` `MED-PRESCRIPTION-RETENTION` |
| 教育 | `EDU-APP-FILING-PUBLIC` `EDU-SCORE-RANK-PUBLIC` `EDU-AD-GAME-SDK` `EDU-STUDENT-ID-EXPOSURE` |
| 金融 | `FIN-PAY-SENSITIVE-RETENTION` `FIN-AUTH-PLAINTEXT` `FIN-AMC-10Y` `FIN-CLIENT-LOCAL-STORE` |
| 地方 | `LR-SZ-26` `LR-SZ-73` |

### 高频通用规则（27 条）

`LOG-RETENTION-SHORT` `LOG-DISABLED` `LOG-SENSITIVE` `FILING-NO-ICP` `FILING-NO-APP`
`FILING-NO-PRIVACY-ENTRY` `FILING-NO-OPERATOR` `LIC-SELF-FILE` `ENV-NOT-IGNORED`
`SBOM-NO-LIST` `DEP-NO-LOCKFILE` `CI-WRITE-ALL` `CI-UNPINNED-ACTION` `CONSENT-PRECHECKED`
`MLPS-DEFAULT-CRED` `CRYPTO-WEAK-HASH` `PII-IDCARD` `RIGHTS-NO-DELETE` `INCIDENT-NO-PLAN`
`CLASSIFY-NO-POLICY` `LIFE-NO-RETENTION-POLICY` `PIPIA-NO-RECORD` `EDU-APP-FILING-RECORD`
`MED-DEVICE-CYBER-POLICY` `MED-HGR-ETHICS-CONSENT-2` `LR-SZ-79` `LR-SZ-80`

其中声明了 `autoApply` 的有 16 条：`LICENSE` 等缺文件类会创建最小模板，
日志留存天数 / 日志级别 / 收银留存期 / CI 权限等配置值类会做定点替换。

> 没覆盖的规则不是「不重要」，而是**还没有可以机械套用的改法**。
> 清单会明说「本条暂无专用改法」并回引原报告 advice，绝不会编造步骤。

---

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 正常（包含 dry-run、apply 成功、`--list-recipes`、`--help`） |
| `2` | 输入缺失 / JSON 坏了 / 缺 `findings[]` / `--root` 不存在 / 参数错误 / recipe 损坏 |

自动修改执行失败（如目标路径越界）会在输出里明确标出，但不改变退出码 2 的语义——
输入本身没问题、清单仍然可用。

---

## 与现有插件不重叠在哪

- 30 多个检查插件负责**发现**问题；本插件负责**把问题变成改法**，不新增任何判据；
- `dsh-guard-suite` 负责**聚合**全套检查；本插件消费它的报告，但不重复扫描；
- `dsh-fix-verify` 负责**复核**改前/改后同一套规则的结果；本插件负责**告诉你怎么改**，
  改完仍建议用 `dsh-fix-verify` 复核；
- `dsh-compliance-doc` 负责**交付文档**；本插件的 `--out 整改清单.md` 可以作为它的输入素材。

---

## 免责声明

本插件输出的是**整改建议与提示确认**，不构成安全结论、合规结论或违规判定。
改法基于常见工程实践与报告中的 source 依据整理，具体条款适用、业务取舍、上线变更仍需人工确认。
未命中的规则不代表项目没有问题；改完请重跑对应检查插件验证。

## 开发与测试

```bash
bash tests/run.sh   # 65 条真断言：清单内容 / dry-run 不改文件 / apply 备份与落盘 / 坏输入 exit 2 / 端到端改掉真实 finding
```

端到端那条最硬：复制 `dsh-cn-log-retention` 的正例样本 → 真插件报 `LOG-RETENTION-SHORT`
→ `dsh-remediation --apply` → 重跑同一插件，断言该 finding 消失。

## License

MIT

## 深鲸网安守护系列（共 39 个）

> 一个插件做一件事。**安全问题是链式的** —— 配套用才完整。

**国内合规**（12）｜ [等保对照](https://github.com/feely0208/dsh-cn-mlps) · [日志留存](https://github.com/feely0208/dsh-cn-log-retention) · [备案公示](https://github.com/feely0208/dsh-cn-filing) · [用户同意](https://github.com/feely0208/dsh-consent-guard) · [个人信息权利](https://github.com/feely0208/dsh-data-rights) · [未成年人保护](https://github.com/feely0208/dsh-minor-guard) · [影响评估](https://github.com/feely0208/dsh-pipia) · [数据分类分级](https://github.com/feely0208/dsh-data-classify) · [算法备案](https://github.com/feely0208/dsh-algorithm-filing) · [数据出境](https://github.com/feely0208/dsh-cn-data-export) · [国密合规](https://github.com/feely0208/dsh-cn-crypto) · [AI 内容标识](https://github.com/feely0208/dsh-cn-ai-labeling)

**AI 与 Agent 治理**（6）｜ [AI 输出信任](https://github.com/feely0208/dsh-ai-output-trust) · [外部内容信任](https://github.com/feely0208/dsh-content-trust) · [MCP 安全](https://github.com/feely0208/dsh-mcp-audit) · [Agent 权限](https://github.com/feely0208/dsh-agent-scope) · [策略核对](https://github.com/feely0208/dsh-agent-policy) · [可疑指令](https://github.com/feely0208/dsh-phishing-guard)

**数据与凭据**（5）｜ [敏感数据](https://github.com/feely0208/dsh-data-scan) · [密钥轮换](https://github.com/feely0208/dsh-key-rotate) · [数据留存](https://github.com/feely0208/dsh-data-lifecycle) · [配置审计](https://github.com/feely0208/dsh-env-audit) · [密钥扫描](https://github.com/feely0208/dsh-secret-scan)

**供应链与构建**（5）｜ [开源许可](https://github.com/feely0208/dsh-license-guard) · [依赖投毒](https://github.com/feely0208/dsh-dep-audit) · [CI 安全](https://github.com/feely0208/dsh-ci-guard) · [工具审查](https://github.com/feely0208/dsh-tool-vet) · [物料清单](https://github.com/feely0208/dsh-sbom)

**权限与应急**（3）｜ [最小权限](https://github.com/feely0208/dsh-least-privilege) · [告警外发](https://github.com/feely0208/dsh-alert-relay) · [应急证据包](https://github.com/feely0208/dsh-incident-package)

**行业专项**（4）｜ [医疗行业专项](https://github.com/feely0208/dsh-industry-medical) · [教育行业专项](https://github.com/feely0208/dsh-industry-education) · [金融行业专项](https://github.com/feely0208/dsh-industry-finance) · [地方数据条例](https://github.com/feely0208/dsh-local-regulation)

**编排与交付**（4）｜ [一键体检](https://github.com/feely0208/dsh-guard-suite) · [改前改后复核](https://github.com/feely0208/dsh-fix-verify) · [合规可交付文档](https://github.com/feely0208/dsh-compliance-doc) · [整改建议](https://github.com/feely0208/dsh-remediation)

都在 DSH 插件市场（dsh-plugin.org）、npm 和 deepwhale.org.cn/guard.html 上。

---

<p align="right"><a href="https://deepwhale.org.cn"><img src="https://www.deepwhale.org.cn/images/badge/deepwhale-badge.png" alt="powered by dwh" height="20"></a></p>
