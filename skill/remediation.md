# 整改建议（dsh-remediation）

**什么时候用**：用户已经拿到一份守护插件的检查报告（`--json`），
但看完还是不知道「到底改成什么样」。用户会说：

- 「这些问题怎么改」「给我一个整改方案」「按这个报告出整改清单」
- 「这条 `LOG-RETENTION-SHORT` 到底要改成多少天」
- 「哪些能直接帮我改掉」「改完怎么确认真的修好了」
- 「把检查结果整理成能交出去的整改材料」

**核心分工**：别的插件告诉你「哪有问题」，这个插件告诉你「到底怎么改 + 改完怎么验」。

## 怎么用

```bash
# 0) 先准备一份报告：任意 guard 插件的 --json，或 dsh-guard-suite 的总报告
dsh-cn-log-retention --root ./my-project --json > report.json
dsh-guard-suite --root ./my-project --json > report.json

# 1) 生成整改清单（默认只打印，不改任何文件）
<cli 路径> --input report.json --root ./my-project

# 2) 另存可交付的 Markdown
<cli 路径> --input report.json --root ./my-project --out ./整改材料/
#    → ./整改材料/整改清单.md

# 3) 看哪些能机械改（dry-run 会打印「将改什么」）
<cli 路径> --input report.json --root ./my-project

# 4) 确认后落盘（会先备份、只改声明过的文件）
<cli 路径> --input report.json --root ./my-project --apply

# 5) 看已覆盖哪些规则、一句话改法
<cli 路径> --list-recipes

# 6) JSON 输出（给 CI / 二次处理）
<cli 路径> --input report.json --root ./my-project --json

# 7) 追加自己的 recipe 目录（目录下放 *.json）
<cli 路径> --input report.json --root ./my-project --rules-from ./my-recipes
```

`--root` 不传时，先取报告里的 `stats.root`，再退回当前目录。

## 清单怎么读

每条问题按严重度（critical → high → medium → low）排序，固定五段：

| 段落 | 看什么 |
|---|---|
| 问题 | `title` + `ruleId` + `文件:行`，先确认它落在哪个文件 |
| 依据 | 报告里的 `source`，要核对原始条款就顺着这条查 |
| 改法 | 具体步骤；有代码/配置的会给「改前 → 改后」片段 |
| 工时 | 5 分钟 / 30 分钟 / 1 小时 / 需要业务决策 |
| 验证 | 重跑哪条命令、哪个 `ruleId` 应该消失 |

**有 recipe 的规则**：按步骤改，改完执行「验证」里的重跑命令，确认该 ruleId 不再出现。

**没有 recipe 的规则**：清单会写「本条暂无专用改法」，并回引原报告 advice。
这时不要照抄通用模板——先按 advice 判断适用性；`--list-recipes` 可以确认到底有没有专用改法。
**没有专用改法不是「不用改」，是「需要人工判断」。**

## --apply 的安全边界

| 边界 | 行为 |
|---|---|
| 默认 | **dry-run**，一个字节都不写，只打印「将改什么」 |
| 落盘 | 必须显式加 `--apply` |
| 备份 | 写盘前备份为 `<file>.bak-<YYYYmmdd-HHMMSS>`；同一文件一次运行只留一份原始备份 |
| 范围 | 只处理 recipe 里声明的 `autoApply`：`newFile` 只创建声明路径；`setValue` 只改 glob 命中的文件 |
| 路径 | 目标必须在 `--root` 之内，越界拒绝 |
| 冲突 | `newFile` 遇到同名文件不覆盖；`setValue` 找不到匹配就明确报告，不臆造修改 |
| 不做 | 不改未声明文件、不执行脚本、不联网、不删除文件 |

`--apply` 之后仍要重跑原插件验证；机械修改只保证「按 recipe 改到位」，
不保证业务上一定正确（例如某个配置值是否被上游覆盖，仍要人工确认）。

## 已覆盖的规则

`--list-recipes` 输出实时清单。当前版本 42 条 recipe：

- **4 个新行业/地方插件的全部 15 条 high 规则**：医疗 EMR 保存/审计/处方 5 条、教育备案公示/成绩排名/广告 SDK/学籍号 4 条、金融支付敏感信息/明文鉴别信息/十年留存/客户端本地存储 4 条、深圳去标识化与数据安全责任人 2 条；
- **27 条高频通用规则**：日志留存与级别、ICP/APP 备案、隐私入口、LICENSE、.env 忽略、
  SBOM、lockfile、CI 权限与 action 固定、同意默认勾选、默认口令、弱哈希、身份证号、
  删除权、应急预案、分类分级、留存期限、影响评估、备案信息表、医疗设备制度、
  知情同意模板、数据共享/销毁制度等。

其中 16 条声明了 `autoApply`：缺文件类创建最小模板，配置值类做定点替换。

## 它不查什么 / 不做什么

- ❌ 不新增判据：没有 `rules/`，问题只来自你给的报告；报告里没有的规则它不会自己发现；
- ❌ 不判违规：输出是提示确认，不是安全结论 / 合规结论；
- ❌ 不保证「照做就合规」：具体条款适用与业务取舍仍需人工确认；
- ❌ 不自动处理未声明 `autoApply` 的规则：只给步骤，不动文件；
- ❌ 不做改前改后复核：那是 `dsh-fix-verify` 的活；交付文档格式化是 `dsh-compliance-doc` 的活。

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 正常（dry-run / apply 成功 / `--list-recipes` / `--help`） |
| `2` | 输入缺失 / JSON 坏了 / 缺 `findings[]` / `--root` 不存在 / 参数错误 / recipe 损坏 |

坏输入一律 exit 2，不会把「报告读不懂」输出成「没有需要整改的问题」。
