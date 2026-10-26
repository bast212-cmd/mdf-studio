// Construction du prompt envoyé au modèle d'image à partir du plan d'aménagement.
// Repère du plan : x = longueur de la pièce (cm, vers la droite), y = largeur (cm, vers le bas).
// Caméra : angle en degrés, 0 = regarde vers +x, sens horaire. Avant d'un meuble = son côté +y local.

const HFOV = 70; // champ horizontal supposé d'une photo de smartphone

const rad = (d) => (d * Math.PI) / 180;
const fmt = (n) => Math.round(Number(n) || 0);

export function relativeToCamera(item, cam) {
  const dx = item.x - cam.x;
  const dy = item.y - cam.y;
  const a = rad(cam.angle || 0);
  const forward = dx * Math.cos(a) + dy * Math.sin(a);
  const lateral = -dx * Math.sin(a) + dy * Math.cos(a);
  const dist = Math.hypot(dx, dy);
  const bearing = (Math.atan2(lateral, forward) * 180) / Math.PI; // + = à droite
  const inView = forward > 0 && Math.abs(bearing) <= HFOV / 2 + 8;
  const xPct = Math.max(0, Math.min(100, 50 + (bearing / (HFOV / 2)) * 50));

  let horiz;
  if (!inView) horiz = forward <= 0 ? 'behind the camera (not visible in the photo)' : bearing < 0 ? 'just outside the left edge of the frame' : 'just outside the right edge of the frame';
  else if (Math.abs(bearing) < 8) horiz = 'in the center of the photo';
  else if (bearing < 0) horiz = bearing < -22 ? 'on the left side of the photo' : 'slightly left of center';
  else horiz = bearing > 22 ? 'on the right side of the photo' : 'slightly right of center';

  // orientation de la face avant par rapport à la caméra
  const r = rad(item.rot || 0);
  const front = { x: -Math.sin(r), y: Math.cos(r) };
  const toCam = { x: -dx / (dist || 1), y: -dy / (dist || 1) };
  const dot = front.x * toCam.x + front.y * toCam.y;
  const cross = front.x * toCam.y - front.y * toCam.x;
  let facing;
  if (dot > 0.7) facing = 'its front faces the camera';
  else if (dot < -0.7) facing = 'its back faces the camera';
  else facing = cross > 0 ? 'seen from its side, front turned towards the left of the photo' : 'seen from its side, front turned towards the right of the photo';

  return { dist, forward, bearing, inView, xPct, horiz, facing };
}

/**
 * Meubles qui se trouvent devant `it` vu depuis l'appareil photo (plus proches et qui se chevauchent dans l'image).
 * Prend en compte les meubles présents conservés et les autres nouveaux meubles.
 */
function occluders(it, rel, cam, existing, newItems) {
  const replacedIds = new Set(newItems.filter((n) => n.replacesId).map((n) => n.replacesId));
  const halfAngle = (o, r) => (Math.atan2(Math.max(o.w || 0, o.d || 0) / 2, Math.max(r.dist, 1)) * 180) / Math.PI;
  const mine = halfAngle(it, rel);
  const others = [
    ...existing.filter((e) => !e.remove && !replacedIds.has(e.id)),
    ...newItems.filter((n) => n.id !== it.id),
  ];
  const out = [];
  for (const o of others) {
    const r = relativeToCamera(o, cam);
    if (!r.inView || r.forward <= 0) continue;
    if (r.forward >= rel.forward - 30) continue; // pas nettement plus proche de l'appareil
    if (Math.abs(r.bearing - rel.bearing) < mine + halfAngle(o, r) - 2) out.push(o.furniture?.name || o.name || 'furniture');
  }
  return out;
}

function dimsText(f) {
  const d = [];
  if (f.length) d.push(`length ${fmt(f.length)} cm`);
  if (f.width) d.push(`depth ${fmt(f.width)} cm`);
  if (f.height) d.push(`height ${fmt(f.height)} cm`);
  if (f.seatHeight) d.push(`seat height ${fmt(f.seatHeight)} cm`);
  if (f.topHeight) d.push(`tabletop height ${fmt(f.topHeight)} cm`);
  if (f.extra) d.push(f.extra);
  return d.join(', ');
}

