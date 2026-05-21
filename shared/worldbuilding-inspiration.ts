export type VisualInspirationKind =
  | "character"
  | "scene"
  | "style"
  | "shot"
  | "prop"
  | "color"
  | "lighting"
  | "composition"
  | "texture"
  | "mood"
  | "reference"
  | "generated";

export type VisualInspirationSourceType =
  | "upload"
  | "generated"
  | "url"
  | "worldbuilding_asset"
  | "character_reference"
  | "scene_reference"
  | "style_reference";

export type VisualInspirationItem = {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  sourceType: VisualInspirationSourceType;
  sourceUrl?: string;
  kind: VisualInspirationKind;
  tags: string[];
  palette?: string[];
  mood?: string;
  lighting?: string;
  composition?: string;
  artStyle?: string;
  cameraLanguage?: string;
  negativePromptHints?: string[];
  promptSeed?: string;
  linkedCharacterIds?: string[];
  linkedSceneIds?: string[];
  linkedStyleProfileIds?: string[];
  linkedStoryboardIds?: string[];
  licenseNote?: string;
  usageScope?: "private_project" | "reference_only" | "generated_asset" | "unknown";
  qualityScore?: number;
  consistencyScore?: number;
  createdAt: string;
  updatedAt?: string;
};

export type VisualInspirationLibrary = {
  items: VisualInspirationItem[];
  defaultStyleItemIds?: string[];
  pinnedItemIds?: string[];
};
