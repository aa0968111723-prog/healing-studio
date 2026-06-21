// @vitest-environment jsdom
/**
 * DirectorChatCanvas · AIDV-157 前端三項修補行為測試。
 *
 * 守住三條使用者可見不變式:
 *   ① 錯誤白話化:directorReply 失敗時,顯示「導演暫時連不上，請稍後再試」類訊息,
 *      絕不外洩「directorReply failed」這種開發字串。
 *   ② 保留既有訊息 + 可重試:失敗不清空對話(使用者送出的訊息與歷史都在),
 *      且把使用者剛打的字回填輸入框,一鍵可重送。
 *   ③ 捲動到最新訊息:送出後呼叫的 scrollIntoView 目標是「最新訊息列」而非
 *      列表底部的空 padding div(後者會把最新訊息推出畫面、看似空白)。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";

// ─── Mock the spine so we control directorReply (success / failure) ───────
const spineState = vi.hoisted(() => ({
  directorReply: vi.fn(),
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { id: 2, name: "療癒直排輪短片" },
    directorReply: spineState.directorReply,
  }),
}));

import { DirectorChatCanvas } from "./DirectorChatCanvas";

// jsdom doesn't implement scrollIntoView; spy so we can assert it's called on
// the latest message element (not a trailing empty div).
let scrollSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollSpy = vi.fn();
  // Attach to the prototype so every rendered element has it.
  Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
  // requestAnimationFrame → run synchronously for deterministic assertions.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  spineState.directorReply.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeAndSend(text: string) {
  const textarea = screen.getByPlaceholderText(/與導演台對話/);
  fireEvent.change(textarea, { target: { value: text } });
  const sendBtn = screen.getByLabelText("送出");
  fireEvent.click(sendBtn);
  return { textarea };
}

describe("DirectorChatCanvas · AIDV-157", () => {
  it("① 失敗訊息白話化:不外洩 directorReply failed,顯示友善提示", async () => {
    spineState.directorReply.mockRejectedValue(
      new Error("directorReply failed")
    );
    render(<DirectorChatCanvas />);
    typeAndSend("幫我把第一鏡的分鏡列出來");

    await waitFor(() =>
      expect(screen.getByText(/導演暫時連不上/)).toBeTruthy()
    );
    // 絕不出現原始開發字串
    expect(screen.queryByText(/directorReply failed/)).toBeNull();
    expect(screen.queryByText(/導演台連線中斷/)).toBeNull();
  });

  it("② 失敗保留既有訊息 + 回填輸入框可重送", async () => {
    spineState.directorReply.mockRejectedValue(new Error("boom"));
    render(<DirectorChatCanvas />);
    const { textarea } = typeAndSend("我想做一支 30 秒療癒短片");

    await waitFor(() =>
      expect(screen.getByText(/導演暫時連不上/)).toBeTruthy()
    );
    // 使用者送出的訊息仍在對話串(沒被清空)。注意:回填後輸入框 value 也含同字串,
    // 故用 getAllByText —— 訊息泡泡 + textarea 共兩處,代表訊息保留且已回填。
    const occurrences = screen.getAllByText("我想做一支 30 秒療癒短片");
    expect(occurrences.length).toBeGreaterThanOrEqual(1);
    const bubble = occurrences.find(el => el.tagName !== "TEXTAREA");
    expect(bubble).toBeTruthy();
    // 開場上下文訊息也還在
    expect(screen.getByText(/已載入《療癒直排輪短片》上下文/)).toBeTruthy();
    // 輸入框回填了剛打的字 → 一鍵可重送
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "我想做一支 30 秒療癒短片"
    );
  });

  it("②b 成功路徑:顯示 AI 回覆、輸入框清空、不出現錯誤樣式", async () => {
    spineState.directorReply.mockResolvedValue({
      role: "ai",
      persona: "creative",
      text: "第一鏡:黃昏河堤，主角逆光滑行。",
      agent: "director",
    });
    render(<DirectorChatCanvas />);
    const { textarea } = typeAndSend("列第一鏡");

    await waitFor(() =>
      expect(screen.getByText(/黃昏河堤/)).toBeTruthy()
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(/導演暫時連不上/)).toBeNull();
  });

  it("③ 送出後捲動到最新訊息(scrollIntoView 被呼叫)", async () => {
    spineState.directorReply.mockResolvedValue({
      role: "ai",
      persona: "creative",
      text: "好的",
      agent: "director",
    });
    render(<DirectorChatCanvas />);
    typeAndSend("hi");

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    // 捲動參數帶 block:"end" — 對齊「捲到最新訊息列底部」而非整頁底部空白。
    const lastCallArg = scrollSpy.mock.calls.at(-1)?.[0];
    expect(lastCallArg).toMatchObject({ block: "end" });
  });
});
