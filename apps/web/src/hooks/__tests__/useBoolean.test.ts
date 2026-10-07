import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoolean } from "@/hooks/useBoolean";

describe("useBoolean", () => {
  it("should initialize with default value (false)", () => {
    const { result } = renderHook(() => useBoolean());
    expect(result.current.value).toBe(false);
  });

  it("should initialize with true", () => {
    const { result } = renderHook(() => useBoolean(true));
    expect(result.current.value).toBe(true);
  });

  it("should set value to true", () => {
    const { result } = renderHook(() => useBoolean());
    act(() => {
      result.current.setTrue();
    });
    expect(result.current.value).toBe(true);
  });

  it("should set value to false", () => {
    const { result } = renderHook(() => useBoolean(true));
    act(() => {
      result.current.setFalse();
    });
    expect(result.current.value).toBe(false);
  });

  it("should toggle value", () => {
    const { result } = renderHook(() => useBoolean(false));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.value).toBe(true);
    act(() => {
      result.current.toggle();
    });
    expect(result.current.value).toBe(false);
  });

  it("should set value directly", () => {
    const { result } = renderHook(() => useBoolean());
    act(() => {
      result.current.setValue(true);
    });
    expect(result.current.value).toBe(true);
    act(() => {
      result.current.setValue(false);
    });
    expect(result.current.value).toBe(false);
  });
});
