import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SignInPage } from "../features/public/SignInPage";
import { AuthProvider } from "../lib/auth/session";
import { getWorkspaceRepository } from "../lib/workspace/repository";

async function seedSession(role: "coordinator" | "volunteer") {
  const email = role === "coordinator" ? "praket@rivergate.example" : "maya.chen@example.org";
  const session = await getWorkspaceRepository().signIn(email, "civicflow-demo", true);
  localStorage.setItem("civicflow.auth.token", session.token);
}

function renderAt(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/welcome" element={<p>Welcome page</p>} />
          <Route path="/volunteer/home" element={<p>Volunteer home</p>} />
          <Route path="/coordinator/mission-control" element={<p>Mission control</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/**
 * Signing in on top of an existing session swaps accounts and drops the old
 * one, so the sign-in screen must never be reachable with a session in hand.
 */
describe("signed-in routing", () => {
  it("sends a volunteer who opens the sign-in page to their own home", async () => {
    await seedSession("volunteer");
    renderAt("/sign-in");

    expect(await screen.findByText("Volunteer home")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome back/ })).not.toBeInTheDocument();
  });

  it("sends a coordinator who opens the sign-in page to mission control", async () => {
    await seedSession("coordinator");
    renderAt("/sign-in");

    expect(await screen.findByText("Mission control")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome back/ })).not.toBeInTheDocument();
  });

  it("still shows the form when nobody is signed in", async () => {
    renderAt("/sign-in");

    expect(await screen.findByRole("heading", { name: /Welcome back/ })).toBeInTheDocument();
  });
});
