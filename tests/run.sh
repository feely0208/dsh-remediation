#!/bin/bash
# dsh-remediation · 真行为验证
#
# 这个插件没有 rules/，所以不能用「正例必报 / 反例 0 命中」那套。
# 它的真行为是四件事，每件都必须有断言：
#   1. 有 recipe 的规则输出「具体改法 / 工时 / 验证方式」；
#   2. 没 recipe 的规则明说「本条暂无专用改法」，不许编假改法；
#   3. 默认 dry-run 一个字节都不写，--apply 才落盘、先备份、只碰声明文件；
#   4. 端到端：真插件报出的问题，--apply 之后重跑真插件，该 finding 消失。
set -uo pipefail
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
ROOT="$PWD"
PASS=0; FAIL=0
ok(){ echo "  ✅ $1"; PASS=$((PASS+1)); }
bad(){ echo "  ❌ $1"; FAIL=$((FAIL+1)); }

TMPBASE=$(mktemp -d "$ROOT/tests/.tmp.XXXXXX") || { echo "无法创建临时目录"; exit 1; }
trap 'rm -rf "$TMPBASE"' EXIT
CLI="$ROOT/bin/cli.mjs"
REPORT="$ROOT/tests/fixtures/report.json"
PROJECT="$ROOT/tests/fixtures/project"
LOG_PLUGIN="$ROOT/../dsh-cn-log-retention"

hashdir() { # hashdir <dir>
  python3 - "$1" <<'PY'
import hashlib, os, sys
root = sys.argv[1]
h = hashlib.sha256()
for base, dirs, files in os.walk(root):
    dirs.sort(); files.sort()
    for name in files:
        p = os.path.join(base, name)
        rel = os.path.relpath(p, root)
        h.update(rel.encode())
        with open(p, 'rb') as f:
            h.update(f.read())
print(h.hexdigest())
PY
}

echo ""; echo "  $(node -p "require('./package.json').name") · 整改建议行为验证"
echo "  ────────────────────────────────────────────────"
echo ""; echo "  【0】本插件不新增判据"
[ ! -d rules ] && ok "没有 rules/ 目录（问题来自其它插件，改法来自 recipes/）" || bad "不应存在 rules/ 目录"

echo ""; echo "  【1】--list-recipes：覆盖数量与 15 条 high 规则"
LIST=$(node "$CLI" --list-recipes 2>&1)
E=$?
[ "$E" = "0" ] && ok "--list-recipes 正常退出" || bad "--list-recipes 退出码 $E"
N=$(echo "$LIST" | grep -oE '已覆盖 [0-9]+ 条规则' | grep -oE '[0-9]+' | head -1)
[ "${N:-0}" -ge 25 ] && ok "已覆盖 ${N} 条规则（要求 ≥25）" || bad "recipe 数量不足：${N:-0}"
for rid in MED-EMR-RETENTION-1 MED-EMR-RETENTION-2 MED-EMR-AUDIT-TRAIL-1 MED-EMR-AUDIT-TRAIL-2 \
           MED-PRESCRIPTION-RETENTION EDU-APP-FILING-PUBLIC EDU-SCORE-RANK-PUBLIC \
           EDU-AD-GAME-SDK EDU-STUDENT-ID-EXPOSURE FIN-PAY-SENSITIVE-RETENTION \
           FIN-AUTH-PLAINTEXT FIN-AMC-10Y FIN-CLIENT-LOCAL-STORE LR-SZ-26 LR-SZ-73; do
  echo "$LIST" | grep -q "$rid" && ok "覆盖 $rid" || bad "缺 high 规则改法：$rid"
done

# 用真实插件规则反查：4 个新插件里的全部 high 规则都必须有 recipe
python3 - <<'PY' && ok "4 个新插件的全部 high 规则均有 recipe" || bad "有 high 规则没有 recipe（见上）"
import glob, json, os, sys
plugins = ['dsh-industry-medical', 'dsh-industry-education', 'dsh-industry-finance', 'dsh-local-regulation']
missing, checked = [], 0
for p in plugins:
    for f in glob.glob(os.path.join('..', p, 'rules', '*.json')):
        d = json.load(open(f, encoding='utf-8'))
        if d.get('severity') != 'high':
            continue
        checked += 1
        if not os.path.exists(os.path.join('recipes', d['id'] + '.json')):
            missing.append(d['id'])
if missing:
    print('缺 recipe 的 high 规则：', ', '.join(missing), file=sys.stderr)
    sys.exit(1)
