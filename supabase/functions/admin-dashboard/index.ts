import { withSupabase } from 'npm:@supabase/server@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PAGE_SIZE = 50
const MAX_PAGE = 200

type JsonRecord = Record<string, unknown>

function failure(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function loadOwnerDetails(
  supabaseAdmin: SupabaseClient,
  rows: JsonRecord[],
  ownerField: string,
) {
  const ownerIds = Array.from(new Set(
    rows.map((row) => row[ownerField]).filter(
      (id): id is string => typeof id === 'string',
    ),
  ))
  if (!ownerIds.length) return rows

  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select('user_id, public_id, email, display_name, account_status')
    .in('user_id', ownerIds)
  if (error) throw new Error(`Unable to load owner profiles: ${error.code}`)

  const byId = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]))
  return rows.map((row) => ({
    ...row,
    owner: byId.get(row[ownerField] as string) ?? null,
  }))
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return failure('Method not allowed', 405)
    const actorId = context.userClaims?.id
    if (!actorId) return failure('Authentication is required', 401)

    let body: JsonRecord
    try {
      const parsed: unknown = await request.json()
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return failure('Invalid request', 400)
      }
      body = parsed as JsonRecord
    } catch {
      return failure('Invalid request', 400)
    }

    const { data: isMaster, error: permissionError } =
      await context.supabase.rpc('is_current_user_master')
    if (permissionError) {
      console.error('Unable to verify master permission', permissionError.code)
      return failure('Administrative access could not be verified', 500)
    }
    if (isMaster !== true) return failure('Forbidden', 403)

    const action = typeof body.action === 'string' ? body.action : ''
    if (action === 'review_event') {
      const eventId = Number(body.eventId)
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!Number.isSafeInteger(eventId) || eventId < 1 || reason.length < 5 || reason.length > 300) {
        return failure('A valid event and review reason are required', 400)
      }
      const { data: reviewed, error: reviewError } = await context.supabaseAdmin
        .from('system_events')
        .update({
          review_status: 'reviewed',
          reviewed_by: actorId,
          reviewed_at: new Date().toISOString(),
          review_reason: reason,
        })
        .eq('id', eventId)
        .eq('review_status', 'automatic')
        .select('id')
        .maybeSingle()
      const { error: reviewAuditError } = await context.supabaseAdmin
        .from('admin_audit_logs')
        .insert({
          actor_id: actorId,
          action: 'review_system_event',
          entity_type: 'system_event',
          entity_id: String(eventId),
          reason: reason,
          outcome: reviewError || !reviewed ? 'failure' : 'success',
          metadata: {},
        })
      if (reviewAuditError) {
        console.error('Unable to record system event review', reviewAuditError.code)
        return failure('Administrative audit logging is unavailable', 500)
      }
      if (reviewError) {
        console.error('Unable to review system event', reviewError.code)
        return failure('System event could not be reviewed', 500)
      }
      if (!reviewed) return failure('System event was not found or was already reviewed', 404)
      return Response.json({ reviewed: true })
    }

    const { error: auditError } = await context.supabaseAdmin
      .from('admin_audit_logs')
      .insert({
        actor_id: actorId,
        action: `view_${action || 'unknown'}`,
        entity_type: action || 'unknown',
        entity_id: action === 'user_detail' && typeof body.userId === 'string'
          ? body.userId
          : null,
        outcome: 'success',
        metadata: {},
      })
    if (auditError) {
      console.error('Unable to record master dashboard access', auditError.code)
      return failure('Administrative audit logging is unavailable', 500)
    }

    try {
      if (action === 'overview') {
        const from = validDate(body.from)
        const to = validDate(body.to)
        if (!from || !to || new Date(to).getTime() <= new Date(from).getTime()) {
          return failure('Invalid reporting period', 400)
        }
        const { data: metrics, error } = await context.supabase.rpc('admin_metrics', {
          p_from: from,
          p_to: to,
        })
        if (error) throw new Error(`Unable to calculate metrics: ${error.code}`)

        const [tournaments, subscriptions, payments, audit, events] = await Promise.all([
          context.supabaseAdmin.from('tournaments')
            .select('id, organizer_id, name, status, is_published, participant_count, created_at, completed_at')
            .order('created_at', { ascending: false }).limit(25),
          context.supabaseAdmin.from('subscriptions')
            .select('id, user_id, plan_id, amount, currency, status, provider_status, provider_subscription_id, current_period_start, current_period_end, last_payment_at, cancelled_at, created_at')
            .order('created_at', { ascending: false }).limit(25),
          context.supabaseAdmin.from('payments')
            .select('id, user_id, subscription_id, provider_payment_id, status, amount, currency, paid_at, provider_created_at, created_at')
            .order('created_at', { ascending: false }).limit(25),
          context.supabaseAdmin.from('admin_audit_logs')
            .select('id, actor_id, action, entity_type, entity_id, reason, outcome, created_at')
            .order('created_at', { ascending: false }).limit(25),
          context.supabaseAdmin.from('system_events')
            .select('id, source, event_type, severity, message, detected_at, review_status, reviewed_by, reviewed_at, review_reason')
            .order('detected_at', { ascending: false }).limit(25),
        ])
        for (const result of [tournaments, subscriptions, payments, audit, events]) {
          if (result.error) throw new Error(`Unable to load dashboard records: ${result.error.code}`)
        }

        return Response.json({
          metrics,
          tournaments: await loadOwnerDetails(
            context.supabaseAdmin,
            (tournaments.data ?? []) as JsonRecord[],
            'organizer_id',
          ),
          subscriptions: await loadOwnerDetails(
            context.supabaseAdmin,
            (subscriptions.data ?? []) as JsonRecord[],
            'user_id',
          ),
          payments: await loadOwnerDetails(
            context.supabaseAdmin,
            (payments.data ?? []) as JsonRecord[],
            'user_id',
          ),
          audit: audit.data ?? [],
          events: events.data ?? [],
        })
      }

      if (action === 'users') {
        const search = typeof body.search === 'string' ? body.search.trim().slice(0, 100) : ''
        const page = typeof body.page === 'number' && Number.isInteger(body.page)
          ? body.page
          : 0
        if (page < 0 || page > MAX_PAGE) return failure('Invalid page', 400)
        const { data, error } = await context.supabase.rpc('admin_search_users', {
          p_search: search,
          p_limit: PAGE_SIZE,
          p_offset: page * PAGE_SIZE,
        })
        if (error) throw new Error(`Unable to search users: ${error.code}`)
        return Response.json({ users: data ?? [], page, pageSize: PAGE_SIZE })
      }

      if (action === 'user_detail') {
        const userId = typeof body.userId === 'string' ? body.userId : ''
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
          return failure('Invalid user identifier', 400)
        }
        const [profile, subscriptions, payments, tournaments] = await Promise.all([
          context.supabaseAdmin.from('profiles').select('user_id, public_id, email, display_name, account_status, profile_data, created_at').eq('user_id', userId).maybeSingle(),
          context.supabaseAdmin.from('subscriptions').select('id, plan_id, amount, currency, status, provider_status, provider_subscription_id, current_period_start, current_period_end, last_payment_at, cancelled_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
          context.supabaseAdmin.from('payments').select('id, subscription_id, provider_payment_id, status, amount, currency, paid_at, provider_created_at, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
          context.supabaseAdmin.from('tournaments').select('id, name, status, is_published, participant_count, created_at, completed_at, payload').eq('organizer_id', userId).order('created_at', { ascending: false }).limit(100),
        ])
        for (const result of [profile, subscriptions, payments, tournaments]) {
          if (result.error) throw new Error(`Unable to load user details: ${result.error.code}`)
        }
        return Response.json({
          profile: profile.data,
          subscriptions: subscriptions.data ?? [],
          payments: payments.data ?? [],
          tournaments: tournaments.data ?? [],
        })
      }

      if (action === 'subscriptions' || action === 'payments' || action === 'tournaments') {
        const table = action
        const query = context.supabaseAdmin.from(table).select(
          action === 'tournaments'
            ? 'id, organizer_id, name, status, is_published, participant_count, created_at, completed_at'
            : action === 'subscriptions'
            ? 'id, user_id, plan_id, amount, currency, status, provider_status, provider_subscription_id, current_period_start, current_period_end, last_payment_at, cancelled_at, created_at'
            : 'id, user_id, subscription_id, provider_payment_id, status, amount, currency, paid_at, provider_created_at, created_at',
        ).order('created_at', { ascending: false }).limit(100)
        const { data, error } = await query
        if (error) throw new Error(`Unable to load ${action}: ${error.code}`)
        const rows = (data ?? []) as JsonRecord[]
        const ownerField = action === 'tournaments' ? 'organizer_id' : 'user_id'
        return Response.json({
          [action]: await loadOwnerDetails(context.supabaseAdmin, rows, ownerField),
        })
      }

      if (action === 'audit') {
        const { data, error } = await context.supabaseAdmin
          .from('admin_audit_logs')
          .select('id, actor_id, action, entity_type, entity_id, reason, outcome, created_at, metadata')
          .order('created_at', { ascending: false })
          .limit(100)
        if (error) throw new Error(`Unable to load audit history: ${error.code}`)
        return Response.json({ audit: data ?? [] })
      }

      if (action === 'monitoring') {
        const { data, error } = await context.supabaseAdmin
          .from('system_events')
          .select('id, source, event_type, severity, message, detected_at, review_status, reviewed_by, reviewed_at, review_reason')
          .order('detected_at', { ascending: false })
          .limit(100)
        if (error) throw new Error(`Unable to load system events: ${error.code}`)
        return Response.json({ events: data ?? [] })
      }

      return failure('Unknown administrative action', 400)
    } catch (error) {
      console.error('Master dashboard request failed', String(error))
      return failure('Administrative data could not be loaded', 500)
    }
  }),
}
