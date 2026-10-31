import { describe, expect, it } from "vitest";
import { routes } from "../../app/routes";
import { helpTopics, topicForPath, validationRules } from "./topics";

describe("screen help", () => {
  it("has an entry for every registered route and no dead entries", () => {
    const ids = new Set(helpTopics.map((topic) => topic.id));
    for (const route of routes) {
      expect(ids.has(route.id), `missing help for ${route.id}`).toBe(true);
    }
    expect(new Set(helpTopics.map((topic) => topic.id)).size).toBe(helpTopics.length);
    expect(helpTopics.length).toBe(routes.length);
  });

  it("resolves every static path and the parameterised screens", () => {
    for (const route of routes.filter((entry) => !entry.path.includes(":"))) {
      expect(topicForPath(route.path)?.id, route.path).toBe(route.id);
    }
    expect(topicForPath("/volunteer/opportunities/community-food-distribution")?.id).toBe(
      "opportunity-detail",
    );
    expect(topicForPath("/volunteer/shifts/sh-sat-food")?.id).toBe("volunteer-shift");
    expect(topicForPath("/coordinator/shifts/sh-sat-food")?.id).toBe("coordinator-shift");
    expect(topicForPath("/coordinator/volunteers/vol-maya")?.id).toBe("volunteer-detail");
    expect(topicForPath("/coordinator/opportunities/opp-food")?.id).toBe("opportunity-management");
    expect(topicForPath("/not-a-screen")).toBeUndefined();
  });

  it("never ships an empty guide", () => {
    for (const topic of helpTopics) {
      expect(topic.title.length, topic.id).toBeGreaterThan(2);
      expect(topic.purpose.length, topic.id).toBeGreaterThan(20);
      expect(topic.steps.length, topic.id).toBeGreaterThan(0);
      for (const step of topic.steps) expect(step.length, topic.id).toBeGreaterThan(10);
    }
  });

  it("documents the validation rules the forms enforce", () => {
    const titles = validationRules().map((group) => group.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Sign in",
        "Create account",
        "Check in",
        "Hours review",
        "Installation backups",
        "Custom report builder",
      ]),
    );
  });
});
