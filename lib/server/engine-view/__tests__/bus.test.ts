import { afterEach, describe, expect, it } from "vitest";
import { publish, resetEngineViewBusForTest, subscribe } from "../bus";
import type { EngineEvent, EngineEventInput } from "@/lib/engine-view/events";

const event = (userId: string, fallback: "llm_off" | "llm_error" = "llm_off"): EngineEventInput => ({
  type: "fallback",
  reason: fallback,
  turn_id: "turn-1",
  user_id: userId,
  source: "replan",
  t_ms: 0,
});

afterEach(() => resetEngineViewBusForTest());

describe("engine-view の bus", () => {
  it("subscribe した後の publish が届く。ほかの利用者の分は届かない。解除すると届かない", () => {
    const received: EngineEvent[] = [];
    const unsubscribe = subscribe("user-1", 0, (e) => received.push(e));
    publish(event("user-1"));
    publish(event("user-2"));
    expect(received.map((e) => [e.seq, e.user_id])).toEqual([[1, "user-1"]]);
    unsubscribe();
    publish(event("user-1"));
    expect(received).toHaveLength(1);
  });

  it("after より後のバッファ分を先に渡す（after 以前の分は届かない）", () => {
    publish(event("user-1"));
    publish(event("user-1"));
    publish(event("user-1"));
    const received: number[] = [];
    subscribe("user-1", 2, (e) => received.push(e.seq));
    publish(event("user-1"));
    expect(received).toEqual([3, 4]);
  });

  it("listener が例外を投げても publish は投げず、ほかの listener には届く", () => {
    const received: number[] = [];
    subscribe("user-1", 0, () => {
      throw new Error("boom");
    });
    subscribe("user-1", 0, (e) => received.push(e.seq));
    expect(() => publish(event("user-1"))).not.toThrow();
    expect(received).toEqual([1]);
  });

  it("バッファは直近300件", () => {
    for (let i = 0; i < 310; i += 1) publish(event("user-1"));
    const received: number[] = [];
    subscribe("user-1", 0, (e) => received.push(e.seq));
    expect(received).toHaveLength(300);
    expect(received[0]).toBe(11);
  });
});
