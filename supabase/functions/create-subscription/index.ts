import { withSupabase } from 'npm:@supabase/server@1'
import {
  mercadoPagoRequest,
  recordSystemEvent,
  stringValue,
} from '../_shared/mercadopago.ts'

const MONTHLY_PRICE = 49.90

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return jsonError('Method not allowed', 405)

    const userId = context.userClaims?.id
    const email = context.userClaims?.email
    if (!userId || !email) return jsonError('Authenticated email is required', 400)

    const { data: canManage, error: accessError } =
      await context.supabase.rpc('can_manage_tournaments')
    if (accessError) {
      console.error('Unable to verify subscription status', accessError.code)
      return jsonError('Subscription status is unavailable', 500)
    }
    if (canManage) return jsonError('Subscription is already active', 409)

    const { data: pending, error: pendingError } = await context.supabaseAdmin
      .from('subscriptions')
      .select('id, checkout_url, provider_subscription_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle()
    if (pendingError) {
      console.error('Unable to load pending subscription', pendingError.code)
      return jsonError('Subscription checkout is unavailable', 500)
    }
    if (pending?.checkout_url) {
      return Response.json({ checkoutUrl: pending.checkout_url })
    }
    if (pending) return jsonError('A subscription checkout is already being created', 409)

    const appUrl = Deno.env.get('PLACARUAI_APP_URL')
    const webhookUrl = Deno.env.get('MERCADOPAGO_WEBHOOK_URL')
    if (!appUrl || !webhookUrl) {
      console.error('Subscription URLs are not configured')
      return jsonError('Subscription checkout is not configured', 503)
    }
    let returnUrl: URL
    try {
      returnUrl = new URL(appUrl)
      const callbackUrl = new URL(webhookUrl)
      if (returnUrl.protocol !== 'https:' || callbackUrl.protocol !== 'https:') {
        return jsonError('Subscription URLs must use HTTPS', 503)
      }
    } catch {
      return jsonError('Subscription URLs are invalid', 503)
    }

    const { data: created, error: insertError } = await context.supabaseAdmin
      .from('subscriptions')
      .insert({
        user_id: userId,
        plan_id: 'placaruai-monthly',
        amount: MONTHLY_PRICE,
        currency: 'BRL',
        status: 'pending',
      })
      .select('id')
      .single()
    if (insertError || !created) {
      console.error('Unable to reserve subscription checkout', insertError?.code)
      return jsonError('Subscription checkout could not be started', 409)
    }

    returnUrl.searchParams.set('subscription', 'return')
    let providerSubscription: Record<string, unknown>
    try {
      providerSubscription = await mercadoPagoRequest('/preapproval', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'PlacarUAI - Assinatura mensal',
          external_reference: userId,
          payer_email: email,
          back_url: returnUrl.toString(),
          notification_url: webhookUrl,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: MONTHLY_PRICE,
            currency_id: 'BRL',
          },
          status: 'pending',
        }),
      })
    } catch (error) {
      await context.supabaseAdmin
        .from('subscriptions')
        .update({ status: 'failed' })
        .eq('id', created.id)
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_checkout_failed',
        'Mercado Pago subscription checkout creation failed.',
        { user_id: userId, subscription_id: created.id },
      )
      console.error('Mercado Pago subscription creation failed', String(error))
      return jsonError('The payment provider could not start checkout', 502)
    }

    const providerId = stringValue(providerSubscription.id)
    const checkoutUrl = stringValue(providerSubscription.init_point)
    if (!providerId || !checkoutUrl) {
      await context.supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'failed',
          provider_status: stringValue(providerSubscription.status),
        })
        .eq('id', created.id)
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_checkout_incomplete',
        'Mercado Pago returned incomplete subscription checkout data.',
        { user_id: userId, subscription_id: created.id },
      )
      console.error('Mercado Pago returned an incomplete checkout response')
      return jsonError('The payment provider returned an invalid checkout', 502)
    }

    let checkout: URL
    try {
      checkout = new URL(checkoutUrl)
    } catch {
      checkout = new URL('https://invalid.local')
    }
    if (
      checkout.protocol !== 'https:' ||
      !/(^|\.)mercadopago\.com(\.br)?$/i.test(checkout.hostname)
    ) {
      await context.supabaseAdmin
        .from('subscriptions')
        .update({ status: 'failed' })
        .eq('id', created.id)
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_checkout_url_rejected',
        'Mercado Pago returned an untrusted checkout URL.',
        { user_id: userId, subscription_id: created.id },
      )
      console.error('Mercado Pago returned an untrusted checkout URL')
      return jsonError('The payment provider returned an invalid checkout', 502)
    }

    const { error: updateError } = await context.supabaseAdmin
      .from('subscriptions')
      .update({
        provider_subscription_id: providerId,
        provider_status: stringValue(providerSubscription.status),
        checkout_url: checkout.toString(),
      })
      .eq('id', created.id)
    if (updateError) {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_reference_save_failed',
        'The provider subscription reference could not be saved.',
        { user_id: userId, subscription_id: created.id },
      )
      console.error('Unable to save provider subscription reference', updateError.code)
      return jsonError('Subscription checkout could not be saved', 500)
    }

    return Response.json({ checkoutUrl: checkout.toString() })
  }),
}
