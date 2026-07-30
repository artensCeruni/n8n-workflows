#!/usr/bin/env node
/**
 * Static validation of every workflow project. Runs offline — no n8n needed —
 * so CI can gate a pull request without a live instance.
 *
 * Checks, per workflow:
 *   • manifest.json is structurally valid and its slug matches the directory
 *   • workflow.json matches the n8n workflow schema
 *   • no connection points at a node that does not exist
 *   • every credential used by a node is declared in the manifest, and vice versa
 *   • every Config node field has a placeholder declared in the manifest
 *   • the workflow contains no real email address and no hardcoded Gmail label id
 *
 * The last check is the one that matters most: workflow.json is regenerated from
 * a live instance, so PII has a standing invitation to walk back in.
 */

import Ajv from 'ajv';
import { loadAllWorkflows, validateManifest } from '../lib/manifest.mjs';
import { danglingConnections } from '../lib/graph.mjs';

const WORKFLOW_SCHEMA = {
  type: 'object',
  required: ['name', 'nodes', 'connections'],
  properties: {
    name: { type: 'string', minLength: 1 },
    nodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['name', 'type', 'position'],
        properties: {
          name: { type: 'string', minLength: 1 },
          type: { type: 'string', minLength: 1 },
          typeVersion: { type: ['number', 'string'] },
          position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          parameters: { type: 'object' },
          credentials: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['name'],
              // An `id` here would pin the workflow to one instance's database.
              not: { required: ['id'] },
              properties: { name: { type: 'string', minLength: 1 } }
            }
          }
        }
      }
    },
    connections: { type: 'object' },
    settings: { type: 'object' }
  }
};

// Matches an address but tolerates the reserved example domains (RFC 2606).
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ALLOWED_EMAIL_DOMAINS = /@(example\.(com|org|net)|users\.noreply\.github\.com|n8n\.io)$/;
const GMAIL_LABEL_PATTERN = /"Label_\d+"/g;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(WORKFLOW_SCHEMA);

const workflows = loadAllWorkflows();

if (workflows.length === 0) {
  console.error('No workflows found under workflows/. Nothing to validate.');
  process.exit(1);
}

let totalProblems = 0;

for (const { slug, manifest, workflow } of workflows) {
  const problems = [];

  problems.push(...validateManifest(manifest, slug).map((problem) => `manifest: ${problem}`));

  if (!validateSchema(workflow)) {
    for (const error of validateSchema.errors ?? []) {
      problems.push(`schema: ${error.instancePath || '/'} ${error.message}`);
    }
  }

  for (const { from, to } of danglingConnections(workflow)) {
    problems.push(
      to === null
        ? `connections: source "${from}" is not a node in this workflow`
        : `connections: "${from}" points at missing node "${to}"`
    );
  }

  // ── Credential declaration parity ─────────────────────────────────────────
  const usedCredentials = new Map();
  for (const node of workflow.nodes ?? []) {
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      if (ref?.name) usedCredentials.set(`${type}:${ref.name}`, { type, name: ref.name });
    }
  }
  const declaredCredentials = new Set(
    (manifest.credentials ?? []).map((credential) => `${credential.type}:${credential.name}`)
  );

  for (const [key, { type, name }] of usedCredentials) {
    if (!declaredCredentials.has(key)) {
      problems.push(`credentials: node uses ${type} "${name}" but manifest does not declare it`);
    }
  }
  for (const key of declaredCredentials) {
    if (!usedCredentials.has(key)) {
      problems.push(`credentials: manifest declares ${key} but no node uses it`);
    }
  }

  // ── Config node placeholder parity ────────────────────────────────────────
  for (const [nodeName, fields] of Object.entries(manifest.configNodes ?? {})) {
    const node = (workflow.nodes ?? []).find((candidate) => candidate.name === nodeName);
    if (!node) {
      problems.push(`configNodes: manifest declares "${nodeName}" which is not in the workflow`);
      continue;
    }

    const assignments = node.parameters?.assignments?.assignments ?? [];
    const actual = new Map(assignments.map((assignment) => [assignment.name, assignment.value]));

    for (const [field, placeholder] of Object.entries(fields)) {
      if (!actual.has(field)) {
        problems.push(`configNodes: "${nodeName}" has no field "${field}"`);
      } else if (actual.get(field) !== placeholder) {
        problems.push(
          `configNodes: "${nodeName}.${field}" is ${JSON.stringify(actual.get(field))}, ` +
            `expected placeholder ${JSON.stringify(placeholder)} — run make export`
        );
      }
    }

    for (const field of actual.keys()) {
      if (!(field in fields)) {
        problems.push(
          `configNodes: "${nodeName}.${field}" has no placeholder in manifest — ` +
            'add one or its live value will leak on the next export'
        );
      }
    }
  }

  // ── Leak checks over the serialised workflow ──────────────────────────────
  const serialized = JSON.stringify(workflow);

  for (const address of serialized.match(EMAIL_PATTERN) ?? []) {
    if (!ALLOWED_EMAIL_DOMAINS.test(address)) {
      problems.push(`pii: real email address "${address}" — must be a Config node placeholder`);
    }
  }

  for (const label of serialized.match(GMAIL_LABEL_PATTERN) ?? []) {
    problems.push(
      `portability: hardcoded Gmail label ${label} — must be a Config node placeholder`
    );
  }

  if (problems.length === 0) {
    console.log(`✔ ${slug}`);
  } else {
    console.log(`✖ ${slug}`);
    for (const problem of problems) console.log(`    ${problem}`);
    totalProblems += problems.length;
  }
}

console.log(`\n${workflows.length} workflow(s) checked, ${totalProblems} problem(s).`);

if (totalProblems > 0) process.exit(1);
