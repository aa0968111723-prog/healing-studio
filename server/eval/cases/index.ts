import basicImageGen from "./basicImageGen.eval";
import delegationFromDirector from "./delegationFromDirector.eval";
import blockedUnknownTool from "./blockedUnknownTool.eval";
import multimodalImageToVideo from "./multimodalImageToVideo.eval";
import loraTrainingRequest from "./loraTrainingRequest.eval";
import multiStepWorkflow from "./multiStepWorkflow.eval";

export const BUILTIN_AGENT_EVAL_CASES = [basicImageGen, delegationFromDirector, blockedUnknownTool, multimodalImageToVideo, loraTrainingRequest, multiStepWorkflow];
