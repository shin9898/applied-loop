/** Barrel — import from `@/components/living-atlas` */
export { AtlasShell } from "./atlas-shell";
export { AtlasBrandMark } from "./atlas-brand-mark";
export { AtlasChrome, AtlasPageTitle } from "./atlas-chrome";
export type { AtlasChromeActive } from "./atlas-chrome";
export {
  AtlasSurfaceIcon,
  SURFACE_COLORS,
  surfaceColor,
  surfaceIdFromPathname,
} from "./atlas-surface-icons";
export type { AtlasSurfaceId } from "./atlas-surface-icons";
export { AtlasCommandDock } from "./atlas-command-dock";
export { AtlasReveal } from "./atlas-reveal";
export { AtlasWorldMap } from "./atlas-world-map";
export { AtlasDashboard } from "./atlas-dashboard";
export type { AtlasDashboardProps } from "./atlas-dashboard";
export { AtlasBattle } from "./atlas-battle";
export type { AtlasBattleProps } from "./atlas-battle";
export { AtlasZukan } from "./atlas-zukan";
export type { ZukanItem } from "./atlas-zukan";
export { AtlasZukanDex } from "./atlas-zukan-dex";
export { AtlasZukanQuadrant } from "./atlas-zukan-quadrant";
export { AtlasGatesList } from "./atlas-gates-list";
export type { GateListItem } from "./atlas-gates-list";
export { AtlasDungeonSelect } from "./atlas-dungeon-select";
export { AtlasDungeonRun } from "./atlas-dungeon-run";
export {
  battleHref,
  buildDungeons,
  dungeonHref,
  findDungeon,
  isSystemKind,
  nextFloorAfter,
} from "./atlas-dungeons";
export type { Dungeon, DungeonFloor } from "./atlas-dungeons";
export { AtlasEnemySprite, AtlasDungeonIcon } from "./atlas-dungeon-sprites";
export { AtlasHarness } from "./atlas-harness";
export type { HarnessRepo } from "./atlas-harness";
export { AtlasPrescription } from "./atlas-prescription";
export { AtlasConceptPromptCache } from "./atlas-concept-prompt-cache";
export { AtlasExperimentDetail } from "./atlas-experiment-detail";
export { AtlasGoals } from "./atlas-goals";
export type { GoalItem } from "./atlas-goals";
export { AtlasNikkiShelf } from "./atlas-nikki-shelf";
export { groupNikkiMonths } from "./nikki-months";
export type { NikkiDay, NikkiMonth } from "./nikki-months";
export { AtlasEntries } from "./atlas-entries";
export type { EntryItem } from "./atlas-entries";
export { AtlasEntryDetail } from "./atlas-entry-detail";
export { AtlasInboxDetail } from "./atlas-inbox-detail";
export { AtlasRequirements } from "./atlas-requirements";
export type { RequirementItem } from "./atlas-requirements";
export {
  ALL_ENEMIES,
  DEFAULT_ENEMY,
  enemyById,
  enemyForGate,
  enemyForSystem,
  paintEnemyFrame,
} from "./atlas-enemies";
export type { EnemyDef, EnemyId } from "./atlas-enemies";
