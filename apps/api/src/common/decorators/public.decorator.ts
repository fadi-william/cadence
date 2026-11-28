import { SetMetadata } from '@nestjs/common';

/** Metadata key read by the auth guard. */
export const IS_PUBLIC_KEY = 'isPublic';
/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