print(f'（核对了 {checked} 条 high 规则）')
PY

echo ""; echo "  【2】默认 dry-run：清单内容 + 文件一个字节都不改"
H1=$(hashdir "$PROJECT")
OUT="$TMPBASE/dryrun.txt"
node "$CLI" --input "$REPORT" --root "$PROJECT" > "$OUT" 2>&1
E=$?
H2=$(hashdir "$PROJECT")
[ "$E" = "0" ] && ok "dry-run 退出码 0" || bad "dry-run 退出码 $E"
[ "$H1" = "$H2" ] && ok "dry-run 后项目文件 hash 不变" || bad "dry-run 改动了文件（hash 变了）"
[ ! -e "$PROJECT/LICENSE" ] && ok "dry-run 没有创建 LICENSE" || bad "dry-run 不应创建 LICENSE"

grep -q '改法' "$OUT" && ok "清单包含「改法」段落" || bad "清单缺少改法"
grep -q '把留存天数改为 ≥180 天' "$OUT" && ok "LOG-RETENTION-SHORT 给出具体步骤" || bad "缺 LOG-RETENTION-SHORT 具体步骤"
grep -q '重跑 dsh-cn-log-retention --root' "$OUT" && ok "给出「改完怎么验」的重跑命令" || bad "缺验证命令"
grep -q '5 分钟' "$OUT" && ok "给出预计工时（5 分钟）" || bad "缺预计工时"
grep -q '1 小时' "$OUT" && ok "给出预计工时（1 小时）" || bad "缺 1 小时工时"
grep -q '本条暂无专用改法' "$OUT" && ok "无 recipe 的规则明说「本条暂无专用改法」" || bad "无 recipe 时没有兜底文案"
grep -q '原报告建议' "$OUT" && ok "无 recipe 时回引原报告 advice" || bad "无 recipe 时没有回引 advice"
grep -q -- '--list-recipes' "$OUT" && ok "无 recipe 时提示 --list-recipes" || bad "无 recipe 时没有提示 --list-recipes"
grep -q 'dry-run' "$OUT" && ok "明确标注 dry-run" || bad "没有标注 dry-run"
grep -q '将改写 1 个文件' "$OUT" && ok "dry-run 打印「将改什么」" || bad "dry-run 没有打印将改内容"

J=$(node "$CLI" --input "$REPORT" --root "$PROJECT" --json 2>"$TMPBASE/json.err")
echo "$J" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['summary']['findings']==5; assert d['summary']['covered']==4; assert d['summary']['uncovered']==1; assert d['summary']['autoApplicable']==3; assert d['summary']['applyMode']=='dry-run'" 2>/dev/null \
  && ok "--json 统计正确（5 命中 / 4 有改法 / 1 无改法 / 3 可自动改）" \
  || { bad "--json 统计不对"; echo "$J" | head -5; }

echo ""; echo "  【3】--out 生成可交付 Markdown"
node "$CLI" --input "$REPORT" --root "$PROJECT" --out "$TMPBASE/out" >/dev/null 2>&1
[ -f "$TMPBASE/out/整改清单.md" ] && ok "生成 整改清单.md" || bad "没有生成 整改清单.md"
MD="$TMPBASE/out/整改清单.md"
grep -q '^# 整改清单' "$MD" && ok "Markdown 标题正确" || bad "Markdown 标题不对"
grep -q '本条暂无专用改法' "$MD" && ok "Markdown 含无 recipe 兜底文案" || bad "Markdown 缺兜底文案"
grep -q '具体改法' "$MD" && ok "Markdown 含具体改法" || bad "Markdown 缺具体改法"

