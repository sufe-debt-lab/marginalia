import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { useTranslation } from "./useTranslation.js";

describe("useTranslation", () => {
  beforeEach(() => {
    useAppStore.setState({ locale: "en" });
    localStorage.clear();
  });

  it("uses English by default", () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t("common.newChat")).toBe("New chat");
  });

  it("switches to Chinese when locale is zh", () => {
    useAppStore.getState().setLocale("zh");
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t("common.newChat")).toBe("新建聊天");
  });
});
