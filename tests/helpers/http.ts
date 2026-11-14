import { createServer } from 'node:http'
import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  RequestListener,
  Server,
  ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'

import type { JsonValue } from '../../lib/core/json.js'

export interface TestServer {
  readonly origin: string
  readonly baseURL: string
  close(): Promise<void>
}

export async function startServer(listener: RequestListener): Promise<TestServer> {
  const server = createServer(listener)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!isTcpAddress(address)) throw new Error('test server is not listening on a TCP port')
  const origin = `http://127.0.0.1:${address.port}`
  return {
    origin,
    baseURL: `${origin}/v1`,
    close: () => closeServer(server),
  }
}

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address === 'object'
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise(resolve => server.close(() => resolve()))
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: JsonValue,
  headers: OutgoingHttpHeaders = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

export async function readText(req: IncomingMessage): Promise<string> {
  let text = ''
  for await (const chunk of req) text += String(chunk)
  return text
}

export async function readJson<T>(response: Response): Promise<T> {
  // SAFETY: each caller asserts the response fields it reads.
  return (await response.json()) as T
}
