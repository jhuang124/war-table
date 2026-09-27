// Canonical classic-Risk map data: 42 territories, 6 continents, 83 borders.
// Presentation lives elsewhere (src/map for geometry, src/shared/palette.ts for colors).

import type { ContinentId, TerritoryId, CardSymbol } from './types';

export interface ContinentInfo {
  id: ContinentId;
  name: string;
  bonus: number;
  territories: TerritoryId[];
}

export interface TerritoryInfo {
  id: TerritoryId;
  name: string;
  continent: ContinentId;
}

export const CONTINENTS: Record<ContinentId, ContinentInfo> = {
  north_america: {
    id: 'north_america',
    name: 'North America',
    bonus: 5,
    territories: [
      'alaska',
      'northwest_territory',
      'greenland',
      'alberta',
      'ontario',
      'quebec',
      'western_us',
      'eastern_us',
      'central_america',
    ],
  },
  south_america: {
    id: 'south_america',
    name: 'South America',
    bonus: 2,
    territories: ['venezuela', 'peru', 'brazil', 'argentina'],
  },
  europe: {
    id: 'europe',
    name: 'Europe',
    bonus: 5,
    territories: [
      'iceland',
      'scandinavia',
      'great_britain',
      'northern_europe',
      'western_europe',
      'southern_europe',
      'ukraine',
    ],
  },
  africa: {
    id: 'africa',
    name: 'Africa',
    bonus: 3,
    territories: ['north_africa', 'egypt', 'east_africa', 'congo', 'south_africa', 'madagascar'],
  },
  asia: {
    id: 'asia',
    name: 'Asia',
    bonus: 7,
    territories: [
      'ural',
      'siberia',
      'yakutsk',
      'kamchatka',
      'irkutsk',
      'mongolia',
      'japan',
      'afghanistan',
      'china',
      'middle_east',
      'india',
      'siam',
    ],
  },
  australia: {
    id: 'australia',
    name: 'Australia',
    bonus: 2,
    territories: ['indonesia', 'new_guinea', 'western_australia', 'eastern_australia'],
  },
};

export const CONTINENT_IDS = Object.keys(CONTINENTS) as ContinentId[];

const NAMES: Record<TerritoryId, string> = {
  alaska: 'Alaska',
  northwest_territory: 'Northwest Territory',
  greenland: 'Greenland',
  alberta: 'Alberta',
  ontario: 'Ontario',
  quebec: 'Quebec',
  western_us: 'Western United States',
  eastern_us: 'Eastern United States',
  central_america: 'Central America',
  venezuela: 'Venezuela',
  peru: 'Peru',
  brazil: 'Brazil',
  argentina: 'Argentina',
  iceland: 'Iceland',
  scandinavia: 'Scandinavia',
  great_britain: 'Great Britain',
  northern_europe: 'Northern Europe',
  western_europe: 'Western Europe',
  southern_europe: 'Southern Europe',
  ukraine: 'Ukraine',
  north_africa: 'North Africa',
  egypt: 'Egypt',
  east_africa: 'East Africa',
  congo: 'Congo',
  south_africa: 'South Africa',
  madagascar: 'Madagascar',
  ural: 'Ural',
  siberia: 'Siberia',
  yakutsk: 'Yakutsk',
  kamchatka: 'Kamchatka',
  irkutsk: 'Irkutsk',
  mongolia: 'Mongolia',
  japan: 'Japan',
  afghanistan: 'Afghanistan',
  china: 'China',
  middle_east: 'Middle East',
  india: 'India',
  siam: 'Siam',
  indonesia: 'Indonesia',
  new_guinea: 'New Guinea',
  western_australia: 'Western Australia',
  eastern_australia: 'Eastern Australia',
};

export const TERRITORY_IDS: TerritoryId[] = CONTINENT_IDS.flatMap((c) => CONTINENTS[c].territories);

export const TERRITORIES: Record<TerritoryId, TerritoryInfo> = Object.fromEntries(
  CONTINENT_IDS.flatMap((c) =>
    CONTINENTS[c].territories.map((t) => [t, { id: t, name: NAMES[t], continent: c }]),
  ),
) as Record<TerritoryId, TerritoryInfo>;

