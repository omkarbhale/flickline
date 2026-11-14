import type { Vec3 } from '../core/vec3';
import { holdStance, holdStandPos } from '../sim/mapQuery';
import type { MapDef, SectorRole } from '../sim/mapTypes';

/**
 * Top-down plan of a map with its sectors drawn: boxes, sector regions (tinted by role), entry and
 * exit gates, hold anchors (with the way an Echo placed there faces), approach lanes and the nav
 * graph. Debug view for authoring and review (`__flickline.mapPlan()`), never part of the game:
 * north (-Z) is up, east (+X) is right. Draws to any 2D canvas context.
 */

const ROLE_COLOUR: Record<SectorRole, string> = { take: '#4aa3ff', hold: '#ffb347', meet: '#c58bff' };
const BOX_COLOUR: Record<string, string> = {
  wall: '#8a93a6', crate: '#c2a46a', cover: '#c2a46a', platform: '#6f8fa8', ramp: '#7fb58f', trim: '#8a93a6', glass: '#5fc7d8',
};

export interface PlanOptions {
  /** Pixel margin around the map. */
  margin?: number;
  /** Player feet position and yaw (radians) to mark, if any. */
  player?: { pos: Vec3; yaw: number };
}

export function drawMapPlan(g: CanvasRenderingContext2D, width: number, height: number, map: MapDef, opts: PlanOptions = {}): void {
  const margin = opts.margin ?? 56;
  const { min, max } = map.bounds;
  const scale = Math.min((width - margin * 2) / (max.x - min.x), (height - margin * 2 - 70) / (max.z - min.z));
  const ox = (width - (max.x - min.x) * scale) / 2;
  const oy = margin + 24 + ((height - margin * 2 - 70) - (max.z - min.z) * scale) / 2;
  const sx = (x: number): number => ox + (x - min.x) * scale;
  const sy = (z: number): number => oy + (z - min.z) * scale;

  g.save();
  g.fillStyle = '#0d1118';
  g.fillRect(0, 0, width, height);
  g.font = '600 15px system-ui, sans-serif';
  g.textBaseline = 'middle';

  // floor plate
  g.fillStyle = '#171d28';
  g.fillRect(sx(min.x), sy(min.z), (max.x - min.x) * scale, (max.z - min.z) * scale);

  // metre grid
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.ceil(min.x); x <= max.x; x++) { g.moveTo(sx(x), sy(min.z)); g.lineTo(sx(x), sy(max.z)); }
  for (let z = Math.ceil(min.z); z <= max.z; z++) { g.moveTo(sx(min.x), sy(z)); g.lineTo(sx(max.x), sy(z)); }
  g.stroke();

  // sector regions under the geometry
  for (const s of map.sectors) {
    const colour = ROLE_COLOUR[s.role[0]!];
    g.fillStyle = `${colour}2e`;
    g.fillRect(sx(s.region.min.x), sy(s.region.min.z), (s.region.max.x - s.region.min.x) * scale, (s.region.max.z - s.region.min.z) * scale);
  }

  // boxes (walls, crates, platforms, ramps); the floor and ceiling plates are the background
  for (const b of map.boxes) {
    if (b.tag === 'floor' || b.tag === 'ceiling') continue;
    g.fillStyle = BOX_COLOUR[b.tag] ?? '#8a93a6';
    g.fillRect(sx(b.min.x), sy(b.min.z), Math.max(1.5, (b.max.x - b.min.x) * scale), Math.max(1.5, (b.max.z - b.min.z) * scale));
  }

  // nav graph
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  const nodeAt = new Map(map.nav.nodes.map((n) => [n.id, n.pos]));
  g.beginPath();
  for (const [a, b] of map.nav.edges) {
    const pa = nodeAt.get(a);
    const pb = nodeAt.get(b);
    if (pa && pb) { g.moveTo(sx(pa.x), sy(pa.z)); g.lineTo(sx(pb.x), sy(pb.z)); }
  }
  g.stroke();

  // region outlines and labels
  for (const s of map.sectors) {
    const colour = ROLE_COLOUR[s.role[0]!];
    g.strokeStyle = colour;
    g.lineWidth = 2.5;
    g.setLineDash([9, 5]);
    g.strokeRect(sx(s.region.min.x), sy(s.region.min.z), (s.region.max.x - s.region.min.x) * scale, (s.region.max.z - s.region.min.z) * scale);
    g.setLineDash([]);
    label(g, `${s.id}  [${s.role.join('+')}]`, sx(s.region.min.x) + 6, sy(s.region.min.z) + 13, colour);
  }

  // approach lanes
  for (const s of map.sectors) {
    for (const id of s.approaches) {
      const lane = map.lanes.find((l) => l.id === id);
      if (!lane) continue;
      g.strokeStyle = ROLE_COLOUR.hold;
      g.fillStyle = ROLE_COLOUR.hold;
      g.lineWidth = Math.max(3, lane.width * scale * 0.18);
      g.globalAlpha = 0.55;
      arrow(g, sx(lane.start.x), sy(lane.start.z), sx(lane.end.x), sy(lane.end.z));
      g.globalAlpha = 1;
      label(g, id, sx(lane.start.x) + 8, sy(lane.start.z) - 10, ROLE_COLOUR.hold);
    }
  }

  // hold anchors, then gates
  for (const s of map.sectors) {
    const colour = ROLE_COLOUR[s.role[0]!];
    for (const id of s.holdAnchors) {
      const a = map.anchors.find((x) => x.id === id);
      const p = a && holdStandPos(a);
      if (!a || !p) continue;
      const x = sx(p.x);
      const y = sy(p.z);
      const crouch = holdStance(a) === 'crouch';
      g.lineWidth = 2.5;
      g.strokeStyle = '#0d1118';
      g.fillStyle = crouch ? '#0d1118' : colour;
      g.beginPath();
      if (a.kind === 'peek') {
        g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath();
      } else g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = colour;
      g.stroke();
      if (a.kind === 'hold') {
        const yaw = a.yaw;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - Math.sin(yaw) * 16, y - Math.cos(yaw) * 16);
        g.stroke();
      }
    }
    gate(g, sx(s.entry.x), sy(s.entry.z), '#3ddc84', 'IN');
    gate(g, sx(s.exit.x), sy(s.exit.z), '#ff5c7a', 'OUT');
  }

  // spawn and player
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(sx(map.spawn.pos.x), sy(map.spawn.pos.z), 4, 0, Math.PI * 2);
  g.stroke();
  if (opts.player) {
    const px = sx(opts.player.pos.x);
    const py = sy(opts.player.pos.z);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(px, py, 5, 0, Math.PI * 2);
    g.fill();
  }

  // title and legend
  g.fillStyle = '#e8ecf4';
  g.font = '700 20px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillText(`${map.name}: ${map.sectors.length} sector${map.sectors.length === 1 ? '' : 's'}, top-down (north up, 1 m grid)`, margin, 34);
  g.font = '500 14px system-ui, sans-serif';
  let lx = margin;
  const ly = height - 24;
  for (const role of ['take', 'hold', 'meet'] as const) {
    g.fillStyle = ROLE_COLOUR[role];
    g.fillRect(lx, ly - 12, 14, 14);
    g.fillStyle = '#e8ecf4';
    g.fillText(`${role} region`, lx + 20, ly);
    lx += 118;
  }
  g.fillStyle = '#9aa3b5';
  g.fillText('● hold anchor (hollow = crouch)   ◆ peek hold   line = facing   IN / OUT = entry / exit gate   ○ spawn', lx, ly);
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
  g.textBaseline = 'middle';
  g.font = '600 15px system-ui, sans-serif';
  g.lineWidth = 4;
  g.strokeStyle = '#0d1118';
  g.strokeText(text, x, y);
  g.fillStyle = colour;
  g.fillText(text, x, y);
}

function arrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - 16 * Math.cos(a - 0.45), y1 - 16 * Math.sin(a - 0.45));
  g.lineTo(x1 - 16 * Math.cos(a + 0.45), y1 - 16 * Math.sin(a + 0.45));
  g.closePath();
  g.fill();
}

function gate(g: CanvasRenderingContext2D, x: number, y: number, colour: string, text: string): void {
  g.fillStyle = colour;
  g.strokeStyle = '#0d1118';
  g.lineWidth = 2;
  g.beginPath();
  g.rect(x - 6, y - 6, 12, 12);
  g.fill();
  g.stroke();
  label(g, text, x + 10, y, colour);
}