echo ""; echo "  【4】--apply：创建文件 / 改配置值 / 先备份 / 只碰声明文件"
APPLY_PROJ="$TMPBASE/apply-project"
cp -R "$PROJECT" "$APPLY_PROJ"
APPLY_OUT="$TMPBASE/apply.txt"
node "$CLI" --input "$REPORT" --root "$APPLY_PROJ" --apply > "$APPLY_OUT" 2>&1
E=$?
[ "$E" = "0" ] && ok "--apply 退出码 0" || bad "--apply 退出码 $E"
[ -f "$APPLY_PROJ/LICENSE" ] && ok "newFile 创建了 LICENSE" || bad "LICENSE 未创建"
grep -q 'maxDays: 180' "$APPLY_PROJ/logger/logger.js" && ok "setValue 把 maxDays 改成 180" || bad "maxDays 未改写"
grep -q "level: 'info'" "$APPLY_PROJ/logger/logger.js" && ok "setValue 把 level 改成 info" || bad "level 未改写"
BAK=$(ls "$APPLY_PROJ"/logger/logger.js.bak-* 2>/dev/null | head -1)
[ -n "${BAK:-}" ] && ok "生成了 .bak-<时间戳> 备份" || bad "没有生成备份"
grep -q 'maxDays: 7' "$BAK" 2>/dev/null && ok "备份保留的是改前内容" || bad "备份内容不是改前原文"
grep -q '已创建 LICENSE' "$APPLY_OUT" && ok "输出显示已创建 LICENSE" || bad "输出没有创建记录"
grep -q '备份 logger/logger.js.bak-' "$APPLY_OUT" && ok "输出显示备份路径" || bad "输出没有备份路径"
grep -q "+ const cfg = { level: 'info', maxDays: 180 };" "$APPLY_OUT" && ok "输出含 unified diff 风格的 + 行" || bad "输出缺 + 行"
grep -q -- '- const cfg = { level: .off., maxDays: 7 };' "$APPLY_OUT" && ok "输出含 unified diff 风格的 - 行" || bad "输出缺 - 行"
[ -f "$APPLY_PROJ/config/retention.yaml" ] && grep -q 'prescription_retention_days: 180' "$APPLY_PROJ/config/retention.yaml" \
  && ok "未声明 autoApply 的规则没有乱改文件" || bad "改动了未声明 autoApply 的文件"
# 幂等：再跑一次不应再改（没有新备份、内容不变）
H3=$(hashdir "$APPLY_PROJ")
node "$CLI" --input "$REPORT" --root "$APPLY_PROJ" --apply > "$TMPBASE/apply2.txt" 2>&1
H4=$(hashdir "$APPLY_PROJ")
NB=$(ls "$APPLY_PROJ"/logger/logger.js.bak-* 2>/dev/null | wc -l | tr -d ' ')
[ "$H3" = "$H4" ] && ok "重复 --apply 幂等（文件不再变化）" || bad "重复 --apply 又改了文件"
[ "$NB" = "1" ] && ok "重复 --apply 不产生重复备份" || bad "重复 --apply 产生了 ${NB} 个备份"

echo ""; echo "  【5】坏输入：必须 exit 2（不许把「读不懂」当成「没问题」）"
node "$CLI" --input "$TMPBASE/nope.json" >/dev/null 2>&1
[ "$?" = "2" ] && ok "输入文件不存在 → exit 2" || bad "输入文件不存在时退出码不是 2"
echo '{ this is not json' > "$TMPBASE/broken.json"
node "$CLI" --input "$TMPBASE/broken.json" >/dev/null 2>&1
[ "$?" = "2" ] && ok "JSON 坏了 → exit 2" || bad "坏 JSON 退出码不是 2"
echo '{"name":"no-findings"}' > "$TMPBASE/no-findings.json"
node "$CLI" --input "$TMPBASE/no-findings.json" >/dev/null 2>&1
[ "$?" = "2" ] && ok "缺 findings[] → exit 2" || bad "缺 findings 退出码不是 2"
node "$CLI" >/dev/null 2>&1
[ "$?" = "2" ] && ok "缺 --input → exit 2" || bad "缺 --input 退出码不是 2"
node "$CLI" --bogus >/dev/null 2>&1
[ "$?" = "2" ] && ok "未知参数 → exit 2" || bad "未知参数退出码不是 2"

echo ""; echo "  【6】端到端：真插件报出 → --apply → 重跑同一插件，finding 必须消失"
if [ ! -d "$LOG_PLUGIN" ]; then
  bad "找不到 dsh-cn-log-retention（$LOG_PLUGIN），端到端无法验证"
