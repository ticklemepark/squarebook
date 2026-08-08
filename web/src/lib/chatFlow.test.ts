import { describe, expect, it } from "vitest";
import { chatReduce, findMember, normalizeUnit, parseStake, type ChatState } from "./chatFlow";
import type { Member } from "./types";

const members: Member[] = [
  { address: "0x1111111111111111111111111111111111111111", name: "Timothy", joinedAt: 0n },
  { address: "0x2222222222222222222222222222222222222222", name: "Alex", joinedAt: 0n },
  { address: "0x3333333333333333333333333333333333333333", name: "Sam", joinedAt: 0n },
];
const me = members[0].address as `0x${string}`;

describe("parseStake", () => {
  it("parses dollar amounts", () => {
    expect(parseStake("$20")).toEqual({ qty: 20, unit: "USD" });
    expect(parseStake("20 bucks")).toEqual({ qty: 20, unit: "USD" });
  });
  it("parses counted units and singularizes", () => {
    expect(parseStake("2 coffees")).toEqual({ qty: 2, unit: "coffee" });
    expect(parseStake("3 x dinner")).toEqual({ qty: 3, unit: "dinner" });
  });
  it("parses bare units as qty 1", () => {
    expect(parseStake("a coffee")).toEqual({ qty: 1, unit: "coffee" });
    expect(parseStake("dessert")).toEqual({ qty: 1, unit: "dessert" });
  });
  it("rejects nonsense", () => {
    expect(parseStake("???")).toBeUndefined();
  });
});

describe("normalizeUnit", () => {
  it("maps dollar words to USD", () => {
    expect(normalizeUnit("dollars")).toBe("USD");
    expect(normalizeUnit("$")).toBe("USD");
  });
  it("keeps short words intact", () => {
    expect(normalizeUnit("beers")).toBe("beer");
    expect(normalizeUnit("gas")).toBe("gas");
  });
});

describe("findMember", () => {
  it("finds a member name as a word, excluding me", () => {
    expect(findMember("I bet Alex the Lakers win", members, me)?.name).toBe("Alex");
    expect(findMember("timothy owes me", members, me)).toBeUndefined();
    expect(findMember("Alexander the great", members, me)).toBeUndefined();
  });
});

describe("chatReduce", () => {
  it("goes straight to stake when the first message names a member", () => {
    const r = chatReduce({ step: "idle" }, "I bet Alex the Lakers win", members, me);
    expect(r.state.step).toBe("stake");
    expect(r.replies.some((x) => x.kind === "unitChips")).toBe(true);
  });

  it("asks for the counterparty when no member is named", () => {
    const r = chatReduce({ step: "idle" }, "Lakers win on Friday", members, me);
    expect(r.state.step).toBe("counterparty");
    expect(r.replies.some((x) => x.kind === "memberChips")).toBe(true);
  });

  it("walks the full flow to a propose effect", () => {
    let s: ChatState = { step: "idle" };
    let r = chatReduce(s, "Lakers win on Friday", members, me);
    r = chatReduce(r.state, "Alex", members, me);
    expect(r.state.step).toBe("stake");
    r = chatReduce(r.state, "2 coffees", members, me);
    expect(r.state.step).toBe("confirm");
    expect(r.replies[0]).toMatchObject({ kind: "confirm" });
    r = chatReduce(r.state, "__send__", members, me);
    expect(r.effect).toMatchObject({
      type: "propose",
      draft: { qty: 2, unit: "coffee", description: "Lakers win on Friday" },
    });
    expect(r.state.step).toBe("idle");
  });

  it("re-asks on an unparseable stake", () => {
    const s: ChatState = { step: "stake", draft: { taker: me, takerName: "Alex", description: "x" } };
    const r = chatReduce(s, "the moon", members, me);
    expect(r.state.step).toBe("confirm"); // "the moon" is a valid custom unit
    const r2 = chatReduce(s, "!!!", members, me);
    expect(r2.state.step).toBe("stake");
  });

  it("handles commands from any point", () => {
    expect(chatReduce({ step: "idle" }, "balance", members, me).replies[0].kind).toBe("showBalances");
    expect(chatReduce({ step: "idle" }, "pending", members, me).replies[0].kind).toBe("showPending");
  });

  it("cancel resets mid-flow", () => {
    const s: ChatState = { step: "stake", draft: { description: "x" } };
    const r = chatReduce(s, "cancel", members, me);
    expect(r.state.step).toBe("idle");
  });
});
