import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../lib/auth/session";
import { DisplayPreferencesProvider } from "../lib/display";
import { LocaleProvider } from "../lib/i18n";
import { WorkspaceSessionProvider } from "../lib/workspace/session";
import { settleQueries } from "../test/queries";
import { pages } from "./router";
import { routes } from "./routes";
import type { RouteMeta } from "./routes";

const demoParams: Record<string, string> = {
  "opportunity-detail": "community-food-distribution",
  "opportunity-management": "opp-food",
  "volunteer-shift": "sh-sat-food",
  "coordinator-shift": "sh-sat-food",
  "volunteer-detail": "vol-maya",
};

function entryPath(route: RouteMeta) {
  const value = demoParams[route.id];
  return value ? route.path.replace(/:[^/]+/, value) : route.path;
}

// The credentials register renders every volunteer, skill and expiry row at
// once, and axe walks the whole tree. It needs longer than the rest.
const routeTimeout = (route: RouteMeta) => (route.id === "credentials" ? 180_000 : 30_000);

function renderRoute(route: RouteMeta) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = pages[route.id];
  if (!page) throw new Error(`Route ${route.id} has no registered page`);
  const rendered = render(
    <DisplayPreferencesProvider>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <WorkspaceSessionProvider>
              <MemoryRouter initialEntries={[entryPath(route)]}>
                <Routes>
                  <Route path={route.path} element={page} />
                </Routes>
              </MemoryRouter>
            </WorkspaceSessionProvider>
          </AuthProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </DisplayPreferencesProvider>,
  );
  return { ...rendered, queryClient };
}

describe("route accessibility", () => {
  for (const route of routes) {
    it(
      `${route.number}. ${route.title} has no serious ARIA or landmark violations`,
      async () => {
        const { container, queryClient } = renderRoute(route);
        await waitFor(
          () => {
            expect((container.textContent ?? "").trim().length).toBeGreaterThan(40);
          },
          { timeout: 5000 },
        );
        await settleQueries(queryClient);

        // The hosted workspace is an iframe around the volunteer client, a
        // separate document jsdom cannot frame-scan. The framed client has its
        // own axe pass in the PWA suite.
        const results = await axe(
          container,
          route.id === "shared-workspace" ? { iframes: false } : undefined,
        );
        const blocking = results.violations.filter(
          (violation) => violation.impact === "serious" || violation.impact === "critical",
        );
        expect(blocking).toEqual([]);
      },
      routeTimeout(route),
    );
  }
});
