/**
 * The provider speaks in API messages; a person signing in needs an action.
 * Both sign-in paths — the hosted workspace and the volunteer PWA — go
 * through this so the same failure cannot read two ways.
 */
export function describeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password do not match.";
  if (/email not confirmed/i.test(message)) return "Confirm your email address first.";
  if (/rate limit|too many/i.test(message))
    return "Too many attempts. Wait a minute and try again.";
  return message;
}
