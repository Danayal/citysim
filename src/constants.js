// ---- World & grid ------------------------------------------------------
export const N = 48;              // cells per side
export const CELL = 4;            // world units per cell
export const WORLD = N * CELL;    // world size in units
export const MAX_CARS = 160;

export const T = { WATER: 0, BEACH: 1, SAND: 2, PALM: 3 };       // terrain
export const K = { EMPTY: 0, ROAD: 1, BLDG: 2 };                 // occupancy
export const Z = { NONE: 0, R: 1, C: 2, I: 3 };                  // zones
export const M = { NONE: 0, TRACK: 1, STATION: 2 };              // metro layer

export const HW_Z = 24;           // highway connection row (east edge)

export const idx = (x, z) => z * N + x;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < N && z < N;

// Coastline on the west: water where x < coastCol(z), beach at the edge.
export function coastCol(z) {
  return 11 + Math.round(2 * Math.sin(z * 0.22) + 1.4 * Math.sin(z * 0.07 + 2));
}

export const cellToWorld = (x, z) => [
  (x + 0.5) * CELL - WORLD / 2,
  (z + 0.5) * CELL - WORLD / 2,
];
export const worldToCell = (wx, wz) => [
  Math.floor((wx + WORLD / 2) / CELL),
  Math.floor((wz + WORLD / 2) / CELL),
];

// ---- Zoned building stats by level (level 1..3) -------------------------
export const ZONE_STATS = {
  [Z.R]: [
    { pop: 6,  power: 1, water: 1 },
    { pop: 22, power: 3, water: 3 },
    { pop: 60, power: 8, water: 8 },
  ],
  [Z.C]: [
    { jobs: 5,  power: 1, water: 1 },
    { jobs: 16, power: 4, water: 2 },
    { jobs: 45, power: 9, water: 4 },
  ],
  [Z.I]: [
    { jobs: 8,  power: 2, water: 1 },
    { jobs: 22, power: 6, water: 3 },
    { jobs: 50, power: 12, water: 5 },
  ],
};