else
  E2E="$TMPBASE/e2e"
  cp -R "$LOG_PLUGIN/tests/fixtures/fail/demo-project" "$E2E"
  node "$LOG_PLUGIN/bin/cli.mjs" --root "$E2E" --json > "$TMPBASE/e2e-before.json" 2>/dev/null
  B=$(python3 -c "
import json
d=json.load(open('$TMPBASE/e2e-before.json'))
print(len([f for f in d.get('findings',[]) if f.get('ruleId')=='LOG-RETENTION-SHORT']))" 2>/dev/null)
  [ "${B:-0}" -gt 0 ] && ok "改前：dsh-cn-log-retention 报出 LOG-RETENTION-SHORT（${B} 处）" || bad "改前就没有报 LOG-RETENTION-SHORT，端到端前提不成立"

  node "$CLI" --input "$TMPBASE/e2e-before.json" --root "$E2E" --apply > "$TMPBASE/e2e-apply.txt" 2>&1
  AE=$?
  [ "$AE" = "0" ] && ok "整改命令执行成功（exit 0）" || bad "整改命令失败（exit $AE）"
  grep -q '已改写 1 个文件' "$TMPBASE/e2e-apply.txt" && ok "端到端：实际改写了文件" || bad "端到端：没有改写记录"
  ls "$E2E"/logger.js.bak-* >/dev/null 2>&1 && ok "端到端：落盘前已备份" || bad "端到端：没有备份"

  node "$LOG_PLUGIN/bin/cli.mjs" --root "$E2E" --json > "$TMPBASE/e2e-after.json" 2>/dev/null
  A=$(python3 -c "
import json
d=json.load(open('$TMPBASE/e2e-after.json'))
print(len([f for f in d.get('findings',[]) if f.get('ruleId')=='LOG-RETENTION-SHORT']))" 2>/dev/null)
  [ "${A:-1}" = "0" ] && ok "改后：重跑 dsh-cn-log-retention，LOG-RETENTION-SHORT 消失 ✅" || bad "改后 LOG-RETENTION-SHORT 仍在（${A} 处）—— 改法是假的"
  grep -q 'maxDays: 180' "$E2E/logger.js" && ok "端到端：logger.js 已写为 180 天" || bad "端到端：logger.js 没改到 180"
fi

echo ""; echo "  【7】recipe 资产体检"
python3 - <<'PY' && ok "42 个 recipe 结构完整（ruleId/title/effort/steps/verify）" || bad "recipe 结构有问题（见上）"
import glob, json, os, sys
bad = []
auto_types = {'newFile', 'setValue'}
for f in glob.glob('recipes/*.json'):
    d = json.load(open(f, encoding='utf-8'))
    for k in ('ruleId', 'title', 'effort', 'steps', 'verify'):
        if not d.get(k):
            bad.append(f'{os.path.basename(f)} 缺 {k}')
    if d.get('ruleId') and os.path.basename(f) != d['ruleId'] + '.json':
        bad.append(f'{os.path.basename(f)} 文件名与 ruleId 不一致')
    if d.get('autoApply'):
        t = d['autoApply'].get('type')
        if t not in auto_types:
            bad.append(f'{d["ruleId"]} autoApply.type={t} 不合法')
        if t == 'newFile' and not (d['autoApply'].get('path') and (d['autoApply'].get('template') or d['autoApply'].get('content'))):
            bad.append(f'{d["ruleId"]} newFile 缺 path/template')
        if t == 'setValue' and not (d['autoApply'].get('glob') and d['autoApply'].get('pattern')):
            bad.append(f'{d["ruleId"]} setValue 缺 glob/pattern')
if bad:
    print('\n'.join(bad), file=sys.stderr)
    sys.exit(1)
print(f'（{len(glob.glob("recipes/*.json"))} 个 recipe 文件）')
PY
AUTON=$(grep -l '"autoApply"' recipes/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "${AUTON:-0}" -ge 10 ] && ok "声明了 autoApply 的 recipe ${AUTON} 条（机械修改不是摆设）" || bad "autoApply recipe 太少：${AUTON:-0}"
node --input-type=module -e "
import { readFileSync, readdirSync } from 'node:fs';
import { TEMPLATES } from './lib/templates.mjs';
const bad = [];
for (const f of readdirSync('recipes').filter((n) => n.endsWith('.json'))) {
  const r = JSON.parse(readFileSync('recipes/' + f, 'utf-8'));
  if (r.autoApply?.type === 'newFile' && r.autoApply.template && !TEMPLATES[r.autoApply.template]) {
    bad.push(r.ruleId + ' → 未知模板 ' + r.autoApply.template);
  }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
" 2>/dev/null && ok "newFile 引用的模板都存在" || bad "有 recipe 引用了不存在的模板"

echo ""; echo "  【8】--help 正常"
node "$CLI" --help > "$TMPBASE/help.txt" 2>&1
[ "$?" = "0" ] && grep -q -- '--apply' "$TMPBASE/help.txt" && ok "--help 正常且说明 --apply" || bad "--help 异常"

echo ""; echo "  ────────────────────────────────────────────────"
echo "  通过 $PASS · 失败 $FAIL"; echo ""
[ "$FAIL" -eq 0 ] || exit 1
