import React, { createContext, useContext, useReducer, type ReactNode } from 'react';

// ─── Core Enums / Literal Types ───────────────────────────────────────────────

export type Modality = 'image' | 'video' | 'music' | 'voice';
export type WorkspaceMode = 'beginner' | 'advanced';
export type PromptStrengthLevel = 'low' | 'medium' | 'high' | 'locked';
export type ActionMode = 'generate' | 'refine' | 'branch';

export type ThoughtIslandCategory =
  | 'goal'
  | 'subject'
  | 'style'
  | 'constraints'
  | 'output';

export type StructuredBlockCategory = 'required' | 'control' | 'correction';

// ─── Data Types ───────────────────────────────────────────────────────────────

export interface ThoughtIsland {
  id: string;
  category: ThoughtIslandCategory;
  content: string;
  hint: string;
}

export interface StructuredBlock {
  id: string;
  fieldKey: string;
  label: string;
  value: string;
  category: StructuredBlockCategory;
  enabled: boolean;
}

export interface ReferenceItem {
  id: string;
  url: string;
  type: string;
  purpose: string;
  weight: number;
  selectiveUsage: string[];
}

export interface VersionEntry {
  id: string;
  timestamp: number;
  modality: Modality;
  blocks: StructuredBlock[];
  thoughtIslands: ThoughtIsland[];
  promptStrength: PromptStrengthLevel;
  advancedPrompt: string;
  compiledPrompt: string;
  changedFields: string[];
  references: ReferenceItem[];
  generationSettings: Record<string, unknown>;
  outputUrl: string | null;
  pinned: boolean;
  actionMode: ActionMode;
}

export interface SavedRecipe {
  id: string;
  name: string;
  modality: Modality;
  blocks: StructuredBlock[];
  thoughtIslands: ThoughtIsland[];
  promptStrength: PromptStrengthLevel;
  advancedPrompt: string;
  references: ReferenceItem[];
  generationParams: Record<string, unknown>;
  createdAt: number;
}

// ─── Workspace State ──────────────────────────────────────────────────────────

