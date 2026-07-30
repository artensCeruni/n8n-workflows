#!/usr/bin/env node
/**
 * Scaffold a new workflow project from workflows/_template.
 *
 *   node tooling/bin/new-workflow.mjs --slug=slack-digest
 *
 * The point of scaffolding rather than documenting the layout: conventions get
 * enforced by tooling instead of by memory. A project created this way is picked
 * up automatically by validate, the test matrix, the CI job matrix and the README
 * index — no script or workflow file needs editing.
 */

import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WORKFLOWS_DIR } from '../lib/manifest.mjs';

const slug = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--slug='))
  ?.split('=')[1];

if (!slug) {
  console.error('Usage: node tooling/bin/new-workflow.mjs --slug=my-workflow');
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error(
    `Invalid slug "${slug}". Use lowercase kebab-case, starting with a letter (e.g. slack-digest).`
  );
  process.exit(1);
}

const templateDir = join(WORKFLOWS_DIR, '_template');
const targetDir = join(WORKFLOWS_DIR, slug);

if (!existsSync(templateDir)) {
  console.error(`Template missing at ${templateDir}`);
  process.exit(1);
}

if (existsSync(targetDir)) {
  console.error(`workflows/${slug} already exists.`);
  process.exit(1);
}

cpSync(templateDir, targetDir, { recursive: true });

/** Human-readable default name: slack-digest → Slack Digest */
const humanName = slug
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

/** Replace template tokens in every text file we just copied. */
function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      substitute(path);
      continue;
    }
    const original = readFileSync(path, 'utf8');
    const replaced = original.replaceAll('__SLUG__', slug).replaceAll('__NAME__', humanName);
    if (replaced !== original) writeFileSync(path, replaced, 'utf8');
  }
}

substitute(targetDir);

console.log(`Created workflows/${slug}/`);
console.log('');
console.log('Next steps:');
console.log(`  1. Build the workflow in n8n, then note its id from the URL`);
console.log(`  2. Set "n8nId" in workflows/${slug}/manifest.json`);
console.log(`  3. make export WORKFLOW=${slug}`);
console.log(`  4. Declare credentials and Config placeholders in manifest.json`);
console.log(`  5. make validate && make test && make readme`);
