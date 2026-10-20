#!/usr/bin/env node
/**
 * 深鲸守护 · 整改建议（dsh-remediation）
 *
 * 输入任意 guard 插件的 --json 报告（或 dsh-guard-suite 的总报告），
 * 输出的不是「请整改」，而是「改成什么样、大概多久、改完怎么验」。
 *
 * 本插件不新增任何判据：问题从报告来，改法从 recipes/ 来，验证靠重跑原插件。
 *
 * 退出码：
 *   0  正常
 *   2  输入缺失 / JSON 坏了 / 缺 findings[] / 参数错误 / recipe 损坏
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecipes } from '../lib/recipes.mjs';
import { normalizeFindings, buildModel } from '../lib/model.mjs';
import { runAutoApply } from '../lib/apply.mjs';
import { textReport, markdownReport } from '../lib/render.mjs';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8'));
const TOOL = 'dsh-remediation';
const META = { name: TOOL, version: pkg.version };

function usage() {
  console.log(`
  深鲸守护 · 整改建议（${TOOL}）v${pkg.version}

  ${pkg.description}

  它读一份检查报告，告诉你每条问题「到底怎么改」：
  具体步骤 / 改前改后代码 / 预计工时 / 改完怎么验。

  用法：
    ${TOOL} --input <报告.json> [选项]

  必须：
    --input <file>       任意 guard 插件 --json 报告，或 dsh-guard-suite --json 报告

  常用：
    --root <dir>         项目目录（默认取报告里的 stats.root，否则当前目录）
    --out <dir>          另存可交付的「整改清单.md」到该目录
    --json               以 JSON 输出（给 CI / 二次处理）
    --apply              真正执行 recipe 里声明了 autoApply 的机械修改（默认 dry-run）
    --list-recipes       列出已覆盖的规则 id 与一句话改法
    --rules-from <dir>   追加 recipe 目录（可重复；目录下放 *.json recipe）
    -h, --help           显示帮助

  安全边界：
    · 默认 dry-run：只打印「将改什么」，一个字节都不写
    · --apply 才落盘，且只改 recipe 里声明过的文件
    · 落盘前先备份成 <file>.bak-<YYYYmmdd-HHMMSS>
    · newFile 遇到已存在的文件不覆盖；setValue 找不到匹配时不臆造修改

  退出码：
    0  正常
    2  输入缺失 / JSON 坏了 / 缺 findings[] / 参数错误 / recipe 损坏
`);
}

function die(msg) {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(2);
}

function need(argv, i, arg) {
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) die(`参数 ${arg} 缺少值`);
  return v;
}

function parseArgs(argv) {
  const opt = {
    input: null, root: null, out: null, json: false, apply: false,
    listRecipes: false, rulesFrom: [], help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') { opt.input = need(argv, i, a); i++; }
    else if (a === '--root') { opt.root = need(argv, i, a); i++; }
    else if (a === '--out') { opt.out = need(argv, i, a); i++; }
    else if (a === '--json') opt.json = true;
    else if (a === '--apply') opt.apply = true;
    else if (a === '--list-recipes') opt.listRecipes = true;
    else if (a === '--rules-from') {
      const v = need(argv, i, a);
      opt.rulesFrom.push(...String(v).split(',').map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (a === '-h' || a === '--help') opt.help = true;
    else if (a === '-v' || a === '--version') { console.log(pkg.version); process.exit(0); }
    else die(`不认识的参数：${a}（用 --help 看用法）`);
  }
  return opt;
}

function loadReport(file) {
  if (!existsSync(file)) die(`输入报告不存在：${file}`);
  let st;
  try {
    st = statSync(file);
  } catch (e) {
    die(`无法读取输入报告：${e.message}`);
  }
  if (!st.isFile()) die(`--input 需要是文件，不是目录：${file}`);
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    die(`输入 JSON 解析失败：${file}\n     ${e.message}`);
  }
  if (!normalizeFindings(data)) {
    die(
      `输入 JSON 里没有 findings[] —— 无法生成整改清单。\n` +
        `     请使用 guard 插件的 --json 输出，或 dsh-guard-suite --json 的报告。`
    );
  }
  return data;
}

function resolveRoot(opt, report) {
  const fromReport = report?.stats?.root;
  const chosen = opt.root || fromReport || process.cwd();
  const abs = resolve(process.cwd(), chosen);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    die(`--root 目录不存在：${abs}`);
  }
  return abs;
}

const opt = parseArgs(process.argv.slice(2));
if (opt.help) { usage(); process.exit(0); }

const { recipes, files, errors, duplicates } = loadRecipes({ pkgRoot: PKG_ROOT, extraDirs: opt.rulesFrom });
if (errors.length) {
  console.error('\n  ❌ recipe 校验失败：');
  for (const e of errors) console.error(`     - ${e}`);
  console.error('');
  process.exit(2);
}
if (duplicates.length) {
  console.error('\n  ⚠️  同名 recipe 被覆盖：');
  for (const d of duplicates) console.error(`     - ${d}`);
  console.error('');
}

if (opt.listRecipes) {
  const sorted = [...recipes.values()].sort((a, b) => String(a.ruleId).localeCompare(String(b.ruleId)));
  console.log('');
  console.log(`  已覆盖 ${sorted.length} 条规则（${files.length} 个 recipe 文件）`);
  console.log(`  ${'─'.repeat(70)}`);
  for (const r of sorted) {
    const auto = r.autoApply ? (r.autoApply.type === 'newFile' ? '可新建文件' : '可改配置值') : '只给步骤';
    const fix = String(r.steps?.[0] || '').replace(/\s+/g, ' ');
    console.log(`  ${String(r.ruleId).padEnd(36)} ${String(r.effort).padEnd(10)} ${auto.padEnd(8)} ${fix.slice(0, 42)}`);
  }
  console.log(`  ${'─'.repeat(70)}`);
  console.log('  没有列在这里的规则，清单会明说「本条暂无专用改法」并回引原报告 advice。');
  console.log('');
  process.exit(0);
}

if (!opt.input) {
  die('缺少 --input <报告.json>（不知道要整改哪份报告）\n     用 --list-recipes 先看已覆盖哪些规则，用 --help 看完整用法');
}

const report = loadReport(opt.input);
const root = resolveRoot(opt, report);
const findings = normalizeFindings(report);

// autoApply 先算（apply 与否都算，dry-run 只打印不落盘）
const autoRun = runAutoApply(
  findings.map((f) => ({ finding: f, recipe: recipes.get(f.ruleId) || null })),
  { root, apply: opt.apply }
);
autoRun.mode = opt.apply ? 'apply' : 'dry-run';

const model = buildModel({
  input: opt.input,
  report,
  root,
  recipes,
  applyRun: autoRun,
  meta: META,
});

if (opt.out) {
  const outDir = resolve(process.cwd(), opt.out);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (e) {
    die(`无法创建 --out 目录：${outDir}（${e.message}）`);
  }
  const mdFile = join(outDir, '整改清单.md');
  try {
    writeFileSync(mdFile, markdownReport(model), 'utf-8');
  } catch (e) {
    die(`写入整改清单失败：${mdFile}（${e.message}）`);
  }
  if (opt.json) console.error(`  已生成 ${mdFile}`);
  else console.log(`\n  📄 已生成 ${mdFile}\n`);
}

if (opt.json) {
  console.log(JSON.stringify(model, null, 2));
} else {
  console.log(textReport(model));
}

// 自动修改失败不算退出码 2（输入没问题），但要在输出里明确可见
const failed = autoRun.results.filter((r) => r.status === 'error');
if (failed.length) {
  console.error(`  ⚠️  ${failed.length} 条自动修改执行失败，详见上面的清单。`);
}

process.exit(0);
