// Static MLB park table, keyed by statsapi home-team id. Shared by the
// weather fetch (fetch-park-weather.ts) + weather fit (fit-weather-nrfi.ts).
// Coordinates are city-block accurate (weather-grid resolution is ~10km).
// `roof`: domes/retractables get NO temp adjustment — indoor air is
// ~constant and roof state is unobservable; treating retractables as
// indoor attenuates rather than corrupts the signal.
export const PARKS: Record<number, { name: string; lat: number; lon: number; roof: "open" | "retractable" | "dome" }> = {
  108: { name: "Angel Stadium",        lat: 33.800, lon: -117.883, roof: "open" },
  109: { name: "Chase Field",          lat: 33.445, lon: -112.067, roof: "retractable" },
  110: { name: "Camden Yards",         lat: 39.284, lon: -76.622,  roof: "open" },
  111: { name: "Fenway Park",          lat: 42.346, lon: -71.097,  roof: "open" },
  112: { name: "Wrigley Field",        lat: 41.948, lon: -87.655,  roof: "open" },
  113: { name: "Great American",       lat: 39.097, lon: -84.507,  roof: "open" },
  114: { name: "Progressive Field",    lat: 41.496, lon: -81.685,  roof: "open" },
  115: { name: "Coors Field",          lat: 39.756, lon: -104.994, roof: "open" },
  116: { name: "Comerica Park",        lat: 42.339, lon: -83.049,  roof: "open" },
  117: { name: "Daikin Park",          lat: 29.757, lon: -95.356,  roof: "retractable" },
  118: { name: "Kauffman Stadium",     lat: 39.051, lon: -94.480,  roof: "open" },
  119: { name: "Dodger Stadium",       lat: 34.074, lon: -118.240, roof: "open" },
  120: { name: "Nationals Park",       lat: 38.873, lon: -77.007,  roof: "open" },
  121: { name: "Citi Field",           lat: 40.757, lon: -73.846,  roof: "open" },
  133: { name: "Sutter Health Park",   lat: 38.580, lon: -121.513, roof: "open" },
  134: { name: "PNC Park",             lat: 40.447, lon: -80.006,  roof: "open" },
  135: { name: "Petco Park",           lat: 32.708, lon: -117.157, roof: "open" },
  136: { name: "T-Mobile Park",        lat: 47.591, lon: -122.332, roof: "retractable" },
  137: { name: "Oracle Park",          lat: 37.778, lon: -122.389, roof: "open" },
  138: { name: "Busch Stadium",        lat: 38.623, lon: -90.193,  roof: "open" },
  139: { name: "Tropicana Field",      lat: 27.768, lon: -82.653,  roof: "dome" },
  140: { name: "Globe Life Field",     lat: 32.747, lon: -97.084,  roof: "retractable" },
  141: { name: "Rogers Centre",        lat: 43.641, lon: -79.389,  roof: "retractable" },
  142: { name: "Target Field",         lat: 44.982, lon: -93.278,  roof: "open" },
  143: { name: "Citizens Bank Park",   lat: 39.906, lon: -75.166,  roof: "open" },
  144: { name: "Truist Park",          lat: 33.891, lon: -84.468,  roof: "open" },
  145: { name: "Rate Field",           lat: 41.830, lon: -87.634,  roof: "open" },
  146: { name: "loanDepot park",       lat: 25.778, lon: -80.220,  roof: "retractable" },
  147: { name: "Yankee Stadium",       lat: 40.829, lon: -73.926,  roof: "open" },
  158: { name: "American Family Field", lat: 43.028, lon: -87.971, roof: "retractable" },
};
