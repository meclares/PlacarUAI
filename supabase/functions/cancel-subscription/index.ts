import { withSupabase } from 'npm:@supabase/server@1'
import {
  mercadoPagoRequest,
  recordSystemEvent,
  stringValue,
} from '../_shared/mercadopago.ts'

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return jsonError('Method not allowed', 405)
    const userId = context.userClaims?.id
    if (!userId) return jsonError('Authentication is required', 401)

    const { data: subscription, error: lookupError } = await context.supabaseAdmin
      .from('subscriptions')
      .select('id, provider_subscription_id, status')
      .eq('user_id', userId)
      .in('status', ['active', 'pending'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lookupError) {
      console.error('Unable to find subscription for cancellation', lookupError.code)
      return jsonError('Subscription could not be loaded', 500)
    }
    if (!subscription?.provider_subscription_id) {
      return jsonError('No cancellable subscription was found', 404)
    }

    let providerResult: Record<string, unknown>
    try {
      providerResult = await mercadoPagoRequest(
        `/preapproval/${encodeURIComponent(subscription.provider_subscription_id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ status: 'cancelled' }),
        },
      )
    } catch (error) {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_cancellation_failed',
        'Mercado Pago subscription cancellation failed.',
        { user_id: userId, subscription_id: subscription.id },
      )
      console.error('Mercado Pago cancellation failed', String(error))
      return jsonError('The payment provider could not cancel the subscription', 502)
    }

    const providerStatus = stringValue(providerResult.status)
    if (providerStatus !== 'cancelled') {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_cancellation_unconfirmed',
        'Mercado Pago did not confirm subscription cancellation.',
        { user_id: userId, subscription_id: subscription.id },
      )
      console.error('Mercado Pago did not confirm cancellation')
      return jsonError('The payment provider did not confirm cancellation', 502)
    }

    const { error: updateError } = await context.supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'cancelled',
        provider_status: providerStatus,
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', subscription.id)
    if (updateError) {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_cancellation_save_failed',
        'The confirmed subscription cancellation could not be saved.',
        { user_id: userId, subscription_id: subscription.id },
      )
      console.error('Unable to save subscription cancellation', updateError.code)
      return jsonError('Cancellation status could not be saved', 500)
    }

    return Response.json({
      cancelled: true,
      message: 'Access remains available through the paid period.',
    })
  }),
}
