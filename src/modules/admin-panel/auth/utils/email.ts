/**
 * Email normalization: trim + lowercase only.
 *
 * Deliberately NOT doing Gmail dot-stripping or plus-address removal:
 * those merge potentially distinct accounts and create account-takeover
 * edge cases. Uniqueness is enforced on the normalized value.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
