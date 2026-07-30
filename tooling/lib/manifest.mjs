/**
 * Workflow discovery and manifest loading.
 *
 * `manifest.json` is the contract that lets every tool in tooling/bin stay
 * generic: it declares the n8n workflow id, which credentials the workflow needs
 * (by name — see sanitize.mjs), and the placeholder value for every Config node
 * field. Adding a workflow means adding a directory, never editing a script or
 * the CI matrix.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKFLOWS_DIR = join(REPO_ROOT, 'workflows');

/** Directories under workflows/ starting with `_` are scaffolding, not projects. */
const isProjectDir = (name) => !name.startsWith('_') && !name.startsWith('.');

/** @returns {string[]} workflow slugs, sorted for deterministic output */
export function listWorkflowSlugs() {
  if (!existsSync(WORKFLOWS_DIR)) return [];
  return readdirSync(WORKFLOWS_DIR)
    .filter(isProjectDir)
    .filter((name) => statSync(join(WORKFLOWS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(WORKFLOWS_DIR, name, 'manifest.json')))
    .sort();
}

export function workflowPaths(slug) {
  const dir = join(WORKFLOWS_DIR, slug);
  return {
    dir,
    manifest: join(dir, 'manifest.json'),
    workflow: join(dir, 'workflow.json'),
    readme: join(dir, 'README.md'),
    tests: join(dir, 'tests')
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error.message}`);
  }
}

export function loadManifest(slug) {
  return readJson(workflowPaths(slug).manifest);
}

export function loadWorkflow(slug) {
  return readJson(workflowPaths(slug).workflow);
}

/** Raw file contents — needed by the round-trip test, which compares bytes. */
export function readWorkflowFile(slug) {
  return readFileSync(workflowPaths(slug).workflow, 'utf8');
}

/** @returns {{slug, manifest, workflow, paths}[]} every project, ready to inspect */
export function loadAllWorkflows() {
  return listWorkflowSlugs().map((slug) => ({
    slug,
    manifest: loadManifest(slug),
    workflow: loadWorkflow(slug),
    paths: workflowPaths(slug)
  }));
}

/**
 * Structural validation of a manifest. Kept as plain code rather than a JSON
 * Schema because the cross-field rules (slug matches directory, placeholders are
 * non-empty strings) are clearer expressed directly.
 *
 * @returns {string[]} human-readable problems; empty means valid
 */
export function validateManifest(manifest, slug) {
  const problems = [];
  const require = (field, type = 'string') => {
    const value = manifest[field];
    if (value === undefined || value === null || value === '') {
      problems.push(`missing required field "${field}"`);
      return false;
    }
    if (type === 'string' && typeof value !== 'string') {
      problems.push(`field "${field}" must be a string`);
      return false;
    }
    if (type === 'array' && !Array.isArray(value)) {
      problems.push(`field "${field}" must be an array`);
      return false;
    }
    return true;
  };

  require('slug');
  require('name');
  require('description');
  require('status');
  require('credentials', 'array');
  require('tags', 'array');

  if (manifest.slug && manifest.slug !== slug) {
    problems.push(`slug "${manifest.slug}" does not match directory name "${slug}"`);
  }

  const allowedStatus = ['live', 'draft', 'archived'];
  if (manifest.status && !allowedStatus.includes(manifest.status)) {
    problems.push(`status "${manifest.status}" must be one of ${allowedStatus.join(', ')}`);
  }

  if (Array.isArray(manifest.credentials)) {
    manifest.credentials.forEach((credential, index) => {
      if (!credential?.type) problems.push(`credentials[${index}] missing "type"`);
      if (!credential?.name) problems.push(`credentials[${index}] missing "name"`);
    });
  }

  if (manifest.configNodes !== undefined) {
    if (typeof manifest.configNodes !== 'object' || Array.isArray(manifest.configNodes)) {
      problems.push('configNodes must be an object keyed by node name');
    } else {
      for (const [nodeName, fields] of Object.entries(manifest.configNodes)) {
        if (typeof fields !== 'object' || Array.isArray(fields)) {
          problems.push(`configNodes["${nodeName}"] must be an object of field → placeholder`);
          continue;
        }
        for (const [field, placeholder] of Object.entries(fields)) {
          if (typeof placeholder !== 'string' || placeholder === '') {
            problems.push(
              `configNodes["${nodeName}"].${field} placeholder must be a non-empty string`
            );
          }
        }
      }
    }
  }

  return problems;
}
