import { describe, expect, expectTypeOf, it } from "vitest";
import {
  API_KEY_MASKED_RE,
  ApiKeyMasked,
  Avatar,
  Broker,
  AccountLabel,
  BrokerCredentialPublic,
  MAX_ACCOUNTS_PER_BROKER,
  BrokerScope,
  Density,
  Id,
  Mobile,
  ReferralCode,
  Theme,
  User,
  UserSettings,
  maskApiKey,
} from "./accounts.js";

/** Copy without the given keys (test helper; keeps unused-variable lint clean). */
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const dropped = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !dropped.has(k))) as Omit<T, K>;
}

const user: User = {
  id: "usr_01J7",
  email: "trader@example.com",
  name: "Asha Trader",
  mobile: "9876543210",
  role: "user",
  avatar: "rocket",
  referralCode: "ASHA2026",
  createdAt: "2026-09-07T10:00:00Z",
};

const settings: UserSettings = {
  currency: "INR",
  conversionRate: "83.5",
  pnlBasis: "mark",
  lotSizes: { BTC: "0.001", ETH: "0.01", XAUT: "0.001" },
  theme: "dark",
  density: "comfortable",
  mindful: { enabled: true, thresholdUsd: "0", pauseSeconds: 30 },
};

const broker: Broker = {
  id: "brk_delta",
  venue: "delta_india",
  name: "Delta Exchange India",
  feePct: "0.05",
  gstPct: "18",
  feeCapPct: "10",
  scope: "GLOBAL",
};

const credential: BrokerCredentialPublic = {
  id: "crd_main",
  brokerId: "brk_delta",
  label: "Main",
  apiKeyMasked: "****ab12",
  connectedAt: "2026-09-07T10:00:00Z",
  whitelistedIp: "172.236.179.136",
};

describe("HC-SH-029 User", () => {
  it("accepts a full user and one without a mobile", () => {
    expect(User.safeParse(user).success).toBe(true);
    expect(User.safeParse(omit(user, "mobile")).success).toBe(true);
  });
  it("HC-SH-028 avatar is one of rocket / diamond / lightning", () => {
    expect(Avatar.options).toEqual(["rocket", "diamond", "lightning"]);
    expect(User.safeParse({ ...user, avatar: "unicorn" }).success).toBe(false);
  });
  it("HC-PB-031 validates email, 10-digit mobile and referral code", () => {
    expect(User.safeParse({ ...user, email: "not-an-email" }).success).toBe(false);
    expect(User.safeParse({ ...user, mobile: "12345" }).success).toBe(false);
    expect(User.safeParse({ ...user, mobile: "+919876543210" }).success).toBe(false);
    expect(Mobile.safeParse("9876543210").success).toBe(true);
    expect(ReferralCode.safeParse("ABC123").success).toBe(true);
    expect(ReferralCode.safeParse("abc123").success).toBe(false);
    expect(ReferralCode.safeParse("AB12").success).toBe(false);
    expect(ReferralCode.safeParse("ABCDEFGHIJKLM").success).toBe(false);
  });
  it("rejects blank names, bad roles, bad timestamps and unknown keys (strict)", () => {
    expect(User.safeParse({ ...user, name: "   " }).success).toBe(false);
    expect(User.safeParse({ ...user, role: "root" }).success).toBe(false);
    expect(User.safeParse({ ...user, createdAt: 1788543685911 }).success).toBe(false);
    expect(User.safeParse({ ...user, passwordHash: "x" }).success).toBe(false);
    expect(Id.safeParse("").success).toBe(false);
    expect(Id.safeParse("a".repeat(129)).success).toBe(false);
  });
  it("trims the name", () => {
    expect(User.parse({ ...user, name: "  Asha  " }).name).toBe("Asha");
  });
});

