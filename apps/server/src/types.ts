import type { Session } from './auth/session.ts';

/** Hono のアプリの型（c.env と c.get('session')） */
export type AppEnv = { Bindings: Env; Variables: { session: Session } };
