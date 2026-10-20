/**
 * 把「任意 guard 插件的 --json 报告」整理成整改清单模型。
 *
 * 输入只认 findings[]（单插件报告和 suite 总报告都是这个形状）。
 * 输出保留 finding 原始字段，并挂上 recipe 与 autoApply 执行结果。
 */

export const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
export const SEV_LABEL = { critical: '致命', high: '高', medium: '中', low: '低', info: '提示' };
export const SEV_ICON = { critical: '💀', high: '🔴', medium: '🟡', low: '🔵', info: '⚪' };

export function normalizeFindings(report) {
  const findings = Array.isArray(report) ? report : report?.findings;
  if (!Array.isArray(findings)) return null;
  return findings.map((f) => ({
    ruleId: String(f.ruleId || '(缺少 ruleId)'),
    title: String(f.title || '(缺少 title)'),
    severity: SEV_ORDER.includes(f.severity) ? f.severity : 'medium',
    source: String(f.source || ''),
    advice: String(f.advice || ''),
    file: String(f.file || ''),
    line: Number.isFinite(f.line) ? f.line : 0,
    evidence: String(f.evidence || ''),
    excerpt: String(f.excerpt || ''),
  }));
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const d = SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
    if (d !== 0) return d;
    return (a.file + ':' + a.line).localeCompare(b.file + ':' + b.line) || a.ruleId.localeCompare(b.ruleId);
  });
}

export function buildModel({ input, report, root, recipes, applyRun, meta = {} }) {
  const findings = normalizeFindings(report);
  const resultByRule = new Map((applyRun?.results || []).map((r) => [r.ruleId, r]));
  const items = sortFindings(findings).map((f) => {
    const recipe = recipes.get(f.ruleId) || null;
    return {
      ...f,
      recipe,
      autoApply: recipe?.autoApply ? resultByRule.get(f.ruleId) || null : null,
    };
  });

  const bySeverity = {};
  for (const f of items) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  const covered = items.filter((i) => i.recipe).length;
  const autoApplicable = new Set(items.filter((i) => i.autoApply).map((i) => i.ruleId)).size;
  const applied = new Set(
    (applyRun?.results || []).filter((r) => r.status === 'applied').map((r) => r.ruleId)
  ).size;
  const wouldApply = new Set(
    (applyRun?.results || []).filter((r) => r.status === 'would-apply').map((r) => r.ruleId)
  ).size;

  return {
    tool: meta.name || 'dsh-remediation',
    version: meta.version || '0.0.0',
    generatedAt: new Date().toISOString(),
    input: input || '',
    root: root || '',
    summary: {
      findings: items.length,
      covered,
      uncovered: items.length - covered,
      autoApplicable,
      applied,
      wouldApply,
      applyMode: applyRun?.mode || 'dry-run',
      bySeverity,
      recipesLoaded: recipes.size,
    },
    items,
    apply: applyRun || null,
  };
}
