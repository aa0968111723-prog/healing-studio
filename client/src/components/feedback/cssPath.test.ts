// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCssSelector } from "./cssPath";

describe("getCssSelector", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("uses id-based selector and stops traversing", () => {
    container.innerHTML = `<section id="hero"><button>Click</button></section>`;
    const btn = container.querySelector("button")!;
    const sel = getCssSelector(btn);
    expect(sel).toContain("#hero");
    expect(sel).not.toContain("section");
  });

  it("falls back to tag + class selector", () => {
    container.innerHTML = `<div class="card"><p class="title">text</p></div>`;
    const p = container.querySelector("p")!;
    const sel = getCssSelector(p);
    expect(sel).toMatch(/p\.title/);
  });

  it("adds nth-of-type when siblings share the same tag", () => {
    container.innerHTML = `<ul><li>a</li><li>b</li><li>c</li></ul>`;
    const second = container.querySelectorAll("li")[1]!;
    const sel = getCssSelector(second);
    expect(sel).toContain("nth-of-type(2)");
  });

  it("respects maxDepth limit", () => {
    container.innerHTML = `<div><div><div><div><span>deep</span></div></div></div></div>`;
    const span = container.querySelector("span")!;
    const sel = getCssSelector(span, 2);
    expect(sel.split(" > ").length).toBeLessThanOrEqual(2);
  });

  it("returns tag-only selector for element without id or class", () => {
    container.innerHTML = `<article><p>plain</p></article>`;
    const p = container.querySelector("p")!;
    const sel = getCssSelector(p);
    expect(sel).toMatch(/p/);
  });
});
