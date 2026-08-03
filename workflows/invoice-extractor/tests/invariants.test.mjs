/**
 * Invariants specific to Invoice / Receipt Extractor.
 *
 * Each describe block corresponds to a decision in docs/adr/. The workflow is
 * expensive to get wrong — the trigger polls every minute and each pass costs
 * Gemini calls against a free-tier quota — so the assertions that matter here
 * are the ones about *termination* and *binary survival*, both of which fail
 * silently in n8n rather than raising.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  everySlotReaches,
  targetsBySlot,
  nodeByName,
  reachableFrom
} from '../../../tooling/lib/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(readFileSync(join(HERE, '..', 'workflow.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures', 'invoices.json'), 'utf8'));

const TERMINATOR = 'Mark as Processed';
const SLACK_NODES = [
  'Unsupported File Alert',
  'Extraction Failed Alert',
  'Review Required Notification',
  'Invoice Logged Notification',
  'Pipeline Error Alert'
];
const EXTRACTION_NODES = [
  'Extract Invoice from PDF',
  'Extract Invoice from Image',
  'Retry Extraction PDF',
  'Retry Extraction Image'
];

describe('ADR-0004: every branch reaches Mark as Processed', () => {
  // The trigger filters on unread mail and polls every minute. A branch that
  // ends without marking the message read re-runs the whole pipeline — Gemini
  // calls included — sixty seconds later, and appends the invoice again.
  for (const router of [
    'Route by File Type',
    'Retry Route by File Type',
    'Parsed Successfully?',
    'Retry Parsed Successfully?',
    'Review Needed?'
  ]) {
    test(`every output of "${router}" reaches "${TERMINATOR}"`, () => {
      const { ok, missing } = everySlotReaches(workflow.connections, router, TERMINATOR);
      assert.ok(
        ok,
        `output(s) ${missing.join(', ')} of "${router}" never reach "${TERMINATOR}" — ` +
          'those emails stay unread and are reprocessed on every poll'
      );
    });
  }

  test(`"${TERMINATOR}" is the last node, and marks read`, () => {
    const terminator = nodeByName(workflow, TERMINATOR);
    assert.ok(terminator, `"${TERMINATOR}" is missing`);
    assert.equal(terminator.parameters.operation, 'markAsRead');
    assert.deepEqual(
      [...reachableFrom(workflow.connections, TERMINATOR)],
      [],
      `nothing may run after "${TERMINATOR}" — the side effect must come first`
    );
  });

  test(`"${TERMINATOR}" reads the id from a node every branch ran`, () => {
    // $json holds a Slack API response by this point and has no message id.
    // Split Attachments is upstream of all five branches, so it always resolves.
    const terminator = nodeByName(workflow, TERMINATOR);
    assert.match(terminator.parameters.messageId, /\$\('Split Attachments'\)/);
  });

  test('all five terminal alerts feed the terminator directly', () => {
    for (const name of SLACK_NODES) {
      assert.deepEqual(
        targetsBySlot(workflow.connections, name).flat(),
        [TERMINATOR],
        `"${name}" must hand straight to "${TERMINATOR}"`
      );
    }
  });

  test('every error output is wired, not left dangling', () => {
    // `onError: continueErrorOutput` adds a second output slot. Leaving it
    // unconnected discards the item — no error, no alert, and the email stays
    // unread forever.
    const withErrorOutput = workflow.nodes.filter((node) => node.onError === 'continueErrorOutput');
    assert.ok(withErrorOutput.length > 0, 'expected nodes with an error output');

    const unwired = withErrorOutput.filter((node) => {
      const slots = targetsBySlot(workflow.connections, node.name);
      return !(slots[1] ?? []).includes('Pipeline Error Alert');
    });
    assert.deepEqual(
      unwired.map((node) => node.name),
      [],
      'error outputs must reach "Pipeline Error Alert"'
    );
  });
});

describe('ADR-0003: Config must not strip the attachments', () => {
  const config = nodeByName(workflow, 'Config');

  test('Config sits between the trigger and Split Attachments', () => {
    assert.deepEqual(
      targetsBySlot(workflow.connections, 'New Invoice Email').flat(),
      ['Config'],
      'Config must be upstream of every consumer, including the error branches'
    );
    assert.deepEqual(targetsBySlot(workflow.connections, 'Config').flat(), ['Split Attachments']);
  });

  test('binary survives Config', () => {
    // Set v3.4: includeBinary = !options.stripBinary && include !== 'none'.
    // The node's declared default for stripBinary is `true`, so leaving it
    // implicit means one editor visit silently empties every attachment and
    // Split Attachments starts returning zero items — with no error anywhere.
    assert.ok(config, '"Config" is missing');
    assert.ok(config.typeVersion >= 3.4, 'stripBinary only exists from typeVersion 3.4');
    assert.equal(
      config.parameters.options?.stripBinary,
      false,
      'pin stripBinary:false — see docs/adr/0003-config-node-must-not-strip-binary.md'
    );
  });

  test('Config passes the upstream payload through', () => {
    assert.equal(config.parameters.includeOtherFields, true);
  });
});

describe('configuration is reachable from every consumer', () => {
  const reachable = reachableFrom(workflow.connections, 'Config');

  for (const consumer of [...SLACK_NODES, 'Append Row to Invoices Log']) {
    test(`"${consumer}" runs downstream of Config`, () => {
      assert.ok(reachable.has(consumer), `"${consumer}" reads Config but Config never runs first`);
    });
  }

  test('Test Config runs before the test sender', () => {
    // The injector is a separate trigger, so it needs its own Config node —
    // a node that never executed cannot be read.
    assert.ok(reachableFrom(workflow.connections, 'Test Config').has('Send Test Invoice'));
  });
});

describe('no account-specific value is hardcoded', () => {
  test('every Slack channel comes from Config', () => {
    for (const name of SLACK_NODES) {
      const channel = nodeByName(workflow, name).parameters.channelId;
      assert.equal(channel.mode, 'id', `"${name}" must address the channel by id`);
      assert.match(
        channel.value,
        /\$\('Config'\)/,
        `"${name}" holds a literal channel — move it to Config`
      );
    }
  });

  test('the Sheets document id comes from Config', () => {
    const sheets = nodeByName(workflow, 'Append Row to Invoices Log');
    assert.equal(sheets.parameters.documentId.mode, 'id');
    assert.match(sheets.parameters.documentId.value, /\$\('Config'\)/);
  });

  test('no resource-locator cache leaks an id or a channel name', () => {
    // cachedResultUrl/Name are display-only, but the sheet URL embeds the
    // document id and the channel cache embeds the workspace's channel names.
    // Config placeholdering does not touch them, so they must not exist.
    const serialized = JSON.stringify(workflow);
    for (const forbidden of ['cachedResultUrl', 'docs.google.com/spreadsheets', 'C0BM']) {
      assert.ok(!serialized.includes(forbidden), `"${forbidden}" must not be committed`);
    }
  });
});

describe('ADR-0001: one retry, with a different prompt', () => {
  test('a failed parse routes into the retry chain, not into an alert', () => {
    const slots = targetsBySlot(workflow.connections, 'Parsed Successfully?');
    assert.deepEqual(slots[0], ['Invoice Ready']);
    assert.deepEqual(slots[1], ['Retry Route by File Type']);
  });

  test('a second failure alerts and writes nothing', () => {
    const slots = targetsBySlot(workflow.connections, 'Retry Parsed Successfully?');
    assert.deepEqual(slots[0], ['Invoice Ready']);
    assert.deepEqual(slots[1], ['Extraction Failed Alert']);
    // The alert branch must not reach the sheet — a row with no data is worse
    // than no row (ADR-0002 logs what parsed, not what did not).
    const afterAlert = reachableFrom(workflow.connections, 'Extraction Failed Alert');
    assert.ok(!afterAlert.has('Append Row to Invoices Log'));
  });

  test('the retry prompt differs from the first-pass prompt', () => {
    // Re-asking the identical question is not a retry, it is a duplicate call.
    const promptOf = (name) => JSON.stringify(nodeByName(workflow, name).parameters);
    assert.notEqual(promptOf('Retry Extraction PDF'), promptOf('Extract Invoice from PDF'));
    assert.notEqual(promptOf('Retry Extraction Image'), promptOf('Extract Invoice from Image'));
  });

  test('both paths rejoin at a single fan-in point', () => {
    // Everything downstream reads $('Invoice Ready').item.json, which is only
    // correct because first-pass and retry results arrive through the same node.
    for (const branch of ['Parsed Successfully?', 'Retry Parsed Successfully?']) {
      assert.ok(reachableFrom(workflow.connections, branch).has('Invoice Ready'));
    }
  });
});

describe('ADR-0002: the row is always written, doubt is a flag', () => {
  test('both review outcomes run after the append, never instead of it', () => {
    const afterAppend = reachableFrom(workflow.connections, 'Append Row to Invoices Log');
    assert.ok(afterAppend.has('Review Required Notification'));
    assert.ok(afterAppend.has('Invoice Logged Notification'));
  });

  test('Review Needed? routes flagged rows to the alerts channel', () => {
    const slots = targetsBySlot(workflow.connections, 'Review Needed?');
    assert.deepEqual(slots[0], ['Review Required Notification']);
    assert.deepEqual(slots[1], ['Invoice Logged Notification']);
  });

  test('the validator keeps its tolerance and its zero-tax rule', () => {
    const code = nodeByName(workflow, 'Parse and Validate').parameters.jsCode;
    assert.match(code, /Math\.max\(0\.02,/, 'the absolute floor covers rounding on small receipts');
    assert.match(code, /taxAmount === null \? 0 :/, 'a tax-exempt receipt is legitimate');
    assert.match(code, /confidence < 0\.6/);
  });
});

describe('the file-type allowlist and the router agree', () => {
  // Drift here is silent: a supported file goes down the Unsupported slot and
  // is alerted as junk instead of being read.
  const kinds = ['pdf', 'image'];

  test('Split Attachments emits exactly the kinds the router matches', () => {
    const code = nodeByName(workflow, 'Split Attachments').parameters.jsCode;
    for (const kind of kinds) assert.ok(code.includes(`"${kind}"`), `allowlist lost "${kind}"`);
    assert.ok(code.includes('"unsupported"'), 'anything unrecognised must be tagged, not dropped');

    const rules = nodeByName(workflow, 'Route by File Type').parameters.rules.values;
    assert.deepEqual(
      rules.map((rule) => rule.conditions.conditions[0].rightValue),
      kinds
    );
  });

  test('unsupported is the router fallback, not a fourth rule', () => {
    // A rule would silently drop anything that matched nothing.
    const options = nodeByName(workflow, 'Route by File Type').parameters.options;
    assert.equal(options.fallbackOutput, 'extra');
    assert.equal(options.renameFallbackOutput, 'Unsupported');
  });

  test('the retry router has no fallback, because retries are already typed', () => {
    const options = nodeByName(workflow, 'Retry Route by File Type').parameters.options;
    assert.equal(options.fallbackOutput, 'none');
  });
});

describe('extraction uses the model with usable free-tier quota', () => {
  test('all four Gemini nodes are on gemini-2.5-flash', () => {
    // The 2.0 series has no usable free quota on a personal key — see the
    // email-ai-classifier ADR-0003 for the measurement.
    for (const name of EXTRACTION_NODES) {
      const node = nodeByName(workflow, name);
      const model = node.parameters.modelId?.value ?? node.parameters.modelId;
      assert.equal(model, 'models/gemini-2.5-flash', `"${name}" is on a different model`);
    }
  });

  test('PDF and image use the resources their inputs require', () => {
    assert.equal(nodeByName(workflow, 'Extract Invoice from PDF').parameters.resource, 'document');
    assert.equal(nodeByName(workflow, 'Extract Invoice from Image').parameters.resource, 'image');
    assert.equal(nodeByName(workflow, 'Retry Extraction PDF').parameters.resource, 'document');
    assert.equal(nodeByName(workflow, 'Retry Extraction Image').parameters.resource, 'image');
  });
});

describe('the trigger and Split Attachments agree', () => {
  const trigger = nodeByName(workflow, 'New Invoice Email');

  test('the trigger downloads attachments under the prefix the splitter reads', () => {
    assert.equal(trigger.parameters.options.downloadAttachments, true);
    const prefix = trigger.parameters.options.dataPropertyAttachmentsPrefixName;
    assert.ok(
      nodeByName(workflow, 'Split Attachments').parameters.jsCode.includes(prefix),
      `Split Attachments looks for a different prefix than "${prefix}"`
    );
  });

  test('the trigger asks for the full message, not the simplified shape', () => {
    // simple:true drops the attachment binary entirely.
    assert.equal(trigger.parameters.simple, false);
    assert.equal(trigger.parameters.filters.readStatus, 'unread');
  });
});

describe('test fixtures stay in sync with the injector node', () => {
  const code = () => nodeByName(workflow, 'Generate Test Invoices').parameters.jsCode;

  test('every fixture case exists in the injector', () => {
    for (const fixture of fixtures) {
      assert.ok(
        code().includes(fixture.testCase),
        `injector is missing "${fixture.testCase}" — fixtures have drifted`
      );
    }
  });

  test('the fixtures cover all five terminal outcomes of the pipeline', () => {
    assert.deepEqual([...new Set(fixtures.map((fixture) => fixture.expectedOutcome))].sort(), [
      'extraction-failed',
      'logged',
      'logged-flagged',
      'unsupported'
    ]);
    assert.ok(
      fixtures.some((fixture) => fixture.fileKind === 'unsupported'),
      'keep a case that never reaches Gemini'
    );
  });
});