describe("HC-SH-038 UserSettings", () => {
  it("accepts valid settings", () => {
    expect(UserSettings.safeParse(settings).success).toBe(true);
    expect(UserSettings.safeParse({ ...settings, currency: "USD", pnlBasis: "bid_ask", theme: "light" }).success).toBe(
      true,
    );
  });
  it("HC-TR-183 mindful: defaults when absent, a non-negative USD threshold, a pause of 10 to 300 whole seconds", () => {
    const { mindful: _omit, ...without } = settings;
    void _omit;
    expect(UserSettings.parse(without).mindful).toEqual({ enabled: true, thresholdUsd: "0", pauseSeconds: 30 });
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: false, thresholdUsd: "25.5", pauseSeconds: 300 } }).success).toBe(true);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: "-1", pauseSeconds: 30 } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: 10, pauseSeconds: 30 } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: "0", pauseSeconds: 9 } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: "0", pauseSeconds: 301 } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: "0", pauseSeconds: 30.5 } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, mindful: { enabled: true, thresholdUsd: "0", pauseSeconds: 30, extra: 1 } }).success).toBe(false);
  });
  it("HC-SH-040 conversion rate must be a positive decimal string", () => {
    expect(UserSettings.safeParse({ ...settings, conversionRate: "0" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, conversionRate: "-83.5" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, conversionRate: 83.5 }).success).toBe(false);
  });
  it("HC-SH-041 lot sizes must cover every underlying with positive values", () => {
    expect(UserSettings.safeParse({ ...settings, lotSizes: { BTC: "0.001", ETH: "0.01" } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, lotSizes: { ...settings.lotSizes, SOL: "1" } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, lotSizes: { ...settings.lotSizes, BTC: "0" } }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, lotSizes: { ...settings.lotSizes, BTC: 0.001 } }).success).toBe(false);
  });
  it("HC-SH-044 pnlBasis, theme and density are closed enums; unknown keys fail", () => {
    expect(UserSettings.safeParse({ ...settings, pnlBasis: "last" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, theme: "auto" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, density: "cozy" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...settings, extra: true }).success).toBe(false);
    expect(Theme.options).toEqual(["dark", "light"]);
    expect(Density.options).toEqual(["comfortable", "compact"]);
  });
});

describe("HC-SH-032 Broker", () => {
  it("accepts a broker with GLOBAL or USER scope", () => {
    expect(Broker.safeParse(broker).success).toBe(true);
    expect(Broker.safeParse({ ...broker, scope: "USER" }).success).toBe(true);
    expect(BrokerScope.options).toEqual(["GLOBAL", "USER"]);
  });
  it("HC-SH-046 rejects negative or numeric percentages, blank names and unknown scopes", () => {
    expect(Broker.safeParse({ ...broker, feePct: "-0.01" }).success).toBe(false);
    expect(Broker.safeParse({ ...broker, gstPct: 18 }).success).toBe(false);
    expect(Broker.safeParse({ ...broker, feeCapPct: "ten" }).success).toBe(false);
    expect(Broker.safeParse({ ...broker, name: "" }).success).toBe(false);
    expect(Broker.safeParse({ ...broker, scope: "TEAM" }).success).toBe(false);
    expect(Broker.safeParse({ ...broker, apiSecret: "x" }).success).toBe(false);
  });
  it("accepts zero fees", () => {
    expect(Broker.safeParse({ ...broker, feePct: "0", gstPct: "0.00", feeCapPct: "0" }).success).toBe(true);
  });
});

describe("HC-SH-031 BrokerCredentialPublic", () => {
  it("accepts a masked credential", () => {
    expect(BrokerCredentialPublic.safeParse(credential).success).toBe(true);
  });
  it("HC-SH-123 an account has a name of 1 to 32 characters; the cap per exchange is five (ADR-068)", () => {
    expect(BrokerCredentialPublic.safeParse({ ...credential, label: "" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, label: "x".repeat(33) }).success).toBe(false);
    expect(AccountLabel.parse("  Sub 1  ")).toBe("Sub 1");
    expect(MAX_ACCOUNTS_PER_BROKER).toBe(5);
  });
  it("HC-SH-033 refuses any secret or raw key material", () => {
    expect(BrokerCredentialPublic.safeParse({ ...credential, apiSecret: "s3cr3t" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, apiKey: "full-key" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, apiKeyMasked: "full-key-1234" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, apiKeyMasked: "****" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, apiKeyMasked: "***ab123" }).success).toBe(false);
    expectTypeOf<BrokerCredentialPublic>().not.toHaveProperty("apiSecret");
    expectTypeOf<BrokerCredentialPublic>().not.toHaveProperty("apiKey");
  });
  it("HC-SH-036 whitelisted IP must be an IPv4 address", () => {
    expect(BrokerCredentialPublic.safeParse({ ...credential, whitelistedIp: "172.236.179" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, whitelistedIp: "999.1.1.1" }).success).toBe(false);
    expect(BrokerCredentialPublic.safeParse({ ...credential, connectedAt: "yesterday" }).success).toBe(false);
  });
  it("maskApiKey keeps only the last four characters", () => {
    expect(maskApiKey("abcdefgh1234")).toBe("****1234");
    expect(maskApiKey("ab")).toBe("****xxab");
    expect(maskApiKey("")).toBe("****xxxx");
    // Non-alphanumerics in the tail are replaced so the mask always matches ApiKeyMasked.
    expect(maskApiKey("key-with-dash-a-b")).toBe("****xaxb");
    expect(ApiKeyMasked.safeParse(maskApiKey("key-with-dash-a-b")).success).toBe(true);
    expect(ApiKeyMasked.safeParse(maskApiKey("abcdefgh1234")).success).toBe(true);
    expect(ApiKeyMasked.safeParse(maskApiKey("ab")).success).toBe(true);
    expect(API_KEY_MASKED_RE.test("****1234")).toBe(true);
  });
});
