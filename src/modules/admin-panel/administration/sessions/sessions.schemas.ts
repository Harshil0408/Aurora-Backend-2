import { z } from 'zod';

/** DELETE /auth/sessions/:id — Sessions screen: revoke-one confirm. */
export const sessionIdParams = z.object({ id: z.string().min(1) });
