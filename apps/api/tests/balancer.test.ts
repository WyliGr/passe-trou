import { describe, expect, it } from "vitest";
import { Balancer } from "../src/proxy/balancer.ts";

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const A = { id: "mA", accountId: "acctA" };
const B = { id: "mB", accountId: "acctB" };

describe("pick — least-used in trailing 60 s", () => {
  it("ties resolve to the first candidate; starts spread 1/1 then to the less-used", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    expect(b.pick([A, B])).toBe("mA");
    b.recordStart("mA");
    expect(b.pick([A, B])).toBe("mB");
    b.recordStart("mB");
    expect(b.pick([A, B])).toBe("mA"); // 1/1 tie → first
  });

  it("starts older than 60 s fall out of the window", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    b.pick([A, B]);
    b.recordStart("mA");
    clock.advance(61_000);
    expect(b.pick([A, B])).toBe("mA"); // mA's start expired → tie → first
  });
});

describe("trip — circuit breaker with per-account cooldown", () => {
  it("trip isolates to the tripped account and lasts exactly retryAfterSec", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    b.pick([A, B]);
    b.trip("acctA", { retryAfterSec: 120 });
    expect(b.cooldownRemainingSec("mA")).toBe(120);
    expect(b.pick([A, B])).toBe("mB");
    clock.advance(119_000);
    expect(b.pick([A, B])).toBe("mB");
    clock.advance(1_000);
    expect(b.pick([A, B])).toBe("mA"); // cooldown expired
  });

  it("all accounts cooling → pick null; per-mapping remaining cooldowns expose the min", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    b.pick([A, B]);
    b.trip("acctA", { retryAfterSec: 120 });
    b.trip("acctB", { retryAfterSec: 45 });
    expect(b.pick([A, B])).toBeNull();
    const remaining = [b.cooldownRemainingSec("mA"), b.cooldownRemainingSec("mB")];
    expect(Math.min(...(remaining as number[]))).toBe(45);
  });

  it("exponential backoff doubles 30→…→960 and caps at 1800", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    b.pick([A]);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      b.trip("acctA");
      seen.push(b.cooldownRemainingSec("mA")!);
    }
    expect(seen).toEqual([30, 60, 120, 240, 480, 960, 1800, 1800]);
  });

  it("recordDone resets the account's strikes", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    b.pick([A]);
    b.trip("acctA");
    b.trip("acctA");
    b.recordDone("mA");
    b.trip("acctA");
    expect(b.cooldownRemainingSec("mA")).toBe(30);
  });

  it("trip persists Account.cooledDownUntil through the injected persist hook", () => {
    const clock = fakeClock();
    const calls: Array<{ accountId: string; until: Date }> = [];
    const b = new Balancer({
      now: clock.now,
      persist: (accountId, until) => {
        calls.push({ accountId, until });
      },
    });
    b.trip("acctA", { retryAfterSec: 120 });
    expect(calls).toEqual([{ accountId: "acctA", until: new Date(1_000_000 + 120_000) }]);
  });

  it("hydrate restores persisted cooldowns after a restart", () => {
    const clock = fakeClock();
    const fresh = new Balancer({ now: clock.now }); // post-restart: memory empty
    fresh.hydrate("acctA", new Date(1_000_000 + 120_000));
    expect(fresh.pick([A, B])).toBe("mB");
    expect(fresh.cooldownRemainingSec("mA")).toBe(120);
  });

  it("hydrate ignores null and already-expired cooldowns", () => {
    const clock = fakeClock();
    const fresh = new Balancer({ now: clock.now });
    fresh.hydrate("acctA", null);
    fresh.hydrate("acctB", new Date(1_000_000 - 1));
    expect(fresh.pick([A, B])).toBe("mA");
  });

  it("cooldownRemainingSec is null for unknown mappings and expired cooldowns", () => {
    const clock = fakeClock();
    const b = new Balancer({ now: clock.now });
    expect(b.cooldownRemainingSec("mA")).toBeNull();
    b.pick([A]);
    b.trip("acctA", { retryAfterSec: 30 });
    clock.advance(30_000);
    expect(b.cooldownRemainingSec("mA")).toBeNull();
  });
});
