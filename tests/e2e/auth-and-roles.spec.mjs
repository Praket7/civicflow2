import { browser, $, expect } from "@wdio/globals";

async function signIn(email, password) {
  const emailField = await $('input[name="email"]');
  await emailField.waitForDisplayed();
  await emailField.setValue(email);
  const passwordField = await $('input[name="password"]');
  await passwordField.setValue(password);
  await $('button[type="submit"]').click();
}

/**
 * Click a rendered button by its visible text. Setup is a sequence of
 * re-rendered steps, and a real click would wait on the embedded driver's
 * window probe, so the click is dispatched straight to the React handler.
 */
async function clickButton(label, groupLabel) {
  await browser.execute(
    (wanted, group) => {
      const scope = group ? document.querySelector(`[aria-label="${group}"]`) : document.body;
      const button = [...(scope ?? document.body).querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === wanted,
      );
      if (!(button instanceof HTMLElement)) throw new Error(`button ${wanted} missing`);
      button.click();
    },
    label,
    groupLabel,
  );
}

/**
 * The shell labels its sign-out control; the setup screens only write the
 * words. Both are the same action.
 */
async function signOut() {
  await browser.execute(() => {
    const button =
      document.querySelector('button[aria-label="Sign out"]') ??
      [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === "Sign out",
      );
    if (!(button instanceof HTMLElement)) throw new Error("Sign out button missing");
    button.click();
  });
}

/**
 * The code panel is rendered a tick after the form submits. Reading it in the
 * same breath as the click raced the render and passed only on a slower runner.
 */
async function readVerificationCode() {
  let code = "";
  await browser.waitUntil(
    async () => {
      code = await browser.execute(() => {
        const output = document.querySelector('output[aria-label="Verification code"]');
        return output?.textContent?.trim() ?? "";
      });
      return /^\d{6}$/.test(code);
    },
    // The panel appears after the account row is written, and writing it
    // hashes a password; a debug build spends minutes on that alone.
    { timeout: 300_000, timeoutMsg: "the verification code never appeared" },
  );
  return code;
}

/**
 * WebKit holds CSS animations on their first frame while the app window sits
 * behind another window, which is how an entrance that started at opacity 0
 * used to make a whole page invisible to WebDriver's visibility check. Freezing
 * the entrance here keeps that regression caught: the coordinator greeting has
 * to be readable even though the animation never advances.
 */
async function freezeEntrance() {
  await browser.execute(() => {
    const style = document.createElement("style");
    style.textContent = '[class*="pageTransition"] { animation-play-state: paused !important; }';
    document.head.appendChild(style);
  });
}

// The debug build hashes passwords and seeds the demo without optimisations,
// which puts a first sign-in well past the old twenty-second budget.
async function waitForHeading(pattern, message, timeout = 180_000) {
  await browser.waitUntil(
    async () =>
      (await $("h1"))
        .getText()
        .then((text) => pattern.test(text))
        .catch(() => false),
    { timeout, timeoutMsg: message },
  );
}

/** Resolves once the workspace shell is on screen, which means a session landed. */
async function waitForShell(message, timeout = 300_000) {
  await browser.waitUntil(
    async () => (await $('button[aria-label="Sign out"]')).isExisting().catch(() => false),
    { timeout, timeoutMsg: message },
  );
}

/** A hash change is how these tests ask for a specific screen. */
async function openRoute(path) {
  await browser.execute((target) => {
    window.location.hash = `#${target}`;
  }, path);
}

