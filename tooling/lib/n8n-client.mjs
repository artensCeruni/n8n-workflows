/**
 * Minimal n8n Public API client.
 *
 * Deliberately dependency-free (Node's global fetch) so `make export` works on a
 * clean checkout with nothing installed. Credentials are never read or written by
 * this client — only workflow definitions, which contain no secrets.
 *
 * Configuration comes from the environment:
 *   N8N_BASE_URL   default http://localhost:5678
 *   N8N_API_KEY    required; create one in n8n under Settings → API
 */

const DEFAULT_BASE_URL = 'http://localhost:5678';

class N8nApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'N8nApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Load config from the environment, failing with an actionable message rather
 * than a 401 five calls later.
 */
export function resolveConfig(env = process.env) {
  const baseUrl = (env.N8N_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiKey = env.N8N_API_KEY;

  if (!apiKey) {
    throw new Error(
      'N8N_API_KEY is not set.\n' +
        '  1. Open n8n → Settings → API → Create an API key\n' +
        '  2. Copy infra/.env.example to infra/.env and set N8N_API_KEY\n' +
        '  3. Re-run with: env $(grep -v "^#" infra/.env | xargs) make export'
    );
  }

  return { baseUrl, apiKey };
}

export function createClient(config = resolveConfig()) {
  const { baseUrl, apiKey } = config;

  async function request(method, path, body) {
    const url = `${baseUrl}/api/v1${path}`;
    let response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          'X-N8N-API-KEY': apiKey,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      throw new N8nApiError(
        `Cannot reach n8n at ${baseUrl}. Is it running? Try: make up\n  (${cause.message})`
      );
    }

    const text = await response.text();
    const parsed = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const detail = parsed?.message ?? text.slice(0, 400);
      throw new N8nApiError(`${method} ${path} → ${response.status}: ${detail}`, {
        status: response.status,
        body: parsed
      });
    }

    return parsed;
  }

  return {
    baseUrl,

    /** Full workflow definition including nodes and connections. */
    async getWorkflow(id) {
      return request('GET', `/workflows/${encodeURIComponent(id)}`);
    },

    /** Paginated listing, transparently followed to the end. */
    async listWorkflows() {
      const all = [];
      let cursor;
      do {
        const query = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
        const page = await request('GET', `/workflows${query}`);
        all.push(...(page?.data ?? []));
        cursor = page?.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },

    /**
     * Update an existing workflow. The API rejects read-only fields, so we send
     * only the four it accepts.
     */
    async updateWorkflow(id, workflow) {
      return request('PUT', `/workflows/${encodeURIComponent(id)}`, {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings ?? {}
      });
    },

    async createWorkflow(workflow) {
      return request('POST', '/workflows', {
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings ?? {}
      });
    }
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export { N8nApiError };
