// Which Natural Earth country (or which part of it) becomes which Risk territory.
//
// A rule is either a fixed result, or an object with:
//   poly(c)  — decided per polygon (island) from its centroid; return undefined to fall through
//   pixel(l) — decided per pixel from its lon/lat (used to split big countries)
// Lon values are unwrapped into the board window (-169.2 … 190.8), so Chukotka is > 180.

import type { TerritoryId } from '../../src/engine/types';

/** 'ireland' = part of Great Britain, kept as a separate island. */
export type Resolved = TerritoryId | 'decor' | 'drop' | 'ireland';
export interface PolyInfo {
  lon: number;
  lat: number;
  /** approx area in square degrees */
  area: number;
}
export type Rule =
  | Resolved
  | {
      poly?: (c: PolyInfo) => Resolved | undefined;
      pixel?: (lon: number, lat: number) => Resolved;
      default?: Resolved;
    };

const usSplitLon = (lat: number) => -101 + (Math.min(49, Math.max(25, lat)) - 30) * (5.5 / 19);

// Hudson Strait: separates Quebec's Ungava from Baffin Island (Ontario on this board).
const hudsonLine = (lon: number) => 62.9 - (lon + 78) * 0.143;

function canada(lon: number, lat: number): Resolved {
  const qSplit = lat > 47 ? -79.5 : -79.5 + (47 - lat) * 1.6;
  if (lon > qSplit && (lat < 60 ? true : lat < hudsonLine(lon)) && lon > -80) return 'quebec';
  if (lat < 60) return lon <= -102 ? 'alberta' : 'ontario';
  // North of 60: Hudson Bay's west shore, Southampton, Melville Peninsula and Baffin → Ontario
  // (so Ontario faces Greenland across Davis Strait); the rest of the north → Northwest Territory.
  if (lat < 73.9 && (lon > -88.5 || (lat < 66.5 && lon > -100))) return 'ontario';
  return 'northwest_territory';
}

function russia(lon: number, lat: number): Resolved {
  // Arctic islands and Yamal north of the Pechora coast belong with the Urals.
  if (lat > 69.8 && lon > 44 && lon < 75) return 'ural';
  if (lon < 57.5) return 'ukraine';
  if (lon < 75) return 'ural';
  if (lon > 152 || (lon > 140 && lat < 64) || (lat < 57.5 && lon > 122)) return 'kamchatka';
  if (lat < 58 && lon > 97) return 'irkutsk';
  if (lon >= 108) return 'yakutsk';
  return 'siberia';
}

function kazakhstan(lon: number, lat: number): Resolved {
  if (lon > 79.5 && lat > 46.3) return 'siberia'; // East Kazakhstan: Siberia meets China at the Altai
  if (lon < 58.5 && lat < 49) return 'afghanistan'; // Caspian lowlands: Afghanistan meets Ukraine
  if (lat < 45.8 && lon < 70) return 'afghanistan'; // Aral / Syr Darya
  return 'ural'; // the steppe: Ural reaches China at the Dzungarian gate and meets Afghanistan
}

function china(lon: number, lat: number): Resolved {
  // Manchuria (+ Hulunbuir) goes to Mongolia, giving it the Pacific coast.
  if (lon > 115 && lat > 46) return 'mongolia';
  if (lon > 118.3 && lat > 38.6) return 'mongolia';
  return 'china';
}

function usa(lon: number, lat: number): Resolved {
  return lon < usSplitLon(lat) ? 'western_us' : 'eastern_us';
}

function australia(lon: number, _lat: number): Resolved {
  return lon < 136.8 ? 'western_australia' : 'eastern_australia';
}

const all = (t: Resolved, names: string[]) => Object.fromEntries(names.map((n) => [n, t])) as Record<string, Rule>;

