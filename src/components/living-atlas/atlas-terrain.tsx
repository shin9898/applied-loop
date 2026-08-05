/**
 * Deprecated observatorium terrain — kept as thin re-export for old imports.
 * Prefer AtlasWorldMap + AtlasDashboard (DQ / ぼうけんのしょ).
 */
export { AtlasWorldMap as AtlasTerrain } from "./atlas-world-map";

/** @deprecated Use pendingGate band + AtlasBattle instead of overlay beacon */
export function AtlasBeacon(_props?: {
  question?: string;
  context?: string;
  href?: string;
}) {
  void _props;
  return null;
}
