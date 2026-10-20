/**
 * 整改清单渲染：文本（stdout）与 Markdown（--out 可交付文件）。
 *
 * 每条都必须给全：问题 / 依据 / 具体改法 / 预计工时 / 改完怎么验。
 * 没有 recipe 的规则要明说「本条暂无专用改法」并回引原报告 advice，
 * 不许编一个看起来像改法的假步骤。
 */

import { SEV_ICON, SEV_LABEL, SEV_ORDER } from './model.mjs';

const RULE = '─'.repeat(66);

function trunc(s, n) {
  const str = String(s || '').replace(/\s+/g, ' ').trim();
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function loc(item) {
  if (!item.file) return '（未给出文件）';
  return item.line ? `${item.file}:${item.line}` : item.file;
}

function sevLine(bySeverity) {
  return SEV_ORDER.filter((s) => bySeverity[s]).map((s) => `${SEV_LABEL[s]} ${bySeverity[s]}`).join(' · ');
}

function autoStatusText(auto, applyMode) {
  if (!auto) return null;
  if (auto.status === 'applied') return `✅ 已执行：${auto.message}`;
  if (auto.status === 'would-apply') return `⏳ 可机械修改（dry-run）：${auto.message}；加 --apply 才落盘`;
  if (auto.status === 'skipped') return `⚠️ 未改动：${auto.message}`;
  return `❌ 执行失败：${auto.message}`;
}

function diffLines(rows) {
  const out = [];
  for (const r of rows) {
    out.push(`${r.kind === 'add' ? '+' : '-'} ${r.text}`);
  }
  return out;
}

function applyDetailLines(auto, applyMode) {
  const out = [];
  for (const f of auto?.files || []) {
    const backup = f.backup ? `（备份 ${f.backup}）` : '';
    out.push(`  · ${f.created ? '新文件' : '改写'} ${f.path}${backup}`);
    for (const line of diffLines(f.changes)) out.push(`    ${line}`);
  }
  return out;
}

export function textReport(model) {
  const L = [];
  const s = model.summary;
  L.push('');
  L.push(`  ${model.tool === 'dsh-remediation' ? '深鲸守护 · 整改建议' : model.tool} v${model.version}`);
  L.push(`  ${RULE}`);
  L.push(`  输入     ${model.input}`);
  L.push(`  项目     ${model.root}`);
  L.push(
    `  命中     ${s.findings} 条${s.findings ? `（${sevLine(s.bySeverity)}）` : ''}` +
      ` · 有专用改法 ${s.covered} 条 · 暂无专用改法 ${s.uncovered} 条`
  );
  if (s.autoApplicable) {
    L.push(
      `  自动修改 ${s.autoApplicable} 条可机械修改 · ` +
        (s.applyMode === 'apply' ? `已执行 ${s.applied} 条` : 'dry-run（文件未改动）')
    );
  }
  L.push('');

  if (!s.findings) {
    L.push('  ✅ 这份报告里没有 findings，无需整改。');
    L.push('     注意：未命中不等于项目没有问题，只代表这套规则这次没报。');
    L.push('');
    return L.join('\n');
  }

  if (model.apply?.mode === 'apply') {
    L.push('  ── 自动修改结果 ────────────────────────────────');
    if (!model.apply.results.length) L.push('  （本次没有可自动修改的规则）');
    for (const r of model.apply.results) {
      L.push(`  ${autoStatusText(r, 'apply')}`);
      for (const line of applyDetailLines(r, 'apply')) L.push(line);
    }
    L.push('');
  }

  let index = 0;
  for (const sev of SEV_ORDER) {
    const group = model.items.filter((i) => i.severity === sev);
    if (!group.length) continue;
    L.push(`  【${SEV_LABEL[sev]}】${group.length} 条`);
    L.push('');
    for (const item of group) {
      index++;
      L.push(`  ${index}. ${SEV_ICON[sev]} ${item.title}`);
      L.push(`     规则    ${item.ruleId} · ${loc(item)}`);
      if (item.source) L.push(`     依据    ${trunc(item.source, 140)}`);
      if (item.evidence) L.push(`     现状    ${trunc(item.evidence, 120)}`);
      if (item.recipe) {
        L.push('     改法');
        item.recipe.steps.forEach((step, i) => L.push(`       ${i + 1}) ${step}`));
        for (const sn of item.recipe.snippets || []) {
          L.push(`     改前 → 改后（${sn.lang || 'text'}）`);
          for (const line of String(sn.before ?? '').split('\n')) L.push(`       - ${line}`);
          for (const line of String(sn.after ?? '').split('\n')) L.push(`       + ${line}`);
        }
        L.push(`     工时    ${item.recipe.effort}`);
        L.push(`     验证    ${item.recipe.verify}`);
        const autoText = autoStatusText(item.autoApply, model.apply?.mode);
        if (autoText) {
          L.push(`     自动修改 ${autoText}`);
          for (const line of applyDetailLines(item.autoApply, model.apply?.mode)) L.push(`       ${line.trim()}`);
        }
      } else {
        L.push('     改法    本条暂无专用改法。');
        if (item.advice) L.push(`             原报告建议：${trunc(item.advice, 260)}`);
        L.push('             可用 --list-recipes 查看已覆盖的规则；这条需要按上面的建议人工判断，不要照抄通用模板。');
        L.push('     工时    待评估（暂无专用改法）');
        L.push(`     验证    按原报告建议人工处理后，重跑原命令，确认 ${item.ruleId} 不再出现`);
      }
      L.push('');
    }
  }

  if (model.apply?.mode !== 'apply' && s.autoApplicable) {
    L.push(`  ${RULE}`);
    L.push('  本次为 dry-run：以上自动修改都没有落盘。');
    L.push('  确认后加 --apply：只会改 recipe 里声明过的文件，落盘前先备份成 <file>.bak-<YYYYmmdd-HHMMSS>。');
    L.push('');
  }

  L.push(`  ${RULE}`);
  L.push('  提示确认，不是判定违规；改法供参考，改完请重跑对应插件验证。');
  L.push('  未命中不等于没有问题；本清单不构成安全结论或合规结论。');
  L.push('');
  return L.join('\n');
}

export function markdownReport(model) {
  const s = model.summary;
  const L = [];
  L.push('# 整改清单');
  L.push('');
  L.push(`> 由 **${model.tool}** v${model.version} 生成于 ${model.generatedAt}`);
  L.push('> 输入报告只用于定位问题；改法来自本插件的 recipes。本清单不构成安全结论或合规结论。');
  L.push('');
  L.push('| 项目 | 内容 |');
  L.push('|---|---|');
  L.push(`| 输入报告 | \`${model.input}\` |`);
  L.push(`| 项目目录 | \`${model.root}\` |`);
  L.push(`| 命中 | ${s.findings} 条${s.findings ? `（${sevLine(s.bySeverity)}）` : ''} |`);
  L.push(`| 有专用改法 | ${s.covered} 条 |`);
  L.push(`| 暂无专用改法 | ${s.uncovered} 条 |`);
  if (s.autoApplicable) {
    L.push(`| 可机械修改 | ${s.autoApplicable} 条（${s.applyMode === 'apply' ? `已执行 ${s.applied} 条` : 'dry-run，未落盘'}） |`);
  }
  L.push('');

  if (!s.findings) {
    L.push('## 无命中');
    L.push('');
    L.push('这份报告里没有 findings，无需整改。注意：未命中不等于项目没有问题。');
    L.push('');
    return L.join('\n');
  }

  if (model.apply?.mode === 'apply') {
    L.push('## 自动修改结果');
    L.push('');
    if (!model.apply.results.length) L.push('本次没有可自动修改的规则。');
    for (const r of model.apply.results) {
      L.push(`- ${autoStatusText(r, 'apply')}`);
      for (const f of r.files || []) {
        L.push(`  - \`${f.path}\`${f.backup ? `（备份 \`${f.backup}\`）` : ''}`);
        if (f.changes?.length) {
          L.push('');
          L.push('```diff');
          for (const line of diffLines(f.changes)) L.push(line);
          L.push('```');
          L.push('');
        }
      }
    }
    L.push('');
  }

  let index = 0;
  for (const sev of SEV_ORDER) {
    const group = model.items.filter((i) => i.severity === sev);
    if (!group.length) continue;
    L.push(`## ${SEV_LABEL[sev]}（${group.length} 条）`);
    L.push('');
    for (const item of group) {
      index++;
      L.push(`### ${index}. ${item.title}`);
      L.push('');
      L.push(`- **规则**：\`${item.ruleId}\` · \`${loc(item)}\``);
      if (item.source) L.push(`- **依据**：${trunc(item.source, 200)}`);
      if (item.evidence) L.push(`- **现状**：\`${trunc(item.evidence, 120)}\``);
      if (item.recipe) {
        L.push('- **具体改法**：');
        item.recipe.steps.forEach((step, i) => L.push(`  ${i + 1}. ${step}`));
        for (const sn of item.recipe.snippets || []) {
          L.push('');
          L.push(`  \`\`\`${sn.lang || 'text'}`);
          for (const line of String(sn.before ?? '').split('\n')) L.push(`  - ${line}`);
          for (const line of String(sn.after ?? '').split('\n')) L.push(`  + ${line}`);
          L.push('  ```');
        }
        L.push(`- **预计工时**：${item.recipe.effort}`);
        L.push(`- **改完怎么验**：${item.recipe.verify}`);
        const autoText = autoStatusText(item.autoApply, model.apply?.mode);
        if (autoText) L.push(`- **自动修改**：${autoText}`);
      } else {
        L.push('- **具体改法**：**本条暂无专用改法。**');
        if (item.advice) L.push(`  - 原报告建议：${item.advice}`);
        L.push('  - 可用 `--list-recipes` 查看已覆盖的规则；这条需要人工判断，不要照抄通用模板。');
        L.push('- **预计工时**：待评估（暂无专用改法）');
        L.push(`- **改完怎么验**：按原报告建议人工处理后，重跑原命令，确认 \`${item.ruleId}\` 不再出现。`);
      }
      L.push('');
    }
  }

  if (model.apply?.mode !== 'apply' && s.autoApplicable) {
    L.push('## 关于自动修改');
    L.push('');
    L.push('本次为 **dry-run**，以上自动修改都没有落盘。确认后加 `--apply`：');
    L.push('只改 recipe 里声明过的文件，落盘前先备份成 `<file>.bak-<YYYYmmdd-HHMMSS>`。');
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('提示确认，不是判定违规。改完请重跑对应插件验证；未命中不等于没有问题。');
  L.push('');
  return L.join('\n');
}
