// Contract between the map pipeline (scripts/build-map.ts → src/map/board.json) and the renderer.

import type { ContinentId, TerritoryId } from '../engine/types';

/** Board coordinates: origin bottom-left, +x east, +y north, units = board units. */
export type Vec2 = [number, number];

export interface PolygonGeom {
  /** Counter-clockwise, no repeated closing point. */
  outer: Vec2[];
  /** Clockwise, no repeated closing point. */
  holes: Vec2[][];
}

export interface TerritoryGeom {
  id: TerritoryId;
  /** Main landmass first. Tiny specks already dropped. */
  polygons: PolygonGeom[];
  /** Where the army piece + count badge sits. Inside the main polygon, clear of edges. */
  anchor: Vec2;
  /** Where the territory name label sits (near but not on top of the anchor). */
  labelAnchor: Vec2;
  area: number;
  /** [minX, minY, maxX, maxY] */
  bbox: [number, number, number, number];
}

export interface SeaLaneGeom {
  a: TerritoryId;
  b: TerritoryId;
  /**
   * Polyline segments in board coords, coast-to-coast. Normally one segment.
   * Alaska–Kamchatka wraps around the board edge: two segments, each running off an edge.
   */
  segments: Vec2[][];
  wrap: boolean;
}

export interface ContinentGeom {
  id: ContinentId;
  /** Where the continent name + bonus label sits (usually on the ocean beside the continent). */
  labelAnchor: Vec2;
}

export interface BoardGeometry {
  version: 1;
  width: number;
  height: number;
  /** Human-readable note on projection + crop, for maintainers. */
  projection: string;
  territories: Record<TerritoryId, TerritoryGeom>;
  seaLanes: SeaLaneGeom[];
  continents: Record<ContinentId, ContinentGeom>;
  /** Non-playable land drawn as neutral terrain (e.g. New Zealand, Caribbean specks). May be empty. */
  decorativeLand: PolygonGeom[];
  oceanLabels: { text: string; at: Vec2; size: number }[];
}
