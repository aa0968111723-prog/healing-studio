// @vitest-environment jsdom
/**
 * TeamAtoms（U-13 / AIDV-116）render + a11y 測試。
 * 守住：Avatar initials/img/線上點、RoleTag 角色文案、ShareScopeBadge 範圍指示、
 * MemberRow/MemberList 語意（list/listitem）。純元件唯讀消費 props。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Avatar, RoleTag, ShareScopeBadge, MemberRow, MemberList } from "./TeamAtoms";
import type { TeamMember } from "./teamsTypes";

afterEach(() => cleanup());

describe("Avatar", () => {
  it("無頭像 → 以 initials 渲染，帶 aria-label 朗讀姓名", () => {
    render(<Avatar name="Quinn Lee" />);
    const img = screen.getByRole("img", { name: "Quinn Lee" });
    expect(img.textContent).toBe("QL");
  });

  it("有頭像 URL → 渲染 <img> 帶 alt", () => {
    render(<Avatar name="林維" avatarUrl="https://x/a.png" />);
    const img = screen.getByRole("img", { name: "林維" }) as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://x/a.png");
  });

  it("online 指示點帶可朗讀 label", () => {
    render(<Avatar name="陳曦" online />);
    expect(screen.getByRole("img", { name: "在線" })).toBeTruthy();
  });
});

describe("RoleTag", () => {
  it("渲染角色中文文案", () => {
    render(<RoleTag role="owner" />);
    expect(screen.getByText("擁有者")).toBeTruthy();
  });
});

describe("ShareScopeBadge", () => {
  it("私人範圍 → 文案 + title hint", () => {
    const { container } = render(<ShareScopeBadge scope="private" />);
    expect(screen.getByText("私人")).toBeTruthy();
    expect(container.querySelector('[title="僅自己可見"]')).toBeTruthy();
  });

  it("公開範圍 → 文案", () => {
    render(<ShareScopeBadge scope="public" />);
    expect(screen.getByText("公開")).toBeTruthy();
  });
});

describe("MemberRow / MemberList", () => {
  const members: TeamMember[] = [
    { id: "m1", name: "林維", role: "owner", online: true },
    { id: "m2", name: "Quinn", role: "viewer", online: false },
  ];

  it("MemberRow 是 listitem，含姓名 + 角色", () => {
    render(
      <ul>
        <MemberRow member={members[0]} />
      </ul>,
    );
    const item = screen.getByRole("listitem");
    expect(within(item).getByText("林維")).toBeTruthy();
    expect(within(item).getByText("擁有者")).toBeTruthy();
  });

  it("MemberList 是 list，帶 aria-label，含全部成員", () => {
    render(<MemberList members={members} />);
    const list = screen.getByRole("list", { name: "團隊成員" });
    expect(within(list).getAllByRole("listitem").length).toBe(2);
  });
});
