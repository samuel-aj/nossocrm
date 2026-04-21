import type { SupabaseClient } from '@supabase/supabase-js';

// Exponential backoff schedule (in minutes): 1m, 5m, 30m, 2h, 12h
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const MAX_RETRIES = BACKOFF_MINUTES.length;
const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookEventOut {
  id: string;
  organization_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
}

interface OutboundEndpoint {
  id: string;
  url: string;
  secret: string;
  active: boolean;
}

interface WebhookDelivery {
  id: string;
  organization_id: string;
  endpoint_id: string;
  event_id: string;
  status: string;
  retry_count: number;
  next_retry_at: string | null;
}

interface DeliveryResult {
  deliveryId: string;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// deliverWebhook — deliver a single event by its delivery row
// ---------------------------------------------------------------------------

/**
 * Attempts to deliver a webhook for a specific delivery row.
 *
 * Flow:
 * 1. Read the delivery + event + endpoint
 * 2. POST to endpoint URL with 10s timeout
 * 3. Log result (status, response_code, response_body, duration_ms)
 * 4. On failure: schedule retry with exponential backoff (up to 5 retries)
 * 5. Update event status: pending → delivered | failed
 */
export async function deliverWebhook(
  supabase: SupabaseClient,
  deliveryId: string
): Promise<DeliveryResult> {
  // 1. Fetch delivery row
  const { data: delivery, error: delErr } = await supabase
    .from('webhook_deliveries')
    .select('*')
    .eq('id', deliveryId)
    .single<WebhookDelivery>();

  if (delErr || !delivery) {
    return { deliveryId, success: false, error: `Delivery not found: ${delErr?.message}` };
  }

  // 2. Fetch the event
  const { data: event, error: evtErr } = await supabase
    .from('webhook_events_out')
    .select('*')
    .eq('id', delivery.event_id)
    .single<WebhookEventOut>();

  if (evtErr || !event) {
    await markDeliveryFailed(supabase, deliveryId, 'Event not found');
    return { deliveryId, success: false, error: 'Event not found' };
  }

  // 3. Fetch the endpoint
  const { data: endpoint, error: epErr } = await supabase
    .from('integration_outbound_endpoints')
    .select('*')
    .eq('id', delivery.endpoint_id)
    .single<OutboundEndpoint>();

  if (epErr || !endpoint) {
    await markDeliveryFailed(supabase, deliveryId, 'Endpoint not found');
    return { deliveryId, success: false, error: 'Endpoint not found' };
  }

  if (!endpoint.active) {
    await markDeliveryFailed(supabase, deliveryId, 'Endpoint disabled');
    await updateEventStatus(supabase, delivery.event_id, 'failed');
    return { deliveryId, success: false, error: 'Endpoint disabled' };
  }

  // 4. Make the HTTP POST
  const start = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let deliveryError: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': endpoint.secret,
        'Authorization': `Bearer ${endpoint.secret}`,
      },
      body: JSON.stringify(event.payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    responseStatus = res.status;

    // Read response body (truncate to 4KB to avoid storing huge payloads)
    try {
      const text = await res.text();
      responseBody = text.slice(0, 4096);
    } catch {
      responseBody = null;
    }

    success = res.ok; // 2xx
    if (!success) {
      deliveryError = `HTTP ${res.status}`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      deliveryError = `Timeout after ${DELIVERY_TIMEOUT_MS}ms`;
    } else {
      deliveryError = message;
    }
  }

  const durationMs = Date.now() - start;

  // 5. Update delivery row
  if (success) {
    await supabase
      .from('webhook_deliveries')
      .update({
        status: 'delivered',
        response_status: responseStatus,
        response_body: responseBody,
        duration_ms: durationMs,
        attempted_at: new Date().toISOString(),
        error: null,
        next_retry_at: null,
      })
      .eq('id', deliveryId);

    // Mark event as delivered
    await updateEventStatus(supabase, delivery.event_id, 'delivered');

    return { deliveryId, success: true };
  }

