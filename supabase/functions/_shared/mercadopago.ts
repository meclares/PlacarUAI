import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const API_URL = 'https://api.mercadopago.com'

export type JsonRecord = Record<string, unknown>

export async function recordSystemEvent(
  supabaseAdmin: SupabaseClient,
  source: string,
  eventType: string,
  message: string,
  metadata: JsonRecord = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from('system_events').insert({
    source,
    event_type: eventType,
    severity: 'error',
    message,
    metadata,
  })
  if (error) console.error('Unable to record system event', error.code)
}

export async function mercadoPagoRequest(
  path: string,
  init: RequestInit = {},
): Promise<JsonRecord> {
  const token = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')
  if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured')

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Mercado Pago request failed', {
      status: response.status,
      path,
    })
    throw new Error('Payment provider request failed')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Payment provider returned an invalid response')
  }
  return body as JsonRecord
}

export async function verifyMercadoPagoSignature(
  request: Request,
  dataId: string,
): Promise<boolean> {
  const secret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')
  const signature = request.headers.get('x-signature')
  const requestId = request.headers.get('x-request-id')
  if (!secret || !signature || !requestId || !dataId) return false

  const parts = new Map(
    signature.split(',').map((part) => {
      const separator = part.indexOf('=')
      return separator < 0
        ? [part.trim(), '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
    }),
  )
  const timestamp = parts.get('ts')
  const received = parts.get('v1')
  if (!timestamp || !received || !/^\d+$/.test(timestamp)) return false

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)),
  )
  const expected = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (expected.length !== received.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index)
  }
  return difference === 0
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function addOneCalendarMonth(value: string): string {
  const date = new Date(value)
  const originalDay = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + 1)
  const finalDay = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
  )).getUTCDate()
  date.setUTCDate(Math.min(originalDay, finalDay))
  return date.toISOString()
}
