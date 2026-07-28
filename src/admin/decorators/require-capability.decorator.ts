import { SetMetadata } from '@nestjs/common';
import type { Capability } from '../capabilities';

export const REQUIRE_CAPABILITY_KEY = 'require_capability';

/**
 * Require the admin to hold AT LEAST ONE of the listed capabilities.
 * Enforced by CapabilitiesGuard. Use on admin routes that mutate state or
 * expose sensitive data (KYC PII, audit log). Routes with no decorator are
 * viewable by any admin (read-only included).
 */
export const RequireCapability = (...capabilities: Capability[]) =>
  SetMetadata(REQUIRE_CAPABILITY_KEY, capabilities);
