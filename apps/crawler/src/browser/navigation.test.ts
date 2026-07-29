import { describe, expect, test, vi } from "vitest";
import { gotoWithNavigationRetry, isNavigationInterrupted } from "./navigation.js";

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

describe("gotoWithNavigationRetry", () => {
  function createMockPage(gotoImpl: (...args: unknown[]) => unknown, isClosed = false) {
    return {
      goto: vi.fn<(...args: unknown[]) => unknown>(gotoImpl),
      waitForTimeout: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      isClosed: vi.fn<() => boolean>().mockReturnValue(isClosed),
      // biome-ignore lint: テスト用の最小モック
    } as any;
  }

  test("returns the response on first success without retrying", async () => {
    const response = { ok: () => true };
    const page = createMockPage(() => Promise.resolve(response));

    const result = await gotoWithNavigationRetry(page, "https://moneyforward.com/");

    expect(result).toBe(response);
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  test("retries once when navigation is interrupted, then succeeds", async () => {
    const response = { ok: () => true };
    let callCount = 0;
    const page = createMockPage(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(
          new Error(
            'Navigation to "https://moneyforward.com/" is interrupted by another navigation to "https://moneyforward.com/spending_targets/edit"',
          ),
        );
      }
      return Promise.resolve(response);
    });

    const result = await gotoWithNavigationRetry(page, "https://moneyforward.com/");

    expect(result).toBe(response);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
  });

  test("rethrows immediately for unrelated errors without retrying", async () => {
    const page = createMockPage(() => Promise.reject(new Error("Timeout 5000ms exceeded.")));

    await expect(gotoWithNavigationRetry(page, "https://moneyforward.com/")).rejects.toThrow(
      "Timeout 5000ms exceeded.",
    );
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  test("rethrows immediately when the page is already closed", async () => {
    const page = createMockPage(
      () =>
        Promise.reject(
          new Error(
            'Navigation to "https://moneyforward.com/" is interrupted by another navigation to "https://moneyforward.com/x"',
          ),
        ),
      true,
    );

    await expect(gotoWithNavigationRetry(page, "https://moneyforward.com/")).rejects.toThrow(
      "is interrupted by another navigation",
    );
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  test("rethrows if the retry attempt also fails", async () => {
    const page = createMockPage(() =>
      Promise.reject(
        new Error(
          'Navigation to "https://moneyforward.com/" is interrupted by another navigation to "https://moneyforward.com/x"',
        ),
      ),
    );

    await expect(gotoWithNavigationRetry(page, "https://moneyforward.com/")).rejects.toThrow(
      "is interrupted by another navigation",
    );
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
});
