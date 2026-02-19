// Game configuration - mirrors server config
export const BIRD_TYPES = ['yellow', 'blue', 'cloudyblue', 'orange', 'pink', 'purple', 'red', 'teal', 'diddy'];

export const SERVER_ZONES = {
  'us-1': { name: 'US $1', region: 'us', minBet: 1, maxBet: 4 },
  'us-5': { name: 'US $5', region: 'us', minBet: 5, maxBet: 19 },
  'us-20': { name: 'US $20', region: 'us', minBet: 20, maxBet: Infinity },
  'eu-1': { name: 'EU $1', region: 'eu', minBet: 1, maxBet: 4 },
  'eu-5': { name: 'EU $5', region: 'eu', minBet: 5, maxBet: 19 },
  'eu-20': { name: 'EU $20', region: 'eu', minBet: 20, maxBet: Infinity },
};

export const BET_AMOUNTS = [1, 5, 25];

export const DEFAULT_CONFIG = {
  worldWidth: 2000,
  worldHeight: 2000,
  playerSize: 25,
  bulletSize: 3,
  bulletSpeed: 18,
  bulletLifetime: 120,
  bulletRange: 310,
  playerSpeed: 7,
  shootCooldown: 120,
  boostMax: 100,
  orbSize: 12,
  orbMagnetRadius: 120,
  cashoutTime: 2000,
  cashoutSegments: 10,
  borderMarginMin: 50,
  borderMarginMax: 250,
};

// Feather colors for each bird type (for death explosions)
export const FEATHER_COLORS = {
  yellow: ['#FFD700', '#FFA500', '#FF8C00'],
  blue: ['#4169E1', '#1E90FF', '#00BFFF'],
  cloudyblue: ['#87CEEB', '#ADD8E6', '#B0E0E6'],
  orange: ['#FF4500', '#FF6347', '#FF7F50'],
  pink: ['#FF69B4', '#FF1493', '#DB7093'],
  purple: ['#9400D3', '#8B008B', '#9932CC'],
  red: ['#DC143C', '#B22222', '#FF0000'],
  teal: ['#008080', '#20B2AA', '#40E0D0'],
  diddy: ['#FFD700', '#FFA500', '#FF8C00'],
};