describe("CivicFlow native window", () => {
  it("opens signed out, with a way in", async () => {
    // The webview keeps its last hash across runs while the database is rebuilt,
    // so a stale token can land on the sign-in screen instead of the welcome
    // page. Both are public screens; the workspace must not be reachable.
    await browser.waitUntil(
      async () => {
        const heading = await $("h1")
          .getText()
          .catch(() => "");
        const emailVisible = await $('input[name="email"]')
          .isDisplayed()
          .catch(() => false);
        return /Service, organized|Welcome back|volunteer desk/.test(heading) || emailVisible;
      },
      { timeout: 30_000, timeoutMsg: "the app did not open on a public screen" },
    );
    expect(await $('button[aria-label="Sign out"]').isExisting()).toBe(false);

    await browser.execute(() => {
      window.location.hash = "#/welcome";
    });
    await waitForHeading(/Service, organized/, "the welcome screen did not render");
    await browser.execute(() => {
      const link = [...document.querySelectorAll("a")].find(
        (candidate) => candidate.textContent?.trim() === "Sign in",
      );
      if (!(link instanceof HTMLElement)) throw new Error("Sign in link missing");
      link.click();
    });
    const emailField = await $('input[name="email"]');
    await emailField.waitForDisplayed({ timeout: 20_000 });
    await expect(await $("h1")).toHaveText(/Welcome back/);
  });

  it("opens the demo workspace and reaches Mission Control", async () => {
    await freezeEntrance();
    // A fresh database has no accounts to type in, so the demo is the door:
    // it seeds the workspace and signs the coordinator in at once. Arriving
    // from a direct sign-in keeps the deep link the router remembered out of
    // the landing decision.
    await openRoute("/sign-in");
    const emailField = await $('input[name="email"]');
    await emailField.waitForDisplayed({ timeout: 30_000 });
    await clickButton("Open demo workspace");
    await waitForShell("the demo workspace never opened");
    await openRoute("/coordinator/mission-control");
    const greeting = await $("#mc-greeting");
    await greeting.waitForDisplayed({ timeout: 60_000 });
    await expect(greeting).toHaveText(/Praket/);
  });

  it("blocks the volunteer workspace for a coordinator", async () => {
    await browser.execute(() => {
      window.location.hash = "#/volunteer/home";
    });
    await browser.waitUntil(
      async () => (await $("#mc-greeting")).isDisplayed().catch(() => false),
      { timeout: 20_000, timeoutMsg: "coordinator was not returned to Mission Control" },
    );
    await expect(await $("#mc-greeting")).toHaveText(/Praket/);
  });

  it("signs out and lets the volunteer demo account in", async () => {
    // A WebDriver click that triggers a route change can wait on the navigation
    // in the embedded server. Dispatching the click keeps the same React
    // handler and returns as soon as the event is delivered.
    await signOut();

    const emailField = await $('input[name="email"]');
    await emailField.waitForDisplayed({ timeout: 30_000 });

    await signIn("maya.chen@example.org", "civicflow-demo");
    await waitForShell("the volunteer demo account never signed in");
    await openRoute("/volunteer/home");
    await waitForHeading(/Maya/, "volunteer home did not render");
  });

  it("blocks coordinator routes for a volunteer", async () => {
    await browser.execute(() => {
      window.location.hash = "#/coordinator/coverage";
    });
    await waitForHeading(/Maya/, "volunteer was not returned to volunteer home");
  });

  it("creates a volunteer account and signs it in again", async () => {
    await signOut();
    const emailField = await $('input[name="email"]');
    await emailField.waitForDisplayed({ timeout: 30_000 });

    // Setup flags and team membership live in this webview's store, which the
    // suite shares with the installed app: a fixed address can arrive with the
    // setup gate already finished or a team it joined in an earlier run. A
    // fresh address keeps every assertion about a brand-new volunteer.
    const email = `alicia.e2e.${Date.now()}@example.org`;

    await browser.execute(() => {
      window.location.hash = "#/create-account";
    });
    const nameField = await $('input[name="name"]');
    await nameField.waitForDisplayed({ timeout: 20_000 });
    await nameField.setValue("Alicia Moreno");
    await $('input[name="email"]').setValue(email);
    await $('input[name="new-password"]').setValue("second-saturday");
    await $('input[name="confirm-password"]').setValue("second-saturday");
    await $('button[type="submit"]').click();

    const code = await readVerificationCode();
    await $('input[name="verification-code"]').setValue(code);
    await $('button[type="submit"]').click();

    // A brand-new identity has no membership, so its role is none and the
    // create-or-join screen is its home until it acquires one.
    await waitForHeading(
      /Put your organization on the map/,
      "the new account did not land on the create-or-join screen",
      300_000,
    );
    const choices = await browser.execute(() =>
      [...document.querySelectorAll("button[aria-pressed]")].map(
        (button) => button.textContent?.trim() ?? "",
      ),
    );
    expect(choices.some((text) => text.includes("Join an existing team"))).toBe(true);
    expect(choices.some((text) => text.includes("Start a new organization"))).toBe(true);
    await browser.execute(() => {
      const start = [...document.querySelectorAll("button[aria-pressed]")].find((button) =>
        button.textContent?.includes("Start a new organization"),
      );
      if (!(start instanceof HTMLElement)) throw new Error("create choice missing");
      start.click();
    });
    await clickButton("Create organization");
    await waitForHeading(
      /Tell volunteers who you are/,
      "the new account could not start an organization",
      30_000,
    );

    // The same account can also join an existing public workspace. The demo
    // organization is public in a seeded database, which is what a volunteer
    // with no invitation would browse.
    await openRoute("/volunteer/start");
    await waitForHeading(/Find a place to serve/, "the new account did not reach discovery");
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          [...document.querySelectorAll("li button")].some(
            (button) => button.textContent?.trim() === "Join",
          ),
        ),
      { timeout: 60_000, timeoutMsg: "no public organization was listed" },
    );
    await browser.execute(() => {
      const join = [...document.querySelectorAll("li button")].find(
        (button) => button.textContent?.trim() === "Join",
      );
      if (!(join instanceof HTMLElement)) throw new Error("join button missing");
      join.click();
    });
    await waitForHeading(/Alicia/, "the new volunteer did not reach their own home", 300_000);

    // The account is a real row: it survives a sign-out and a fresh sign-in,
    // and a member now lands in the workspace its membership names.
    await signOut();
    const fields = await $('input[name="email"]');
    await fields.waitForDisplayed({ timeout: 30_000 });
    await signIn(email, "second-saturday");
    await waitForShell("the new account could not sign in again");
    await openRoute("/volunteer/home");
    await waitForHeading(/Alicia/, "the returning volunteer did not land on their home");
  });
});
