import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression: every invokeLLM call inside server/routers/director.ts must run
 * under the user's configured Director brain (model / temperature / topP /
 * systemPrompt). Without this, the user's My Brain settings silently no-op
 * for half the Director surface (planning chat, depth analysis, segment
 * CO-STAR, batch CO-STAR, script overview), which is the bug this file pins.
 *
 * This is a static source-scan rather than a runtime mock — same pattern as
 * override-wiring.test.ts. It catches new invokeLLM call sites
 * landing without brain wiring on review.
 */
describe("Director router invokeLLM brain-config wiring", () => {
  // Scan both the router and the extracted costarService — invokeLLM calls
  // from runDirectorAI live in services/director/costarService.ts after the
  // Phase 4 reorganization.
  const source = [
    readFileSync(resolve(process.cwd(), "server/routers/director.ts"), "utf8"),
    readFileSync(
      resolve(process.cwd(), "server/services/director/costarService.ts"),
      "utf8"
    ),
  ].join("\n");

  // Find every `invokeLLM({ ... })` call. We extract the inner block and
  // check that it sets `model:` (which in this codebase is always paired
  // with the rest of the brain knobs at the matching call sites).
  function extractInvokeLLMBlocks(src: string): string[] {
    const out: string[] = [];
    const marker = "invokeLLM({";
    let from = 0;
    while (true) {
      const start = src.indexOf(marker, from);
      if (start < 0) break;
      // Walk balanced braces from the opening `{`.
      let depth = 0;
      let i = start + marker.length - 1; // position of `{`
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      out.push(src.slice(start, i + 1));
      from = i + 1;
    }
    return out;
  }

  const blocks = extractInvokeLLMBlocks(source);

  it("director.ts has at least 8 invokeLLM call sites", () => {
    // Sanity: the file should still cover all the LLM-driven director
    // surfaces. If this drops, someone collapsed real functionality.
    expect(blocks.length).toBeGreaterThanOrEqual(8);
  });

  it("every invokeLLM call wires `model:` (so brain config flows through)", () => {
    const offenders = blocks
      .map((block, idx) => ({ idx, block }))
      .filter(({ block }) => !/\bmodel:\s/.test(block));
    if (offenders.length > 0) {
      // Surface the offending runName(s) for fast triage.
      const snippets = offenders.map(({ idx, block }) => {
        const runName = block.match(/runName:\s*"([^"]+)"/)?.[1] ?? "(unknown)";
        return `[${idx}] runName=${runName}`;
      });
      throw new Error(
        `invokeLLM call(s) missing brain config wiring:\n${snippets.join("\n")}\n` +
          `Each director invokeLLM must pass model/temperature/topP/systemPrompt ` +
          `from ctx.brain.getBrain("director") so the user's My Brain settings apply.`
      );
    }
  });

  it("every invokeLLM call also wires temperature and topP", () => {
    // Stricter check: once `model:` is set, the matching knobs must follow.
    // systemPrompt is intentionally allowed to be omitted at sites that
    // interpolate `director.systemPrompt` directly into the system message
    // string instead of passing it as a top-level key (askForStudioPlan).
    const offenders = blocks.filter(
      block =>
        /\bmodel:\s/.test(block) &&
        (!/\btemperature:\s/.test(block) || !/\btopP:\s/.test(block))
    );
    if (offenders.length > 0) {
      const snippets = offenders.map(block => {
        return block.match(/runName:\s*"([^"]+)"/)?.[1] ?? "(unknown)";
      });
      throw new Error(
        `invokeLLM call(s) wired model: but missing temperature/topP: ${snippets.join(
          ", "
        )}`
      );
    }
  });

  it("the 5 procedures historically missing brain config are now wired", () => {
    // Belt-and-braces: keep an explicit list of the runNames that used to
    // bypass user brain config. If any reappears without `model:` we want a
    // pointed failure, not just the generic check above.
    const previouslyBroken = [
      "director-planning-discuss",
      "director-emotional-analysis",
      "director-segment-costar",
      "director-batch-costar",
      "director-global-analysis",
    ];
    for (const runName of previouslyBroken) {
      const block = blocks.find(b => b.includes(`runName: "${runName}"`));
      expect(block, `missing invokeLLM with runName="${runName}"`).toBeDefined();
      expect(
        /\bmodel:\s/.test(block!),
        `runName="${runName}" must pass model: from director brain`
      ).toBe(true);
    }
  });
});