/** The 83 undirected borders of the classic board. */
export const BORDERS: [TerritoryId, TerritoryId][] = [
  // North America
  ['alaska', 'northwest_territory'],
  ['alaska', 'alberta'],
  ['alaska', 'kamchatka'],
  ['northwest_territory', 'alberta'],
  ['northwest_territory', 'ontario'],
  ['northwest_territory', 'greenland'],
  ['greenland', 'ontario'],
  ['greenland', 'quebec'],
  ['greenland', 'iceland'],
  ['alberta', 'ontario'],
  ['alberta', 'western_us'],
  ['ontario', 'western_us'],
  ['ontario', 'eastern_us'],
  ['ontario', 'quebec'],
  ['quebec', 'eastern_us'],
  ['western_us', 'eastern_us'],
  ['western_us', 'central_america'],
  ['eastern_us', 'central_america'],
  ['central_america', 'venezuela'],
  // South America
  ['venezuela', 'peru'],
  ['venezuela', 'brazil'],
  ['peru', 'brazil'],
  ['peru', 'argentina'],
  ['brazil', 'argentina'],
  ['brazil', 'north_africa'],
  // Europe
  ['iceland', 'great_britain'],
  ['iceland', 'scandinavia'],
  ['scandinavia', 'great_britain'],
  ['scandinavia', 'northern_europe'],
  ['scandinavia', 'ukraine'],
  ['great_britain', 'northern_europe'],
  ['great_britain', 'western_europe'],
  ['northern_europe', 'ukraine'],
  ['northern_europe', 'southern_europe'],
  ['northern_europe', 'western_europe'],
  ['western_europe', 'southern_europe'],
  ['western_europe', 'north_africa'],
  ['southern_europe', 'ukraine'],
  ['southern_europe', 'middle_east'],
  ['southern_europe', 'egypt'],
  ['southern_europe', 'north_africa'],
  ['ukraine', 'middle_east'],
  ['ukraine', 'afghanistan'],
  ['ukraine', 'ural'],
  // Africa
  ['north_africa', 'egypt'],
  ['north_africa', 'east_africa'],
  ['north_africa', 'congo'],
  ['egypt', 'middle_east'],
  ['egypt', 'east_africa'],
  ['east_africa', 'congo'],
  ['east_africa', 'south_africa'],
  ['east_africa', 'madagascar'],
  ['east_africa', 'middle_east'],
  ['congo', 'south_africa'],
  ['south_africa', 'madagascar'],
  // Asia
  ['ural', 'siberia'],
  ['ural', 'china'],
  ['ural', 'afghanistan'],
  ['siberia', 'yakutsk'],
  ['siberia', 'irkutsk'],
  ['siberia', 'mongolia'],
  ['siberia', 'china'],
  ['yakutsk', 'kamchatka'],
  ['yakutsk', 'irkutsk'],
  ['kamchatka', 'irkutsk'],
  ['kamchatka', 'mongolia'],
  ['kamchatka', 'japan'],
  ['irkutsk', 'mongolia'],
  ['mongolia', 'japan'],
  ['mongolia', 'china'],
  ['afghanistan', 'china'],
  ['afghanistan', 'india'],
  ['afghanistan', 'middle_east'],
  ['china', 'india'],
  ['china', 'siam'],
  ['middle_east', 'india'],
  ['india', 'siam'],
  ['siam', 'indonesia'],
  // Australia
  ['indonesia', 'new_guinea'],
  ['indonesia', 'western_australia'],
  ['new_guinea', 'eastern_australia'],
  ['new_guinea', 'western_australia'],
  ['western_australia', 'eastern_australia'],
];

export const ADJACENCY: Record<TerritoryId, TerritoryId[]> = (() => {
  const adj = Object.fromEntries(TERRITORY_IDS.map((t) => [t, [] as TerritoryId[]])) as Record<
    TerritoryId,
    TerritoryId[]
  >;
  for (const [a, b] of BORDERS) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
})();

export function areAdjacent(a: TerritoryId, b: TerritoryId): boolean {
  return ADJACENCY[a].includes(b);
}

/** Card symbol printed on each territory's card: 14 of each, cycling through the canonical order. */
export const CARD_SYMBOLS: Record<TerritoryId, Exclude<CardSymbol, 'wild'>> = Object.fromEntries(
  TERRITORY_IDS.map((t, i) => [t, (['infantry', 'cavalry', 'artillery'] as const)[i % 3]]),
) as Record<TerritoryId, Exclude<CardSymbol, 'wild'>>;

/** Default starting armies by player count (classic rules). */
export const STARTING_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30 };