export interface WorkspaceState {
  modality: Modality;
  workspaceMode: WorkspaceMode;
  actionMode: ActionMode;
  thoughtIslands: ThoughtIsland[];
  blocks: Record<string, StructuredBlock[]>;
  promptStrength: PromptStrengthLevel;
  advancedPrompt: Record<string, string>;
  advancedPromptOverride: Record<string, boolean>;
  compiledPrompt: string;
  references: Record<string, ReferenceItem[]>;
  versions: VersionEntry[];
  pinnedVersionId: string | null;
  savedRecipes: SavedRecipe[];
  negativePrompt: Record<string, string>;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type WorkspaceAction =
  | { type: 'SET_MODALITY'; payload: Modality }
  | { type: 'SET_WORKSPACE_MODE'; payload: WorkspaceMode }
  | { type: 'SET_ACTION_MODE'; payload: ActionMode }
  | { type: 'UPDATE_THOUGHT_ISLAND'; payload: { id: string; content: string } }
  | { type: 'SET_BLOCKS'; payload: { modality: Modality; blocks: StructuredBlock[] } }
  | { type: 'UPDATE_BLOCK'; payload: { modality: Modality; blockId: string; changes: Partial<StructuredBlock> } }
  | { type: 'SET_PROMPT_STRENGTH'; payload: PromptStrengthLevel }
  | { type: 'SET_ADVANCED_PROMPT'; payload: { modality: Modality; prompt: string } }
  | { type: 'SET_ADVANCED_PROMPT_OVERRIDE'; payload: { modality: Modality; override: boolean } }
  | { type: 'SET_COMPILED_PROMPT'; payload: string }
  | { type: 'ADD_REFERENCE'; payload: { modality: Modality; reference: ReferenceItem } }
  | { type: 'REMOVE_REFERENCE'; payload: { modality: Modality; referenceId: string } }
  | { type: 'UPDATE_REFERENCE'; payload: { modality: Modality; referenceId: string; changes: Partial<ReferenceItem> } }
  | { type: 'ADD_VERSION'; payload: VersionEntry }
  | { type: 'PIN_VERSION'; payload: string }
  | { type: 'RESTORE_VERSION'; payload: string }
  | { type: 'SAVE_RECIPE'; payload: SavedRecipe }
  | { type: 'DELETE_RECIPE'; payload: string }
  | { type: 'SET_NEGATIVE_PROMPT'; payload: { modality: Modality; prompt: string } }
  | { type: 'RESET_WORKSPACE' };

// ─── Default ThoughtIslands per Modality ──────────────────────────────────────

const defaultThoughtIslands: Record<Modality, ThoughtIsland[]> = {
  image: [
    { id: 'image-goal', category: 'goal', content: '', hint: '這張圖的用途是什麼？' },
    { id: 'image-subject', category: 'subject', content: '', hint: '主體是什麼？畫面要呈現什麼？' },
    { id: 'image-style', category: 'style', content: '', hint: '想要什麼風格？光線與色調？' },
    { id: 'image-constraints', category: 'constraints', content: '', hint: '要避免什麼？有什麼限制？' },
    { id: 'image-output', category: 'output', content: '', hint: '輸出格式與尺寸？' },
  ],
  video: [
    { id: 'video-goal', category: 'goal', content: '', hint: '這段影片的目的是什麼？' },
    { id: 'video-subject', category: 'subject', content: '', hint: '事件如何發生？主角做什麼？' },
    { id: 'video-style', category: 'style', content: '', hint: '鏡頭如何移動？節奏感如何？' },
    { id: 'video-constraints', category: 'constraints', content: '', hint: '要避免什麼動作或效果？' },
    { id: 'video-output', category: 'output', content: '', hint: '時長與格式？' },
  ],
  music: [
    { id: 'music-goal', category: 'goal', content: '', hint: '這首曲子的用途是什麼？' },
    { id: 'music-subject', category: 'subject', content: '', hint: '故事或情境是什麼？' },
    { id: 'music-style', category: 'style', content: '', hint: '情緒與節奏是什麼？要哪些樂器？' },
    { id: 'music-constraints', category: 'constraints', content: '', hint: '要避免什麼元素？' },
    { id: 'music-output', category: 'output', content: '', hint: '時長與格式？' },
  ],
  voice: [
    { id: 'voice-goal', category: 'goal', content: '', hint: '這段語音的用途是什麼？' },
    { id: 'voice-subject', category: 'subject', content: '', hint: '誰在說話？內容是什麼？' },
    { id: 'voice-style', category: 'style', content: '', hint: '語氣如何？語速與停頓如何？' },
    { id: 'voice-constraints', category: 'constraints', content: '', hint: '要避免什麼語調？' },
    { id: 'voice-output', category: 'output', content: '', hint: '輸出格式與品質？' },
  ],
};

export function getDefaultThoughtIslands(modality: Modality): ThoughtIsland[] {
  return (defaultThoughtIslands[modality] || defaultThoughtIslands.image).map((i) => ({ ...i }));
}

// ─── Default Blocks per Modality ──────────────────────────────────────────────

function block(
  id: string,
  fieldKey: string,
  label: string,
  category: StructuredBlockCategory,
): StructuredBlock {
  return { id, fieldKey, label, value: '', category, enabled: true };
}

export function getDefaultBlocks(modality: Modality): StructuredBlock[] {
  switch (modality) {
    case 'image':
      return [
        block('img-subject', 'subject', 'Subject', 'required'),
        block('img-scene', 'scene', 'Scene', 'required'),
        block('img-composition', 'composition', 'Composition', 'required'),
        block('img-lighting', 'lighting', 'Lighting', 'required'),
        block('img-style', 'style', 'Style', 'required'),
        block('img-aspectRatio', 'aspectRatio', 'Aspect Ratio', 'required'),
        block('img-camera', 'camera', 'Camera / Lens', 'control'),
        block('img-colorPalette', 'colorPalette', 'Color Palette', 'control'),
        block('img-material', 'material', 'Material', 'control'),
        block('img-characterConsistency', 'characterConsistency', 'Character Consistency', 'control'),
        block('img-negativePrompt', 'negativePrompt', 'Negative Prompt', 'control'),
      ];
    case 'video':
      return [
        block('vid-subjectAction', 'subjectAction', 'Subject & Action', 'required'),
        block('vid-scene', 'scene', 'Scene', 'required'),
        block('vid-duration', 'duration', 'Duration', 'required'),
        block('vid-cameraMovement', 'cameraMovement', 'Camera Movement', 'required'),
        block('vid-motionPacing', 'motionPacing', 'Motion Pacing', 'required'),
        block('vid-visualStyle', 'visualStyle', 'Visual Style', 'required'),
        block('vid-shotType', 'shotType', 'Shot Type', 'control'),
        block('vid-continuity', 'continuity', 'Continuity', 'control'),
        block('vid-startEndState', 'startEndState', 'Start / End State', 'control'),
        block('vid-motionIntensity', 'motionIntensity', 'Motion Intensity', 'control'),
        block('vid-negativeMotion', 'negativeMotion', 'Negative Motion', 'control'),
      ];
    case 'music':
      return [
        block('mus-useCase', 'useCase', 'Use Case', 'required'),
        block('mus-mood', 'mood', 'Mood', 'required'),
        block('mus-duration', 'duration', 'Duration', 'required'),
        block('mus-genre', 'genre', 'Genre', 'required'),
        block('mus-bpm', 'bpm', 'BPM', 'required'),
        block('mus-instrumentation', 'instrumentation', 'Instrumentation', 'required'),
        block('mus-energyCurve', 'energyCurve', 'Energy Curve', 'control'),
        block('mus-structure', 'structure', 'Structure', 'control'),
        block('mus-vocalInstrumental', 'vocalInstrumental', 'Vocal / Instrumental', 'control'),
        block('mus-mixDensity', 'mixDensity', 'Mix Density', 'control'),
        block('mus-negativeConstraints', 'negativeConstraints', 'Negative Constraints', 'control'),
      ];
    case 'voice':
      return [
        block('voi-script', 'script', 'Script', 'required'),
        block('voi-speakerIdentity', 'speakerIdentity', 'Speaker Identity', 'required'),
        block('voi-language', 'language', 'Language', 'required'),
        block('voi-tone', 'tone', 'Tone', 'required'),
        block('voi-pace', 'pace', 'Pace', 'required'),
        block('voi-deliveryStyle', 'deliveryStyle', 'Delivery Style', 'required'),
        block('voi-pronunciation', 'pronunciation', 'Pronunciation', 'control'),
        block('voi-pauseBehavior', 'pauseBehavior', 'Pause Behavior', 'control'),
        block('voi-emphasis', 'emphasis', 'Emphasis', 'control'),
        block('voi-role', 'role', 'Role', 'control'),
        block('voi-voiceConsistency', 'voiceConsistency', 'Voice Consistency', 'control'),
        block('voi-negativeConstraints', 'negativeConstraints', 'Negative Constraints', 'control'),
      ];
  }
}

// ─── Initial State ────────────────────────────────────────────────────────────

const allModalities: Modality[] = ['image', 'video', 'music', 'voice'];

export function createInitialWorkspaceState(): WorkspaceState {
  const blocks: Record<string, StructuredBlock[]> = {};
  const advancedPrompt: Record<string, string> = {};
  const advancedPromptOverride: Record<string, boolean> = {};
  const references: Record<string, ReferenceItem[]> = {};
  const negativePrompt: Record<string, string> = {};

  for (const m of allModalities) {
    blocks[m] = getDefaultBlocks(m);
    advancedPrompt[m] = '';
    advancedPromptOverride[m] = false;
    references[m] = [];
    negativePrompt[m] = '';
  }

  return {
    modality: 'image',
    workspaceMode: 'beginner',
    actionMode: 'generate',
    thoughtIslands: defaultThoughtIslands.image.map((i) => ({ ...i })),
    blocks,
    promptStrength: 'medium',
    advancedPrompt,
    advancedPromptOverride,
    compiledPrompt: '',
    references,
    versions: [],
    pinnedVersionId: null,
    savedRecipes: [],
    negativePrompt,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'SET_MODALITY': {
      // Note: switching modality resets thought islands to defaults for the new
      // modality. Per-modality persistence can be layered on top if needed.
      const modality = action.payload;
      return {
        ...state,
        modality,
        thoughtIslands: defaultThoughtIslands[modality].map((i) => ({ ...i })),
      };
    }

    case 'SET_WORKSPACE_MODE':
      return { ...state, workspaceMode: action.payload };

    case 'SET_ACTION_MODE':
      return { ...state, actionMode: action.payload };

    case 'UPDATE_THOUGHT_ISLAND':
      return {
        ...state,
        thoughtIslands: state.thoughtIslands.map((island) =>
          island.id === action.payload.id
            ? { ...island, content: action.payload.content }
            : island,
        ),
      };

    case 'SET_BLOCKS':
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [action.payload.modality]: action.payload.blocks,
        },
      };