export const RULES: Record<string, Rule> = {
  // ---------------------------------------------------------------- North America
  'United States of America': {
    poly: (c) => {
      if (c.lon > 0 || c.lon < -168.5) return 'drop'; // western Aleutians
      if (c.lat < 25 && c.lon < -150) return 'decor'; // Hawaii
      if (c.lat > 50 && c.lon < -129) return 'alaska';
      return undefined;
    },
    pixel: usa,
  },
  Canada: { pixel: canada },
  Greenland: 'greenland',
  ...all('central_america', [
    'Mexico', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama',
    'Cuba', 'Jamaica', 'Haiti', 'Dominican Rep.', 'Puerto Rico', 'Bahamas',
  ]),
  // ---------------------------------------------------------------- South America
  ...all('venezuela', ['Colombia', 'Venezuela', 'Guyana', 'Suriname', 'Trinidad and Tobago']),
  Ecuador: { poly: (c) => (c.lon < -85 ? 'drop' : 'peru') },
  ...all('peru', ['Peru', 'Bolivia']),
  Brazil: 'brazil',
  Chile: { poly: (c) => (c.lon < -80 ? 'drop' : 'argentina') },
  ...all('argentina', ['Argentina', 'Uruguay', 'Paraguay']),
  'Falkland Is.': 'decor',
  // ---------------------------------------------------------------- Europe
  Iceland: 'iceland',
  'United Kingdom': {
    poly: (c) => (c.lat < 49.5 ? 'drop' : c.lon < -5.3 && c.lat < 55.4 && c.lat > 53.9 ? 'ireland' : 'great_britain'),
  },
  Ireland: 'ireland',
  'Isle of Man': 'great_britain',
  Norway: { poly: (c) => (c.lat > 74 ? 'decor' : c.lon < 0 ? 'drop' : 'scandinavia') },
  ...all('scandinavia', ['Sweden', 'Finland', 'Åland']),
  Denmark: { poly: (c) => (c.lon > 0 && c.lat > 53 ? 'northern_europe' : 'drop') },
  Netherlands: { poly: (c) => (c.lat > 45 ? 'northern_europe' : 'drop') },
  ...all('northern_europe', ['Germany', 'Belgium', 'Luxembourg', 'Poland', 'Czechia', 'Slovakia']),
  France: {
    poly: (c) => {
      if (c.lat > 41 && c.lon > -6 && c.lon < 10) return 'western_europe';
      if (c.lon < -45 && c.lon > -60 && c.lat > 0 && c.lat < 10) return 'venezuela'; // French Guiana
      return 'drop';
    },
  },
  Spain: { poly: (c) => (c.lat > 35.95 ? 'western_europe' : c.lat < 30 && c.lon < -13 ? 'decor' : 'drop') },
  Portugal: { poly: (c) => (c.lon > -10 && c.lat > 36 ? 'western_europe' : 'drop') },
  ...all('western_europe', ['Andorra', 'Monaco']),
  ...all('southern_europe', [
    'Switzerland', 'Liechtenstein', 'Austria', 'Italy', 'San Marino', 'Vatican', 'Malta', 'Slovenia',
    'Croatia', 'Bosnia and Herz.', 'Serbia', 'Montenegro', 'Kosovo', 'Albania', 'Macedonia', 'Greece',
    'Bulgaria', 'Romania', 'Hungary',
  ]),
  ...all('ukraine', ['Estonia', 'Latvia', 'Lithuania', 'Belarus', 'Ukraine', 'Moldova', 'Georgia', 'Armenia', 'Azerbaijan']),
  Russia: { pixel: russia },
  // ---------------------------------------------------------------- Asia
  Kazakhstan: { pixel: kazakhstan },
  ...all('afghanistan', ['Afghanistan', 'Uzbekistan', 'Turkmenistan', 'Tajikistan', 'Kyrgyzstan']),
  Yemen: { poly: (c) => (c.lon > 51.5 && c.lat < 13.5 ? 'drop' : 'middle_east') }, // drop Socotra
  ...all('middle_east', [
    'Turkey', 'Cyprus', 'N. Cyprus', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Iraq', 'Iran',
    'Kuwait', 'Saudi Arabia', 'Qatar', 'Bahrain', 'United Arab Emirates', 'Oman',
  ]),
  India: { poly: (c) => (c.lon > 91.5 && c.lat < 15 ? 'drop' : 'india') }, // no Andaman/Nicobar
  ...all('india', ['Pakistan', 'Nepal', 'Bhutan', 'Bangladesh', 'Sri Lanka', 'Siachen Glacier']),
  China: { pixel: china },
  ...all('china', ['Taiwan', 'Hong Kong', 'Macao']),
  ...all('mongolia', ['Mongolia', 'North Korea', 'South Korea']),
  Japan: { poly: (c) => (c.lat < 30.5 || c.lon > 146 ? 'drop' : 'japan') },
  ...all('siam', ['Myanmar', 'Thailand', 'Laos', 'Cambodia', 'Vietnam', 'Singapore']),
  Malaysia: { poly: (c) => (c.lon < 105 ? 'siam' : 'indonesia') },
  Indonesia: { poly: (c) => (c.lon > 132 ? 'new_guinea' : 'indonesia') },
  ...all('indonesia', ['Brunei', 'Timor-Leste']),
  'Papua New Guinea': 'new_guinea',
  Philippines: 'decor',
  // ---------------------------------------------------------------- Australia
  Australia: {
    poly: (c) => {
      if (c.lon < 110 || c.lon > 155) return 'drop';
      if (c.lat < -39.3) return 'eastern_australia'; // Tasmania
      return undefined;
    },
    pixel: australia,
  },
  ...all('decor', ['New Zealand', 'Fiji', 'New Caledonia', 'Solomon Is.', 'Vanuatu']),
  // ---------------------------------------------------------------- Africa
  ...all('north_africa', [
    'Morocco', 'W. Sahara', 'Algeria', 'Tunisia', 'Mauritania', 'Mali', 'Niger', 'Chad', 'Senegal', 'Gambia',
    'Guinea-Bissau', 'Guinea', 'Sierra Leone', 'Liberia', "Côte d'Ivoire", 'Burkina Faso', 'Ghana', 'Togo',
    'Benin', 'Nigeria',
  ]),
  ...all('egypt', ['Egypt', 'Libya']),
  ...all('east_africa', [
    'Sudan', 'S. Sudan', 'Eritrea', 'Djibouti', 'Ethiopia', 'Somalia', 'Somaliland', 'Kenya', 'Uganda',
    'Rwanda', 'Burundi', 'Tanzania',
  ]),
  ...all('congo', ['Cameroon', 'Central African Rep.', 'Eq. Guinea', 'Gabon', 'Congo', 'Dem. Rep. Congo', 'Angola']),
  ...all('south_africa', [
    'Namibia', 'Botswana', 'Zimbabwe', 'Zambia', 'Malawi', 'Mozambique', 'South Africa', 'Lesotho', 'eSwatini',
  ]),
  Madagascar: 'madagascar',
};
