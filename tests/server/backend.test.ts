import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertCpaBinary,
  buildManagedConfig,
  fetchModels,
  modelsUrl,
  normalizeModels,
  readBoundedJson,
  resolveCpaBinary,
} from '../../lib/server/backend.js'
import { sendJson, startServer } from '../helpers/http.ts'

describe('server/backend', () => {
  it('keeps the v1 prefix stable for models URL', () => {
    assert.equal(modelsUrl('http://127.0.0.1:8317/v1'), 'http://127.0.0.1:8317/v1/models')
    assert.equal(modelsUrl('http://127.0.0.1:8317'), 'http://127.0.0.1:8317/v1/models')
    assert.equal(modelsUrl('http://127.0.0.1:8317/'), 'http://127.0.0.1:8317/v1/models')
  })

  it('normalizeModels reads CPA metadata fields and drops entries without a usable id', () => {
    assert.deepEqual(normalizeModels([
      {
        id: 'alpha',
        display_name: 'Alpha',
        context_length: 128_000,
        max_completion_tokens: 4096,
      },
      { id: 'beta' },
      { id: '' },
      null,
      { id: 7 },
    ]), [
      {
        id: 'alpha',
        displayName: 'Alpha',
        contextLength: 128_000,
        maxCompletionTokens: 4096,
      },
      { id: 'beta' },
    ])
  })

  it('normalizeModels sorts models and maps reasoning levels', () => {
    assert.deepEqual(normalizeModels([
      { id: 'model-10', display_name: 'Model 10' },
      { id: 'model-2', display_name: 'Model 2' },
      {
        id: 'model-1',
        display_name: 'Model 1',
        supported_reasoning_levels: [
          { effort: 'high', description: 'High effort' },
          { effort: 'low', description: 'Low effort' },
        ],
        default_reasoning_level: 'high',
      },
      { id: 'model-1' },
    ]), [
      {
        id: 'model-1',
        displayName: 'Model 1',
        reasoning: {
          efforts: [
            { id: 'high', name: 'High', description: 'High effort' },
            { id: 'low', name: 'Low', description: 'Low effort' },
          ],
          defaultEffort: 'high',
        },
      },
      { id: 'model-2', displayName: 'Model 2' },
      { id: 'model-10', displayName: 'Model 10' },
    ])
  })

  it('normalizeModels skips hidden models and reads alternate catalog fields', () => {
    assert.deepEqual(normalizeModels([
      { slug: 'hidden', visibility: 'hide' },
      { slug: 'listed', visibility: 'list', name: 'Listed', max_output_tokens: 8192 },
      { id: 'plain', max_tokens: 1024 },
    ]), [
      { id: 'listed', displayName: 'Listed', maxCompletionTokens: 8192 },
      { id: 'plain', maxCompletionTokens: 1024 },
    ])
  })

  it('normalizeModels reads catalog input modalities', () => {
    assert.deepEqual(normalizeModels([
      { slug: 'vision', input_modalities: ['text', 'image', 'IMAGE', 'audio'] },
      { slug: 'compat-vision', supported_input_modalities: ['TEXT', 'IMAGE'] },
      { slug: 'empty', input_modalities: ['audio'] },
    ]), [
      { id: 'compat-vision', inputModalities: ['text', 'image'] },
      { id: 'empty' },
      { id: 'vision', inputModalities: ['text', 'image'] },
    ])
  })

  it('fetchModels requests the CPA rich model catalog and reads its metadata', async () => {
    const server = await startServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      assert.equal(url.searchParams.get('client_version'), 'dsh-cpa')
      sendJson(res, 200, {
        models: [
          {
            slug: 'gpt-5.5',
            display_name: 'GPT 5.5',
            context_window: 272_000,
            default_reasoning_level: 'high',
            supported_reasoning_levels: [{ effort: 'high' }],
          },
          { id: 'raw-model' },
        ],
      })
    })
    try {
      assert.deepEqual(await fetchModels(server.baseURL, 'sk-test'), [
        {
          id: 'gpt-5.5',
          displayName: 'GPT 5.5',
          contextLength: 272_000,
          reasoning: {
            efforts: [{ id: 'high', name: 'High' }],
            defaultEffort: 'high',
          },
        },
        { id: 'raw-model' },
      ])
    } finally {
      await server.close()
    }
  })

  it('fetchModels points auth failures at the CPA API key', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(401)
      res.end()
    })
    try {
      await assert.rejects(
        fetchModels(server.baseURL, 'sk-bad'),
        /models returned 401; check the CPA API key/,
      )
    } finally {
      await server.close()
    }
  })

  it('readBoundedJson rejects streamed bodies larger than the limit', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('["aaaa",'))
        controller.enqueue(new TextEncoder().encode('"bbbb"]'))
        controller.close()
      },
    })
    await assert.rejects(readBoundedJson(new Response(body), 10), /exceeds 10 bytes/)
    assert.deepEqual(await readBoundedJson(new Response('[1,2]'), 10), [1, 2])
  })

  it('buildManagedConfig writes a local CPA config with the usage flag', () => {
    const yaml = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'sk-test',
      managementKey: 'mgmt-test',
    })
    assert.match(yaml, /^config-version: 8$/m)
    assert.match(yaml, /^server:$/m)
    assert.match(yaml, /^  host: "127\.0\.0\.1"$/m)
    assert.match(yaml, /^  port: 8317$/m)
    assert.match(yaml, /^management:$/m)
    assert.match(yaml, /^  secret-key: "mgmt-test"$/m)
    assert.match(yaml, /^access:$/m)
    assert.match(yaml, /^  api-keys:$/m)
    assert.match(yaml, /^    - "sk-test"$/m)
    assert.match(yaml, /^requests:$/m)
    assert.match(yaml, /^  passthrough-headers: true$/m)
    assert.match(yaml, /^observability:$/m)
    assert.match(yaml, /^  usage:$/m)
    assert.match(yaml, /^    usage-statistics-enabled: true$/m)

    const disabled = buildManagedConfig({
      host: '127.0.0.1',
      port: 8317,
      apiKey: 'sk-test',
      managementKey: 'mgmt-test',
      usageStatisticsEnabled: false,
    })
    assert.match(disabled, /^    usage-statistics-enabled: false$/m)
  })

  it('resolveCpaBinary checks PATH and the executable bit before spawning', { skip: process.platform === 'win32' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-cpa-bin-'))
    const script = join(dir, 'cli-proxy-api')
    const previousPath = process.env.PATH
    try {
      await writeFile(script, '#!/bin/sh\n')
      await chmod(script, 0o755)
      process.env.PATH = dir
      assert.equal(await resolveCpaBinary('cli-proxy-api'), script)
      assert.equal(await resolveCpaBinary(join(dir, 'missing')), undefined)
      await assert.rejects(assertCpaBinary('not-a-real-cpa'), /CPA binary not found/)
      await chmod(script, 0o644)
      assert.equal(await resolveCpaBinary('cli-proxy-api'), undefined)
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(dir, { recursive: true, force: true })
    }
  })
})