/**
 * @param room   projet pièce (dims, plan)
 * @param items  éléments "new" du plan, enrichis {furniture, imageIdx[], textureIdx}
 * @param refIdx index (1-based) de la photo de référence dans la liste d'images
 * @param ctxIdx index des autres photos de la pièce
 */
export function buildPrompt({ room, items, refIdx, ctxIdx, extraInstructions }) {
  const cam = room.plan?.camera || { x: 0, y: 0, angle: 0 };
  const existing = (room.plan?.items || []).filter((i) => i.kind === 'existing');
  const L = [];

  L.push('You are an expert interior-design photo retoucher. Edit a real photograph of a room to show new furniture, keeping it 100% photorealistic.');
  L.push('');
  L.push(`IMAGE ${refIdx} is the BASE PHOTO of the room. The output must be this exact photo, same framing, same camera viewpoint and lens, same aspect ratio, same walls, floor, windows, lighting and shadows. Only change what is listed below.`);
  if (ctxIdx.length) L.push(`IMAGE(S) ${ctxIdx.join(', ')} are other views of the same room, for context only (materials, layout). Do not output them.`);
  L.push('');
  L.push(`ROOM: ${room.category ? room.category + ', ' : ''}${fmt(room.dims?.length)} cm long x ${fmt(room.dims?.width)} cm wide, ceiling height ${fmt(room.dims?.height)} cm. Use these dimensions to keep every object at a realistic scale.`);
  L.push('');
  L.push('CHANGES TO MAKE:');

  items.forEach((it, n) => {
    const f = it.furniture || {};
    const rel = relativeToCamera(it, cam);
    const replaced = it.replacesId ? existing.find((e) => e.id === it.replacesId) : null;
    const imgs = it.imageIdx.length ? `shown in IMAGE ${it.imageIdx.join(' and ')}` : 'described below';
    const name = f.name || it.name || 'furniture';
    const type = f.type ? ` (${f.type})` : '';

    let s = `${n + 1}. `;
    if (replaced) {
      s += `REMOVE the existing "${replaced.name}" and REPLACE it, at the same place, by the "${name}"${type} ${imgs}.`;
    } else {
      s += `ADD the "${name}"${type} ${imgs}.`;
    }
    s += ` Real dimensions: ${dimsText({ ...f, ...it.dimsOverride }) || `${fmt(it.w)} x ${fmt(it.d)} cm footprint`}.`;
    if (it.configText) s += ` ${it.configText}`;
    s += ` Position: ${rel.horiz}, about ${(rel.forward / 100).toFixed(1)} m in front of the camera`;
    if (rel.inView) s += ` (horizontal center around ${Math.round(rel.xPct)}% of the image width)`;
    s += `, ${rel.facing}. It stands on the floor.`;
    const front = occluders(it, rel, cam, existing, items);
    if (front.length) s += ` DEPTH: it stands BEHIND ${front.map((o) => `the "${o}"`).join(' and ')}, which ${front.length > 1 ? 'are' : 'is'} closer to the camera: ${front.length > 1 ? 'they stay' : 'it stays'} in front, unchanged and fully visible, and partly hide${front.length > 1 ? '' : 's'} the new furniture. Do not draw the new furniture over ${front.length > 1 ? 'them' : 'it'}.`;
    if (!rel.inView) s += ' Since it is out of frame, only show the part that would naturally be visible, if any.';

    const look = [];
    if (it.color && !it.keepOriginal) look.push(`main color ${it.colorName ? it.colorName + ' ' : ''}(${it.color})`);
    if (it.texture && !it.keepOriginal) look.push(`material/finish: ${it.textureEn || it.texture}`);
    if (it.textureIdx) look.push(`use the material/texture sample shown in IMAGE ${it.textureIdx}`);
    if (look.length) s += ` Change its upholstery/finish: ${look.join('; ')}. Keep its exact shape and design.`;
    else s += ' Keep its exact shape, color and materials as in the reference photo.';
    if (f.notes) s += ` Notes: ${f.notes}.`;
    if (it.notes) s += ` ${it.notes}.`;
    L.push(s);
  });

  const removed = existing.filter((e) => e.remove && !items.some((i) => i.replacesId === e.id));
  removed.forEach((e) => L.push(`- REMOVE the existing "${e.name}" and fill the space naturally (floor, wall).`));

  L.push('');
  L.push('RULES: reproduce the new furniture faithfully from its reference photos (shape, proportions, legs, cushions, details), at correct scale relative to the room and to the other furniture; respect depth: furniture closer to the camera stays in front and hides what is behind it; correct perspective matching the base photo; realistic contact shadows and reflections consistent with the existing light; do not add any other object, text, watermark or people; do not crop or change the camera angle.');
  if (extraInstructions) L.push(`ADDITIONAL INSTRUCTIONS FROM THE USER (French): ${extraInstructions}`);
  L.push('Return only the edited photo.');

  return L.join('\n');
}

const RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '5:4': 5 / 4, '4:5': 4 / 5, '21:9': 21 / 9 };
export function nearestRatio(w, h) {
  if (!w || !h) return undefined;
  const r = w / h;
  return Object.entries(RATIOS).sort((a, b) => Math.abs(Math.log(a[1] / r)) - Math.abs(Math.log(b[1] / r)))[0][0];
}

/**
 * Prompt du rendu rapide : photo de la pièce + zone dessinée + photo(s) du meuble + texture facultative.
 * @param q  { zone:{x,y,w,h} en fractions 0..1, action:'replace'|'add', furniture:{name,length,width,height,notes},
 *             textureNotes, extraInstructions }
 * @param idx { base, marked, furniture:number[], texture:number|null }  numéros des images (1-based)
 */
/**
 * Rendu rapide : un meuble ou un ensemble (2 à 3 meubles), placés par l'IA sans zone tracée.
 * idx = { base, items: [[n° des images du meuble 1], [meuble 2]…], texture }
 */
export function buildQuickPrompt(q, idx) {
  const items = q.items || [];
  const many = items.length > 1;
  const label = (f, i) => `${many ? `FURNITURE ${'ABC'[i]}` : 'the new furniture'}${f.name ? ` ("${f.name}"${f.type ? `, ${f.type}` : ''})` : f.type ? ` (${f.type})` : ''}`;
  const L = [];
  L.push(`You are an expert interior-design photo retoucher. Edit a real photograph of a room to show ${many ? `a set of ${items.length} new pieces of furniture` : 'a new piece of furniture'}, keeping it 100% photorealistic.`);
  L.push('');
  L.push(`IMAGE ${idx.base} is the BASE PHOTO of the room. The output must be this exact photo: same framing, same camera viewpoint and lens, same aspect ratio, same walls, floor, windows, lighting and shadows. Only change what is described below.`);
  items.forEach((f, i) => {
    const n = idx.items[i] || [];
    L.push(`IMAGE${n.length > 1 ? 'S' : ''} ${n.join(' and ')} show${n.length > 1 ? '' : 's'} ${label(f, i)} (furniture type in French).`);
  });
  if (idx.texture) L.push(`IMAGE ${idx.texture} is a material / texture sample.`);
  L.push('');
  L.push('TASK:');
  items.forEach((f, i) => {
    const who = label(f, i);
    L.push(`- Place ${who} in the room. If the room already contains a piece of the same kind (for example a sofa when it is a sofa), REMOVE that piece and PUT ${who} exactly in its place. Otherwise, place it in the most natural free spot on the floor where such furniture usually stands.`);
    const dims = [];
    if (f.length) dims.push(`length ${fmt(f.length)} cm`);
    if (f.width) dims.push(`depth ${fmt(f.width)} cm`);
    if (f.height) dims.push(`height ${fmt(f.height)} cm`);
    if (dims.length) L.push(`  Real dimensions of ${who}: ${dims.join(', ')}. Keep a realistic scale relative to the room, doors, windows and other furniture.`);
    if (f.notes) L.push(`  Notes about ${who} (French): ${f.notes}.`);
  });
  if (many) L.push('- Arrange the pieces together as a coherent, realistic set, the way a furniture showroom would (for example the coffee table in front of the sofa, the armchair angled towards them), with enough space to walk around. Show every piece of the set.');
  L.push('- Rebuild the floor and wall naturally wherever an old object is no longer covered. Keep every other object of the room in place; whatever stands closer to the camera than the new furniture stays in front of it and hides the parts behind it.');
  L.push(`- ${many ? 'Each piece stands' : 'The new furniture stands'} on the floor, oriented naturally in the room (aligned with the nearby wall or with the furniture it replaces), with a correct perspective matching the base photo.`);
  if (idx.texture) {
    L.push(`- Cover ${label(items[0], 0)} (upholstery / main surfaces) with the material shown in IMAGE ${idx.texture}: same color, pattern and finish. Keep its exact shape and design.${many ? ' The other pieces keep their own materials.' : ''}`);
  } else {
    L.push(`- Keep the exact shape, color and materials of ${many ? 'each piece' : 'the furniture'} as in ${many ? 'their' : 'its'} reference photo${many ? 's' : ''}.`);
  }
  if (q.textureNotes) L.push(`- Material / color wanted for ${label(items[0], 0)} (French): ${q.textureNotes}.`);
  L.push('');
  L.push('RULES: reproduce the new furniture faithfully from its reference photos (shape, proportions, legs, cushions, details); respect depth: whatever is closer to the camera stays in front and hides what is behind it; realistic contact shadows and reflections consistent with the existing light; ignore the background of the furniture photos; do not add any other object, text, watermark or people; do not crop or change the camera angle.');
  if (q.extraInstructions) L.push(`ADDITIONAL INSTRUCTIONS FROM THE USER (French): ${q.extraInstructions}`);
  if (q.revision) L.push(`CORRECTION REQUESTED FOR THIS NEW VERSION, apply it in priority (French): ${q.revision}`);
  L.push('Return only the edited photo.');
  return L.join('\n');
}

