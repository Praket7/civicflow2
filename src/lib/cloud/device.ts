/**
 * A human label for the health view. It is never an authorization claim: the
 * server already knows which membership and replica a request belongs to.
 */
export function desktopDevice(): { label: string; platform: string } {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Macintosh|Mac OS X/i.test(agent)) return { label: "CivicFlow desktop", platform: "macOS" };
  if (/Windows/i.test(agent)) return { label: "CivicFlow desktop", platform: "Windows" };
  if (/Linux/i.test(agent)) return { label: "CivicFlow desktop", platform: "Linux" };
  return { label: "CivicFlow desktop", platform: "Desktop" };
}
