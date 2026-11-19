// Public, no-login endpoints for judges and visitors (no personal data): /safety.
import { z } from 'zod';

/** GET /api/public/safety: how the shield works and what it stopped (rule + time only). */
export const SafetyResponse = z.object({
  /** pre-delivery: Nexconn pre-messaging blocks before anyone sees it; after-delivery: removed within ~1 s. */
  mode: z.enum(['pre-delivery', 'after-delivery']),
  rules: z.array(z.object({ rule: z.string(), label: z.string(), what: z.string(), count: z.number().int().min(0) })),
  recent: z.array(z.object({ rule: z.string(), at: z.string() })),
  /** Days the moderation log is kept. */
  retentionDays: z.number().int(),
});
export type SafetyResponse = z.infer<typeof SafetyResponse>;
