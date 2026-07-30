#!/usr/bin/env node
/**
 * Regenerate the workflow index table in README.md from the manifests.
 *
 *   node tooling/bin/gen-readme.mjs          # write
 *   node tooling/bin/gen-readme.mjs --check  # exit 1 if stale (used by CI)
 *
 * The table lives between two HTML comment markers so the rest of the README
 * stays hand-written. CI runs --check, which makes documentation drift a build
 * failure rather than something noticed six months later.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { loadAllWorkflows, REPO_ROOT } from '../lib/manifest.mjs';

const START_MARKER = '<!-- workflow-index:start -->';
const END_MARKER = '<!-- workflow-index:end -->';
const README_PATH = join(REPO_ROOT, 'README.md');

const STATUS_BADGE = {
  live: '🟢 live',
  draft: '🟡 draft',
  archived: '⚪ archived'
};

function buildTable(workflows) {
  if (workflows.length === 0) {
    return '_No workflows yet. Scaffold one with `make new-workflow SLUG=my-flow`._';
  }

  const rows = workflows.map(({ slug, manifest, workflow }) => {
    const status = STATUS_BADGE[manifest.status] ?? manifest.status;
    const trigger = manifest.trigger ?? '—';
    const nodes = workflow.nodes?.length ?? 0;
    const services = (manifest.tags ?? []).join(', ') || '—';
    return `| [${manifest.name}](workflows/${slug}/) | ${status} | ${trigger} | ${nodes} | ${services} |`;
  });

  return [
    '| Workflow | Status | Trigger | Nodes | Services |',
    '| --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n');
}

const workflows = loadAllWorkflows();
const table = buildTable(workflows);
const readme = readFileSync(README_PATH, 'utf8');

const startIndex = readme.indexOf(START_MARKER);
const endIndex = readme.indexOf(END_MARKER);

if (startIndex === -1 || endIndex === -1) {
  console.error(`README.md is missing the ${START_MARKER} / ${END_MARKER} markers.`);
  process.exit(1);
}

const spliced =
  readme.slice(0, startIndex + START_MARKER.length) + '\n' + table + '\n' + readme.slice(endIndex);

// Run the result through Prettier before comparing or writing. Prettier pads
// Markdown table columns and pads blank lines around HTML comments, so a raw
// splice would never equal what `prettier --check` expects — the two would
// rewrite each other forever. Formatting here makes both idempotent.
const updated = await format(spliced, {
  ...(await resolveConfig(README_PATH)),
  filepath: README_PATH
});

if (process.argv.includes('--check')) {
  if (updated !== readme) {
    console.error('README.md workflow index is out of date. Run: make readme');
    process.exit(1);
  }
  console.log('✔ README.md workflow index is current');
  process.exit(0);
}

if (updated === readme) {
  console.log('= README.md workflow index already current');
} else {
  writeFileSync(README_PATH, updated, 'utf8');
  console.log(`~ README.md workflow index updated (${workflows.length} workflow(s))`);
}
