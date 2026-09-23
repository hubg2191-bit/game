// simAdapter: один код sim для клиента и сервера (architecture.md: shared/sim).
// В docker sim лежит в ./client-sim, локально — ../src/game.
import fs from 'fs';
import { pathToFileURL } from 'url';

const base = fs.existsSync('./client-sim/sim.js') ? './client-sim' : '../src/game';
const simUrl = pathToFileURL(base + '/sim.js').href;
export const sim = await import(simUrl);

const read = (p) => JSON.parse(fs.readFileSync(`${base}/${p}`, 'utf8'));
const units = read('data/units.json');
const bdefs = read('data/buildings.json');
const races = read('data/races.json');
const heroes = read('data/heroes.json');
const netcode = read('data/netcode.json');
const maps = {
  plain: read('data/maps/skirmish-plain.json'),
  river: read('data/maps/skirmish-river.json'),
  pass: read('data/maps/skirmish-pass.json'),
};

export const data = { units, bdefs, races, heroes, netcode, maps };
export const SIM_VERSION = netcode.simVersion;
export const CFG = {
  simTickHz: netcode.simTickHz,
  snapHz: netcode.snapHz,
  maxOrdersPerSec: netcode.maxOrdersPerSec,
  maxSnapKb: netcode.maxSnapKb,
  reconnectSec: netcode.reconnectSec,
  autosaveSec: netcode.autosaveSec,
};
