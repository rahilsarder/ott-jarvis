import { z } from 'zod';

export const createDeploymentSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  brandName: z.string().min(1).max(100).trim(),
  baseUrl: z.string().url(),
  sshHost: z.string().min(1).max(255).trim(),
  sshUser: z.string().min(1).max(100).trim(),
  sshPort: z.coerce.number().int().min(1).max(65535).default(22),
  adminEmail: z.string().email(),
  flussonicBaseUrl: z.string().url(),
  flussonicSecurelinkKey: z.string().max(500).default(''),
  licenseExpiresAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    .refine((v) => v === null || !Number.isNaN(v.getTime()), { message: 'Invalid date' }),
});
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

export const updateDeploymentSchema = createDeploymentSchema.partial().extend({
  status: z.enum(['REGISTERED', 'PROVISIONING', 'ACTIVE', 'FAILED', 'PAUSED', 'DECOMMISSIONED']).optional(),
});
export type UpdateDeploymentInput = z.infer<typeof updateDeploymentSchema>;
