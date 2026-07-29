import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// RFC 6238 のテスト用に広く使われる公開ベクタ（実際のシードではない）
const TEST_SECRET = "JBSWY3DPEHPK3PXP";

// Mock process.exit — 新実装は使わないが、回帰防止のため未呼び出しを検証する
const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

import { getCredentials, getOTP } from "./credentials.js";

describe("credentials", () => {
  beforeEach(() => {
    exitSpy.mockClear();
    vi.stubEnv("MF_USERNAME", "user-a@example.com");
    vi.stubEnv("MF_PASSWORD", "correct-horse-battery-staple");
    vi.stubEnv("MF_TOTP_SECRET", TEST_SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("getCredentials", () => {
    test("returns credentials from environment variables", async () => {
      const result = await getCredentials();

      expect(result).toEqual({
        username: "user-a@example.com",
        password: "correct-horse-battery-staple",
      });
    });

    test("throws when MF_USERNAME is empty", async () => {
      vi.stubEnv("MF_USERNAME", "");

      await expect(getCredentials()).rejects.toThrow("MF_USERNAME が設定されていません");
    });

    test("throws when MF_PASSWORD is empty", async () => {
      vi.stubEnv("MF_PASSWORD", "");

      await expect(getCredentials()).rejects.toThrow("MF_PASSWORD が設定されていません");
    });

    test("trims surrounding whitespace", async () => {
      vi.stubEnv("MF_USERNAME", "  user-a@example.com  ");
      vi.stubEnv("MF_PASSWORD", "  correct-horse-battery-staple  ");

      const result = await getCredentials();

      expect(result).toEqual({
        username: "user-a@example.com",
        password: "correct-horse-battery-staple",
      });
    });

    test("does not call process.exit", async () => {
      await getCredentials();

      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("getOTP", () => {
    test("returns a 6-digit TOTP for a fixed time", async () => {
      const otp = await getOTP();

      expect(otp).toMatch(/^\d{6}$/);
    });

    test("returns the same value for a lowercase, space-separated seed", async () => {
      const expected = await getOTP();

      vi.stubEnv("MF_TOTP_SECRET", "jbsw y3dp ehpk 3pxp");
      const actual = await getOTP();

      expect(actual).toBe(expected);
    });

    test("throws when MF_TOTP_SECRET is empty", async () => {
      vi.stubEnv("MF_TOTP_SECRET", "");

      await expect(getOTP()).rejects.toThrow("MF_TOTP_SECRET が設定されていません");
    });

    test("throws on an invalid Base32 secret without leaking it in the message", async () => {
      vi.stubEnv("MF_TOTP_SECRET", "not-valid-base32!!!");

      await expect(getOTP()).rejects.toThrow("MF_TOTP_SECRET が有効な Base32 文字列ではありません");
      await expect(getOTP()).rejects.not.toThrow(/not-valid-base32/);
    });

    test("changes value across a 30-second period boundary", async () => {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const before = await getOTP();

      vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
      const after = await getOTP();

      expect(after).not.toBe(before);
    });
  });
});