// ---- Catalog ------------------------------------------------------------
// drag: paintable by dragging. zone: paints zone id. coast: must touch water.
// svc: coverage type. radius in cells. power/water: capacity provided.
export const CATALOG = {
  // Transport
  road:    { name: 'Road', icon: '🛣️', cat: 'transport', cost: 40, maint: 0.6, drag: true,
             desc: 'Drag to draw roads. Connect to the glowing highway ramp on the east edge to open your city.' },
  metro:   { name: 'Metro Track', icon: '🚝', cat: 'transport', cost: 150, maint: 2, drag: true, metro: true,
             desc: 'Elevated track, Dubai-style. Drag to build, then add stations.' },
  station: { name: 'Metro Station', icon: '🚉', cat: 'transport', cost: 2400, maint: 26, w: 1, d: 1, radius: 9, onTrack: true,
             desc: 'Place on metro track. Citizens near 2+ connected stations ride instead of driving.' },

  // Zones
  zoneR: { name: 'Homes', icon: '🏠', cat: 'zones', cost: 12, drag: true, zone: Z.R,
           desc: 'Paint beside roads. Desert villas grow into marina towers.' },
  zoneC: { name: 'Commerce', icon: '🏬', cat: 'zones', cost: 12, drag: true, zone: Z.C,
           desc: 'Shops and glass offices. Needs residents and tourists.' },
  zoneI: { name: 'Industry', icon: '🏭', cat: 'zones', cost: 12, drag: true, zone: Z.I,
           desc: 'Jobs and trade. Keep smog away from homes.' },

  // Utilities
  solar: { name: 'Solar Farm', icon: '☀️', cat: 'utilities', cost: 2600, maint: 28, w: 2, d: 2, power: 70,
           desc: 'Clean power from endless desert sun.' },
  gas:   { name: 'Power Plant', icon: '⚡', cat: 'utilities', cost: 7500, maint: 110, w: 2, d: 2, power: 260, pollution: true,
           desc: 'Serious megawatts, a little smog.' },
  desal: { name: 'Desalination', icon: '💧', cat: 'utilities', cost: 4200, maint: 55, w: 2, d: 2, water: 220, coast: true,
           desc: 'Drinks the Gulf so your city can too. Must touch the sea.' },
  tank:  { name: 'Water Tower', icon: '🚰', cat: 'utilities', cost: 1300, maint: 14, w: 1, d: 1, water: 60,
           desc: 'A modest splash of water supply.' },

  // Services
  school:   { name: 'School', icon: '🏫', cat: 'services', cost: 3600, maint: 70, w: 2, d: 2, radius: 10, svc: 'edu',
              desc: 'Educated citizens build taller.' },
  hospital: { name: 'Clinic', icon: '🏥', cat: 'services', cost: 5800, maint: 110, w: 2, d: 2, radius: 12, svc: 'health',
              desc: 'Healthy and happy, even in August.' },
  police:   { name: 'Police', icon: '🚓', cat: 'services', cost: 2600, maint: 55, w: 1, d: 1, radius: 10, svc: 'safety',
              desc: 'Keeps the souk honest.' },
  fire:     { name: 'Fire Station', icon: '🚒', cat: 'services', cost: 2600, maint: 55, w: 1, d: 1, radius: 10, svc: 'fire',
              desc: 'Sand is fireproof. Towers are not.' },
  mosque:   { name: 'Grand Mosque', icon: '🕌', cat: 'services', cost: 3200, maint: 35, w: 2, d: 2, radius: 10, svc: 'joy',
              desc: 'Beautiful domes, calmer citizens.' },
  park:     { name: 'Palm Park', icon: '🌴', cat: 'services', cost: 650, maint: 8, w: 1, d: 1, radius: 6, svc: 'joy',
              desc: 'Shade! Glorious shade.' },
  souk:     { name: 'Souk', icon: '🏺', cat: 'services', cost: 2100, maint: 18, w: 2, d: 2, radius: 9, svc: 'joy', income: 30,
              desc: 'Gold, spice and tourist money.' },

  // Landmarks (unlocked by population)
  fountain:   { name: 'Dancing Fountain', icon: '⛲', cat: 'landmarks', cost: 5000, maint: 30, w: 2, d: 2,
                radius: 10, svc: 'joy', tourism: 40, unlock: 200,
                desc: 'Water that dances better than you.' },
  frame:      { name: 'Dubai Frame', icon: '🖼️', cat: 'landmarks', cost: 12000, maint: 50, w: 2, d: 2,
                radius: 11, svc: 'joy', tourism: 80, unlock: 500,
                desc: 'A golden window between old and new Dubai.' },
  burjalarab: { name: 'Burj Al Arab', icon: '⛵', cat: 'landmarks', cost: 25000, maint: 90, w: 2, d: 2, coast: true,
                radius: 12, svc: 'joy', tourism: 160, unlock: 1200,
                desc: 'The seven-star sail. Must touch the sea.' },
  museum:     { name: 'Museum of the Future', icon: '🔮', cat: 'landmarks', cost: 20000, maint: 80, w: 2, d: 2,
                radius: 11, svc: 'joy', tourism: 130, unlock: 2000,
                desc: 'A silver ring of tomorrow, inscribed in calligraphy.' },
  mall:       { name: 'Dubai Mall', icon: '🛍️', cat: 'landmarks', cost: 30000, maint: 120, w: 3, d: 3,
                radius: 12, svc: 'joy', tourism: 180, jobs: 120, unlock: 3000,
                desc: 'A city inside your city. With an aquarium.' },
  palm:       { name: 'Palm Island', icon: '🏝️', cat: 'landmarks', cost: 40000, maint: 60, special: 'palm', unlock: 4000,
                tourism: 220, desc: 'Tap the open sea to reclaim a palm-shaped island you can build on.' },
  burj:       { name: 'Burj Khalifa', icon: '🗼', cat: 'landmarks', cost: 60000, maint: 200, w: 3, d: 3,
                radius: 14, svc: 'joy', tourism: 350, unlock: 6000,
                desc: 'The tallest thing on Earth. Fireworks included.' },

  // The Future (high-population tech tree)
  vertfarm:  { name: 'Vertical Farm', icon: '🥬', cat: 'future', cost: 8000, maint: 60, w: 2, d: 2,
               water: 80, radius: 7, svc: 'joy', unlock: 1500,
               desc: 'Lettuce towers in the desert. Recycles its own water.' },
  droneport: { name: 'Drone Port', icon: '🛸', cat: 'future', cost: 9000, maint: 70, w: 2, d: 2,
               jobs: 20, trafficCut: 0.08, unlock: 2000,
               desc: 'Parcels by air — delivery vans stay home.' },
  hyperloop: { name: 'Hyperloop Hub', icon: '🚄', cat: 'future', cost: 16000, maint: 110, w: 2, d: 2,
               jobs: 30, tourism: 60, trafficCut: 0.12, unlock: 2500,
               desc: 'Abu Dhabi in 9 minutes. Commuters vanish from your roads.' },
  skyport:   { name: 'Sky-Taxi Pad', icon: '🚁', cat: 'future', cost: 7000, maint: 45, w: 1, d: 1,
               trafficCut: 0.04, radius: 6, svc: 'joy', unlock: 3000,
               desc: 'Build 2+ pads and flying taxis start hopping between them.' },
  robopolice:{ name: 'Robo-Police HQ', icon: '🤖', cat: 'future', cost: 9000, maint: 80, w: 2, d: 2,
               radius: 18, svc: 'safety', unlock: 3500,
               desc: 'Patrols the whole district. Never sleeps, never snacks.' },
  fusion:    { name: 'Fusion Reactor', icon: '⚛️', cat: 'future', cost: 30000, maint: 180, w: 2, d: 2,
               power: 800, unlock: 4500,
               desc: 'A bottled star. Powers everything you will ever build.' },
  arcology:  { name: 'Arcology Dome', icon: '🌐', cat: 'future', cost: 45000, maint: 220, w: 3, d: 3,
               pop: 400, use: { power: 40, water: 30 }, radius: 8, svc: 'joy', unlock: 6000,
               desc: 'A whole neighbourhood under one climate-controlled dome.' },
  spaceelevator: { name: 'Space Elevator', icon: '🛰️', cat: 'future', cost: 150000, maint: 500, w: 2, d: 2,
               tourism: 500, radius: 16, svc: 'joy', unlock: 10000,
               desc: 'The ultimate flex: a ribbon to orbit. Watch the launches.' },

  // Tools
  bulldoze: { name: 'Bulldoze', icon: '🦴', cat: 'tools', cost: 0, drag: true,
              desc: 'Demolish. Refunds 25% of the build cost.' },
  inspect:  { name: 'Inspect', icon: '🔍', cat: 'tools', cost: 0,
              desc: 'Tap anything to see how it is doing.' },
  heatmap:  { name: 'Traffic View', icon: '🌡️', cat: 'tools', cost: 0, toggle: true,
              desc: 'Toggle congestion heatmap on roads.' },
};

