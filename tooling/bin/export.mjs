#!/usr/bin/env node
/**
 * Pull workflows from a live n8n instance into the repo, sanitised.
 *
 *   node tooling/bin/export.mjs --all
 *   node tooling/bin/export.mjs --workflow=email-ai-classifier
 *
 * Exit codes: 0 success (whether or not files changed), 1 failure.
 *
 * Sanitisation happens on the way out, never as a separate step someone can
 * forget — see tooling/lib/sanitize.mjs.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createClient } from '../lib/n8n-client.mjs';
import { toRepoFormat } from '../lib/sanitize.mjs';
import { listWorkflowSlugs, loadManifest, workflowPaths } from '../lib/manifest.mjs';

const args = process.argv.slice(2);
const requested = args.find((arg) => arg.startsWith('--workflow='))?.split('=')[1];
const exportAll = args.includes('--all') || !requested;

const slugs = requested ? [requested] : listWorkflowSlugs();

if (slugs.length === 0) {
  console.error(
    'No workflows found under workflows/. Scaffold one: make new-workflow SLUG=my-flow'
  );
  process.exit(1);
}

const client = createClient();
let changed = 0;
let failed = 0;

for (const slug of slugs) {
  const paths = workflowPaths(slug);

  if (!existsSync(paths.manifest)) {
    console.error(`✖ ${slug}: no manifest.json`);
    failed += 1;
    continue;
  }

  const manifest = loadManifest(slug);

  if (!manifest.n8nId) {
    console.error(`✖ ${slug}: manifest has no "n8nId" — cannot know what to export`);
    failed += 1;
    continue;
  }

  try {
    const remote = await client.getWorkflow(manifest.n8nId);
    const { content, warnings } = toRepoFormat(remote, manifest);

    for (const warning of warnings) console.warn(`  ⚠ ${slug}: ${warning}`);

    const previous = existsSync(paths.workflow) ? readFileSync(paths.workflow, 'utf8') : null;

    if (previous === content) {
      console.log(`= ${slug}: unchanged`);
      continue;
    }

    writeFileSync(paths.workflow, content, 'utf8');
    console.log(`${previous === null ? '+' : '~'} ${slug}: written (${content.length} bytes)`);
    changed += 1;
  } catch (error) {
    console.error(`✖ ${slug}: ${error.message}`);
    failed += 1;
  }
}

console.log(
  `\n${exportAll ? 'Exported' : 'Exported'} ${slugs.length - failed}/${slugs.length} workflow(s), ${changed} changed.`
);

if (failed > 0) process.exit(1);
