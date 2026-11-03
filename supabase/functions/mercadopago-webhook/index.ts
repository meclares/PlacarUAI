import { withSupabase } from 'npm:@supabase/server@1'
import {
  addOneCalendarMonth,
  isoDate,
  mercadoPagoRequest,
  recordSystemEvent,
  stringValue,
  verifyMercadoPagoSignature,
} from '../_shared/mercadopago.ts'

const MONTHLY_PRICE = 49.90

type PaymentRecord = {
  id: string | number
  status?: string
  transaction_amount?: number
  currency_id?: string
  date_approved?: string
  date_created?: string
  preapproval_id?: string | number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function paymentRecord(value: Record<string, unknown>): PaymentRecord {
  const amount = Number(value.transaction_amount)
  return {
    id: stringValue(value.id) ?? '',
    status: stringValue(value.status) ?? undefined,
    transaction_amount: amount,
    currency_id: stringValue(value.currency_id) ?? undefined,
    date_approved: stringValue(value.date_approved) ?? undefined,
    date_created: stringValue(value.date_created) ?? undefined,
    preapproval_id: stringValue(value.preapproval_id) ?? undefined,
  }
}

function paymentStatus(value: string | undefined): string {
  if (value === 'approved') return 'approved'
  if (value === 'rejected') return 'rejected'
  if (value === 'refunded' || value === 'charged_back') return 'refunded'
  if (value === 'cancelled') return 'cancelled'
  return 'pending'
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status })
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (request, context) => {
    if (request.method !== 'POST') return errorResponse('Method not allowed', 405)

    const url = new URL(request.url)
    const rawBody = await request.text()
    let notification: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(rawBody)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return errorResponse('Invalid notification', 400)
      }
      notification = parsed as Record<string, unknown>
    } catch {
      return errorResponse('Invalid notification', 400)
    }

    const dataId = url.searchParams.get('data.id')
    if (!dataId || !await verifyMercadoPagoSignature(request, dataId)) {
      return errorResponse('Invalid notification signature', 401)
    }

    const topic = stringValue(notification.type) ??
      url.searchParams.get('type') ??
      url.searchParams.get('topic')
    if (!topic) return errorResponse('Notification topic is missing', 400)

    if (topic === 'subscription_preapproval') {
      let providerSubscription: Record<string, unknown>
      try {
        providerSubscription = await mercadoPagoRequest(
          `/preapproval/${encodeURIComponent(dataId)}`,
        )
      } catch (error) {
        await recordSystemEvent(
          context.supabaseAdmin,
          'payments',
          'subscription_webhook_verification_failed',
          'Mercado Pago subscription notification could not be verified.',
          { topic },
        )
        console.error('Unable to verify subscription notification', String(error))
        return errorResponse('Subscription verification failed', 502)
      }

      const providerId = stringValue(providerSubscription.id)
      const providerStatus = stringValue(providerSubscription.status)
      if (!providerId || !providerStatus) {
        return errorResponse('Provider subscription data is incomplete', 502)
      }
      const { data: current, error: lookupError } = await context.supabaseAdmin
        .from('subscriptions')
        .select('id, status, current_period_end')
        .eq('provider_subscription_id', providerId)
        .maybeSingle()
      if (lookupError) {
        console.error('Unable to find matching subscription', lookupError.code)
        return errorResponse('Subscription record is unavailable', 500)
      }
      if (!current) return errorResponse('Subscription record was not found', 404)

      const ended = providerStatus === 'cancelled' || providerStatus === 'paused'
      const stillPaid = current.current_period_end &&
        new Date(current.current_period_end).getTime() > Date.now()
      const nextStatus = ended
        ? (stillPaid ? 'cancelled' : 'expired')
        : providerStatus === 'authorized' && stillPaid
        ? 'active'
        : current.status
      const { error: updateError } = await context.supabaseAdmin
        .from('subscriptions')
        .update({
          status: nextStatus,
          provider_status: providerStatus,
          cancelled_at: ended ? new Date().toISOString() : null,
        })
        .eq('id', current.id)
      if (updateError) {
        console.error('Unable to update subscription status', updateError.code)
        return errorResponse('Subscription status could not be saved', 500)
      }
      return Response.json({ received: true })
    }

    if (topic !== 'payment' && topic !== 'subscription_authorized_payment') {
      return Response.json({ received: true, ignored: true })
    }

    let payment: PaymentRecord
    let authorizedPreapprovalId: string | null = null
    try {
      if (topic === 'payment') {
        payment = paymentRecord(await mercadoPagoRequest(
          `/v1/payments/${encodeURIComponent(dataId)}`,
        ))
      } else {
        const authorized = await mercadoPagoRequest(
          `/authorized_payments/${encodeURIComponent(dataId)}`,
        )
        authorizedPreapprovalId = stringValue(authorized.preapproval_id)
        const nestedPayment = authorized.payment
        const nestedId = isRecord(nestedPayment)
          ? stringValue(nestedPayment.id)
          : stringValue(authorized.payment_id)
        if (!nestedId) {
          console.error('Authorized payment does not contain a payment reference')
          return errorResponse('Authorized payment data is incomplete', 502)
        }
        payment = paymentRecord(await mercadoPagoRequest(
          `/v1/payments/${encodeURIComponent(nestedId)}`,
        ))
      }
    } catch (error) {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'payment_webhook_verification_failed',
        'Mercado Pago payment notification could not be verified.',
        { topic },
      )
      console.error('Unable to verify payment notification', String(error))
      return errorResponse('Payment verification failed', 502)
    }

    const providerPaymentId = stringValue(payment.id)
    const providerSubscriptionId =
      stringValue(payment.preapproval_id) ?? authorizedPreapprovalId
    const status = paymentStatus(payment.status)
    const amount = Number(payment.transaction_amount)
    const currency = stringValue(payment.currency_id) ?? ''
    const paidAt = isoDate(payment.date_approved)
    const createdAt = isoDate(payment.date_created)
    if (!providerPaymentId || !providerSubscriptionId || !Number.isFinite(amount)) {
      return errorResponse('Payment data is incomplete', 502)
    }

    const { data: subscription, error: subscriptionError } =
      await context.supabaseAdmin
        .from('subscriptions')
        .select('id, user_id, status, cancelled_at, current_period_start, current_period_end, last_payment_at')
        .eq('provider_subscription_id', providerSubscriptionId)
        .maybeSingle()
    if (subscriptionError) {
      console.error('Unable to find payment subscription', subscriptionError.code)
      return errorResponse('Subscription record is unavailable', 500)
    }
    if (!subscription) return errorResponse('Subscription record was not found', 404)

    const { error: paymentError } = await context.supabaseAdmin
      .from('payments')
      .upsert({
        subscription_id: subscription.id,
        user_id: subscription.user_id,
        provider_payment_id: providerPaymentId,
        status,
        amount,
        currency,
        paid_at: paidAt,
        provider_created_at: createdAt,
      }, { onConflict: 'provider_payment_id' })
    if (paymentError) {
      console.error('Unable to save payment event', paymentError.code)
      return errorResponse('Payment event could not be saved', 500)
    }

    if (status === 'refunded') {
      const { data: latestApproved, error: latestError } =
        await context.supabaseAdmin
          .from('payments')
          .select('paid_at, entitlement_period_end')
          .eq('subscription_id', subscription.id)
          .eq('status', 'approved')
          .not('entitlement_period_end', 'is', null)
          .order('entitlement_period_end', { ascending: false })
          .limit(1)
          .maybeSingle()
      if (latestError) {
        console.error('Unable to verify remaining paid periods', latestError.code)
        return errorResponse('Subscription period could not be verified', 500)
      }
      const restoredPeriodEnd = latestApproved?.entitlement_period_end
        ? new Date(latestApproved.entitlement_period_end).getTime()
        : 0
      const stillPaid = restoredPeriodEnd > Date.now()
      const { error: revokeError } = await context.supabaseAdmin
        .from('subscriptions')
        .update({
          status: stillPaid
            ? subscription.status === 'cancelled' ? 'cancelled' : 'active'
            : 'expired',
          current_period_start: latestApproved?.paid_at ?? null,
          current_period_end: new Date(Math.max(restoredPeriodEnd, Date.now())).toISOString(),
          last_payment_at: latestApproved?.paid_at ?? null,
        })
        .eq('id', subscription.id)
      if (revokeError) {
        console.error('Unable to recalculate refunded subscription period', revokeError.code)
        return errorResponse('Subscription status could not be updated', 500)
      }
      return Response.json({ received: true })
    }

    if (status !== 'approved') return Response.json({ received: true })
    if (amount !== MONTHLY_PRICE || currency !== 'BRL' || !paidAt) {
      console.error('Approved payment does not match the configured subscription plan')
      return Response.json({ received: true, entitlementUpdated: false })
    }

    let providerSubscription: Record<string, unknown>
    try {
      providerSubscription = await mercadoPagoRequest(
        `/preapproval/${encodeURIComponent(providerSubscriptionId)}`,
      )
    } catch (error) {
      await recordSystemEvent(
        context.supabaseAdmin,
        'payments',
        'subscription_period_verification_failed',
        'The Mercado Pago subscription period could not be verified.',
        { topic },
      )
      console.error('Unable to verify subscription period', String(error))
      return errorResponse('Subscription period verification failed', 502)
    }
    if (stringValue(providerSubscription.status) !== 'authorized') {
      return Response.json({ received: true, entitlementUpdated: false })
    }

    const autoRecurring = providerSubscription.auto_recurring
    const recurring = autoRecurring && typeof autoRecurring === 'object'
      ? autoRecurring as Record<string, unknown>
      : {}
    const periodEnd = isoDate(providerSubscription.next_payment_date) ??
      isoDate(recurring.next_payment_date) ??
      addOneCalendarMonth(paidAt)
    const { error: periodError } = await context.supabaseAdmin
      .from('payments')
      .update({ entitlement_period_end: periodEnd })
      .eq('provider_payment_id', providerPaymentId)
    if (periodError) {
      console.error('Unable to save payment entitlement period', periodError.code)
      return errorResponse('Payment entitlement period could not be saved', 500)
    }

    const currentEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end).getTime()
      : 0
    const finalEnd = Math.max(currentEnd, new Date(periodEnd).getTime())
    const hasNewerPayment = subscription.last_payment_at &&
      new Date(subscription.last_payment_at).getTime() > new Date(paidAt).getTime()
    const { error: activateError } = await context.supabaseAdmin
      .from('subscriptions')
      .update({
        status: finalEnd > Date.now() ? 'active' : 'expired',
        provider_status: 'authorized',
        current_period_start: hasNewerPayment
          ? subscription.current_period_start
          : paidAt,
        current_period_end: new Date(finalEnd).toISOString(),
        last_payment_at: hasNewerPayment
          ? subscription.last_payment_at
          : paidAt,
        cancelled_at: null,
      })
      .eq('id', subscription.id)
    if (activateError) {
      console.error('Unable to activate paid subscription', activateError.code)
      return errorResponse('Subscription entitlement could not be saved', 500)
    }

    return Response.json({ received: true, entitlementUpdated: true })
  }),
}
