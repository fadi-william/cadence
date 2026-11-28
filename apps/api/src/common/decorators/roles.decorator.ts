import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

/** Metadata key read by the auth guard. */
export const ROLES_KEY = 'roles';
/**
 * Restricts a controller or handler to the given roles. A handler's `@Roles()` overrides its controller's.
 * Data scoping within a role is done separately by `AccessScopeService`.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
