/**
 * Map tiles for every map in the panel (Live Device Map, Gov Comparison). One place, so the provider can be changed with
 * environment variables and a rebuild - no code change:
 *
 *   VITE_MAP_TILE_URL     tile URL template, e.g. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY
 *   VITE_MAP_ATTRIBUTION  HTML credit line the provider requires (shown on the map)
 *   VITE_MAP_MAX_ZOOM     highest zoom the provider serves (default 19)
 *
 * Default: the public OpenStreetMap tile server. It is free and has no expiry, but it is donation-funded, has no uptime
 * guarantee and may block heavy or commercial use without notice (https://operations.osmfoundation.org/policies/tiles/).
 * For a production deployment point the three variables at a hosted provider or your own tile server.
 */
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';   // no {s} subdomains: the OSM policy asks for this exact host
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
const zoom = Number(import.meta.env.VITE_MAP_MAX_ZOOM);

export const MAP_TILE_URL = clean(import.meta.env.VITE_MAP_TILE_URL) ?? OSM_URL;
/** Attribution always follows the tile source: a custom URL without its own credit line is shown with a neutral one, never with OSM's. */
export const MAP_ATTRIBUTION = clean(import.meta.env.VITE_MAP_ATTRIBUTION) ?? (clean(import.meta.env.VITE_MAP_TILE_URL) ? 'Map tiles: see provider terms' : OSM_ATTRIBUTION);
export const MAP_MAX_ZOOM = Number.isFinite(zoom) && zoom >= 1 && zoom <= 22 ? zoom : 19;
