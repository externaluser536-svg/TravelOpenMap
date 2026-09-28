// Экспорт в GPX 1.1 и GeoJSON.

export interface TrackPoint {
  lng: number;
  lat: number;
  /** unix ms */
  t: number;
}

export interface GpxWaypoint {
  lng: number;
  lat: number;
  name: string;
  desc?: string;
  t?: number;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function toGpx(tracks: { name: string; points: TrackPoint[] }[], waypoints: GpxWaypoint[]): string {
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">` +
        (w.t ? `<time>${new Date(w.t).toISOString()}</time>` : '') +
        `<name>${esc(w.name)}</name>` +
        (w.desc ? `<desc>${esc(w.desc)}</desc>` : '') +
        `</wpt>`,
    )
    .join('\n');
  const trks = tracks
    .filter((t) => t.points.length)
    .map(
      (t) =>
        `  <trk><name>${esc(t.name)}</name><trkseg>\n` +
        t.points
          .map((p) => `    <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${new Date(p.t).toISOString()}</time></trkpt>`)
          .join('\n') +
        `\n  </trkseg></trk>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="TravelOpenMap" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n${trks}\n</gpx>\n`
  );
}

export function notesToGeoJson(
  notes: { id: string; title: string; text: string; category: string; lng: number; lat: number; createdAt: number }[],
) {
  return {
    type: 'FeatureCollection' as const,
    features: notes.map((n) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [n.lng, n.lat] },
      properties: { id: n.id, title: n.title, text: n.text, category: n.category, createdAt: new Date(n.createdAt).toISOString() },
    })),
  };
}