    case 'UPDATE_BLOCK': {
      const { modality, blockId, changes } = action.payload;
      return {
        ...state,
        blocks: {
          ...state.blocks,
          [modality]: (state.blocks[modality] ?? []).map((b) =>
            b.id === blockId ? { ...b, ...changes } : b,
          ),
        },
      };
    }

    case 'SET_PROMPT_STRENGTH':
      return { ...state, promptStrength: action.payload };

    case 'SET_ADVANCED_PROMPT':
      return {
        ...state,
        advancedPrompt: {
          ...state.advancedPrompt,
          [action.payload.modality]: action.payload.prompt,
        },
      };

    case 'SET_ADVANCED_PROMPT_OVERRIDE':
      return {
        ...state,
        advancedPromptOverride: {
          ...state.advancedPromptOverride,
          [action.payload.modality]: action.payload.override,
        },
      };

    case 'SET_COMPILED_PROMPT':
      return { ...state, compiledPrompt: action.payload };

    case 'ADD_REFERENCE': {
      const { modality, reference } = action.payload;
      return {
        ...state,
        references: {
          ...state.references,
          [modality]: [...(state.references[modality] ?? []), reference],
        },
      };
    }

    case 'REMOVE_REFERENCE': {
      const { modality, referenceId } = action.payload;
      return {
        ...state,
        references: {
          ...state.references,
          [modality]: (state.references[modality] ?? []).filter(
            (r) => r.id !== referenceId,
          ),
        },
      };
    }

