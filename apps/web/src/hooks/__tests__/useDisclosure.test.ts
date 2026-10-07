import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useDisclosure from "@/hooks/useDisclosure";

describe("useDisclosure", () => {
  it("should initialize with default value (false)", () => {
    const { result } = renderHook(() => useDisclosure());
    expect(result.current.isOpen).toBe(false);
  });

  it("should initialize with true", () => {
    const { result } = renderHook(() => useDisclosure(true));
    expect(result.current.isOpen).toBe(true);
  });

  it("should open", () => {
    const { result } = renderHook(() => useDisclosure());
    act(() => {
      result.current.onOpen();
    });
    expect(result.current.isOpen).toBe(true);
  });

  it("should close", () => {
    const { result } = renderHook(() => useDisclosure(true));
    act(() => {
      result.current.onClose();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("should toggle", () => {
    const { result } = renderHook(() => useDisclosure(false));
    act(() => {
      result.current.onToggle();
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.onToggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("should set isOpen directly", () => {
    const { result } = renderHook(() => useDisclosure());
    act(() => {
      result.current.setIsOpen(true);
    });
    expect(result.current.isOpen).toBe(true);
    act(() => {
      result.current.setIsOpen(false);
    });
    expect(result.current.isOpen).toBe(false);
  });
});
