import type { Page, Response } from "playwright";

/**
 * ナビゲーションが別のナビゲーションによって中断されたかどうかを判定する。
 *
 * Playwright は中断されたナビゲーションを `NavigationAbortedError` として送出するが、
 * クライアント側にはプレーンな `Error` としてシリアライズされて届くため、
 * `instanceof` では判定できず、メッセージ文字列で判定する必要がある。
 * - ネットワークレベルの中断: `net::ERR_ABORTED` を含む
 * - ページ内遷移による中断（例: MoneyForwardの自動リダイレクト）: `is interrupted by another navigation` を含む
 */
export function isNavigationInterrupted(message: string): boolean {
  return (
    message.includes("net::ERR_ABORTED") || message.includes("is interrupted by another navigation")
  );
}

/**
 * MoneyForwardが支出目標の設定督促などでページ内リダイレクトを挟むことがあり、
 * `page.goto` が `NavigationAbortedError` で中断されることがある。
 * 中断を検知した場合のみ1秒待機して1回だけ再遷移する。
 *
 * 戻り値は Playwright の `page.goto` と同じ `Response | null`。
 * 呼び出し元が `response.ok()` 等で遷移結果を検証する場合はこの戻り値を使う。
 */
export async function gotoWithNavigationRetry(
  page: Page,
  url: string,
  options?: Parameters<Page["goto"]>[1],
): Promise<Response | null> {
  try {
    return await page.goto(url, options);
  } catch (err) {
    if (page.isClosed()) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (!isNavigationInterrupted(message)) {
      throw err;
    }
    await page.waitForTimeout(1000);
    return await page.goto(url, options);
  }
}