  // Failed — schedule retry or mark as permanently failed
  const retryCount = (delivery.retry_count || 0) + 1;

  if (retryCount >= MAX_RETRIES) {
    // Exhausted all retries
    await supabase
      .from('webhook_deliveries')
      .update({
        status: 'failed',
        retry_count: retryCount,
        response_status: responseStatus,
        response_body: responseBody,
        duration_ms: durationMs,
        attempted_at: new Date().toISOString(),
        error: deliveryError,
        next_retry_at: null,
      })
      .eq('id', deliveryId);

    await updateEventStatus(supabase, delivery.event_id, 'failed');

    return { deliveryId, success: false, error: `Exhausted ${MAX_RETRIES} retries: ${deliveryError}` };
  }

  // Schedule next retry with exponential backoff
  const backoffMinutes = BACKOFF_MINUTES[retryCount - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

  await supabase
    .from('webhook_deliveries')
    .update({
      status: 'queued',
      retry_count: retryCount,
      response_status: responseStatus,
      response_body: responseBody,
      duration_ms: durationMs,
      attempted_at: new Date().toISOString(),
      error: deliveryError,
      next_retry_at: nextRetryAt,
    })
    .eq('id', deliveryId);

  return { deliveryId, success: false, error: `Retry ${retryCount}/${MAX_RETRIES} scheduled at ${nextRetryAt}` };
}

// ---------------------------------------------------------------------------
// retryFailedWebhooks — find all deliveries due for retry and process them
// ---------------------------------------------------------------------------

/**
 * Finds all queued deliveries where `next_retry_at <= now()` and attempts
 * to deliver each one. Also picks up deliveries with status='queued' and
 * no next_retry_at (initial delivery from the Postgres trigger).
 *
 * Returns summary of processed deliveries.
 */
export async function retryFailedWebhooks(
  supabase: SupabaseClient
): Promise<{ processed: number; succeeded: number; failed: number; results: DeliveryResult[] }> {
  const now = new Date().toISOString();

  // Find deliveries that are due for retry OR initial deliveries that were never
  // picked up by the application layer (next_retry_at is null, retry_count = 0,
  // status = 'queued')
  const { data: deliveries, error } = await supabase
    .from('webhook_deliveries')
    .select('id')
    .eq('status', 'queued')
    .or(`next_retry_at.is.null,next_retry_at.lte.${now}`)
    .order('attempted_at', { ascending: true })
    .limit(100);

  if (error || !deliveries?.length) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] };
  }

  const results: DeliveryResult[] = [];
  let succeeded = 0;
  let failed = 0;

  // Process sequentially to avoid overwhelming destination servers
  for (const row of deliveries) {
    const result = await deliverWebhook(supabase, row.id);
    results.push(result);
    if (result.success) succeeded++;
    else failed++;
  }

  return {
    processed: deliveries.length,
    succeeded,
    failed,
    results,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markDeliveryFailed(supabase: SupabaseClient, deliveryId: string, error: string) {
  await supabase
    .from('webhook_deliveries')
    .update({
      status: 'failed',
      error,
      attempted_at: new Date().toISOString(),
      next_retry_at: null,
    })
    .eq('id', deliveryId);
}

async function updateEventStatus(supabase: SupabaseClient, eventId: string, status: 'delivered' | 'failed') {
  // Only update if not already in a terminal state
  // For 'delivered': always set (even if one endpoint delivered)
  // For 'failed': only set if ALL deliveries for this event are failed
  if (status === 'delivered') {
    await supabase
      .from('webhook_events_out')
      .update({ status: 'delivered' })
      .eq('id', eventId);
    return;
  }

  // Check if any delivery for this event is still queued or delivered
  const { data: remaining } = await supabase
    .from('webhook_deliveries')
    .select('id')
    .eq('event_id', eventId)
    .in('status', ['queued', 'delivered'])
    .limit(1);

  if (!remaining?.length) {
    await supabase
      .from('webhook_events_out')
      .update({ status: 'failed' })
      .eq('id', eventId);
  }
}
