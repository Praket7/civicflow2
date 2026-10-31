import { awaitSessionFromParent, isBridgedSession, sendSession, SESSION_MESSAGE } from "./bridge";

describe("desktop session bridge", () => {
  it("adopts only a pair of tokens", () => {
    expect(isBridgedSession({ accessToken: "a", refreshToken: "r" })).toBe(true);
    expect(isBridgedSession({ accessToken: "a" })).toBe(false);
    expect(isBridgedSession({ accessToken: 1, refreshToken: "r" })).toBe(false);
    expect(isBridgedSession(null)).toBe(false);
  });

  it("does nothing when there is no frame", () => {
    expect(() => sendSession(null, { access_token: "a", refresh_token: "r" })).not.toThrow();
  });

  it("posts the session as tokens and nothing else", () => {
    const posted: Array<{ message: unknown; target: string }> = [];
    const frame = {
      contentWindow: {
        postMessage: (message: unknown, target: string) => posted.push({ message, target }),
      },
    } as unknown as HTMLIFrameElement;

    sendSession(frame, { access_token: "access", refresh_token: "refresh" });

    expect(posted).toEqual([
      {
        message: {
          type: SESSION_MESSAGE,
          session: { accessToken: "access", refreshToken: "refresh" },
        },
        // The packaged scheme can serialize its origin as "null", which
        // postMessage refuses; identity is proven by event.source instead.
        target: "*",
      },
    ]);
  });

  it("passes an explicit absence of a session rather than staying silent", () => {
    const posted: unknown[] = [];
    const frame = {
      contentWindow: { postMessage: (message: unknown) => posted.push(message) },
    } as unknown as HTMLIFrameElement;

    sendSession(frame, null);

    expect(posted).toEqual([{ type: SESSION_MESSAGE, session: null }]);
  });

  it("resolves to no session in a top-level document", async () => {
    await expect(awaitSessionFromParent(10)).resolves.toBeNull();
  });
});
