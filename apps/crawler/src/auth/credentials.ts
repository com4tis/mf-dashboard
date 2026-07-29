import { Secret, TOTP } from "otpauth";
import { debug } from "../logger.js";

interface Credentials {
  username: string;
  password: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} が設定されていません`);
  }
  return value;
}

export async function getCredentials(): Promise<Credentials> {
  debug("環境変数から認証情報を取得しています...");
  return {
    username: requireEnv("MF_USERNAME"),
    password: requireEnv("MF_PASSWORD"),
  };
}

export async function getOTP(): Promise<string> {
  const secret = requireEnv("MF_TOTP_SECRET");

  debug("TOTP を生成しています...");
  let totp: TOTP;
  try {
    totp = new TOTP({
      secret: Secret.fromBase32(secret.replace(/\s+/g, "").toUpperCase()),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  } catch {
    // otpauth の例外にシード断片が含まれる可能性があり、ログへ流出するのを防ぐため握り潰して再送出する
    throw new Error("MF_TOTP_SECRET が有効な Base32 文字列ではありません");
  }

  const otp = totp.generate();
  if (!otp) {
    throw new Error("OTP の生成に失敗しました");
  }

  return otp;
}
