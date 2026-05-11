// This file contains the remaining dispatcher functions to be integrated into agentToolExecutor.ts
// Insert these BEFORE the "inspiration.fetch 工具橋接" section (around line 3116)

// ═══════════════════════════════════════════════════════════════════════════
// learningSpecialist.* 工具橋接：學學（learning-specialist）的學習與教學工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchLearningSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { getTutorial, listTutorials, getQuickTips } = await import("./spiritTools/learningSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "learningSpecialist.getTutorial": {
        const featureName = args.featureName as string;
        if (!featureName) {
          return { name: call.name, ok: false, error: "featureName is required" };
        }
        const result = getTutorial(featureName);
        return { name: call.name, ok: result.success, data: result, usedTool: call.name, ...(result.success ? {} : { error: result.message }) };
      }
      case "learningSpecialist.listTutorials": {
        const result = listTutorials();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }
      case "learningSpecialist.getQuickTips": {
        const result = getQuickTips();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }
      default:
        return { name: call.name, ok: false, error: `unknown learningSpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Continue with other dispatchers...
// Add musicSpecialist, trainingSpecialist, legalAdvisor, securityGuard,
// communityManager, onboardingCoach, planExecutor, inspirationSpecialist, anatomySpecialist
// ═══════════════════════════════════════════════════════════════════════════

// CASE HANDLERS TO ADD IN THE MAIN SWITCH:

/*
      case "learningSpecialist.getTutorial":
      case "learningSpecialist.listTutorials":
      case "learningSpecialist.getQuickTips": {
        const result = await dispatchLearningSpecialistTool(call, opts);
        return result;
      }

      // Add similar case blocks for:
      // - musicSpecialist.*
      // - trainingSpecialist.*
      // - legalAdvisor.*
      // - securityGuard.*
      // - communityManager.*
      // - onboardingCoach.*
      // - planExecutor.*
      // - inspirationSpecialist.*
      // - anatomySpecialist.*
*/
