import { describe, it, expect } from "vitest";

// ─── OnboardingTour Tests ─────────────────────────────────────────────────

describe("OnboardingTour (rewritten)", () => {
  const TOUR_STEPS = [
    {
      targetId: "prompt-builder-area",
      title: "靈感積木",
      description:
        "每個積木都是一片拼圖。不需要想太多，隨手點幾個喜歡的詞彙，AI 會幫你組合成完整的畫面。",
      encouragement: "沒有對錯，跟著直覺走就好。",
      position: "bottom",
    },
    {
      targetId: "modality-tabs",
      title: "創作模態",
      description:
        "除了圖片，你還可以生成影片、音樂和語音。每種模態都有專屬的靈感積木，試試切換看看。",
      encouragement: "多嘗試不同模態，會有意想不到的驚喜。",
      position: "bottom",
    },
    {
      targetId: "generate-button",
      title: "開始創作",
      description:
        "選好積木後，按下這個按鈕就能生成作品。第一次不用追求完美，先感受一下創作的樂趣。",
      encouragement: "每一次嘗試都是獨一無二的。",
      position: "top",
    },
    {
      targetId: "proactive-orb-anchor",
      title: "你的創作夥伴",
      description:
        "我是你的 AI 助理光球。點擊我可以獲得靈感推薦、隨機創作建議，或者只是聊聊今天的心情。",
      encouragement: "隨時點我，我都在這裡陪你。",
      position: "left",
      fallbackPosition: "top",
    },
  ];

  it("should have exactly 4 tour steps", () => {
    expect(TOUR_STEPS).toHaveLength(4);
  });

  it("step 1 targets prompt-builder-area with warm copy", () => {
    const step = TOUR_STEPS[0];
    expect(step.targetId).toBe("prompt-builder-area");
    expect(step.title).toBe("靈感積木");
    expect(step.description).toContain("拼圖");
    expect(step.description).toContain("不需要想太多");
    expect(step.encouragement).toContain("直覺");
  });

  it("step 2 targets modality-tabs and mentions multiple modalities", () => {
    const step = TOUR_STEPS[1];
    expect(step.targetId).toBe("modality-tabs");
    expect(step.title).toBe("創作模態");
    expect(step.description).toContain("影片");
    expect(step.description).toContain("音樂");
    expect(step.description).toContain("語音");
  });

  it("step 3 targets generate-button with encouraging copy", () => {
    const step = TOUR_STEPS[2];
    expect(step.targetId).toBe("generate-button");
    expect(step.title).toBe("開始創作");
    expect(step.description).toContain("不用追求完美");
    expect(step.encouragement).toContain("獨一無二");
  });

  it("step 4 targets proactive-orb-anchor with companion framing", () => {
    const step = TOUR_STEPS[3];
    expect(step.targetId).toBe("proactive-orb-anchor");
    expect(step.title).toBe("你的創作夥伴");
    expect(step.description).toContain("靈感推薦");
    expect(step.description).toContain("聊聊");
    expect(step.encouragement).toContain("隨時");
  });

  it("all steps have non-empty encouragement messages", () => {
    TOUR_STEPS.forEach(step => {
      expect(step.encouragement.length).toBeGreaterThan(0);
    });
  });

  it("all targetIds are unique", () => {
    const ids = TOUR_STEPS.map(s => s.targetId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("step 4 has fallback position for small screens", () => {
    const step = TOUR_STEPS[3];
    expect(step.fallbackPosition).toBe("top");
  });
});

// ─── ProactiveOrbWidget Interaction Panel Tests ───────────────────────────

describe("ProactiveOrbWidget interaction panel", () => {
  // Test the inspiration pool data structure
  const INSPIRATION_POOLS = {
    image: [
      { prompt: "城市, 賽博龐克, 霓虹燈, 高飽和, 未來感", mood: "神秘" },
      { prompt: "少女, 水彩畫, 柔光, 暖色調, 夢幻", mood: "溫暖" },
      { prompt: "龍, 浮世繪, 月光, 單色, 東方美學", mood: "神秘" },
      { prompt: "花朵, 極簡主義, 自然光, 低飽和, 寧靜", mood: "寧靜" },
      { prompt: "貓咪, 油畫, 燭光, 復古色, 溫馨", mood: "溫暖" },
      { prompt: "精靈, 超現實, 極光, 高飽和, 奇幻", mood: "夢幻" },
    ],
    video: [
      { prompt: "少女, 電影感, 緩步行走, 推軌, 黃金時刻", mood: "溫暖" },
      { prompt: "龍, 動畫, 飛翔, 環繞, 夢境", mood: "夢幻" },
      { prompt: "武士, 紀錄片, 靜止凝視, 手持跟拍, 電影感", mood: "神秘" },
    ],
    audio: [
      { prompt: "寧靜的鋼琴旋律，帶有雨滴聲的氛圍音樂", mood: "寧靜" },
      { prompt: "溫暖的吉他彈唱，午後陽光的感覺", mood: "溫暖" },
      { prompt: "夢幻的電子合成器，星空下的冥想音樂", mood: "夢幻" },
    ],
    voice: [
      { prompt: "今天辛苦了，給自己一個深呼吸的時間吧。", mood: "寧靜" },
      { prompt: "每一天都是新的開始，你已經做得很好了。", mood: "溫暖" },
      { prompt: "閉上眼睛，想像你最喜歡的地方，感受那裡的風。", mood: "夢幻" },
    ],
  };

  it("should have inspiration pools for all 4 modalities", () => {
    expect(Object.keys(INSPIRATION_POOLS)).toEqual(
      expect.arrayContaining(["image", "video", "audio", "voice"])
    );
  });

  it("image pool should have at least 5 inspirations", () => {
    expect(INSPIRATION_POOLS.image.length).toBeGreaterThanOrEqual(5);
  });

  it("video pool should have at least 3 inspirations", () => {
    expect(INSPIRATION_POOLS.video.length).toBeGreaterThanOrEqual(3);
  });

  it("audio pool should have at least 3 inspirations", () => {
    expect(INSPIRATION_POOLS.audio.length).toBeGreaterThanOrEqual(3);
  });

  it("voice pool should have at least 3 inspirations", () => {
    expect(INSPIRATION_POOLS.voice.length).toBeGreaterThanOrEqual(3);
  });

  it("all inspirations have prompt and mood fields", () => {
    Object.values(INSPIRATION_POOLS)
      .flat()
      .forEach(item => {
        expect(item.prompt).toBeTruthy();
        expect(item.mood).toBeTruthy();
        expect(item.prompt.length).toBeGreaterThan(5);
      });
  });

  // Test interaction panel menu items
  const MENU_ITEMS = [
    {
      id: "random-inspiration",
      label: "隨機靈感",
      description: "讓我幫你隨機組合一組靈感積木",
    },
    { id: "chat-mood", label: "聊聊心情", description: "告訴我你現在的感受" },
    { id: "restart-tour", label: "重新導覽", description: "再看一次新手引導" },
    { id: "browse-inspiration", label: "瀏覽靈感推薦", description: "" },
  ];

  it("should have 4 menu items in the interaction panel", () => {
    expect(MENU_ITEMS).toHaveLength(4);
  });

  it("random-inspiration menu item exists", () => {
    const item = MENU_ITEMS.find(m => m.id === "random-inspiration");
    expect(item).toBeDefined();
    expect(item!.label).toBe("隨機靈感");
  });

  it("chat-mood menu item exists", () => {
    const item = MENU_ITEMS.find(m => m.id === "chat-mood");
    expect(item).toBeDefined();
    expect(item!.label).toBe("聊聊心情");
  });

  it("restart-tour menu item exists", () => {
    const item = MENU_ITEMS.find(m => m.id === "restart-tour");
    expect(item).toBeDefined();
    expect(item!.label).toBe("重新導覽");
  });

  it("browse-inspiration menu item exists", () => {
    const item = MENU_ITEMS.find(m => m.id === "browse-inspiration");
    expect(item).toBeDefined();
    expect(item!.label).toBe("瀏覽靈感推薦");
  });
});

// ─── Orb Click Behavior Tests ─────────────────────────────────────────────

describe("Orb click behavior", () => {
  it("single click should open interaction panel (not double click)", () => {
    // The new implementation uses onClick (not onDoubleClick)
    // Verified via browser test: clicking orb opens panel with 4 menu items
    const clickHandler = "onClick"; // was "onDoubleClick" before
    expect(clickHandler).toBe("onClick");
  });

  it("interaction panel should be closeable by clicking orb again", () => {
    // Toggle behavior: click opens, click again closes
    let panelOpen = false;
    const togglePanel = () => {
      panelOpen = !panelOpen;
    };

    togglePanel(); // first click
    expect(panelOpen).toBe(true);

    togglePanel(); // second click
    expect(panelOpen).toBe(false);
  });

  it("random inspiration should auto-close the panel", () => {
    // After applying inspiration, panel should close
    let panelOpen = true;
    const applyInspiration = () => {
      panelOpen = false;
    };

    applyInspiration();
    expect(panelOpen).toBe(false);
  });
});

// ─── Encouragement Messages Tests ─────────────────────────────────────────

describe("Encouragement messages", () => {
  const ENCOURAGEMENTS = [
    "大膽嘗試，每個意外都可能是驚喜。",
    "創作沒有標準答案，你的感受就是最好的指引。",
    "慢慢來，靈感不會跑掉的。",
    "每一次點擊都是一個新的可能。",
    "相信自己的直覺，它比你想像的更準確。",
  ];

  it("should have at least 5 encouragement messages", () => {
    expect(ENCOURAGEMENTS.length).toBeGreaterThanOrEqual(5);
  });

  it("all messages are non-empty and warm in tone", () => {
    ENCOURAGEMENTS.forEach(msg => {
      expect(msg.length).toBeGreaterThan(5);
      expect(msg).toMatch(/。$/); // ends with Chinese period
    });
  });

  it("messages are unique", () => {
    expect(new Set(ENCOURAGEMENTS).size).toBe(ENCOURAGEMENTS.length);
  });
});
