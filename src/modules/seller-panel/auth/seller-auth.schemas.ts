import { z } from 'zod';

export const registerSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(12).max(128),
  name: z.string().min(2).max(255).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const sellerLoginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export type SellerLoginInput = z.infer<typeof sellerLoginSchema>;