/** Contrôle d'un rendu rapide : IMAGE 1 = pièce d'origine, 2 = rendu, 3… = photo de chaque meuble choisi */
export function buildCheckPrompt(items, q = {}) {
  const L = [];
  L.push('You are a strict quality controller for a furniture retailer. An AI edited a real photo of a room to show furniture from the retailer\'s catalogue. Check the result before it is shown to a customer.');
  L.push('IMAGE 1 is the original room photo. IMAGE 2 is the AI-edited photo.');
  items.forEach((f, i) => {
    const dims = [f.length && `length ${fmt(f.length)} cm`, f.width && `depth ${fmt(f.width)} cm`, f.height && `height ${fmt(f.height)} cm`].filter(Boolean).join(', ');
    L.push(`IMAGE ${i + 3} is the official product photo of item ${i + 1}: "${f.name || 'furniture'}"${f.type ? ` (${f.type})` : ''}${dims ? `, ${dims}` : ''}.`);
  });
  const wanted = [q.textureNotes, q.texture?.media ? 'a material sample was provided' : ''].filter(Boolean).join('; ');
  L.push('');
  L.push('Check, for each item:');
  L.push('- present: the item is clearly visible in IMAGE 2;');
  L.push(`- faithful: it is the same model as its product photo (shape, proportions, armrests, cushions, legs, details) and the same color and material${wanted ? ` (except the requested material change: ${wanted})` : ''}. Small lighting or angle differences are fine; a different model, a missing part or an invented design is not.`);
  L.push('Also check that no other furniture was added or visibly changed in the room compared with IMAGE 1 (apart from the pieces replaced by the new items), and that the scale looks realistic.');
  L.push('Be strict but fair: answer "warning" only for problems a customer would notice.');
  L.push('');
  L.push('Return JSON only: {"verdict":"ok"|"warning","items":[{"name":"...","present":true,"faithful":true,"issue_fr":"short, neutral description of the difference in French (it may be read by a customer), empty if none"}],"other_changes_fr":"French, empty if none","summary_fr":"one short, neutral and reassuring sentence in French that may be read by a customer","correction_fr":"short instruction in French to fix the render, empty if ok"}');
  return L.join('\n');
}
