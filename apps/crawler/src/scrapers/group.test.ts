import { describe, expect, test } from "vitest";
import { isNavigationInterrupted } from "./group.js";

describe("isNavigationInterrupted", () => {
  test("detects network-level abort", () => {
    expect(isNavigationInterrupted("net::ERR_ABORTED at https://moneyforward.com/")).toBe(true);
  });

  test("detects in-page navigation interruption (Playwright NavigationAbortedError message)", () => {
    expect(
      isNavigationInterrupted(
        'Navigation to "https://moneyforward.com/" is interrupted by another navigation to "https://moneyforward.com/spending_targets/edit"',
      ),
    ).toBe(true);
  });

  test("does not misclassify an unrelated timeout error", () => {
    expect(isNavigationInterrupted("Timeout 5000ms exceeded.")).toBe(false);
  });

  test("does not misclassify an unrelated selector error", () => {
    expect(isNavigationInterrupted("Group selector not found after switch")).toBe(false);
  });
});
