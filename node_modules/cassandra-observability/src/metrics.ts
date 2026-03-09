/**
 * Shared metrics push utility for Cloudflare Workers.
 *
 * Serializes metrics to Prometheus text exposition format and POSTs
 * to VictoriaMetrics via CF Access-protected endpoint.
 *
 * Usage:
 *   ctx.waitUntil(pushMetrics(env, [
 *     counter("mcp_requests_total", 1, { service: "portal", status: "200" }),
 *     gauge("mcp_active_keys", 42, { service: "portal" }),
 *   ]));
 */

export interface MetricsEnv {
  VM_PUSH_URL: string;
  VM_PUSH_CLIENT_ID: string;
  VM_PUSH_CLIENT_SECRET: string;
}

export interface Metric {
  name: string;
  value: number;
  labels: Record<string, string>;
}

/** Create a counter metric (monotonically increasing). */
export function counter(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): Metric {
  return { name, value, labels };
}

/** Create a gauge metric (can go up or down). */
export function gauge(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): Metric {
  return { name, value, labels };
}

/** Create a histogram observation (single sample). */
export function histogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): Metric {
  return { name, value, labels };
}

/**
 * Serialize metrics to Prometheus text exposition format.
 *
 * Each metric becomes: `metric_name{label1="val1",label2="val2"} value timestamp`
 */
export function serialize(metrics: Metric[]): string {
  const ts = Date.now();
  return metrics
    .map((m) => {
      const labelStr = Object.entries(m.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      const fqn = labelStr ? `${m.name}{${labelStr}}` : m.name;
      return `${fqn} ${m.value} ${ts}`;
    })
    .join("\n");
}

/**
 * Push metrics to VictoriaMetrics. Fire-and-forget — silently swallows errors.
 *
 * Use with `ctx.waitUntil(pushMetrics(env, [...]))` to avoid blocking the response.
 */
export async function pushMetrics(
  env: MetricsEnv,
  metrics: Metric[],
): Promise<void> {
  if (!env.VM_PUSH_URL || metrics.length === 0) return;

  try {
    await fetch(env.VM_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "CF-Access-Client-Id": env.VM_PUSH_CLIENT_ID,
        "CF-Access-Client-Secret": env.VM_PUSH_CLIENT_SECRET,
      },
      body: serialize(metrics),
    });
  } catch {
    // Fire-and-forget — don't let metrics failure affect the request
  }
}
