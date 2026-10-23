import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { UsageContext } from './types';

type Execution = { context: UsageContext; failure?: Error; sequence: number; executionId: string };
const storage = new AsyncLocalStorage<Execution>();

export class AiUsageError extends Error {
  readonly code: string;
  constructor(code: string, message = 'A IA foi pausada pelo controle de consumo. O atendimento humano continua disponível.') {
    super(message);
    this.name = 'AiUsageError';
    this.code = code;
  }
}

/** The context spans the complete run, including tools, helpers and action variables. */
export function runWithUsageContext<T>(context: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ context, sequence: 0, executionId: randomUUID() }, fn);
}

export function getUsageContext(): UsageContext | undefined { return storage.getStore()?.context; }
export function getUsageFailure(): Error | undefined { return storage.getStore()?.failure; }
export function requireUsageContext(): UsageContext {
  const context = getUsageContext();
  if (!context) throw new AiUsageError('AI_USAGE_CONTEXT_REQUIRED', 'Não foi possível autorizar o consumo desta operação de IA.');
  assertUsageHealthy();
  return context;
}

/** Tool executors may catch errors. This sticky failure prevents a later reply from escaping. */
export function failUsage(error: unknown): Error {
  const failure = error instanceof Error ? error : new AiUsageError('AI_USAGE_UNAVAILABLE');
  const execution = storage.getStore();
  if (execution && !execution.failure) execution.failure = failure;
  return failure;
}
export function assertUsageHealthy(): void {
  const failure = storage.getStore()?.failure;
  if (failure) throw failure;
}
export function nextUsageOperationId(): string {
  const execution = storage.getStore();
  if (!execution) throw new AiUsageError('AI_USAGE_CONTEXT_REQUIRED');
  return `${execution.executionId}:${++execution.sequence}`;
}

/** Administrative calls get their own budget; never turn a missing conversation context into one. */
export async function withAdministrativeUsage<T>(
  context: UsageContext,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = getUsageContext();
  if (existing) {
    if (existing.organizationId !== context.organizationId) throw failUsage(new AiUsageError('AI_USAGE_ORGANIZATION_MISMATCH'));
    return fn();
  }
  return runWithUsageContext(context, fn);
}