export const CATEGORIES = [
  { id: 'transport', name: 'Move',  icon: '🛣️' },
  { id: 'zones',     name: 'Zone',  icon: '🏗️' },
  { id: 'utilities', name: 'Power', icon: '⚡' },
  { id: 'services',  name: 'Serve', icon: '🏥' },
  { id: 'landmarks', name: 'Wonders', icon: '🗼' },
  { id: 'future',    name: 'Future', icon: '🚀' },
  { id: 'tools',     name: 'Tools', icon: '🔍' },
];

export const MILESTONES = [
  { pop: 100,  title: 'Desert Camp',     reward: 1500,  blurb: 'A few villas between the dunes. It begins.' },
  { pop: 500,  title: 'Oasis Town',      reward: 4000,  blurb: 'The souk is busy and the adhan echoes at sunset.' },
  { pop: 1200, title: 'Gulf City',       reward: 8000,  blurb: 'Cranes on every horizon. The Burj Al Arab awaits.' },
  { pop: 3000, title: 'Emirate Capital', reward: 15000, blurb: 'Tourists arrive by the planeload.' },
  { pop: 6000, title: 'World Metropolis',reward: 30000, blurb: 'Time to build the tallest tower on Earth.' },
  { pop: 10000, title: 'City of the Future', reward: 80000, blurb: 'Flying taxis hum overhead. Next stop: orbit.' },
];

export const SERVICES = ['edu', 'health', 'safety', 'fire', 'joy'];

export const START_MONEY = 22000;
