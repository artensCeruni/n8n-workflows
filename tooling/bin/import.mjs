#!/usr/bin/env node
/**
 * Push workflows from the repo into a live n8n instance.
 *
 *   node tooling/bin/import.mjs --all
 *   node tooling/bin/import.mjs --workflow=email-ai-classifier --dry-run
 *
 * Credentials are bound by *name*: the repo stores `{ name: "Gmail account" }`
 * with no id, so n8n attaches whichever credential the local user created under
 * that name. Nothing here reads or writes credential secrets.
 *
 * Config nodes arrive holding placeholders. Replace them in the n8n UI after the
 * first import; a later `make export` rewrites them back to placeholders, so the
 * repo never picks up real values.
 */

import { createClient } from '../lib/n8n-client.mjs';
import { listWorkflowSlugs, loadManifest, loadWorkflow } from '../lib/manifest.mjs';

const args = process.argv.slice(2);
const requested = args.find((arg) => arg.startsWith('--workflow='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

const slugs = requested ? [requested] : listWorkflowSlugs();

if (slugs.length === 0) {
  console.error('No workflows found under workflows/.');
  process.exit(1);
}

const client = createClient();
let failed = 0;

for (const slug of slugs) {
  let manifest;
  let workflow;

  try {
    manifest = loadManifest(slug);
    workflow = loadWorkflow(slug);
  } catch (error) {
    console.error(`✖ ${slug}: ${error.message}`);
    failed += 1;
    continue;
  }

  const nodeCount = workflow.nodes?.length ?? 0;
  const credentialNames = manifest.credentials?.map((credential) => credential.name) ?? [];

  if (dryRun) {
    const action = manifest.n8nId ? `update ${manifest.n8nId}` : 'create new workflow';
    console.log(`◦ ${slug}: would ${action} — ${nodeCount} nodes`);
    if (credentialNames.length > 0) {
      console.log(`    requires credentials named: ${credentialNames.join(', ')}`);
    }
    continue;
  }

  try {
    let created = null;

    if (manifest.n8nId) {
      try {
        await client.updateWorkflow(manifest.n8nId, workflow);
        console.log(`~ ${slug}: updated ${manifest.n8nId} (${nodeCount} nodes)`);
      } catch (error) {
        // `n8nId` records the id on the instance this workflow was authored on.
        // On anyone else's instance — a fresh clone, a rebuilt container — that
        // id does not exist, so treat it as a hint rather than a requirement and
        // create the workflow instead of failing with a bare 404.
        if (error.status !== 404) throw error;
        console.log(`  ◦ ${slug}: ${manifest.n8nId} not found on this instance — creating`);
        created = await client.createWorkflow(workflow);
      }
    } else {
      created = await client.createWorkflow(workflow);
    }

    if (created) {
      console.log(`+ ${slug}: created ${created.id} (${nodeCount} nodes)`);
      console.log(`    set "n8nId": "${created.id}" in workflows/${slug}/manifest.json`);
      console.log(`    (needed so make export knows which workflow to pull back)`);
    }

    if (credentialNames.length > 0) {
      console.log(`    bind credentials named: ${credentialNames.join(', ')}`);
    }
  } catch (error) {
    console.error(`✖ ${slug}: ${error.message}`);
    failed += 1;
  }
}

if (!dryRun && failed === 0) {
  console.log(`\nImported ${slugs.length} workflow(s) into ${client.baseUrl}.`);
  console.log('Workflows arrive inactive and with placeholder config — review before publishing.');
}

if (failed > 0) process.exit(1);