    case 'UPDATE_REFERENCE': {
      const { modality, referenceId, changes } = action.payload;
      return {
        ...state,
        references: {
          ...state.references,
          [modality]: (state.references[modality] ?? []).map((r) =>
            r.id === referenceId ? { ...r, ...changes } : r,
          ),
        },
      };
    }

    case 'ADD_VERSION':
      return {
        ...state,
        versions: [...state.versions, action.payload],
      };

    case 'PIN_VERSION':
      return {
        ...state,
        pinnedVersionId: action.payload,
        versions: state.versions.map((v) => ({
          ...v,
          pinned: v.id === action.payload,
        })),
      };

    case 'RESTORE_VERSION': {
      const version = state.versions.find((v) => v.id === action.payload);
      if (!version) return state;
      return {
        ...state,
        modality: version.modality,
        actionMode: version.actionMode,
        thoughtIslands: version.thoughtIslands.map((i) => ({ ...i })),
        blocks: {
          ...state.blocks,
          [version.modality]: version.blocks.map((b) => ({ ...b })),
        },
        promptStrength: version.promptStrength,
        advancedPrompt: {
          ...state.advancedPrompt,
          [version.modality]: version.advancedPrompt,
        },
        compiledPrompt: version.compiledPrompt,
        references: {
          ...state.references,
          [version.modality]: version.references.map((r) => ({ ...r })),
        },
      };
    }

    case 'SAVE_RECIPE':
      return {
        ...state,
        savedRecipes: [...state.savedRecipes, action.payload],
      };

    case 'DELETE_RECIPE':
      return {
        ...state,
        savedRecipes: state.savedRecipes.filter((r) => r.id !== action.payload),
      };

    case 'SET_NEGATIVE_PROMPT':
      return {
        ...state,
        negativePrompt: {
          ...state.negativePrompt,
          [action.payload.modality]: action.payload.prompt,
        },
      };

    case 'RESET_WORKSPACE':
      return createInitialWorkspaceState();

    default:
      return state;
  }
}

// ─── React Context + Provider + Hook ──────────────────────────────────────────

const WorkspaceContext = createContext<
  { state: WorkspaceState; dispatch: React.Dispatch<WorkspaceAction> } | undefined
>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createInitialWorkspaceState,
  );

  return React.createElement(
    WorkspaceContext.Provider,
    { value: { state, dispatch } },
    children,
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (ctx === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}
