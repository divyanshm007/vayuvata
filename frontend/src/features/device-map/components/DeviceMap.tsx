import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Box, GlobalStyles } from '@mui/material';
import { MAP_ATTRIBUTION, MAP_MAX_ZOOM, MAP_TILE_URL } from '../../../config/mapTiles';
import type { DeviceLocation } from '../types';

/** Placeholder view (India) used only until the first markers arrive. */
const DEFAULT_CENTER: L.LatLngTuple = [22.5, 79];
const DEFAULT_ZOOM = 4;
const FOCUS_ZOOM = 15;

const PIN_CSS = `
.vv-pin{position:relative;width:30px;height:40px}
.vv-pin .vv-pin-body{position:absolute;left:3px;top:2px;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
  background:#15803D;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.35)}
.vv-pin .vv-pin-dot{position:absolute;left:11px;top:10px;width:8px;height:8px;border-radius:50%;background:#fff}
.vv-pin.stale .vv-pin-body{background:#B45309}
.vv-pin.selected .vv-pin-body{background:#166534;box-shadow:0 0 0 4px rgba(16,185,129,.45),0 4px 10px rgba(0,0,0,.4)}
.vv-pin.selected{z-index:1000 !important}
.leaflet-container{font-family:inherit}
.marker-cluster-small,.marker-cluster-medium,.marker-cluster-large{background-color:rgba(21,128,61,.28)}
.marker-cluster-small div,.marker-cluster-medium div,.marker-cluster-large div{background-color:rgba(21,128,61,.9);color:#fff;font-weight:700}
`;

const iconCache = new Map<string, L.DivIcon>();
/** One icon per visual state (normal / stale, selected or not); markers share them. */
function pinIcon(selected: boolean, stale: boolean): L.DivIcon {
  const k = `${selected ? 's' : 'n'}${stale ? 'o' : 'f'}`;
  let icon = iconCache.get(k);
  if (!icon) {
    icon = L.divIcon({
      className: '', iconSize: [30, 40], iconAnchor: [15, 36], popupAnchor: [0, -34],
      html: `<div class="vv-pin${selected ? ' selected' : ''}${stale ? ' stale' : ''}"><div class="vv-pin-body"></div><div class="vv-pin-dot"></div></div>`,
    });
    iconCache.set(k, icon);
  }
  return icon;
}

interface ControllerProps {
  markers: DeviceLocation[];
  focus: { id: string; token: number } | null;
  fitToken: number;
  animate: boolean;
  markerRefs: React.MutableRefObject<Map<string, L.Marker>>;
  clusterRef: React.MutableRefObject<L.MarkerClusterGroup | null>;
  onReady?: (map: L.Map) => void;
}

/**
 * Owns every camera movement. Normal data refreshes never move the camera: it only moves
 *  (a) once, to fit the first markers that ever appear,
 *  (b) when the user asks to fit all markers, and
 *  (c) when a device is selected (centre on it, make its popup visible).
 */
function CameraController({ markers, focus, fitToken, animate, markerRefs, clusterRef, onReady }: ControllerProps) {
  const map = useMap();
  const fittedFirst = useRef(false);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  useEffect(() => { onReady?.(map); }, [map, onReady]);

  const fitAll = () => {
    const pts = markersRef.current.filter((m) => m.position).map((m) => L.latLng(m.position!.lat!, m.position!.lon!));
    if (pts.length === 0) return;
    if (pts.length === 1) { map.setView(pts[0], FOCUS_ZOOM, { animate }); return; }
    map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16, animate });
  };

  // (a) the first time markers exist
  useEffect(() => {
    if (!fittedFirst.current && markers.length > 0) { fittedFirst.current = true; fitAll(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers.length]);

  // (b) explicit "fit all"
  const lastFit = useRef(fitToken);
  useEffect(() => {
    if (fitToken !== lastFit.current) { lastFit.current = fitToken; fitAll(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  // (c) selection from the list
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!focus || focus.token === lastFocus.current) return;
    lastFocus.current = focus.token;
    const loc = markersRef.current.find((m) => m.device.deviceId === focus.id);
    if (!loc?.position) return;
    const target = L.latLng(loc.position.lat!, loc.position.lon!);
    map.setView(target, Math.max(map.getZoom(), FOCUS_ZOOM), { animate });
    const marker = markerRefs.current.get(focus.id);
    if (marker) {
      const cluster = clusterRef.current;
      if (cluster && typeof cluster.zoomToShowLayer === 'function') cluster.zoomToShowLayer(marker, () => marker.openPopup());
      else marker.openPopup();
    }
  }, [focus, map, animate, markerRefs, clusterRef]);

  return null;
}

export interface DeviceMapProps {
  /** Only devices that have a valid position are drawn. */
  locations: DeviceLocation[];
  selectedId: string | null;
  focus: { id: string; token: number } | null;
  fitToken: number;
  onSelect: (deviceId: string) => void;
  renderPopup: (loc: DeviceLocation) => ReactNode;
  /** false disables camera animation (used by tests) */
  animate?: boolean;
  onMapReady?: (map: L.Map) => void;
}

export function DeviceMap({ locations, selectedId, focus, fitToken, onSelect, renderPopup, animate = true, onMapReady }: DeviceMapProps) {
  const markerRefs = useRef(new Map<string, L.Marker>());
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markers = useMemo(() => locations.filter((l) => l.position), [locations]);

  return (
    <Box sx={{ position: 'relative', height: '100%', width: '100%', borderRadius: '14px', overflow: 'hidden' }}>
      <GlobalStyles styles={PIN_CSS} />
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} minZoom={2} scrollWheelZoom style={{ height: '100%', width: '100%' }} worldCopyJump>
        <TileLayer url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} attribution={MAP_ATTRIBUTION} />
        <CameraController markers={markers} focus={focus} fitToken={fitToken} animate={animate} markerRefs={markerRefs} clusterRef={clusterRef} onReady={onMapReady} />
        <MarkerClusterGroup ref={clusterRef} chunkedLoading maxClusterRadius={46} showCoverageOnHover={false} spiderfyOnMaxZoom>
          {markers.map((m) => (
            <Marker
              key={m.device.deviceId}
              position={[m.position!.lat!, m.position!.lon!]}
              icon={pinIcon(m.device.deviceId === selectedId, m.stale)}
              ref={(r) => { if (r) markerRefs.current.set(m.device.deviceId, r); else markerRefs.current.delete(m.device.deviceId); }}
              eventHandlers={{ click: () => onSelect(m.device.deviceId) }}
              title={m.device.deviceId}
              alt={`Device ${m.device.deviceId}`}
            >
              <Popup minWidth={240} maxWidth={300}>{renderPopup(m)}</Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </Box>
  );
}
