(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // js/data/db.js
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in self)) return reject(new Error("Ce navigateur ne permet pas le stockage local (IndexedDB)."));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("rooms")) db.createObjectStore("rooms", { keyPath: "id" });
        if (!db.objectStoreNames.contains("furniture")) db.createObjectStore("furniture", { keyPath: "id" });
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("Base locale bloquée : fermez les autres onglets de l'application."));
    });
    return dbPromise;
  }
  async function tx(storeNames, mode, fn) {
    const db = await openDB();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new Promise((resolve, reject) => {
      const t = db.transaction(names, mode);
      const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Transaction annulée"));
      try {
        Promise.resolve(fn(stores)).then((r) => {
          result = r;
        }, (e) => {
          try {
            t.abort();
          } catch {
          }
          reject(e);
        });
      } catch (e) {
        t.abort();
        reject(e);
      }
    });
  }
  var DB_NAME, DB_VERSION, dbPromise, wrap, idb, uid, now;
  var init_db = __esm({
    "js/data/db.js"() {
      DB_NAME = "mdf-studio";
      DB_VERSION = 1;
      dbPromise = null;
      wrap = (req) => new Promise((ok, ko) => {
        req.onsuccess = () => ok(req.result);
        req.onerror = () => ko(req.error);
      });
      idb = {
        get: (store2, key) => tx(store2, "readonly", (s) => wrap(s[store2].get(key))),
        all: (store2) => tx(store2, "readonly", (s) => wrap(s[store2].getAll())),
        keys: (store2) => tx(store2, "readonly", (s) => wrap(s[store2].getAllKeys())),
        put: (store2, value, key) => tx(store2, "readwrite", (s) => wrap(key === void 0 ? s[store2].put(value) : s[store2].put(value, key))),
        del: (store2, key) => tx(store2, "readwrite", (s) => wrap(s[store2].delete(key))),
        /** Supprime plusieurs clés en une transaction */
        delMany: (store2, keys) => tx(store2, "readwrite", (s) => Promise.all(keys.map((k) => wrap(s[store2].delete(k))))),
        /** Écrit plusieurs valeurs en une transaction */
        putMany: (store2, values) => tx(store2, "readwrite", (s) => Promise.all(values.map((v) => wrap(s[store2].put(v))))),
        wrap
      };
      uid = (p = "") => p + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
      now = () => (/* @__PURE__ */ new Date()).toISOString();
    }
  });

  // js/data/media.js
  async function putMedia(blob, id = uid("m")) {
    await idb.put("media", { id, blob, type: blob.type || "image/jpeg", size: blob.size, createdAt: now() });
    return id;
  }
  async function getMediaBlob(id) {
    if (!id) return null;
    const rec = await idb.get("media", id);
    return rec?.blob || null;
  }
  async function hasMedia(id) {
    return Boolean(id && await idb.get("media", id));
  }
  async function deleteMedia(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return;
    list.forEach((id) => {
      const u = urls.get(id);
      if (u) {
        URL.revokeObjectURL(u);
        urls.delete(id);
      }
    });
    await idb.delMany("media", list);
  }
  async function mediaURL(id) {
    if (!id) return "";
    if (urls.has(id)) return urls.get(id);
    const blob = await getMediaBlob(id);
    if (!blob) return "";
    const u = URL.createObjectURL(blob);
    urls.set(id, u);
    if (urls.size > MAX_URLS) {
      const [oldId, oldUrl] = urls.entries().next().value;
      if (!document.querySelector(`img[data-media="${CSS.escape(oldId)}"]`)) {
        URL.revokeObjectURL(oldUrl);
        urls.delete(oldId);
      }
    }
    return u;
  }
  function src(id) {
    if (!id) return "";
    const u = urls.get(id);
    return `data-media="${String(id).replace(/"/g, "")}"${u ? ` src="${u}"` : ""}`;
  }
  function hydrate(root = document) {
    const imgs = root.matches?.("img[data-media]") ? [root] : [...root.querySelectorAll?.("img[data-media]") || []];
    imgs.forEach(async (img) => {
      if (img.getAttribute("src")) return;
      const u = await mediaURL(img.dataset.media);
      if (u) img.src = u;
      else img.classList.add("img-missing");
    });
  }
  function startMediaObserver() {
    if (observing) return;
    observing = true;
    hydrate(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) hydrate(n);
    }).observe(document.body, { childList: true, subtree: true });
  }
  async function resizeImage(file, max = 1600, quality = 0.88) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
    let source = bmp;
    let tmpUrl = null;
    if (!source) {
      source = await new Promise((ok, ko) => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => ko(new Error("Image illisible (format non pris en charge ?)"));
        im.src = tmpUrl = URL.createObjectURL(file);
      });
    }
    const w0 = source.width, h0 = source.height;
    const k = Math.min(1, max / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(source, 0, 0, w, h);
    bmp?.close?.();
    if (tmpUrl) URL.revokeObjectURL(tmpUrl);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", quality));
    if (!blob) throw new Error("Impossible de convertir l'image");
    return { blob, w, h };
  }
  async function storeImages(files) {
    const list = [...files].filter((f) => f && (f.type?.startsWith("image/") || f instanceof Blob && !f.type));
    const out = [];
    for (const f of list) {
      const r = await resizeImage(f);
      out.push({ media: await putMedia(r.blob), w: r.w, h: r.h });
    }
    return out;
  }
  function blobToBase64(blob) {
    return new Promise((ok, ko) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(",")[1] || "");
      fr.onerror = () => ko(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, type = "image/png") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  function collectMediaIds(obj, acc = /* @__PURE__ */ new Set()) {
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      for (const [k, v] of Object.entries(n)) {
        if ((k === "media" || k === "textureImage") && typeof v === "string") acc.add(v);
        else if (v && typeof v === "object") walk(v);
      }
    })(obj);
    return acc;
  }
  async function collectGarbage(rooms, furniture) {
    const used = /* @__PURE__ */ new Set();
    rooms.forEach((r) => collectMediaIds(r, used));
    furniture.forEach((f) => collectMediaIds(f, used));
    const all = await idb.all("media");
    const limit = Date.now() - 36e5;
    const orphans = all.filter((m) => !used.has(m.id) && Date.parse(m.createdAt || 0) < limit).map((m) => m.id);
    await deleteMedia(orphans);
    return orphans.length;
  }
  function canShareFiles() {
    try {
      return Boolean(navigator.canShare?.({ files: [new File([""], "x.zip", { type: "application/zip" })] }));
    } catch {
      return false;
    }
  }
  function downloadBlob(blob, filename) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 6e4);
  }
  async function shareOrDownload(blob, filename, title = "", mode = "auto") {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const touch = matchMedia("(pointer: coarse)").matches;
    if (mode === "share" || mode === "auto" && touch) {
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: title || filename });
          return "shared";
        } catch (e) {
          if (e.name === "AbortError") return "cancelled";
        }
      }
    }
    downloadBlob(blob, filename);
    return "downloaded";
  }
  var urls, MAX_URLS, observing;
  var init_media = __esm({
    "js/data/media.js"() {
      init_db();
      urls = /* @__PURE__ */ new Map();
      MAX_URLS = 400;
      observing = false;
    }
  });

  // js/ai/prompt.js
  function relativeToCamera(item, cam) {
    const dx = item.x - cam.x;
    const dy = item.y - cam.y;
    const a = rad(cam.angle || 0);
    const forward = dx * Math.cos(a) + dy * Math.sin(a);
    const lateral = -dx * Math.sin(a) + dy * Math.cos(a);
    const dist = Math.hypot(dx, dy);
    const bearing = Math.atan2(lateral, forward) * 180 / Math.PI;
    const inView = forward > 0 && Math.abs(bearing) <= HFOV / 2 + 8;
    const xPct = Math.max(0, Math.min(100, 50 + bearing / (HFOV / 2) * 50));
    let horiz;
    if (!inView) horiz = forward <= 0 ? "behind the camera (not visible in the photo)" : bearing < 0 ? "just outside the left edge of the frame" : "just outside the right edge of the frame";
    else if (Math.abs(bearing) < 8) horiz = "in the center of the photo";
    else if (bearing < 0) horiz = bearing < -22 ? "on the left side of the photo" : "slightly left of center";
    else horiz = bearing > 22 ? "on the right side of the photo" : "slightly right of center";
    const r = rad(item.rot || 0);
    const front = { x: -Math.sin(r), y: Math.cos(r) };
    const toCam = { x: -dx / (dist || 1), y: -dy / (dist || 1) };
    const dot = front.x * toCam.x + front.y * toCam.y;
    const cross = front.x * toCam.y - front.y * toCam.x;
    let facing;
    if (dot > 0.7) facing = "its front faces the camera";
    else if (dot < -0.7) facing = "its back faces the camera";
    else facing = cross > 0 ? "seen from its side, front turned towards the left of the photo" : "seen from its side, front turned towards the right of the photo";
    return { dist, forward, bearing, inView, xPct, horiz, facing };
  }
  function occluders(it, rel, cam, existing, newItems) {
    const replacedIds = new Set(newItems.filter((n) => n.replacesId).map((n) => n.replacesId));
    const halfAngle = (o, r) => Math.atan2(Math.max(o.w || 0, o.d || 0) / 2, Math.max(r.dist, 1)) * 180 / Math.PI;
    const mine = halfAngle(it, rel);
    const others = [
      ...existing.filter((e) => !e.remove && !replacedIds.has(e.id)),
      ...newItems.filter((n) => n.id !== it.id)
    ];
    const out = [];
    for (const o of others) {
      const r = relativeToCamera(o, cam);
      if (!r.inView || r.forward <= 0) continue;
      if (r.forward >= rel.forward - 30) continue;
      if (Math.abs(r.bearing - rel.bearing) < mine + halfAngle(o, r) - 2) out.push(o.furniture?.name || o.name || "furniture");
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
    return d.join(", ");
  }
  function buildPrompt({ room, items, refIdx, ctxIdx, extraInstructions }) {
    const cam = room.plan?.camera || { x: 0, y: 0, angle: 0 };
    const existing = (room.plan?.items || []).filter((i) => i.kind === "existing");
    const L = [];
    L.push("You are an expert interior-design photo retoucher. Edit a real photograph of a room to show new furniture, keeping it 100% photorealistic.");
    L.push("");
    L.push(`IMAGE ${refIdx} is the BASE PHOTO of the room. The output must be this exact photo, same framing, same camera viewpoint and lens, same aspect ratio, same walls, floor, windows, lighting and shadows. Only change what is listed below.`);
    if (ctxIdx.length) L.push(`IMAGE(S) ${ctxIdx.join(", ")} are other views of the same room, for context only (materials, layout). Do not output them.`);
    L.push("");
    L.push(`ROOM: ${room.category ? room.category + ", " : ""}${fmt(room.dims?.length)} cm long x ${fmt(room.dims?.width)} cm wide, ceiling height ${fmt(room.dims?.height)} cm. Use these dimensions to keep every object at a realistic scale.`);
    L.push("");
    L.push("CHANGES TO MAKE:");
    items.forEach((it, n) => {
      const f = it.furniture || {};
      const rel = relativeToCamera(it, cam);
      const replaced = it.replacesId ? existing.find((e) => e.id === it.replacesId) : null;
      const imgs = it.imageIdx.length ? `shown in IMAGE ${it.imageIdx.join(" and ")}` : "described below";
      const name = f.name || it.name || "furniture";
      const type = f.type ? ` (${f.type})` : "";
      let s = `${n + 1}. `;
      if (replaced) {
        s += `REMOVE the existing "${replaced.name}" and REPLACE it, at the same place, by the "${name}"${type} ${imgs}.`;
      } else {
        s += `ADD the "${name}"${type} ${imgs}.`;
      }
      s += ` Real dimensions: ${dimsText({ ...f, ...it.dimsOverride }) || `${fmt(it.w)} x ${fmt(it.d)} cm footprint`}.`;
      s += ` Position: ${rel.horiz}, about ${(rel.forward / 100).toFixed(1)} m in front of the camera`;
      if (rel.inView) s += ` (horizontal center around ${Math.round(rel.xPct)}% of the image width)`;
      s += `, ${rel.facing}. It stands on the floor.`;
      const front = occluders(it, rel, cam, existing, items);
      if (front.length) s += ` DEPTH: it stands BEHIND ${front.map((o) => `the "${o}"`).join(" and ")}, which ${front.length > 1 ? "are" : "is"} closer to the camera: ${front.length > 1 ? "they stay" : "it stays"} in front, unchanged and fully visible, and partly hide${front.length > 1 ? "" : "s"} the new furniture. Do not draw the new furniture over ${front.length > 1 ? "them" : "it"}.`;
      if (!rel.inView) s += " Since it is out of frame, only show the part that would naturally be visible, if any.";
      const look = [];
      if (it.color && !it.keepOriginal) look.push(`main color ${it.colorName ? it.colorName + " " : ""}(${it.color})`);
      if (it.texture && !it.keepOriginal) look.push(`material/finish: ${it.textureEn || it.texture}`);
      if (it.textureIdx) look.push(`use the material/texture sample shown in IMAGE ${it.textureIdx}`);
      if (look.length) s += ` Change its upholstery/finish: ${look.join("; ")}. Keep its exact shape and design.`;
      else s += " Keep its exact shape, color and materials as in the reference photo.";
      if (f.notes) s += ` Notes: ${f.notes}.`;
      if (it.notes) s += ` ${it.notes}.`;
      L.push(s);
    });
    const removed = existing.filter((e) => e.remove && !items.some((i) => i.replacesId === e.id));
    removed.forEach((e) => L.push(`- REMOVE the existing "${e.name}" and fill the space naturally (floor, wall).`));
    L.push("");
    L.push("RULES: reproduce the new furniture faithfully from its reference photos (shape, proportions, legs, cushions, details), at correct scale relative to the room and to the other furniture; respect depth: furniture closer to the camera stays in front and hides what is behind it; correct perspective matching the base photo; realistic contact shadows and reflections consistent with the existing light; do not add any other object, text, watermark or people; do not crop or change the camera angle.");
    if (extraInstructions) L.push(`ADDITIONAL INSTRUCTIONS FROM THE USER (French): ${extraInstructions}`);
    L.push("Return only the edited photo.");
    return L.join("\n");
  }
  function nearestRatio(w, h) {
    if (!w || !h) return void 0;
    const r = w / h;
    return Object.entries(RATIOS).sort((a, b) => Math.abs(Math.log(a[1] / r)) - Math.abs(Math.log(b[1] / r)))[0][0];
  }
  function buildQuickPrompt(q, idx) {
    const z = q.zone;
    const pct = (v) => Math.round(v * 100);
    const f = q.furniture || {};
    const name = f.name ? `the "${f.name}"` : "the piece of furniture";
    const L = [];
    L.push("You are an expert interior-design photo retoucher. Edit a real photograph of a room to show a new piece of furniture, keeping it 100% photorealistic.");
    L.push("");
    L.push(`IMAGE ${idx.base} is the BASE PHOTO of the room. The output must be this exact photo: same framing, same camera viewpoint and lens, same aspect ratio, same walls, floor, windows, lighting and shadows. Only change what is described below.`);
    L.push(`IMAGE ${idx.marked} is the same photo with a RED RECTANGLE marking the target area: horizontally from ${pct(z.x)}% to ${pct(z.x + z.w)}% of the image width, vertically from ${pct(z.y)}% to ${pct(z.y + z.h)}% of the image height. The red rectangle is only a guide: it must NOT appear in the output.`);
    const keep = q.keep || [];
    if (keep.length) {
      L.push(`IMAGE ${idx.marked} also shows ${keep.length > 1 ? `${keep.length} BLUE RECTANGLES` : "a BLUE RECTANGLE"} around object${keep.length > 1 ? "s" : ""} that stand${keep.length > 1 ? "" : "s"} IN FRONT of the new furniture (closer to the camera): ${keep.map((k) => `from ${pct(k.x)}% to ${pct(k.x + k.w)}% of the width and ${pct(k.y)}% to ${pct(k.y + k.h)}% of the height`).join("; ")}. Blue rectangles are guides too and must NOT appear in the output.`);
    }
    L.push(`IMAGE${idx.furniture.length > 1 ? "S" : ""} ${idx.furniture.join(" and ")} show${idx.furniture.length > 1 ? "" : "s"} ${name} to place in the room.`);
    if (idx.texture) L.push(`IMAGE ${idx.texture} is a material / texture sample.`);
    L.push("");
    L.push("TASK:");
    if (q.action === "add") {
      L.push(`- ADD ${name} inside the marked area. Keep every existing object of the room in place; only cover what the new furniture naturally hides.`);
    } else {
      L.push(`- REMOVE the furniture or objects currently standing in the red area${keep.length ? " (EXCEPT the objects marked in blue, which stay)" : ""}, and PUT ${name} in their place. Rebuild the floor and wall naturally wherever the old object is no longer covered.`);
    }
    if (keep.length) {
      L.push(`- DEPTH / OCCLUSION, very important: the new furniture is placed BEHIND the object${keep.length > 1 ? "s" : ""} marked in blue. ${keep.length > 1 ? "These objects" : "This object"} must stay exactly where ${keep.length > 1 ? "they are" : "it is"}, unchanged and fully visible, and must HIDE the parts of the new furniture located behind ${keep.length > 1 ? "them" : "it"}. Do not move, shrink, remove or redraw ${keep.length > 1 ? "them" : "it"}, and do not draw the new furniture over ${keep.length > 1 ? "them" : "it"}. Layer order from back to front: wall, new furniture, blue-marked object${keep.length > 1 ? "s" : ""}. The new furniture's base is farther from the camera, so it is drawn smaller and higher in the image than the object${keep.length > 1 ? "s" : ""} in front.`);
    }
    L.push("- The marked rectangle shows approximately the space the new furniture should occupy in the photo. It stands on the floor, oriented naturally in the room (aligned with the nearby wall or with the furniture it replaces), with a correct perspective matching the base photo.");
    const dims = [];
    if (f.length) dims.push(`length ${fmt(f.length)} cm`);
    if (f.width) dims.push(`depth ${fmt(f.width)} cm`);
    if (f.height) dims.push(`height ${fmt(f.height)} cm`);
    if (dims.length) L.push(`- Real dimensions of the new furniture: ${dims.join(", ")}. Keep a realistic scale relative to the room, doors, windows and other furniture.`);
    if (idx.texture) {
      L.push(`- Cover the new furniture (upholstery / main surfaces) with the material shown in IMAGE ${idx.texture}: same color, pattern and finish. Keep the exact shape and design of the furniture.`);
    } else {
      L.push("- Keep the exact shape, color and materials of the furniture as in its reference photo.");
    }
    if (q.textureNotes) L.push(`- Material / color wanted (French): ${q.textureNotes}.`);
    if (f.notes) L.push(`- Notes about the furniture (French): ${f.notes}.`);
    L.push("");
    L.push("RULES: reproduce the new furniture faithfully from its reference photo (shape, proportions, legs, cushions, details); respect depth: whatever is closer to the camera stays in front and hides what is behind it; realistic contact shadows and reflections consistent with the existing light; ignore the background of the furniture photo; do not add any other object, text, watermark or people; do not crop or change the camera angle.");
    if (q.extraInstructions) L.push(`ADDITIONAL INSTRUCTIONS FROM THE USER (French): ${q.extraInstructions}`);
    L.push("Return only the edited photo.");
    return L.join("\n");
  }
  var HFOV, rad, fmt, RATIOS;
  var init_prompt = __esm({
    "js/ai/prompt.js"() {
      HFOV = 70;
      rad = (d) => d * Math.PI / 180;
      fmt = (n) => Math.round(Number(n) || 0);
      RATIOS = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "3:2": 3 / 2, "2:3": 2 / 3, "16:9": 16 / 9, "9:16": 9 / 16, "5:4": 5 / 4, "4:5": 4 / 5, "21:9": 21 / 9 };
    }
  });

  // js/ai/providers/gemini.js
  async function call(method, url, body, cfg) {
    if (!navigator.onLine) throw Object.assign(new Error("Pas de connexion internet : la génération d'images nécessite internet."), { fatal: true });
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...body ? { "Content-Type": "application/json" } : {}, "x-goog-api-key": cfg.apiKey.trim() },
        body: body ? JSON.stringify(body) : void 0
      });
    } catch {
      throw Object.assign(new Error("Impossible de joindre Google (connexion internet coupée ou bloquée)."), { fatal: true });
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = json?.error?.message || text.slice(0, 400);
      const status = json?.error?.status || "";
      let nice = `Gemini ${res.status} : ${msg}`;
      let fatal = false;
      if (/API key not valid|API_KEY_INVALID/i.test(msg)) {
        nice = "Clé API invalide. Vérifiez-la dans les Réglages.";
        fatal = true;
      } else if (res.status === 429 || status === "RESOURCE_EXHAUSTED") {
        nice = `Quota ou plafond de dépense atteint (${msg})`;
        fatal = true;
      } else if (res.status === 403) nice = `Accès refusé par Google : ${msg} (API « Generative Language » activée ? Facturation active ? Restrictions de la clé ?)`;
      else if (/billing/i.test(msg)) nice = `Facturation requise : ${msg}`;
      throw Object.assign(new Error(nice), { status: res.status, fatal });
    }
    return json;
  }
  function extract(resp) {
    const images = [];
    const texts = [];
    const seen = /* @__PURE__ */ new Set();
    (function walk(n) {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) return n.forEach(walk);
      const inline = n.inlineData || n.inline_data;
      if (inline?.data) images.push({ mimeType: inline.mimeType || inline.mime_type || "image/png", data: inline.data });
      else if (n.type === "image" && typeof n.data === "string") images.push({ mimeType: n.mime_type || n.mimeType || "image/png", data: n.data });
      if (typeof n.text === "string" && !n.thought) texts.push(n.text);
      for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
    })(resp);
    return { images, text: texts.join("\n").trim() };
  }
  var BASE, gemini;
  var init_gemini = __esm({
    "js/ai/providers/gemini.js"() {
      BASE = "https://generativelanguage.googleapis.com/v1beta";
      gemini = {
        id: "gemini",
        label: "Google Gemini",
        help: `Clé à créer sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
    La facturation doit être activée sur le projet Google Cloud de la clé (paiement à l'usage, environ 0,02 à 0,04 $ par image 1K).
    Pensez à fixer un plafond de dépense dans Google Cloud.`,
        /** Champs affichés dans l'écran Réglages */
        fields: [
          { key: "apiKey", label: "Clé API Google AI Studio", type: "secret", placeholder: "AIza…" },
          {
            key: "imageModel",
            label: "Modèle d'image",
            type: "text",
            default: "gemini-3.1-flash-image",
            suggestions: ["gemini-3.1-flash-image", "gemini-3-pro-image", "gemini-2.5-flash-image"],
            hint: "gemini-3.1-flash-image : rapide, bon rapport qualité/prix. gemini-3-pro-image : qualité maximale, plus cher."
          },
          {
            key: "imageSize",
            label: "Taille de l'image",
            type: "select",
            default: "",
            options: [["", "Par défaut du modèle (1K)"], ["1K", "1K"], ["2K", "2K (plus cher)"], ["4K", "4K (beaucoup plus cher)"]],
            hint: "Les modèles 2.5 n'acceptent pas ce réglage : laissez « Par défaut »."
          },
          {
            key: "textModel",
            label: "Modèle de création du plan (détection des meubles)",
            type: "text",
            default: "gemini-3.8-flash",
            // anciennes valeurs par défaut remplacées automatiquement par la nouvelle
            replaces: ["gemini-2.5-flash", "gemini-3-flash", "gemini-3.7-flash"],
            suggestions: ["gemini-3.8-flash", "gemini-3.6-flash"],
            hint: "gemini-3.8-flash : le plus précis pour situer les meubles et le point de vue."
          },
          {
            key: "apiMode",
            label: "Format d'appel",
            type: "select",
            default: "auto",
            options: [["auto", "Automatique (recommandé)"], ["interactions", "interactions uniquement"], ["generateContent", "generateContent uniquement"]]
          }
        ],
        isConfigured: (cfg) => Boolean(cfg?.apiKey?.trim()),
        modelLabel: (cfg) => cfg?.imageModel || "gemini-3.1-flash-image",
        /** Vérifie la clé ; renvoie la liste des modèles d'image disponibles */
        async test(cfg) {
          const res = await call("GET", `${BASE}/models?pageSize=1000`, null, cfg);
          const models = (res.models || []).map((m) => String(m.name || "").replace(/^models\//, ""));
          return { ok: true, imageModels: models.filter((m) => /image/i.test(m)), textModels: models.filter((m) => /^gemini/.test(m) && !/image|tts|embedding|audio|live/i.test(m)) };
        },
        /**
         * @param {{prompt:string, images:{mimeType:string,data:string}[], aspectRatio?:string}} req
         * @returns {Promise<{images:{mimeType:string,data:string}[], text:string}>}
         */
        async generateImage({ prompt, images, aspectRatio }, cfg) {
          const model = cfg.imageModel || "gemini-3.1-flash-image";
          const mode = String(cfg.apiMode || "auto").toLowerCase();
          const errors = [];
          if (mode === "auto" || mode === "interactions") {
            try {
              const body = {
                model,
                input: [
                  { type: "text", text: prompt },
                  ...images.map((im) => ({ type: "image", mime_type: im.mimeType, data: im.data }))
                ]
              };
              const out = extract(await call("POST", `${BASE}/interactions`, body, cfg));
              if (out.images.length) return out;
              errors.push("interactions : aucune image renvoyée" + (out.text ? ` (« ${out.text.slice(0, 200)} »)` : ""));
            } catch (e) {
              if (e.fatal) throw e;
              errors.push(e.message);
            }
          }
          if (mode === "auto" || mode === "generatecontent") {
            try {
              const imageConfig = {};
              if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
              if (cfg.imageSize) imageConfig.imageSize = cfg.imageSize;
              const body = {
                contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] }],
                generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...Object.keys(imageConfig).length ? { imageConfig } : {} }
              };
              const out = extract(await call("POST", `${BASE}/models/${encodeURIComponent(model)}:generateContent`, body, cfg));
              if (out.images.length) return out;
              errors.push("generateContent : aucune image renvoyée" + (out.text ? ` (« ${out.text.slice(0, 200)} »)` : ""));
            } catch (e) {
              if (e.fatal) throw e;
              errors.push(e.message);
            }
          }
          throw new Error(errors.join(" | ") || "Échec de la génération");
        },
        /** Demande au modèle texte une réponse JSON (analyse des photos de la pièce) */
        async analyzeJSON(prompt, images, cfg) {
          const model = cfg.textModel || "gemini-3.8-flash";
          const generationConfig = { responseMimeType: "application/json" };
          if (/^gemini-2\./.test(model)) generationConfig.temperature = 0.2;
          const body = {
            contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] }],
            generationConfig
          };
          const out = extract(await call("POST", `${BASE}/models/${encodeURIComponent(model)}:generateContent`, body, cfg));
          const m = out.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (!m) throw new Error("Réponse non exploitable du modèle");
          return JSON.parse(m[0]);
        }
      };
    }
  });

  // js/ai/providers/index.js
  function providerConfig(settings, id) {
    const p = getProvider(id);
    const saved = settings?.providers?.[p.id] || {};
    const cfg = {};
    for (const f of p.fields) {
      let v = saved[f.key];
      if (v && f.replaces?.includes(v)) v = f.default;
      cfg[f.key] = v ?? f.default ?? "";
    }
    return { ...saved, ...cfg };
  }
  var PROVIDERS, getProvider;
  var init_providers = __esm({
    "js/ai/providers/index.js"() {
      init_gemini();
      PROVIDERS = [gemini];
      getProvider = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
    }
  });

  // js/ai/ai.js
  var ai_exports = {};
  __export(ai_exports, {
    aiStatus: () => aiStatus,
    analyzeRoom: () => analyzeRoom,
    generateQuickRender: () => generateQuickRender,
    generateRender: () => generateRender
  });
  async function active() {
    const settings = await api.settings();
    const provider = getProvider(settings.provider);
    return { settings, provider, cfg: providerConfig(settings, provider.id) };
  }
  async function aiStatus() {
    const { provider, cfg } = await active();
    return { configured: provider.isConfigured(cfg), provider: provider.label, imageModel: provider.modelLabel(cfg) };
  }
  async function readImage(mediaId) {
    const blob = await getMediaBlob(mediaId);
    if (!blob) return null;
    return { mimeType: blob.type || "image/jpeg", data: await blobToBase64(blob) };
  }
  async function analyzeRoom(room) {
    const { settings, provider, cfg } = await active();
    let p = provider, c = cfg;
    if (!p.analyzeJSON || !p.isConfigured(c)) {
      p = PROVIDERS.find((x) => x.analyzeJSON && x.isConfigured(providerConfig(settings, x.id)));
      c = p && providerConfig(settings, p.id);
    }
    if (!p) throw notConfigured();
    const photos = (await Promise.all((room.photos || []).slice(0, 4).map((ph) => readImage(ph.media)))).filter(Boolean);
    if (!photos.length) throw new Error("Ajoutez au moins une photo de la pièce");
    const { length, width, height } = room.dims;
    const prompt = `These photos show the same room. The room is ${length} cm long (x axis, left to right on a top-down plan) and ${width} cm wide (y axis, top to bottom), ceiling ${height} cm.
Photo 1 is the main view. Estimate a top-down floor plan.
Return JSON only: {"camera":{"x":cm,"y":cm,"angle":degrees},"items":[{"name":"French name e.g. Canapé 3 places","length":cm,"width":cm,"height":cm,"x":cm,"y":cm,"rot":degrees}]}
Rules: x,y are the CENTER of each item, within 0..${length} and 0..${width}. "angle" for the camera: 0 = looking towards +x, 90 = towards +y (clockwise). "rot" for items: 0 = front of the item faces +y, 90 = faces -x, 180 = faces -y, 270 = faces +x. Include only movable furniture (sofas, tables, chairs, beds, cabinets, rugs), max 12 items. The camera of photo 1 is usually near a wall.`;
    const ref = room.refPhoto || 0;
    if (ref > 0 && ref < photos.length) photos.unshift(photos.splice(ref, 1)[0]);
    const out = await p.analyzeJSON(prompt, photos, c);
    const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
    const items = (out.items || []).slice(0, 12).map((i) => ({
      id: uid("e"),
      kind: "existing",
      name: String(i.name || "Meuble"),
      w: Math.max(20, Number(i.length) || 80),
      d: Math.max(20, Number(i.width) || 60),
      h: Number(i.height) || 80,
      x: clamp(i.x, length),
      y: clamp(i.y, width),
      rot: Number(i.rot) || 0
    }));
    const camera = out.camera ? { x: clamp(out.camera.x, length), y: clamp(out.camera.y, width), angle: Number(out.camera.angle) || 0 } : null;
    return { items, camera };
  }
  async function generateRender(room) {
    const { provider, cfg } = await active();
    if (!provider.isConfigured(cfg)) throw notConfigured();
    const ref = room.photos[room.refPhoto || 0] || room.photos[0];
    const refImg = await readImage(ref?.media);
    if (!refImg) throw new Error("Photo de référence de la pièce introuvable");
    const images = [refImg];
    const refIdx = 1;
    const ctxIdx = [];
    for (const p of room.photos.filter((x) => x !== ref).slice(0, 2)) {
      const im = await readImage(p.media);
      if (im) {
        images.push(im);
        ctxIdx.push(images.length);
      }
    }
    const newItems = (room.plan?.items || []).filter((i) => i.kind === "new");
    const hasRemoval = (room.plan?.items || []).some((i) => i.kind === "existing" && i.remove);
    if (!newItems.length && !hasRemoval && !room.extraInstructions?.trim()) throw new Error("Ajoutez au moins un meuble sur le plan");
    const enriched = [];
    for (const it of newItems) {
      const furniture = it.furnitureId ? await api.getFurniture(it.furnitureId).catch(() => null) : null;
      const f = furniture || { name: it.name, length: it.w, width: it.d, height: it.h };
      const imageIdx = [];
      const photos = f.photos || [];
      const ordered = [photos[f.cover || 0], ...photos.filter((_, i) => i !== (f.cover || 0))].filter(Boolean);
      for (const p of ordered.slice(0, 2)) {
        const im = await readImage(p.media);
        if (im && images.length < 12) {
          images.push(im);
          imageIdx.push(images.length);
        }
      }
      let textureIdx = null;
      if (it.textureImage && !it.keepOriginal) {
        const im = await readImage(it.textureImage);
        if (im && images.length < 14) {
          images.push(im);
          textureIdx = images.length;
        }
      }
      enriched.push({ ...it, furniture: f, imageIdx, textureIdx });
    }
    const prompt = buildPrompt({ room, items: enriched, refIdx, ctxIdx, extraInstructions: room.extraInstructions });
    const result = await provider.generateImage({ prompt, images, aspectRatio: nearestRatio(ref.w, ref.h) }, cfg);
    const img = result.images[0];
    const media = await putMedia(base64ToBlob(img.data, img.mimeType || "image/png"));
    const render = {
      id: uid("g"),
      media,
      createdAt: now(),
      saved: false,
      prompt,
      modelText: result.text || "",
      provider: provider.id,
      model: provider.modelLabel(cfg),
      planSnapshot: structuredClone(room.plan)
    };
    await api.addRender(room.id, render);
    return render;
  }
  async function markedImage(mediaId, zone, keep = []) {
    const blob = await getMediaBlob(mediaId);
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    bmp.close?.();
    const lw = Math.max(4, Math.round(Math.max(c.width, c.height) / 220));
    g.strokeStyle = "#ff0000";
    g.lineWidth = lw;
    g.strokeRect(zone.x * c.width, zone.y * c.height, zone.w * c.width, zone.h * c.height);
    g.strokeStyle = "#0050ff";
    for (const k of keep) g.strokeRect(k.x * c.width, k.y * c.height, k.w * c.width, k.h * c.height);
    const out = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.9));
    return { mimeType: "image/jpeg", data: await blobToBase64(out) };
  }
  async function generateQuickRender(room) {
    const { provider, cfg } = await active();
    if (!provider.isConfigured(cfg)) throw notConfigured();
    const q = room.quick || {};
    const ref = room.photos?.[0];
    if (!ref) throw new Error("Ajoutez la photo de la pièce");
    if (!q.zone || q.zone.w < 0.01 || q.zone.h < 0.01) throw new Error("Tracez la zone où placer le meuble");
    const fPhotos = q.furniture?.photos || [];
    if (!fPhotos.length) throw new Error("Ajoutez la photo du meuble");
    const images = [await readImage(ref.media), await markedImage(ref.media, q.zone, q.keep || [])];
    if (!images[0]) throw new Error("Photo de la pièce introuvable");
    const idx = { base: 1, marked: 2, furniture: [], texture: null };
    for (const p of fPhotos.slice(0, 3)) {
      const im = await readImage(p.media);
      if (im) {
        images.push(im);
        idx.furniture.push(images.length);
      }
    }
    if (!idx.furniture.length) throw new Error("Photo du meuble introuvable");
    if (q.texture?.media) {
      const im = await readImage(q.texture.media);
      if (im) {
        images.push(im);
        idx.texture = images.length;
      }
    }
    const prompt = buildQuickPrompt(q, idx);
    const result = await provider.generateImage({ prompt, images, aspectRatio: nearestRatio(ref.w, ref.h) }, cfg);
    const img = result.images[0];
    const media = await putMedia(base64ToBlob(img.data, img.mimeType || "image/png"));
    const render = {
      id: uid("g"),
      media,
      createdAt: now(),
      saved: false,
      prompt,
      modelText: result.text || "",
      provider: provider.id,
      model: provider.modelLabel(cfg),
      quickSnapshot: structuredClone(q)
    };
    await api.addRender(room.id, render);
    return render;
  }
  var notConfigured;
  var init_ai = __esm({
    "js/ai/ai.js"() {
      init_api();
      init_media();
      init_prompt();
      init_providers();
      notConfigured = () => Object.assign(new Error("Clé API non renseignée : ouvrez les Réglages pour l'ajouter."), { code: "NO_KEY" });
    }
  });

  // js/api.js
  function emit(store2, id, op) {
    listeners.forEach((fn) => {
      try {
        fn({ store: store2, id, op });
      } catch (e) {
        console.error(e);
      }
    });
  }
  async function tombstone(store2, id) {
    const t = await meta.get("tombstones") || {};
    (t[store2] ??= {})[id] = now();
    await meta.set("tombstones", t);
  }
  async function releaseMedia(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return;
    const used = /* @__PURE__ */ new Set();
    (await idb.all("rooms")).forEach((r) => collectMediaIds(r, used));
    (await idb.all("furniture")).forEach((f) => collectMediaIds(f, used));
    await deleteMedia(list.filter((m) => !used.has(m)));
  }
  var DEFAULT_CATEGORIES, slug, listeners, meta, pick, notFound, FURN_FIELDS, ROOM_FIELDS, byDateDesc, api, uploadImages;
  var init_api = __esm({
    "js/api.js"() {
      init_db();
      init_media();
      DEFAULT_CATEGORIES = [
        { id: "salon", name: "Salon", types: ["Canapé", "Fauteuil", "Table basse", "Meuble TV", "Bibliothèque", "Buffet", "Pouf"] },
        { id: "salle-a-manger", name: "Salle à manger", types: ["Table", "Chaise", "Buffet", "Vaisselier", "Banc"] },
        { id: "cuisine", name: "Cuisine", types: ["Table", "Chaise", "Tabouret", "Îlot", "Desserte"] },
        { id: "chambre", name: "Chambre", types: ["Lit", "Table de chevet", "Commode", "Armoire", "Dressing", "Coiffeuse"] },
        { id: "bureau", name: "Bureau", types: ["Bureau", "Chaise de bureau", "Rangement", "Étagère"] },
        { id: "entree", name: "Entrée", types: ["Console", "Meuble à chaussures", "Banc", "Miroir"] }
      ];
      slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uid("c");
      listeners = /* @__PURE__ */ new Set();
      meta = {
        get: (k) => idb.get("meta", k),
        set: (k, v) => idb.put("meta", v, k)
      };
      pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== void 0).map((k) => [k, o[k]]));
      notFound = (what) => Object.assign(new Error(`${what} introuvable`), { status: 404 });
      FURN_FIELDS = ["name", "reference", "category", "type", "length", "width", "height", "seatHeight", "topHeight", "extra", "notes", "photos", "cover"];
      ROOM_FIELDS = ["name", "category", "dims", "photos", "refPhoto", "plan", "extraInstructions", "mode", "quick"];
      byDateDesc = (k) => (a, b) => String(b[k] || "").localeCompare(String(a[k] || ""));
      api = {
        meta,
        releaseMedia,
        /** Signale un import groupé (pour un futur module de synchronisation) */
        notifyImport() {
          emit("*", null, "import");
        },
        // ----- Réglages -----
        async settings() {
          return await meta.get("settings") || {};
        },
        async saveSettings(s) {
          await meta.set("settings", s);
          emit("meta", "settings", "put");
          return s;
        },
        // ----- Catégories (niveau 1 = pièce, niveau 2 = type) -----
        async categories() {
          let c = await meta.get("categories");
          if (!c) {
            c = structuredClone(DEFAULT_CATEGORIES);
            await meta.set("categories", c);
          }
          return c;
        },
        async saveCategories(cats) {
          if (!Array.isArray(cats)) throw new Error("Liste attendue");
          const clean = cats.map((c) => ({
            id: c.id || slug(c.name),
            name: String(c.name || "").trim(),
            types: [...new Set((c.types || []).map((t) => String(t).trim()).filter(Boolean))]
          })).filter((c) => c.name);
          await meta.set("categories", clean);
          await meta.set("categoriesUpdatedAt", now());
          emit("meta", "categories", "put");
          return clean;
        },
        async resetCategories() {
          return this.saveCategories(structuredClone(DEFAULT_CATEGORIES));
        },
        // ----- Meubles -----
        async furniture(q = {}) {
          let list = (await idb.all("furniture")).sort(byDateDesc("createdAt"));
          if (q.category) list = list.filter((f) => f.category === q.category);
          if (q.type) list = list.filter((f) => f.type === q.type);
          if (q.q) {
            const s = String(q.q).toLowerCase();
            list = list.filter((f) => [f.name, f.reference, f.type].join(" ").toLowerCase().includes(s));
          }
          return list;
        },
        async getFurniture(id) {
          const f = await idb.get("furniture", id);
          if (!f) throw notFound("Meuble");
          return f;
        },
        async createFurniture(data) {
          const body = pick(data, FURN_FIELDS);
          if (!body.name) throw new Error("Le nom est obligatoire");
          const item = { id: uid("f"), createdAt: now(), updatedAt: now(), photos: [], ...body };
          await idb.put("furniture", item);
          emit("furniture", item.id, "put");
          return item;
        },
        async updateFurniture(id, data) {
          const old = await idb.get("furniture", id);
          if (!old) throw notFound("Meuble");
          const item = { ...old, ...pick(data, FURN_FIELDS), id, updatedAt: now() };
          await idb.put("furniture", item);
          const keep = collectMediaIds(item);
          await releaseMedia([...collectMediaIds(old)].filter((m) => !keep.has(m)));
          emit("furniture", id, "put");
          return item;
        },
        async deleteFurniture(id) {
          const old = await idb.get("furniture", id);
          if (!old) return { ok: false };
          await idb.del("furniture", id);
          await releaseMedia([...collectMediaIds(old)]);
          await tombstone("furniture", id);
          emit("furniture", id, "delete");
          return { ok: true };
        },
        // ----- Pièces (projets) -----
        async rooms() {
          return (await idb.all("rooms")).sort(byDateDesc("updatedAt"));
        },
        async room(id) {
          const r = await idb.get("rooms", id);
          if (!r) throw notFound("Pièce");
          return r;
        },
        async createRoom(data = {}) {
          const room = {
            id: uid("r"),
            createdAt: now(),
            updatedAt: now(),
            name: "Ma pièce",
            dims: { length: 500, width: 400, height: 250 },
            photos: [],
            refPhoto: 0,
            plan: null,
            renders: [],
            ...pick(data, ROOM_FIELDS)
          };
          await idb.put("rooms", room);
          emit("rooms", room.id, "put");
          return room;
        },
        async updateRoom(id, data) {
          return this._patchRoom(id, (r) => Object.assign(r, pick(data, ROOM_FIELDS)));
        },
        /** Modifie une pièce dans une seule transaction (évite d'écraser un rendu ajouté entre-temps) */
        async _patchRoom(id, fn) {
          let out;
          await tx("rooms", "readwrite", async (s) => {
            const r = await idb.wrap(s.rooms.get(id));
            if (!r) throw notFound("Pièce");
            fn(r);
            r.id = id;
            r.updatedAt = now();
            await idb.wrap(s.rooms.put(r));
            out = r;
          });
          emit("rooms", id, "put");
          return out;
        },
        async deleteRoom(id) {
          const old = await idb.get("rooms", id);
          if (!old) return { ok: false };
          await idb.del("rooms", id);
          await releaseMedia([...collectMediaIds(old)]);
          await tombstone("rooms", id);
          emit("rooms", id, "delete");
          return { ok: true };
        },
        // ----- Rendus -----
        async addRender(roomId, render, maxUnsaved = 20) {
          let dropped = [];
          const room = await this._patchRoom(roomId, (r) => {
            r.renders = [render, ...r.renders || []];
            const unsaved = r.renders.filter((x) => !x.saved);
            if (unsaved.length > maxUnsaved) {
              dropped = unsaved.slice(maxUnsaved);
              const ids = new Set(dropped.map((x) => x.id));
              r.renders = r.renders.filter((x) => !ids.has(x.id));
            }
          });
          if (dropped.length) await releaseMedia(dropped.map((x) => x.media));
          return room;
        },
        async updateRender(roomId, rid, patch) {
          let out;
          await this._patchRoom(roomId, (r) => {
            const x = r.renders?.find((y) => y.id === rid);
            if (!x) throw notFound("Rendu");
            if (patch.saved !== void 0) x.saved = Boolean(patch.saved);
            if (patch.title !== void 0) x.title = String(patch.title);
            out = x;
          });
          return out;
        },
        async deleteRender(roomId, rid) {
          let media = null;
          await this._patchRoom(roomId, (r) => {
            media = r.renders?.find((x) => x.id === rid)?.media;
            r.renders = (r.renders || []).filter((x) => x.id !== rid);
          });
          if (media) await releaseMedia([media]);
          return { ok: true };
        },
        // ----- IA (chargée à la demande) -----
        async status() {
          return (await Promise.resolve().then(() => (init_ai(), ai_exports))).aiStatus();
        },
        async analyzeRoom(id) {
          return (await Promise.resolve().then(() => (init_ai(), ai_exports))).analyzeRoom(await this.room(id));
        },
        async generateQuick(id) {
          return (await Promise.resolve().then(() => (init_ai(), ai_exports))).generateQuickRender(await this.room(id));
        },
        async generate(id, extraInstructions) {
          if (extraInstructions !== void 0) await this.updateRoom(id, { extraInstructions: String(extraInstructions) });
          return (await Promise.resolve().then(() => (init_ai(), ai_exports))).generateRender(await this.room(id));
        }
      };
      uploadImages = storeImages;
    }
  });

  // js/data/zip.js
  function crc32(bytes) {
    let c = 4294967295;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }
  function dosDateTime(d = /* @__PURE__ */ new Date()) {
    const time = d.getHours() << 11 | d.getMinutes() << 5 | Math.floor(d.getSeconds() / 2);
    const date = d.getFullYear() - 1980 << 9 | d.getMonth() + 1 << 5 | d.getDate();
    return { time, date };
  }
  async function createZip(files, onProgress) {
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosDateTime();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const nameBytes = enc.encode(f.name);
      const bytes = typeof f.data === "string" ? enc.encode(f.data) : f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
      const crc = crc32(bytes);
      const size = bytes.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 67324752, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 2048, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, nameBytes, f.data instanceof Blob ? f.data : bytes);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 33639248, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 2048, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(cd.buffer, nameBytes);
      offset += 30 + nameBytes.length + size;
      onProgress?.(i + 1, files.length);
    }
    const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 101010256, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
  }
  async function readZip(blob) {
    const tailLen = Math.min(blob.size, 65557);
    const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 101010256) {
      eocd = i;
      break;
    }
    if (eocd < 0) throw new Error("Ce fichier n'est pas une archive ZIP valide.");
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOffset = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    const entries = /* @__PURE__ */ new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 33639248) throw new Error("Archive ZIP endommagée.");
      const method = cd.getUint16(p + 10, true);
      const compSize = cd.getUint32(p + 20, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      const localOffset = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue;
      const getBlob = async () => {
        const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
        const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = blob.slice(start, start + compSize);
        if (method === 0) return raw;
        if (method === 8) {
          if (typeof DecompressionStream === "undefined") throw new Error("Archive compressée non prise en charge par ce navigateur.");
          return new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
        }
        throw new Error(`Méthode de compression ZIP non prise en charge (${method}).`);
      };
      entries.set(name, { name, blob: getBlob, text: async () => (await getBlob()).text() });
    }
    return entries;
  }
  var CRC_TABLE, enc;
  var init_zip = __esm({
    "js/data/zip.js"() {
      CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
          let c = n;
          for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
          t[n] = c >>> 0;
        }
        return t;
      })();
      enc = new TextEncoder();
    }
  });

  // js/data/bundle.js
  var bundle_exports = {};
  __export(bundle_exports, {
    FORMAT: () => FORMAT,
    FORMAT_VERSION: () => FORMAT_VERSION,
    applyImport: () => applyImport,
    exportBackup: () => exportBackup,
    exportLibrary: () => exportLibrary,
    planImport: () => planImport,
    readBundle: () => readBundle
  });
  async function buildZip(manifest, records, onProgress) {
    const ids = /* @__PURE__ */ new Set();
    records.forEach((r) => collectMediaIds(r, ids));
    const files = [];
    const missing = [];
    for (const id of ids) {
      const blob2 = await getMediaBlob(id);
      if (!blob2) {
        missing.push(id);
        continue;
      }
      files.push({ name: `media/${id}.${EXT[blob2.type] || "jpg"}`, data: blob2 });
    }
    manifest.mediaCount = files.length;
    files.unshift({ name: MANIFEST, data: JSON.stringify(manifest, null, 1) });
    const blob = await createZip(files, onProgress);
    return { blob, missing: missing.length };
  }
  async function exportLibrary({ categoryId = "", onProgress } = {}) {
    const allCats = await api.categories();
    const categories = categoryId ? allCats.filter((c) => c.id === categoryId) : allCats;
    const furniture = (await api.furniture()).filter((f) => !categoryId || f.category === categoryId);
    const title = categoryId ? `Bibliothèque ${categories[0]?.name || ""}`.trim() : "Bibliothèque complète";
    const manifest = { format: FORMAT, kind: "library", version: FORMAT_VERSION, exportedAt: now(), title, categories, furniture };
    const { blob, missing } = await buildZip(manifest, furniture, onProgress);
    const filename = `Bibliotheque-${categoryId ? safeName(categories[0]?.name || categoryId) + "-" : ""}${today()}.zip`;
    return { blob, filename, count: furniture.length, missing };
  }
  async function exportBackup({ onProgress } = {}) {
    const categories = await api.categories();
    const furniture = await api.furniture();
    const rooms = await api.rooms();
    const manifest = { format: FORMAT, kind: "backup", version: FORMAT_VERSION, exportedAt: now(), title: "Sauvegarde complète", categories, furniture, rooms };
    const { blob, missing } = await buildZip(manifest, [...furniture, ...rooms], onProgress);
    return { blob, filename: `Sauvegarde-Studio-IA-${today()}.zip`, count: furniture.length + rooms.length, missing };
  }
  async function readBundle(file) {
    let entries;
    try {
      entries = await readZip(file);
    } catch (e) {
      throw new Error(`Fichier illisible : ${e.message}`);
    }
    const mf = entries.get(MANIFEST) || [...entries.values()].find((e) => e.name.endsWith("/" + MANIFEST));
    if (!mf) throw new Error("Ce fichier n'est pas un export du Studio d'aménagement (studio.json absent).");
    const manifest = JSON.parse(await mf.text());
    if (manifest.format !== FORMAT) throw new Error("Format de fichier inconnu.");
    if (manifest.version > FORMAT_VERSION) throw new Error("Ce fichier provient d'une version plus récente de l'application : mettez-la à jour.");
    const byId = /* @__PURE__ */ new Map();
    for (const e of entries.values()) {
      const m = e.name.match(/(?:^|\/)media\/([^/]+)\.(\w+)$/);
      if (m) byId.set(m[1], { entry: e, type: MIME[m[2].toLowerCase()] || "image/jpeg" });
    }
    return {
      manifest,
      async resolveMedia(id) {
        const x = byId.get(id);
        if (!x) return null;
        return new Blob([await x.entry.blob()], { type: x.type });
      }
    };
  }
  async function planImport(bundle) {
    const { manifest } = bundle;
    const local = {
      furniture: new Map((await idb.all("furniture")).map((x) => [x.id, x])),
      rooms: new Map((await idb.all("rooms")).map((x) => [x.id, x]))
    };
    const sections = {};
    for (const store2 of ["furniture", "rooms"]) {
      const list = Array.isArray(manifest[store2]) ? manifest[store2] : [];
      const s = { add: [], update: [], same: 0, keepLocal: 0 };
      for (const item of list) {
        if (!item?.id) continue;
        const mine = local[store2].get(item.id);
        if (!mine) s.add.push(item);
        else if (newer(item, mine)) s.update.push(item);
        else if (newer(mine, item)) s.keepLocal++;
        else s.same++;
      }
      sections[store2] = s;
    }
    const cats = structuredClone(await api.categories());
    const remap = {};
    let newCats = 0, newTypes = 0;
    for (const c of manifest.categories || []) {
      if (!c?.name) continue;
      let mine = cats.find((x) => x.id === c.id) || cats.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
      if (!mine) {
        mine = { id: c.id || slug(c.name), name: c.name, types: [] };
        cats.push(mine);
        newCats++;
      }
      if (c.id && c.id !== mine.id) remap[c.id] = mine.id;
      for (const t of c.types || []) if (!mine.types.some((x) => x.toLowerCase() === String(t).toLowerCase())) {
        mine.types.push(t);
        newTypes++;
      }
    }
    return { kind: manifest.kind, title: manifest.title, exportedAt: manifest.exportedAt, ...sections, categories: cats, remap, newCats, newTypes };
  }
  async function applyImport(bundle, plan, onProgress) {
    const remapCat = (o) => o.category && plan.remap[o.category] ? { ...o, category: plan.remap[o.category] } : o;
    const toWrite = {
      furniture: [...plan.furniture.add, ...plan.furniture.update].map(remapCat),
      rooms: [...plan.rooms.add, ...plan.rooms.update].map(remapCat)
    };
    const ids = /* @__PURE__ */ new Set();
    [...toWrite.furniture, ...toWrite.rooms].forEach((r) => collectMediaIds(r, ids));
    let i = 0, missing = 0;
    for (const id of ids) {
      if (!await hasMedia(id)) {
        const blob = await bundle.resolveMedia(id);
        if (blob) await putMedia(blob, id);
        else missing++;
      }
      onProgress?.(++i, ids.size);
    }
    const obsolete = [];
    for (const store2 of ["furniture", "rooms"]) {
      for (const item of plan[store2].update) {
        const old = await idb.get(store2, item.id);
        if (!old) continue;
        const keep = collectMediaIds(item);
        collectMediaIds(old).forEach((m) => {
          if (!keep.has(m)) obsolete.push(m);
        });
      }
    }
    if (plan.newCats || plan.newTypes) await api.saveCategories(plan.categories);
    if (toWrite.furniture.length) await idb.putMany("furniture", toWrite.furniture);
    if (toWrite.rooms.length) await idb.putMany("rooms", toWrite.rooms.map((r) => ({ renders: [], photos: [], ...r })));
    await api.releaseMedia(obsolete);
    api.notifyImport();
    return { furniture: toWrite.furniture.length, rooms: toWrite.rooms.length, missing };
  }
  var FORMAT, FORMAT_VERSION, MANIFEST, EXT, MIME, today, safeName, newer;
  var init_bundle = __esm({
    "js/data/bundle.js"() {
      init_db();
      init_media();
      init_zip();
      init_api();
      FORMAT = "mdf-studio";
      FORMAT_VERSION = 1;
      MANIFEST = "studio.json";
      EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
      today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      safeName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
      newer = (a, b) => String(a?.updatedAt || "") > String(b?.updatedAt || "");
    }
  });

  // js/data/legacy.js
  var legacy_exports = {};
  __export(legacy_exports, {
    readLegacyFolder: () => readLegacyFolder
  });
  async function readLegacyFolder(files) {
    const list = [...files];
    const dbFile = list.find((f) => /(^|\/)db\.json$/.test(f.webkitRelativePath || f.name));
    if (!dbFile) throw new Error("Fichier db.json introuvable : choisissez le dossier « data » de l'ancienne version.");
    const db = JSON.parse(await dbFile.text());
    const byUrl = /* @__PURE__ */ new Map();
    for (const f of list) {
      const m = (f.webkitRelativePath || f.name).match(/(?:^|\/)(uploads|renders)\/([\w.-]+)$/);
      if (m) byUrl.set(`/${m[1]}/${m[2]}`, f);
    }
    const idFor = (url) => "old-" + url.replace(/^\/(uploads|renders)\//, "$1-").replace(/\.\w+$/, "").replace(/[^\w-]/g, "");
    const mediaFiles = /* @__PURE__ */ new Map();
    const convert = (n) => {
      if (Array.isArray(n)) return n.map(convert);
      if (!n || typeof n !== "object") return n;
      const out = {};
      for (const [k, v] of Object.entries(n)) {
        if ((k === "url" || k === "textureImage") && typeof v === "string" && /^\/(uploads|renders)\//.test(v)) {
          const id = idFor(v);
          if (byUrl.has(v)) mediaFiles.set(id, byUrl.get(v));
          out[k === "url" ? "media" : "textureImage"] = id;
        } else out[k] = convert(v);
      }
      return out;
    };
    const manifest = {
      format: FORMAT,
      kind: "backup",
      version: FORMAT_VERSION,
      title: "Données de l'ancienne version",
      categories: db.categories || [],
      furniture: convert(db.furniture || []),
      rooms: convert(db.rooms || [])
    };
    return {
      manifest,
      async resolveMedia(id) {
        const f = mediaFiles.get(id);
        if (!f) return null;
        const ext = f.name.split(".").pop().toLowerCase();
        return new Blob([f], { type: f.type || MIME2[ext] || "image/jpeg" });
      }
    };
  }
  var MIME2;
  var init_legacy = __esm({
    "js/data/legacy.js"() {
      init_bundle();
      MIME2 = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    }
  });

  // js/app.js
  init_api();

  // js/store.js
  init_api();
  var APP_VERSION = "2.4.0";
  var store = {
    categories: [],
    status: { configured: false },
    async loadCategories() {
      this.categories = await api.categories();
      return this.categories;
    },
    async refreshStatus() {
      this.status = await api.status();
      return this.status;
    },
    catName(id) {
      return this.categories.find((c) => c.id === id)?.name || "";
    }
  };
  var COLORS = [
    { name: "Blanc", hex: "#f4f2ee" },
    { name: "Ivoire", hex: "#ece3cf" },
    { name: "Beige lin", hex: "#d8c8ad" },
    { name: "Taupe", hex: "#9b8b7a" },
    { name: "Gris perle", hex: "#c4c4c2" },
    { name: "Gris anthracite", hex: "#4a4c50" },
    { name: "Noir", hex: "#1d1d1d" },
    { name: "Bleu nuit", hex: "#1f2f4f" },
    { name: "Bleu canard", hex: "#1f5c66" },
    { name: "Vert sauge", hex: "#9aa88a" },
    { name: "Vert forêt", hex: "#2f4a3a" },
    { name: "Terracotta", hex: "#b5603f" },
    { name: "Moutarde", hex: "#c9a03a" },
    { name: "Rose poudré", hex: "#d9b3a8" },
    { name: "Cognac", hex: "#8a4f2a" },
    { name: "Chêne clair", hex: "#c9a679" },
    { name: "Noyer", hex: "#6b4a32" }
  ];
  var TEXTURES = [
    { name: "Tissu tissé", css: "repeating-linear-gradient(0deg,#cfc6b8 0 2px,#ddd5c8 2px 4px),#ddd5c8" },
    { name: "Velours", css: "linear-gradient(135deg,#7c86a3,#4c5677 60%,#7c86a3)" },
    { name: "Bouclette", css: "radial-gradient(circle at 3px 3px,#fff 1.5px,#e6e0d6 2px) 0 0/6px 6px" },
    { name: "Lin", css: "repeating-linear-gradient(90deg,#d9cfbd 0 1px,#e7dfd0 1px 3px),#e7dfd0" },
    { name: "Cuir", css: "radial-gradient(circle at 30% 30%,#a0673f,#6e4024)" },
    { name: "Cuir vieilli", css: "linear-gradient(120deg,#7a4a2a,#a46d45 40%,#5f381f)" },
    { name: "Bois chêne", css: "repeating-linear-gradient(100deg,#c9a679 0 6px,#b89062 6px 8px,#d1b085 8px 14px)" },
    { name: "Bois noyer", css: "repeating-linear-gradient(100deg,#6b4a32 0 6px,#5a3d29 6px 8px,#76533a 8px 14px)" },
    { name: "Laqué mat", css: "#e9e7e3" },
    { name: "Laqué brillant", css: "linear-gradient(160deg,#fff,#dcdcdc 45%,#fafafa 55%,#d5d5d5)" },
    { name: "Marbre", css: "linear-gradient(125deg,#f2f2f0 30%,#cfcfcf 32%,#f2f2f0 35%,#f2f2f0 60%,#bdbdbd 62%,#f2f2f0 64%)" },
    { name: "Céramique", css: "linear-gradient(135deg,#8f8a84,#b5afa7)" },
    { name: "Métal brossé", css: "repeating-linear-gradient(90deg,#b8bcc0 0 1px,#cfd3d6 1px 3px)" },
    { name: "Verre", css: "linear-gradient(135deg,rgba(180,210,220,.6),rgba(255,255,255,.9))" },
    { name: "Rotin / cannage", css: "repeating-linear-gradient(45deg,#c8a46e 0 2px,transparent 2px 6px),repeating-linear-gradient(-45deg,#c8a46e 0 2px,#efe2c8 2px 6px)" }
  ];
  var TEXTURE_EN = {
    "Tissu tissé": "woven fabric upholstery",
    "Velours": "velvet",
    "Bouclette": "bouclé fabric",
    "Lin": "linen fabric",
    "Cuir": "smooth leather",
    "Cuir vieilli": "aged / distressed leather",
    "Bois chêne": "natural oak wood",
    "Bois noyer": "walnut wood",
    "Laqué mat": "matte lacquer",
    "Laqué brillant": "high-gloss lacquer",
    "Marbre": "marble",
    "Céramique": "ceramic",
    "Métal brossé": "brushed metal",
    "Verre": "glass",
    "Rotin / cannage": "rattan cane webbing"
  };
  var SEAT_TYPES = /canap|fauteuil|chaise|tabouret|banc|pouf|méridienne/i;
  var TOP_TYPES = /table|bureau|console|îlot|desserte|coiffeuse|buffet|commode|chevet/i;

  // js/ui.js
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var $ = (sel, root = document) => root.querySelector(sel);
  var $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  var num = (v) => v === "" || v == null || isNaN(Number(v)) ? void 0 : Number(v);
  function toast(msg, type = "") {
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    document.getElementById("toast-root").appendChild(el);
    setTimeout(() => el.remove(), type === "err" ? 6e3 : 3e3);
  }
  function modal({ title, content, footer = "", wide = false, onClose }) {
    const root = document.getElementById("modal-root");
    const el = document.createElement("div");
    el.className = "modal";
    el.innerHTML = `
    <div class="modal__box ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal__head"><h2>${esc(title)}</h2><button class="close" data-close aria-label="Fermer">×</button></div>
      <div class="modal__body">${content}</div>
      ${footer ? `<div class="modal__foot">${footer}</div>` : ""}
    </div>`;
    root.appendChild(el);
    document.body.style.overflow = "hidden";
    let closed = false;
    const close = (v) => {
      if (closed) return;
      closed = true;
      el.remove();
      if (!root.children.length) document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      onClose?.(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape" && root.lastElementChild === el) close();
    };
    document.addEventListener("keydown", onKey);
    el.addEventListener("mousedown", (e) => {
      if (e.target === el) close();
    });
    el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => close()));
    return { el, close };
  }
  function confirmDialog(message, okLabel = "Confirmer", danger = true) {
    return new Promise((resolve) => {
      let result = false;
      const m = modal({
        title: "Confirmation",
        content: `<p>${esc(message)}</p>`,
        footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn ${danger ? "btn--danger" : ""}" data-ok>${esc(okLabel)}</button>`,
        onClose: () => resolve(result)
      });
      m.el.querySelector("[data-ok]").addEventListener("click", () => {
        result = true;
        m.close();
      });
    });
  }
  function bindDropzone(zone, input, onFiles) {
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files.length) onFiles([...input.files]);
      input.value = "";
    });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
    }));
    zone.addEventListener("drop", (e) => {
      const f = [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/"));
      if (f.length) onFiles(f);
    });
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = label || "Patientez…";
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }
  function furnitureDims(f) {
    const p = [];
    if (f.length) p.push(`L ${Math.round(f.length)}`);
    if (f.width) p.push(`l ${Math.round(f.width)}`);
    if (f.height) p.push(`H ${Math.round(f.height)}`);
    return p.length ? p.join(" × ") + " cm" : "Dimensions non renseignées";
  }

  // js/app.js
  init_media();

  // js/project.js
  init_api();

  // js/camera.js
  function nativeCapture() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.capture = "environment";
      input.multiple = true;
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }
  async function capturePhotos({ title = "Prendre une photo" } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) return nativeCapture();
    let facing = "environment";
    let stream;
    const shots = [];
    let resolveFn;
    let resolved = false;
    const finish = (v) => {
      if (!resolved) {
        resolved = true;
        resolveFn?.(v);
      }
    };
    const m = modal({
      title,
      content: `
      <div class="camera">
        <video playsinline autoplay muted></video>
        <p class="muted small">Cadrez le meuble en entier, de face ou de trois-quarts, avec une lumière homogène. Vous pouvez prendre plusieurs photos.</p>
        <div class="shots"></div>
      </div>`,
      footer: `
      <button class="btn btn--light" data-switch>Changer de caméra</button>
      <button class="btn btn--ghost" data-shot>● Prendre la photo</button>
      <button class="btn" data-done disabled>Utiliser les photos (0)</button>`,
      onClose: () => {
        stream?.getTracks().forEach((t) => t.stop());
        finish(shots);
      }
    });
    const video = m.el.querySelector("video");
    const doneBtn = m.el.querySelector("[data-done]");
    async function start() {
      stream?.getTracks().forEach((t) => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
        video.srcObject = stream;
      } catch (e) {
        m.el.querySelector(".camera").innerHTML = `<div class="alert alert--info">Impossible d'accéder à la caméra depuis le navigateur (${e.name || "erreur"}).
        Sur téléphone, le bouton ci-dessous ouvre directement l'appareil photo.</div>
        <button class="btn btn--block" data-native>Ouvrir l'appareil photo / choisir une image</button>`;
        m.el.querySelector("[data-native]").onclick = async () => {
          const files = await nativeCapture();
          shots.push(...files);
          m.close();
        };
        m.el.querySelector("[data-shot]").disabled = true;
        m.el.querySelector("[data-switch]").disabled = true;
      }
    }
    return new Promise((resolve) => {
      resolveFn = resolve;
      m.el.querySelector("[data-switch]").onclick = () => {
        facing = facing === "environment" ? "user" : "environment";
        start();
      };
      m.el.querySelector("[data-shot]").onclick = () => {
        if (!video.videoWidth) return;
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        c.getContext("2d").drawImage(video, 0, 0);
        c.toBlob((b) => {
          shots.push(b);
          const img = document.createElement("img");
          img.src = URL.createObjectURL(b);
          m.el.querySelector(".shots").appendChild(img);
          doneBtn.disabled = false;
          doneBtn.textContent = `Utiliser les photos (${shots.length})`;
        }, "image/jpeg", 0.92);
      };
      doneBtn.onclick = () => m.close();
      start();
    });
  }

  // js/project.js
  init_media();

  // js/plan.js
  var PAD = 70;
  var FOV = 70;
  var SNAP = 5;
  var rad2 = (d) => d * Math.PI / 180;
  var snap = (v, s = SNAP) => Math.round(v / s) * s;
  function defaultPlan(dims) {
    return { camera: { x: Math.round(dims.length / 2), y: Math.max(0, dims.width - 20), angle: -90 }, items: [] };
  }
  function clampPlan(plan, dims) {
    const L = dims.length, W = dims.width;
    plan.camera.x = Math.min(Math.max(plan.camera.x, 0), L);
    plan.camera.y = Math.min(Math.max(plan.camera.y, 0), W);
    plan.items.forEach((it) => clampItem(it, L, W));
    return plan;
  }
  function halfExtents(it) {
    const r = rad2(it.rot || 0);
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    return { hx: it.w / 2 * c + it.d / 2 * s, hy: it.w / 2 * s + it.d / 2 * c };
  }
  function clampItem(it, L, W) {
    const { hx, hy } = halfExtents(it);
    it.x = hx * 2 >= L ? L / 2 : Math.min(Math.max(it.x, hx), L - hx);
    it.y = hy * 2 >= W ? W / 2 : Math.min(Math.max(it.y, hy), W - hy);
  }
  var PlanEditor = class {
    /**
     * @param {HTMLElement} host
     * @param {{room:object, mode:'existing'|'new', onSelect?:Function, onChange?:Function}} opts
     */
    constructor(host, opts) {
      this.host = host;
      this.room = opts.room;
      this.mode = opts.mode;
      this.onSelect = opts.onSelect || (() => {
      });
      this.onChange = opts.onChange || (() => {
      });
      this.selected = null;
      this.drag = null;
      this.host.addEventListener("pointerdown", (e) => this.down(e));
      window.addEventListener("pointermove", this._mv = (e) => this.move(e));
      window.addEventListener("pointerup", this._up = (e) => this.up(e));
      this.render();
    }
    destroy() {
      window.removeEventListener("pointermove", this._mv);
      window.removeEventListener("pointerup", this._up);
    }
    get plan() {
      return this.room.plan;
    }
    get L() {
      return Number(this.room.dims.length) || 400;
    }
    get W() {
      return Number(this.room.dims.width) || 300;
    }
    editable(it) {
      return it.kind === this.mode;
    }
    select(id, silent) {
      this.selected = id;
      this.render();
      if (!silent) this.onSelect(id ? this.plan.items.find((i) => i.id === id) : null);
    }
    // ---------- rendu ----------
    render() {
      const { L, W } = this;
      const fs = Math.max(L, W) / 45;
      const vb = `${-PAD} ${-PAD} ${L + PAD * 2} ${W + PAD * 2}`;
      const grid = [];
      for (let x = 50; x < L; x += 50) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${W}"/>`);
      for (let y = 50; y < W; y += 50) grid.push(`<line x1="0" y1="${y}" x2="${L}" y2="${y}"/>`);
      const items = [...this.plan.items].sort((a, b) => (a.id === this.selected) - (b.id === this.selected) || (a.kind === "new") - (b.kind === "new"));
      const replacedIds = new Set(this.plan.items.filter((i) => i.kind === "new" && i.replacesId).map((i) => i.replacesId));
      this.host.innerHTML = `
      <svg class="plan-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" style="font-size:${fs}px">
        <defs>
          <pattern id="hatch" width="12" height="12" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#f7e6e4"/><line x1="0" y1="0" x2="0" y2="12" stroke="#d9a39e" stroke-width="4"/>
          </pattern>
        </defs>
        <rect class="room" x="0" y="0" width="${L}" height="${W}"/>
        <g class="grid">${grid.join("")}</g>
        ${this.dimLines(fs)}
        ${items.map((it) => this.itemSVG(it, replacedIds.has(it.id), fs)).join("")}
        ${this.cameraSVG()}
      </svg>`;
      this.svg = this.host.querySelector("svg");
    }
    dimLines(fs) {
      const { L, W } = this;
      const o = PAD * 0.45;
      return `
      <line class="dimline" x1="0" y1="${-o}" x2="${L}" y2="${-o}"/>
      <line class="dimline" x1="0" y1="${-o - 8}" x2="0" y2="${-o + 8}"/><line class="dimline" x1="${L}" y1="${-o - 8}" x2="${L}" y2="${-o + 8}"/>
      <text class="dim" x="${L / 2}" y="${-o - 8}" text-anchor="middle" style="font-size:${fs * 0.95}px">${Math.round(L)} cm</text>
      <line class="dimline" x1="${-o}" y1="0" x2="${-o}" y2="${W}"/>
      <line class="dimline" x1="${-o - 8}" y1="0" x2="${-o + 8}" y2="0"/><line class="dimline" x1="${-o - 8}" y1="${W}" x2="${-o + 8}" y2="${W}"/>
      <text class="dim" x="${-o - 10}" y="${W / 2}" text-anchor="middle" transform="rotate(-90 ${-o - 10} ${W / 2})" style="font-size:${fs * 0.95}px">${Math.round(W)} cm</text>
      <text class="dim" x="${L}" y="${W + PAD * 0.7}" text-anchor="end" style="font-size:${fs * 0.8}px">Hauteur sous plafond : ${Math.round(this.room.dims.height || 0)} cm</text>`;
    }
    itemSVG(it, isReplaced, fs) {
      const sel = it.id === this.selected;
      const removed = it.kind === "existing" && (isReplaced || it.remove);
      const locked = !this.editable(it);
      const cls = ["item", it.kind, removed ? "removed" : "", sel ? "sel" : ""].join(" ");
      const handle = sel && !locked ? `<line x1="0" y1="${-it.d / 2}" x2="0" y2="${-it.d / 2 - 28}" stroke="#e08a00" stroke-width="2"/>
         <circle class="rot-handle" data-rot="${it.id}" cx="0" cy="${-it.d / 2 - 34}" r="${Math.max(9, fs * 0.55)}" fill="#fff" stroke="#e08a00" stroke-width="3" style="cursor:crosshair"/>` : "";
      const label = it.kind === "new" ? it.name : it.name + (removed ? isReplaced ? " (remplacé)" : " (retiré)" : "");
      const showLabel = !(isReplaced && this.mode === "new");
      return `
      <g class="${cls}" data-id="${it.id}" style="${locked ? "opacity:.55" : ""}">
        <g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">
          <rect class="body" x="${-it.w / 2}" y="${-it.d / 2}" width="${it.w}" height="${it.d}" rx="3"/>
          <line class="front" x1="${-it.w / 2 + 4}" y1="${it.d / 2}" x2="${it.w / 2 - 4}" y2="${it.d / 2}"/>
          ${handle}
        </g>
        ${showLabel ? `<text class="label" x="${it.x}" y="${it.y}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>
        <text class="label sub" x="${it.x}" y="${it.y + fs * 1.1}" text-anchor="middle" dominant-baseline="middle" style="font-size:${fs * 0.75}px">${Math.round(it.w)}×${Math.round(it.d)}</text>` : ""}
      </g>`;
    }
    cameraSVG() {
      const c = this.plan.camera;
      const R = Math.min(this.L, this.W) * 0.55;
      const a = rad2(c.angle);
      const a1 = rad2(c.angle - FOV / 2), a2 = rad2(c.angle + FOV / 2);
      const p = (ang, r) => `${c.x + Math.cos(ang) * r},${c.y + Math.sin(ang) * r}`;
      const hx = c.x + Math.cos(a) * R * 0.62, hy = c.y + Math.sin(a) * R * 0.62;
      const s = Math.max(this.L, this.W) / 38;
      return `
      <g class="cam">
        <path class="cone" d="M${c.x},${c.y} L${p(a1, R)} A${R},${R} 0 0 1 ${p(a2, R)} Z" pointer-events="none"/>
        <line x1="${c.x}" y1="${c.y}" x2="${hx}" y2="${hy}" stroke="#e08a00" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>
        <g data-cam="body" transform="translate(${c.x} ${c.y}) rotate(${c.angle})">
          <rect class="body" x="${-s}" y="${-s * 0.7}" width="${s * 1.6}" height="${s * 1.4}" rx="${s * 0.25}"/>
          <polygon class="body" points="${s * 0.6},${-s * 0.45} ${s * 1.25},${-s * 0.8} ${s * 1.25},${s * 0.8} ${s * 0.6},${s * 0.45}"/>
        </g>
        <circle class="handle" data-cam="handle" cx="${hx}" cy="${hy}" r="${s * 0.55}"/>
      </g>`;
    }
    // ---------- interactions ----------
    pt(e) {
      const p = this.svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      return p.matrixTransform(this.svg.getScreenCTM().inverse());
    }
    down(e) {
      if (!this.svg) return;
      const t = e.target;
      const P = this.pt(e);
      const rot = t.closest("[data-rot]");
      const cam = t.closest("[data-cam]");
      const g = t.closest("[data-id]");
      if (rot) {
        this.drag = { type: "rot", id: rot.dataset.rot };
      } else if (cam) {
        this.drag = { type: cam.dataset.cam === "handle" ? "camrot" : "cam", ox: P.x - this.plan.camera.x, oy: P.y - this.plan.camera.y };
      } else if (g) {
        const it = this.plan.items.find((i) => i.id === g.dataset.id);
        if (this.selected !== it.id) this.select(it.id);
        if (!this.editable(it)) return;
        this.drag = { type: "item", id: it.id, ox: P.x - it.x, oy: P.y - it.y };
      } else {
        if (this.selected) this.select(null);
        return;
      }
      this.drag.moved = false;
      e.preventDefault();
    }
    move(e) {
      if (!this.drag) return;
      const P = this.pt(e);
      const d = this.drag;
      d.moved = true;
      if (d.type === "item") {
        const it = this.plan.items.find((i) => i.id === d.id);
        it.x = snap(P.x - d.ox);
        it.y = snap(P.y - d.oy);
        clampItem(it, this.L, this.W);
      } else if (d.type === "rot") {
        const it = this.plan.items.find((i) => i.id === d.id);
        const ang = Math.atan2(P.y - it.y, P.x - it.x) * 180 / Math.PI + 90;
        it.rot = ((e.shiftKey ? Math.round(ang) : snap(ang, 15)) + 360) % 360;
        clampItem(it, this.L, this.W);
      } else if (d.type === "cam") {
        const c = this.plan.camera;
        c.x = Math.min(Math.max(snap(P.x - d.ox), 0), this.L);
        c.y = Math.min(Math.max(snap(P.y - d.oy), 0), this.W);
      } else if (d.type === "camrot") {
        const c = this.plan.camera;
        const ang = Math.atan2(P.y - c.y, P.x - c.x) * 180 / Math.PI;
        c.angle = e.shiftKey ? Math.round(ang) : snap(ang, 5);
      }
      this.render();
    }
    up() {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) this.onChange();
    }
    // ---------- actions ----------
    rotateSelected(delta) {
      const it = this.plan.items.find((i) => i.id === this.selected);
      if (!it || !this.editable(it)) return;
      it.rot = (((it.rot || 0) + delta) % 360 + 360) % 360;
      clampItem(it, this.L, this.W);
      this.render();
      this.onChange();
    }
  };

  // js/library.js
  init_api();
  init_media();

  // js/transfer.js
  init_api();
  init_media();
  var bundleMod = () => Promise.resolve().then(() => (init_bundle(), bundle_exports));
  var fmtSize = (n) => n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`;
  async function exportLibraryDialog(defaultCategory = "") {
    await store.loadCategories();
    const all = await api.furniture();
    const count = (id) => all.filter((f) => !id || f.category === id).length;
    const m = modal({
      title: "Partager la bibliothèque",
      content: `
      <p class="small">Crée un fichier contenant les meubles, leurs photos et leurs cotes. Envoyez-le par mail, AirDrop, ou enregistrez-le dans iCloud Drive / Google Drive (app Fichiers). Sur l'autre appareil : <strong>Bibliothèque › Importer</strong>.</p>
      <div class="field"><label>Contenu</label>
        <select id="xcat">
          <option value="">Toute la bibliothèque (${count("")} meubles)</option>
          ${store.categories.map((c) => `<option value="${c.id}" ${c.id === defaultCategory ? "selected" : ""}>${esc(c.name)} uniquement (${count(c.id)} meubles)</option>`).join("")}
        </select></div>
      <div class="progress hidden" id="xprog"><div></div></div>`,
      footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-go>Créer le fichier</button>`
    });
    m.el.querySelector("[data-go]").onclick = async (e) => {
      const btn = e.currentTarget;
      const cat = m.el.querySelector("#xcat").value;
      if (!count(cat)) return toast("Aucun meuble à exporter", "err");
      busy(btn, true, "Préparation…");
      const prog = m.el.querySelector("#xprog");
      prog.classList.remove("hidden");
      try {
        const { exportLibrary: exportLibrary2 } = await bundleMod();
        const out = await exportLibrary2({ categoryId: cat, onProgress: (d, t) => prog.firstElementChild.style.width = `${d / t * 100}%` });
        m.close();
        fileReadyDialog(out.blob, out.filename, `${out.count} meuble(s) avec leurs photos et leurs cotes.`);
      } catch (err) {
        console.error(err);
        toast("Échec de l'export : " + err.message, "err");
        busy(btn, false);
      }
    };
  }
  function fileReadyDialog(blob, filename, description = "") {
    const share = canShareFiles();
    const m = modal({
      title: "Fichier prêt",
      content: `<p><strong>${esc(filename)}</strong> <span class="muted small">· ${fmtSize(blob.size)}</span></p>
      ${description ? `<p class="small">${esc(description)}</p>` : ""}
      ${share ? '<p class="muted small">« Partager » ouvre AirDrop, Mail, Enregistrer dans Fichiers (iCloud Drive, Google Drive)…</p>' : ""}`,
      footer: `<button class="btn btn--light" data-close>Fermer</button>
      <button class="btn ${share ? "btn--ghost" : ""}" data-dl>Télécharger</button>
      ${share ? '<button class="btn" data-share>Partager…</button>' : ""}`
    });
    m.el.querySelector("[data-dl]").onclick = async () => {
      await shareOrDownload(blob, filename, "", "download");
      m.close();
    };
    m.el.querySelector("[data-share]")?.addEventListener("click", async () => {
      const r = await shareOrDownload(blob, filename, filename, "share");
      if (r !== "cancelled") m.close();
    });
  }
  async function exportBackupDialog(btn) {
    busy(btn, true, "Préparation…");
    try {
      const { exportBackup: exportBackup2 } = await bundleMod();
      const out = await exportBackup2({});
      fileReadyDialog(out.blob, out.filename, "Projets, rendus et bibliothèque de cet appareil (la clé API n'est pas incluse).");
    } catch (err) {
      console.error(err);
      toast("Échec de la sauvegarde : " + err.message, "err");
    }
    busy(btn, false);
  }
  function pickAndImport() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,application/zip,application/x-zip-compressed";
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(false);
        try {
          const { readBundle: readBundle2 } = await bundleMod();
          resolve(await importDialog(await readBundle2(file)));
        } catch (err) {
          console.error(err);
          toast(err.message, "err");
          resolve(false);
        }
      };
      input.click();
    });
  }
  function pickLegacyFolder() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;
      input.onchange = async () => {
        if (!input.files.length) return resolve(false);
        try {
          const { readLegacyFolder: readLegacyFolder2 } = await Promise.resolve().then(() => (init_legacy(), legacy_exports));
          resolve(await importDialog(await readLegacyFolder2(input.files)));
        } catch (err) {
          console.error(err);
          toast(err.message, "err");
          resolve(false);
        }
      };
      input.click();
    });
  }
  async function importDialog(bundle) {
    const { planImport: planImport2, applyImport: applyImport2 } = await bundleMod();
    const plan = await planImport2(bundle);
    const line = (label, s) => {
      const parts = [];
      if (s.add.length) parts.push(`<strong>${s.add.length}</strong> nouveau(x)`);
      if (s.update.length) parts.push(`<strong>${s.update.length}</strong> mis à jour`);
      if (s.same) parts.push(`${s.same} déjà identique(s)`);
      if (s.keepLocal) parts.push(`${s.keepLocal} plus récent(s) sur cet appareil, conservé(s)`);
      return parts.length ? `<li>${label} : ${parts.join(", ")}</li>` : "";
    };
    const total = plan.furniture.add.length + plan.furniture.update.length + plan.rooms.add.length + plan.rooms.update.length;
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: "Importer",
        onClose: () => resolve(done),
        content: `
        <p><strong>${esc(plan.title || "Fichier")}</strong>${plan.exportedAt ? ` <span class="muted small">· exporté le ${new Date(plan.exportedAt).toLocaleString("fr-FR")}</span>` : ""}</p>
        <ul class="small">
          ${line("Meubles", plan.furniture)}
          ${line("Projets", plan.rooms)}
          ${plan.newCats || plan.newTypes ? `<li>Catégories : ${plan.newCats} pièce(s) et ${plan.newTypes} type(s) ajoutés</li>` : ""}
        </ul>
        ${total ? `<p class="muted small">Rien n'est supprimé sur cet appareil. Pour un même meuble, la version la plus récente est gardée.</p>` : '<div class="alert alert--info">Tout est déjà à jour sur cet appareil.</div>'}
        <div class="progress hidden" id="iprog"><div></div></div>`,
        footer: `<button class="btn btn--light" data-close>${total ? "Annuler" : "Fermer"}</button>${total ? '<button class="btn" data-go>Importer</button>' : ""}`
      });
      m.el.querySelector("[data-go]")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        busy(btn, true, "Import…");
        const prog = m.el.querySelector("#iprog");
        prog.classList.remove("hidden");
        try {
          const r = await applyImport2(bundle, plan, (d, t) => prog.firstElementChild.style.width = `${d / t * 100}%`);
          await store.loadCategories();
          done = true;
          toast(`Import terminé : ${r.furniture} meuble(s), ${r.rooms} projet(s)${r.missing ? ` (${r.missing} image(s) manquante(s))` : ""}`, "ok");
          m.close();
        } catch (err) {
          console.error(err);
          toast("Échec de l'import : " + err.message, "err");
          busy(btn, false);
        }
      });
    });
  }

  // js/library.js
  var PLACEHOLDER = `<svg width="56" viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 22v-8a4 4 0 014-4h44a4 4 0 014 4v8"/><path d="M2 22a4 4 0 018 0v6h44v-6a4 4 0 018 0v10H2z"/><path d="M8 32v5M56 32v5"/></svg>`;
  function furnitureCard(f, { selectable = false } = {}) {
    const cover = f.photos?.[f.cover || 0]?.media;
    return `
    <article class="card" data-fid="${f.id}" tabindex="0">
      <div class="card__img">${cover ? `<img ${src(cover)} alt="">` : PLACEHOLDER}</div>
      ${f.type ? `<span class="card__badge">${esc(f.type)}</span>` : ""}
      <div class="card__body">
        <div class="card__title">${esc(f.name)}</div>
        <div class="card__meta">${esc(store.catName(f.category) || "Sans pièce")}${f.reference ? " · Réf. " + esc(f.reference) : ""}</div>
        <div class="card__meta">${furnitureDims(f)}</div>
      </div>
      ${selectable ? "" : ""}
    </article>`;
  }
  async function renderLibrary(app2, params = {}) {
    await store.loadCategories();
    const state = { category: params.category || "", type: params.type || "", q: "" };
    let all = await api.furniture();
    app2.innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">Bibliothèque</span><h1>Mes meubles</h1></div>
      <div class="btn-row">
        <button class="btn btn--light" data-cats>Gérer les pièces et types</button>
        <button class="btn btn--light" data-import title="Importer une bibliothèque reçue (fichier .zip)">⤓ Importer</button>
        <button class="btn btn--light" data-export title="Créer un fichier à partager">⤴ Partager</button>
        <button class="btn btn--ghost" data-photo>📷 Photographier un meuble</button>
        <button class="btn" data-new>+ Nouveau meuble</button>
      </div>
    </div>
    <div class="lib">
      <aside><ul class="tree" id="tree"></ul></aside>
      <section>
        <div class="breadcrumb" id="crumb"></div>
        <div class="filters"><input class="input" id="search" placeholder="Rechercher un meuble, une référence…"></div>
        <div class="cards" id="grid"></div>
      </section>
    </div>`;
    const drawTree = () => {
      const count = (c, t) => all.filter((f) => (!c || f.category === c) && (!t || f.type === t)).length;
      $("#tree", app2).innerHTML = `
      <li><button class="${!state.category ? "active" : ""}" data-c="">Tous les meubles <span class="count">${all.length}</span></button></li>
      ${store.categories.map((c) => `
        <li>
          <button class="${state.category === c.id ? "active" : ""}" data-c="${c.id}">${esc(c.name)} <span class="count">${count(c.id)}</span></button>
          ${state.category === c.id ? `<ul>${c.types.map((t) => `
            <li><button class="${state.type === t ? "active" : ""}" data-c="${c.id}" data-t="${esc(t)}">${esc(t)} <span class="count">${count(c.id, t)}</span></button></li>`).join("")}</ul>` : ""}
        </li>`).join("")}`;
    };
    const drawGrid = () => {
      const q = state.q.toLowerCase();
      const list = all.filter((f) => (!state.category || f.category === state.category) && (!state.type || f.type === state.type) && (!q || [f.name, f.reference, f.type].join(" ").toLowerCase().includes(q)));
      $("#crumb", app2).textContent = ["Bibliothèque", store.catName(state.category), state.type].filter(Boolean).join(" › ");
      $("#grid", app2).innerHTML = `
      <button class="card card--add" data-new><div><span>+</span>Ajouter un meuble</div></button>
      ${list.map((f) => furnitureCard(f)).join("")}
      ${!all.length ? `<div class="empty" style="grid-column:1/-1">Bibliothèque vide. Ajoutez vos meubles, ou <button class="linklike" data-import>importez un fichier de bibliothèque</button> reçu d'un autre appareil.</div>` : ""}`;
    };
    const refresh = async () => {
      all = await api.furniture();
      drawTree();
      drawGrid();
    };
    drawTree();
    drawGrid();
    app2.addEventListener("click", async (e) => {
      const c = e.target.closest("[data-c]");
      if (c) {
        state.category = c.dataset.c;
        state.type = c.dataset.t || "";
        drawTree();
        drawGrid();
        return;
      }
      if (e.target.closest("[data-new]")) {
        const f = await openFurnitureForm({ defaults: { category: state.category, type: state.type } });
        if (f) refresh();
        return;
      }
      if (e.target.closest("[data-photo]")) {
        const shots = await capturePhotos({ title: "Photographier un meuble" });
        if (!shots?.length) return;
        const f = await openFurnitureForm({ defaults: { category: state.category, type: state.type }, files: shots });
        if (f) refresh();
        return;
      }
      if (e.target.closest("[data-cats]")) {
        if (await manageCategories()) {
          drawTree();
          drawGrid();
        }
        return;
      }
      if (e.target.closest("[data-export]")) {
        exportLibraryDialog(state.category);
        return;
      }
      if (e.target.closest("[data-import]")) {
        if (await pickAndImport()) refresh();
        return;
      }
      const card = e.target.closest("[data-fid]");
      if (card) {
        const f = all.find((x) => x.id === card.dataset.fid);
        const res = await openFurnitureForm({ furniture: f });
        if (res !== null) refresh();
      }
    });
    $("#search", app2).addEventListener("input", (e) => {
      state.q = e.target.value;
      drawGrid();
    });
  }
  async function openFurnitureForm({ furniture, defaults = {}, files = [] } = {}) {
    if (!store.categories.length) await store.loadCategories();
    const f = furniture ? structuredClone(furniture) : { name: "", category: defaults.category || store.categories[0]?.id || "", type: defaults.type || "", photos: [], cover: 0 };
    f.photos ??= [];
    const typeOptions = (cat) => {
      const types = store.categories.find((c) => c.id === cat)?.types || [];
      return `<option value="">— Choisir —</option>` + types.map((t) => `<option ${t === f.type ? "selected" : ""}>${esc(t)}</option>`).join("");
    };
    return new Promise((resolve) => {
      let result = null;
      const m = modal({
        title: furniture ? "Modifier le meuble" : "Nouveau meuble",
        wide: true,
        onClose: () => resolve(result),
        content: `
        <div class="layout" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
          <div>
            <h3>Photos du meuble</h3>
            <div class="choice">
              <button type="button" data-cam><span class="ico">📷</span><strong>Prendre en photo</strong></button>
              <button type="button" data-drop><span class="ico">🖼️</span><strong>Importer des images</strong></button>
            </div>
            <div class="dropzone hidden" id="fdrop"><strong>Déposez vos images ici</strong><span class="muted small">ou cliquez pour parcourir</span></div>
            <input type="file" accept="image/*" multiple hidden id="ffile">
            <p class="muted small">Conseil : une photo nette du meuble entier, sur fond neutre si possible. L'étoile désigne la photo principale.</p>
            <div class="thumbs" id="fthumbs"></div>
          </div>
          <form id="fform" autocomplete="off">
            <div class="field"><label>Nom du meuble *</label><input name="name" required value="${esc(f.name)}" placeholder="Ex. Canapé 3 places Milano"></div>
            <div class="field"><label>Référence</label><input name="reference" value="${esc(f.reference || "")}" placeholder="Optionnel"></div>
            <div class="grid-2">
              <div class="field"><label>Pièce</label><select name="category">${store.categories.map((c) => `<option value="${c.id}" ${c.id === f.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
              <div class="field"><label>Type de meuble</label><select name="type">${typeOptions(f.category)}</select></div>
            </div>
            <div class="grid-3">
              <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input name="length" type="number" min="1" step="1" value="${f.length ?? ""}"></div></div>
              <div class="field"><label>Largeur / prof.</label><div class="unit" data-unit="cm"><input name="width" type="number" min="1" step="1" value="${f.width ?? ""}"></div></div>
              <div class="field"><label>Hauteur</label><div class="unit" data-unit="cm"><input name="height" type="number" min="1" step="1" value="${f.height ?? ""}"></div></div>
            </div>
            <div class="grid-2">
              <div class="field" data-seat><label>Hauteur d'assise</label><div class="unit" data-unit="cm"><input name="seatHeight" type="number" min="1" value="${f.seatHeight ?? ""}"></div></div>
              <div class="field" data-top><label>Hauteur de plateau</label><div class="unit" data-unit="cm"><input name="topHeight" type="number" min="1" value="${f.topHeight ?? ""}"></div></div>
            </div>
            <div class="field"><label>Autres cotes</label><input name="extra" value="${esc(f.extra || "")}" placeholder="Ex. profondeur d'assise 58 cm, accoudoirs 20 cm"></div>
            <div class="field"><label>Description / notes</label><textarea name="notes" placeholder="Matière, coloris, pieds, particularités…">${esc(f.notes || "")}</textarea></div>
          </form>
        </div>`,
        footer: `
        ${furniture ? '<button class="btn btn--danger" data-del style="margin-right:auto">Supprimer</button>' : ""}
        <button class="btn btn--light" data-close>Annuler</button>
        <button class="btn" data-save>${furniture ? "Enregistrer" : "Ajouter à la bibliothèque"}</button>`
      });
      const el = m.el;
      const form = $("#fform", el);
      const drawThumbs = () => {
        $("#fthumbs", el).innerHTML = f.photos.map((p, i) => `
        <div class="thumb ${i === (f.cover || 0) ? "ref" : ""}">
          <img ${src(p.media)} alt="">
          ${i === (f.cover || 0) ? '<span class="thumb__tag">Principale</span>' : ""}
          <div class="thumb__actions">
            <button type="button" title="Photo principale" data-cover="${i}">★</button>
            <button type="button" title="Supprimer" data-rm="${i}">✕</button>
          </div>
        </div>`).join("") || '<p class="muted small">Aucune photo pour le moment.</p>';
      };
      const toggleExtra = () => {
        const t = form.type.value;
        $("[data-seat]", el).classList.toggle("hidden", Boolean(t) && !SEAT_TYPES.test(t));
        $("[data-top]", el).classList.toggle("hidden", Boolean(t) && !TOP_TYPES.test(t));
      };
      const addFiles = async (list) => {
        try {
          toast("Enregistrement des photos…");
          f.photos.push(...await uploadImages(list));
          drawThumbs();
        } catch (e) {
          toast(e.message, "err");
        }
      };
      drawThumbs();
      toggleExtra();
      if (files.length) addFiles(files);
      form.category.addEventListener("change", () => {
        f.category = form.category.value;
        f.type = "";
        form.type.innerHTML = typeOptions(f.category);
        toggleExtra();
      });
      form.type.addEventListener("change", toggleExtra);
      bindDropzone($("#fdrop", el), $("#ffile", el), addFiles);
      $("[data-drop]", el).onclick = () => {
        $("#fdrop", el).classList.remove("hidden");
        $("#ffile", el).click();
      };
      $("[data-cam]", el).onclick = async () => {
        const s = await capturePhotos({ title: "Photographier le meuble" });
        if (s?.length) addFiles(s);
      };
      $("#fthumbs", el).addEventListener("click", (e) => {
        const c = e.target.closest("[data-cover]");
        const r = e.target.closest("[data-rm]");
        if (c) f.cover = Number(c.dataset.cover);
        if (r) {
          const i = Number(r.dataset.rm);
          f.photos.splice(i, 1);
          if ((f.cover || 0) >= f.photos.length) f.cover = 0;
          else if (i < (f.cover || 0)) f.cover--;
        }
        drawThumbs();
      });
      $("[data-save]", el).onclick = async (e) => {
        if (!form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        const body = {
          name: data.name.trim(),
          reference: data.reference.trim(),
          category: data.category,
          type: data.type,
          length: num(data.length),
          width: num(data.width),
          height: num(data.height),
          seatHeight: num(data.seatHeight),
          topHeight: num(data.topHeight),
          extra: data.extra.trim(),
          notes: data.notes.trim(),
          photos: f.photos,
          cover: f.cover || 0
        };
        if (!body.photos.length && !await confirmDialog("Ce meuble n'a pas de photo : l'IA ne pourra s'appuyer que sur sa description. Continuer ?", "Continuer", false)) return;
        busy(e.target, true, "Enregistrement…");
        try {
          result = furniture ? await api.updateFurniture(furniture.id, body) : await api.createFurniture(body);
          toast("Meuble enregistré", "ok");
          m.close();
        } catch (err) {
          toast(err.message, "err");
          busy(e.target, false);
        }
      };
      $("[data-del]", el)?.addEventListener("click", async () => {
        if (!await confirmDialog(`Supprimer « ${furniture.name} » de la bibliothèque ?`, "Supprimer")) return;
        await api.deleteFurniture(furniture.id);
        result = "deleted";
        toast("Meuble supprimé");
        m.close();
      });
    });
  }
  async function pickFurniture({ category = "" } = {}) {
    await store.loadCategories();
    let all = await api.furniture();
    const st = { category: all.some((f) => f.category === category) ? category : "", type: "", q: "" };
    return new Promise((resolve) => {
      let result = null;
      const m = modal({
        title: "Choisir dans la bibliothèque",
        wide: true,
        onClose: () => resolve(result),
        content: `
        <div class="filters">
          <select class="input" data-f="category"><option value="">Toutes les pièces</option>${store.categories.map((c) => `<option value="${c.id}" ${c.id === st.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <select class="input" data-f="type"></select>
          <input class="input" data-f="q" placeholder="Rechercher…">
        </div>
        <div class="cards" id="pgrid"></div>`,
        footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn btn--ghost" data-create>+ Créer un nouveau meuble</button>`
      });
      const el = m.el;
      const types = () => {
        const cats = st.category ? store.categories.filter((c) => c.id === st.category) : store.categories;
        const list = [...new Set(cats.flatMap((c) => c.types))];
        $("[data-f=type]", el).innerHTML = `<option value="">Tous les types</option>` + list.map((t) => `<option ${t === st.type ? "selected" : ""}>${esc(t)}</option>`).join("");
      };
      const draw = () => {
        const q = st.q.toLowerCase();
        const list = all.filter((f) => (!st.category || f.category === st.category) && (!st.type || f.type === st.type) && (!q || [f.name, f.reference].join(" ").toLowerCase().includes(q)));
        $("#pgrid", el).innerHTML = list.map((f) => furnitureCard(f)).join("") || `<div class="empty" style="grid-column:1/-1">Aucun meuble ne correspond. Créez-en un nouveau !</div>`;
      };
      types();
      draw();
      $$("[data-f]", el).forEach((inp) => inp.addEventListener("input", () => {
        st[inp.dataset.f] = inp.value;
        if (inp.dataset.f === "category") {
          st.type = "";
          types();
        }
        draw();
      }));
      $("#pgrid", el).addEventListener("click", (e) => {
        const c = e.target.closest("[data-fid]");
        if (c) {
          result = all.find((f) => f.id === c.dataset.fid);
          m.close();
        }
      });
      $("[data-create]", el).onclick = async () => {
        const f = await openFurnitureForm({ defaults: { category: st.category, type: st.type } });
        if (f && f !== "deleted") {
          result = f;
          m.close();
        }
      };
    });
  }
  function manageCategories() {
    const cats = structuredClone(store.categories);
    return new Promise((resolve) => {
      let saved = false;
      const m = modal({
        title: "Pièces et types de meubles",
        onClose: () => resolve(saved),
        content: `<p class="muted small">Niveau 1 : les pièces. Niveau 2 : les types de meubles de chaque pièce.</p><div id="cats"></div>
        <div class="btn-row" style="margin-top:16px"><input class="input" id="newcat" placeholder="Nouvelle pièce (ex. Salle de bain)" style="flex:1"><button class="btn btn--ghost" id="addcat">Ajouter la pièce</button></div>`,
        footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-save>Enregistrer</button>`
      });
      const el = m.el;
      const draw = () => {
        $("#cats", el).innerHTML = cats.map((c, i) => `
        <div class="cat-block" data-i="${i}">
          <header><input class="input" data-name value="${esc(c.name)}"><button class="icon-btn" title="Supprimer la pièce" data-delcat>✕</button></header>
          <div class="chips">${c.types.map((t, j) => `<span class="chip">${esc(t)}<button data-deltype="${j}" title="Retirer">×</button></span>`).join("")}</div>
          <div class="btn-row" style="margin-top:10px"><input class="input" data-newtype placeholder="Ajouter un type…" style="flex:1"><button class="btn btn--sm btn--ghost" data-addtype>Ajouter</button></div>
        </div>`).join("");
      };
      draw();
      el.addEventListener("input", (e) => {
        const b = e.target.closest("[data-i]");
        if (b && e.target.matches("[data-name]")) cats[b.dataset.i].name = e.target.value;
      });
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (e.target.matches("[data-delcat]")) {
          cats.splice(b.dataset.i, 1);
          draw();
        } else if (e.target.matches("[data-deltype]")) {
          cats[b.dataset.i].types.splice(e.target.dataset.deltype, 1);
          draw();
        } else if (e.target.matches("[data-addtype]")) {
          const v = $("[data-newtype]", b).value.trim();
          if (v) {
            cats[b.dataset.i].types.push(v);
            draw();
            $(`[data-i="${b.dataset.i}"] [data-newtype]`, el).focus();
          }
        }
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-newtype]")) {
          e.preventDefault();
          e.target.nextElementSibling.click();
        }
      });
      $("#addcat", el).onclick = () => {
        const v = $("#newcat", el).value.trim();
        if (v) {
          cats.push({ name: v, types: [] });
          $("#newcat", el).value = "";
          draw();
        }
      };
      $("[data-save]", el).onclick = async () => {
        try {
          store.categories = await api.saveCategories(cats);
          saved = true;
          toast("Catégories enregistrées", "ok");
          m.close();
        } catch (err) {
          toast(err.message, "err");
        }
      };
    });
  }

  // js/project.js
  var STEPS = ["La pièce", "Le plan", "Aménagement", "Rendu IA"];
  async function ensureAIReady() {
    store.status = await api.status();
    if (!store.status.configured) {
      const ok = await confirmDialog("Aucune clé API n'est renseignée sur cet appareil. Ouvrir les réglages pour l'ajouter ?", "Ouvrir les réglages", false);
      if (ok) location.hash = "#/reglages";
      return false;
    }
    if (!navigator.onLine) {
      toast("Pas de connexion internet : l'IA n'est pas disponible hors ligne.", "err");
      return false;
    }
    return true;
  }
  var pending = /* @__PURE__ */ new Map();
  var uid2 = () => Math.random().toString(36).slice(2, 10);
  async function renderProject(view, { id, step }) {
    await store.loadCategories();
    if (id === "nouveau") {
      const room2 = await api.createRoom({ name: "Nouveau projet", category: store.categories[0]?.id || "" });
      location.replace(`#/projet/${room2.id}/1`);
      return;
    }
    let room;
    try {
      room = await api.room(id);
    } catch {
      view.innerHTML = `<div class="empty">Projet introuvable. <a href="#/">Retour à mes projets</a></div>`;
      return;
    }
    room.plan ??= null;
    room.renders ??= [];
    step = Math.min(4, Math.max(1, Number(step) || 1));
    if (step > 1 && !room.plan) step = 1;
    let saveTimer = null;
    const persist2 = () => api.updateRoom(room.id, {
      name: room.name,
      category: room.category,
      dims: room.dims,
      photos: room.photos,
      refPhoto: room.refPhoto,
      plan: room.plan,
      extraInstructions: room.extraInstructions
    }).catch((e) => toast("Sauvegarde impossible : " + e.message, "err"));
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist2, 500);
    };
    const flush = async () => {
      clearTimeout(saveTimer);
      await persist2();
    };
    const go = async (n, extra = "") => {
      await flush();
      location.hash = `#/projet/${room.id}/${n}${extra}`;
    };
    const canReach = (n) => n === 1 || n <= 3 && room.plan || n === 4 && room.plan && (room.renders.length || pending.has(room.id));
    view.innerHTML = `
    <div class="project-head">
      <div style="flex:1;min-width:240px">
        <span class="eyebrow">Projet d'aménagement</span>
        <input class="input" id="pname" value="${esc(room.name)}" style="font-family:var(--serif);font-size:28px;border:0;padding:0;background:transparent" aria-label="Nom du projet">
      </div>
      <button class="btn btn--light btn--sm" id="pdel">Supprimer le projet</button>
    </div>
    <ol class="stepper">${STEPS.map((s, i) => `
      <li><button data-step="${i + 1}" class="${i + 1 === step ? "active" : i + 1 < step ? "done" : ""}" ${canReach(i + 1) ? "" : "disabled"}>
        <span class="n">${i + 1}</span><span class="t">${s}</span></button></li>`).join("")}
    </ol>
    <div id="stepbody"></div>`;
    $("#pname", view).addEventListener("input", (e) => {
      room.name = e.target.value;
      save();
    });
    $("#pdel", view).onclick = async () => {
      if (await confirmDialog("Supprimer définitivement ce projet et ses rendus ?", "Supprimer")) {
        await api.deleteRoom(room.id);
        location.hash = "#/";
      }
    };
    $$("[data-step]", view).forEach((b) => b.onclick = () => go(b.dataset.step));
    const body = $("#stepbody", view);
    const ctx = { room, body, save, flush, go };
    [step1, step2, step3, step4][step - 1](ctx);
  }
  function step1({ room, body, save, go }) {
    body.innerHTML = `
    <div class="layout">
      <div class="panel">
        <h3>Photos de la pièce</h3>
        <p class="muted small">Ajoutez une ou plusieurs photos. La photo marquée « Vue principale » sera retouchée par l'IA : prenez-la à hauteur d'yeux, en mode paysage, pièce bien éclairée.</p>
        <div class="choice">
          <button type="button" data-cam><span class="ico">📷</span><strong>Prendre une photo</strong></button>
          <button type="button" data-imp><span class="ico">🖼️</span><strong>Importer des photos</strong></button>
        </div>
        <div class="dropzone" id="rdrop"><strong>Glissez-déposez vos photos ici</strong><span class="muted small">JPEG, PNG ou WebP</span></div>
        <input type="file" id="rfile" accept="image/*" multiple hidden>
        <div class="thumbs" id="rthumbs"></div>
      </div>
      <div class="sticky">
        <form class="panel" id="rform">
          <h3>Informations</h3>
          <div class="field"><label>Type de pièce</label>
            <select name="category">${store.categories.map((c) => `<option value="${c.id}" ${c.id === room.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input name="length" type="number" min="100" max="5000" required value="${room.dims.length ?? ""}"></div></div>
          <div class="field"><label>Largeur</label><div class="unit" data-unit="cm"><input name="width" type="number" min="100" max="5000" required value="${room.dims.width ?? ""}"></div></div>
          <div class="field"><label>Hauteur sous plafond</label><div class="unit" data-unit="cm"><input name="height" type="number" min="150" max="1000" required value="${room.dims.height ?? ""}"></div></div>
          <p class="hint muted small">Longueur = mur de gauche à droite sur le plan, largeur = profondeur de la pièce.</p>
          <button class="btn btn--block btn--lg" type="submit">Générer le plan →</button>
        </form>
      </div>
    </div>`;
    const drawThumbs = () => {
      $("#rthumbs", body).innerHTML = room.photos.map((p, i) => `
      <div class="thumb ${i === (room.refPhoto || 0) ? "ref" : ""}">
        <img ${src(p.media)} alt="">
        ${i === (room.refPhoto || 0) ? '<span class="thumb__tag">Vue principale</span>' : ""}
        <div class="thumb__actions">
          <button type="button" title="Définir comme vue principale" data-ref="${i}">★</button>
          <button type="button" title="Supprimer" data-rm="${i}">✕</button>
        </div>
      </div>`).join("");
    };
    const add = async (files) => {
      try {
        toast("Enregistrement des photos…");
        room.photos.push(...await uploadImages(files));
        drawThumbs();
        save();
      } catch (e) {
        toast(e.message, "err");
      }
    };
    drawThumbs();
    bindDropzone($("#rdrop", body), $("#rfile", body), add);
    $("[data-imp]", body).onclick = () => $("#rfile", body).click();
    $("[data-cam]", body).onclick = async () => {
      const s = await capturePhotos({ title: "Photographier la pièce" });
      if (s?.length) add(s);
    };
    $("#rthumbs", body).addEventListener("click", (e) => {
      const r = e.target.closest("[data-ref]");
      const d = e.target.closest("[data-rm]");
      if (r) room.refPhoto = Number(r.dataset.ref);
      if (d) {
        const i = Number(d.dataset.rm);
        room.photos.splice(i, 1);
        if ((room.refPhoto || 0) >= room.photos.length || i === room.refPhoto) room.refPhoto = 0;
        else if (i < room.refPhoto) room.refPhoto--;
      }
      drawThumbs();
      save();
    });
    const form = $("#rform", body);
    form.addEventListener("input", () => {
      room.category = form.category.value;
      room.dims = { length: num(form.length.value), width: num(form.width.value), height: num(form.height.value) };
      save();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!room.photos.length) return toast("Ajoutez au moins une photo de la pièce", "err");
      if (!form.reportValidity()) return;
      room.plan = room.plan ? clampPlan(room.plan, room.dims) : defaultPlan(room.dims);
      go(2);
    });
  }
  function planBlock() {
    return `
    <div class="plan-wrap">
      <div class="plan-toolbar">
        <button class="btn btn--light btn--sm" data-rot="-90" title="Pivoter de -90°">⟲ 90°</button>
        <button class="btn btn--light btn--sm" data-rot="-15">⟲ 15°</button>
        <button class="btn btn--light btn--sm" data-rot="15">15° ⟳</button>
        <button class="btn btn--light btn--sm" data-rot="90">90° ⟳</button>
        <span class="sep"></span>
        <span class="muted small">Glissez les meubles · poignée ronde = rotation · Maj = sans aimantation</span>
      </div>
      <div id="planhost"></div>
      <div class="plan-legend">
        <span><i style="background:#e4ddd1;border-color:#8a8172"></i>Meuble présent</span>
        <span><i style="background:rgba(10,61,124,.16);border-color:#0a3d7c"></i>Nouveau meuble</span>
        <span><i style="background:#f7e6e4;border-color:#b3261e;border-style:dashed"></i>Retiré / remplacé</span>
        <span><i style="background:#e08a00;border-color:#e08a00;border-radius:50%"></i>Point de vue de la photo</span>
        <span>Trait épais = face avant</span>
      </div>
    </div>`;
  }
  function itemPropsCommon(it) {
    return `
    <div class="grid-3">
      <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input data-p="w" type="number" min="10" value="${Math.round(it.w)}"></div></div>
      <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-p="d" type="number" min="10" value="${Math.round(it.d)}"></div></div>
      <div class="field"><label>Rotation</label><div class="unit" data-unit="°"><input data-p="rot" type="number" step="5" value="${Math.round(it.rot || 0)}"></div></div>
    </div>`;
  }
  function bindProps(panel, it, editor, save, onAny) {
    panel.addEventListener("input", (e) => {
      const p = e.target.dataset.p;
      if (!p) return;
      if (e.target.type === "checkbox") it[p] = e.target.checked;
      else if (e.target.type === "number") {
        const v = num(e.target.value);
        if (v === void 0) return;
        it[p] = p === "rot" ? (v % 360 + 360) % 360 : v;
      } else it[p] = e.target.value;
      clampItem(it, editor.L, editor.W);
      editor.render();
      save();
      onAny?.(p);
    });
  }
  function step2({ room, body, save, go }) {
    body.innerHTML = `
    <div class="layout">
      <div>${planBlock()}</div>
      <div class="sticky" id="side"></div>
    </div>
    <div class="footer-actions">
      <button class="btn btn--light" data-back>← La pièce</button>
      <button class="btn btn--lg" data-next>Continuer vers l'aménagement →</button>
    </div>`;
    const editor = new PlanEditor($("#planhost", body), {
      room,
      mode: "existing",
      onSelect: () => side(),
      onChange: () => {
        save();
        side();
      }
    });
    $$("[data-rot]", body).forEach((b) => b.onclick = () => editor.rotateSelected(Number(b.dataset.rot)));
    $("[data-back]", body).onclick = () => go(1);
    $("[data-next]", body).onclick = () => go(3);
    function side() {
      const sel = room.plan.items.find((i) => i.id === editor.selected && i.kind === "existing");
      const existing = room.plan.items.filter((i) => i.kind === "existing");
      const el = $("#side", body);
      el.innerHTML = `
      <div class="panel panel--sand">
        <h3>Point de vue</h3>
        <p class="small">Placez l'icône orange là où la <strong>vue principale</strong> a été prise et orientez-la avec la poignée ronde. L'IA s'en sert pour situer les meubles dans la photo.</p>
        <div class="thumbs" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
          ${room.photos.map((p, i) => `<button class="thumb ${i === (room.refPhoto || 0) ? "ref" : ""}" data-ref="${i}" style="padding:0;cursor:pointer" title="Choisir comme vue principale"><img ${src(p.media)} alt=""></button>`).join("")}
        </div>
      </div>
      ${sel ? `
      <div class="panel" id="props">
        <h3>${esc(sel.name)}</h3>
        <div class="field"><label>Nom</label><input data-p="name" value="${esc(sel.name)}"></div>
        ${itemPropsCommon(sel)}
        <label class="check"><input type="checkbox" data-p="remove" ${sel.remove ? "checked" : ""}> Retirer ce meuble de la photo</label>
        <button class="btn btn--danger btn--sm" data-del>Supprimer du plan</button>
      </div>` : ""}
      <div class="panel">
        <h3>Meubles déjà présents</h3>
        <ul class="item-list">${existing.map((i) => `<li data-sel="${i.id}" class="${i.id === editor.selected ? "sel" : ""}"><span class="dot" style="background:${i.remove ? "#b3261e" : "#8a8172"}"></span>${esc(i.name)}<span class="meta">${Math.round(i.w)}×${Math.round(i.d)}</span></li>`).join("") || `<li class="muted small" style="cursor:default">Aucun meuble pour l'instant.</li>`}</ul>
        <form id="addex" class="grid-2">
          <div class="field" style="grid-column:1/-1;margin-bottom:8px"><label>Ajouter un meuble présent</label><input name="name" placeholder="Ex. Canapé, table…" required></div>
          <div class="field" style="margin-bottom:8px"><div class="unit" data-unit="cm"><input name="w" type="number" min="10" placeholder="Longueur" required></div></div>
          <div class="field" style="margin-bottom:8px"><div class="unit" data-unit="cm"><input name="d" type="number" min="10" placeholder="Profondeur" required></div></div>
          <div class="field" style="grid-column:1/-1"><button class="btn btn--ghost btn--sm btn--block">Ajouter au plan</button></div>
        </form>
        <button class="btn btn--light btn--block btn--sm" data-ai>✨ Détecter les meubles sur mes photos (IA)</button>
      </div>`;
      el.querySelectorAll("[data-ref]").forEach((b) => b.onclick = () => {
        room.refPhoto = Number(b.dataset.ref);
        save();
        side();
      });
      el.querySelectorAll("[data-sel]").forEach((li) => li.onclick = () => editor.select(li.dataset.sel));
      if (sel) {
        bindProps($("#props", el), sel, editor, save, (p) => {
          if (p === "name" || p === "remove") {
            editor.render();
          }
        });
        $("[data-del]", el).onclick = () => {
          room.plan.items = room.plan.items.filter((i) => i.id !== sel.id);
          room.plan.items.forEach((i) => {
            if (i.replacesId === sel.id) delete i.replacesId;
          });
          editor.select(null);
          save();
        };
      }
      $("#addex", el).addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target;
        const it = { id: "e" + uid2(), kind: "existing", name: f.name.value.trim(), w: num(f.w.value), d: num(f.d.value), h: 80, x: room.dims.length / 2, y: room.dims.width / 2, rot: 0 };
        clampItem(it, room.dims.length, room.dims.width);
        room.plan.items.push(it);
        save();
        editor.select(it.id);
      });
      $("[data-ai]", el).onclick = async (e) => {
        if (!await ensureAIReady()) return;
        if (room.plan.items.some((i) => i.kind === "existing") && !await confirmDialog("Remplacer les meubles présents du plan par ceux détectés par l'IA ?", "Remplacer", false)) return;
        busy(e.target, true, "Analyse des photos…");
        try {
          await persist(room);
          const out = await api.analyzeRoom(room.id);
          const keepNew = room.plan.items.filter((i) => i.kind === "new");
          keepNew.forEach((i) => delete i.replacesId);
          room.plan.items = [...out.items, ...keepNew];
          if (out.camera) room.plan.camera = out.camera;
          save();
          editor.select(null);
          toast(`${out.items.length} meuble(s) détecté(s). Ajustez leur position si besoin.`, "ok");
        } catch (err) {
          toast(err.message, "err");
          busy(e.target, false);
        }
      };
    }
    side();
  }
  var persist = (room) => api.updateRoom(room.id, { plan: room.plan, refPhoto: room.refPhoto, dims: room.dims, photos: room.photos });
  function step3({ room, body, save, flush, go }) {
    const furnCache = /* @__PURE__ */ new Map();
    const getF = async (id) => {
      if (!id) return null;
      if (!furnCache.has(id)) furnCache.set(id, await api.getFurniture(id).catch(() => null));
      return furnCache.get(id);
    };
    const preselect = new URLSearchParams(location.hash.split("?")[1] || "").get("item");
    body.innerHTML = `
    <div class="layout">
      <div>${planBlock()}</div>
      <div class="sticky" id="side"></div>
    </div>
    <div class="footer-actions">
      <button class="btn btn--light" data-back>← Le plan</button>
      <button class="btn btn--lg" data-gen>Valider et générer l'image ✨</button>
    </div>`;
    const editor = new PlanEditor($("#planhost", body), {
      room,
      mode: "new",
      onSelect: () => side(),
      onChange: () => {
        save();
        const it = room.plan.items.find((i) => i.id === editor.selected);
        const r = $("#props [data-p=rot]", body);
        if (it && r) r.value = Math.round(it.rot || 0);
      }
    });
    $$("[data-rot]", body).forEach((b) => b.onclick = () => {
      editor.rotateSelected(Number(b.dataset.rot));
      side();
    });
    $("[data-back]", body).onclick = () => go(2);
    const generate = async (btn) => {
      const news = room.plan.items.filter((i) => i.kind === "new");
      const removals = room.plan.items.some((i) => i.kind === "existing" && i.remove);
      if (!news.length && !removals && !room.extraInstructions?.trim()) return toast("Ajoutez au moins un meuble à intégrer", "err");
      if (!await ensureAIReady()) return;
      busy(btn, true, "Préparation…");
      await flush();
      startGeneration(room);
      go(4);
    };
    $("[data-gen]", body).onclick = (e) => generate(e.target);
    async function addFurniture(f, forcedReplace) {
      if (!f || f === "deleted") return;
      furnCache.set(f.id, f);
      const existing = room.plan.items.filter((i) => i.kind === "existing" && !room.plan.items.some((n) => n.replacesId === i.id));
      let replacesId = forcedReplace || null;
      if (!forcedReplace && existing.length) {
        replacesId = await new Promise((resolve) => {
          let r;
          const m = modal({
            title: "Comment placer ce meuble ?",
            onClose: () => resolve(r),
            content: `
            <p><strong>${esc(f.name)}</strong> <span class="muted">· ${furnitureDims(f)}</span></p>
            <div class="choice" style="grid-template-columns:1fr">
              <button data-free><span class="ico">✥</span><strong>Le placer librement</strong><span class="small muted">Vous le déplacez où vous voulez sur le plan</span></button>
            </div>
            <h3 style="margin-top:20px">Ou remplacer un meuble existant</h3>
            <div class="choice">${existing.map((e) => `<button data-rep="${e.id}"><span class="ico">⇄</span><strong>${esc(e.name)}</strong><span class="small muted">${Math.round(e.w)}×${Math.round(e.d)} cm</span></button>`).join("")}</div>`
          });
          m.el.querySelector("[data-free]").onclick = () => {
            r = null;
            m.close();
          };
          m.el.querySelectorAll("[data-rep]").forEach((b) => b.onclick = () => {
            r = b.dataset.rep;
            m.close();
          });
        });
      }
      const it = {
        id: "n" + uid2(),
        kind: "new",
        furnitureId: f.id,
        name: f.name,
        w: f.length || 100,
        d: f.width || 60,
        h: f.height || 80,
        x: room.dims.length / 2,
        y: room.dims.width / 2,
        rot: 0,
        keepOriginal: true
      };
      const rep = replacesId && room.plan.items.find((i) => i.id === replacesId);
      if (rep) {
        it.x = rep.x;
        it.y = rep.y;
        it.rot = rep.rot || 0;
        it.replacesId = rep.id;
      } else {
        const c = room.plan.camera;
        const vx = c.x - it.x, vy = c.y - it.y;
        it.rot = (Math.round(Math.atan2(-vx, vy) * 180 / Math.PI / 15) * 15 + 360) % 360;
      }
      clampItem(it, room.dims.length, room.dims.width);
      room.plan.items.push(it);
      save();
      editor.select(it.id);
    }
    async function side() {
      const el = $("#side", body);
      const news = room.plan.items.filter((i) => i.kind === "new");
      const sel = news.find((i) => i.id === editor.selected);
      const existing = room.plan.items.filter((i) => i.kind === "existing");
      const f = sel ? await getF(sel.furnitureId) : null;
      if (sel && editor.selected !== sel.id) return;
      const selEx = existing.find((i) => i.id === editor.selected);
      const replacer = selEx && news.find((n) => n.replacesId === selEx.id);
      el.innerHTML = `
      <div class="panel">
        <h3>Ajouter un meuble</h3>
        <div class="choice">
          <button data-shoot><span class="ico">📷</span><strong>Photo en direct</strong></button>
          <button data-lib><span class="ico">📚</span><strong>Bibliothèque</strong></button>
        </div>
        ${news.length ? `<ul class="item-list" style="margin-top:12px">${news.map((i) => `<li data-sel="${i.id}" class="${i.id === editor.selected ? "sel" : ""}"><span class="dot" style="background:${i.keepOriginal ? "#0a3d7c" : i.color || "#0a3d7c"}"></span>${esc(i.name)}<span class="meta">${i.replacesId ? "remplace" : "libre"}</span></li>`).join("")}</ul>` : '<p class="muted small" style="margin-top:12px">Aucun nouveau meuble. Ajoutez-en un, puis placez-le sur le plan.</p>'}
      </div>
      ${sel ? selPanel(sel, f, existing) : ""}
      ${selEx ? `<div class="panel panel--sand">
        <h3>${esc(selEx.name)}</h3>
        ${replacer ? `<p class="small">Remplacé par <strong>${esc(replacer.name)}</strong>.</p><button class="btn btn--light btn--sm" data-sel="${replacer.id}">Voir le nouveau meuble</button>` : `<p class="small">Meuble présent dans la pièce. Remplacez-le par un meuble :</p>
        <div class="choice"><button data-repshoot><span class="ico">📷</span><strong>Photo en direct</strong></button><button data-replib><span class="ico">📚</span><strong>Bibliothèque</strong></button></div>`}
      </div>` : ""}
      <div class="panel panel--sand">
        <h3>Instructions pour l'IA</h3>
        <div class="field" style="margin:0"><textarea id="extra" placeholder="Optionnel. Ex. : ajouter un plaid beige sur le canapé, garder le tapis.">${esc(room.extraInstructions || "")}</textarea></div>
      </div>`;
      el.querySelectorAll("[data-sel]").forEach((li) => li.onclick = () => editor.select(li.dataset.sel));
      $("[data-lib]", el).onclick = async () => addFurniture(await pickFurniture({ category: room.category }));
      $("[data-shoot]", el).onclick = async () => {
        const shots = await capturePhotos({ title: "Photographier le meuble à intégrer" });
        if (!shots?.length) return;
        addFurniture(await openFurnitureForm({ defaults: { category: room.category }, files: shots }));
      };
      $("#extra", el).addEventListener("input", (e) => {
        room.extraInstructions = e.target.value;
        save();
      });
      $("[data-replib]", el)?.addEventListener("click", async () => addFurniture(await pickFurniture({ category: room.category }), selEx.id));
      $("[data-repshoot]", el)?.addEventListener("click", async () => {
        const shots = await capturePhotos({ title: "Photographier le meuble à intégrer" });
        if (shots?.length) addFurniture(await openFurnitureForm({ defaults: { category: room.category }, files: shots }), selEx.id);
      });
      if (!sel) return;
      const panel = $("#props", el);
      bindProps(panel, sel, editor, save, (p) => {
        if (p === "keepOriginal") {
          panel.querySelector("#look").classList.toggle("hidden", sel.keepOriginal);
        }
        if (p === "replacesId") {
          const rep = room.plan.items.find((i) => i.id === sel.replacesId);
          if (rep) {
            sel.x = rep.x;
            sel.y = rep.y;
            sel.rot = rep.rot || 0;
            clampItem(sel, editor.L, editor.W);
          }
          if (!sel.replacesId) delete sel.replacesId;
          editor.render();
          save();
          side();
        }
      });
      panel.querySelectorAll("[data-color]").forEach((b) => b.onclick = () => {
        sel.color = b.dataset.color;
        sel.colorName = b.title;
        sel.keepOriginal = false;
        save();
        side();
      });
      $("#cpick", panel).addEventListener("change", (e) => {
        sel.color = e.target.value;
        sel.colorName = "";
        sel.keepOriginal = false;
        save();
        side();
      });
      panel.querySelectorAll("[data-tex]").forEach((b) => b.onclick = () => {
        const t = b.dataset.tex;
        if (sel.texture === t) {
          delete sel.texture;
          delete sel.textureEn;
        } else {
          sel.texture = t;
          sel.textureEn = TEXTURE_EN[t] || t;
        }
        sel.keepOriginal = false;
        save();
        side();
      });
      $("#texfile", panel).addEventListener("change", async (e) => {
        if (!e.target.files.length) return;
        try {
          const [p] = await uploadImages(e.target.files);
          sel.textureImage = p.media;
          sel.keepOriginal = false;
          save();
          side();
        } catch (err) {
          toast(err.message, "err");
        }
      });
      $("[data-rmtex]", panel)?.addEventListener("click", () => {
        delete sel.textureImage;
        save();
        side();
      });
      $("[data-edit]", panel)?.addEventListener("click", async () => {
        const res = await openFurnitureForm({ furniture: f });
        if (res && res !== "deleted") {
          furnCache.set(res.id, res);
          sel.name = res.name;
          if (res.length) sel.w = res.length;
          if (res.width) sel.d = res.width;
          clampItem(sel, editor.L, editor.W);
          editor.render();
          save();
          side();
        }
      });
      $("[data-swap]", panel).onclick = async () => {
        const nf = await pickFurniture({ category: room.category });
        if (!nf || nf === "deleted") return;
        furnCache.set(nf.id, nf);
        Object.assign(sel, { furnitureId: nf.id, name: nf.name, w: nf.length || sel.w, d: nf.width || sel.d, h: nf.height || sel.h });
        clampItem(sel, editor.L, editor.W);
        editor.render();
        save();
        side();
      };
      $("[data-del]", panel).onclick = () => {
        room.plan.items = room.plan.items.filter((i) => i.id !== sel.id);
        save();
        editor.select(null);
      };
    }
    function selPanel(sel, f, existing) {
      const cover = f?.photos?.[f.cover || 0]?.media;
      const taken = new Set(room.plan.items.filter((i) => i.kind === "new" && i.id !== sel.id && i.replacesId).map((i) => i.replacesId));
      return `
      <div class="panel" id="props">
        <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
          <div style="width:84px;aspect-ratio:4/3;background:var(--sand);flex:none">${cover ? `<img ${src(cover)} style="width:100%;height:100%;object-fit:cover">` : ""}</div>
          <div><strong>${esc(sel.name)}</strong><div class="muted small">${f ? furnitureDims(f) : "Meuble supprimé de la bibliothèque"}</div>
            <div class="btn-row" style="gap:6px;margin-top:6px">${f ? '<button class="btn btn--light btn--sm" data-edit>Fiche</button>' : ""}<button class="btn btn--light btn--sm" data-swap>Changer</button></div></div>
        </div>
        <div class="field"><label>Placement</label>
          <select data-p="replacesId">
            <option value="">Placement libre</option>
            ${existing.filter((e) => !taken.has(e.id)).map((e) => `<option value="${e.id}" ${sel.replacesId === e.id ? "selected" : ""}>Remplace : ${esc(e.name)}</option>`).join("")}
          </select></div>
        ${itemPropsCommon(sel)}
        <h3 style="margin-top:8px">Couleur et matière</h3>
        <label class="check"><input type="checkbox" data-p="keepOriginal" ${sel.keepOriginal ? "checked" : ""}> Conserver le coloris d'origine</label>
        <div id="look" class="${sel.keepOriginal ? "hidden" : ""}">
          <div class="swatches">${COLORS.map((c) => `<button class="swatch ${sel.color === c.hex ? "sel" : ""}" style="background:${c.hex}" title="${c.name}" data-color="${c.hex}"></button>`).join("")}</div>
          <div class="color-row" style="margin-bottom:14px"><input type="color" id="cpick" value="${sel.color || "#9b8b7a"}"><span class="small">${sel.color ? `Choisi : <strong>${esc(sel.colorName || sel.color)}</strong>` : "Couleur personnalisée"}</span></div>
          <div class="textures">${TEXTURES.map((t) => `<button class="texture ${sel.texture === t.name ? "sel" : ""}" data-tex="${t.name}"><div class="sw" style="background:${t.css}"></div>${t.name}</button>`).join("")}</div>
          <div class="field">
            <label>Échantillon de matière (photo)</label>
            ${sel.textureImage ? `<div style="display:flex;gap:10px;align-items:center"><img ${src(sel.textureImage)} style="width:60px;height:45px;object-fit:cover"><button class="btn btn--light btn--sm" data-rmtex>Retirer</button></div>` : ""}
            <input type="file" id="texfile" accept="image/*">
          </div>
        </div>
        <div class="field"><label>Précisions</label><input data-p="notes" value="${esc(sel.notes || "")}" placeholder="Ex. coussins assortis, pieds noirs"></div>
        <button class="btn btn--danger btn--sm" data-del>Retirer ce meuble</button>
      </div>`;
    }
    if (preselect && room.plan.items.some((i) => i.id === preselect)) editor.select(preselect);
    else side();
  }
  function startGeneration(room) {
    const p = api.generate(room.id, room.extraInstructions || "").then((r) => ({ ok: true, render: r })).catch((e) => ({ ok: false, error: e.message })).finally(() => setTimeout(() => pending.delete(room.id), 0));
    pending.set(room.id, p);
    return p;
  }
  async function step4({ room, body, go }) {
    const ref = room.photos[room.refPhoto || 0] || room.photos[0];
    let current = room.renders[0] || null;
    let error = null;
    const draw = (loading) => {
      if (loading) {
        body.innerHTML = `
        <div class="loader" style="aspect-ratio:${ref ? `${ref.w}/${ref.h}` : "4/3"};max-height:70vh;margin:0 auto">
          ${ref ? `<img ${src(ref.media)} alt="">` : ""}
          <div><div class="spinner"></div><h2>Création de votre rendu…</h2>
          <p class="muted">L'IA intègre vos meubles dans la photo de la pièce.<br>Cela prend généralement 20 à 60 secondes.<br><strong>Gardez l'application ouverte</strong> pendant la création.</p></div>
        </div>`;
        return;
      }
      body.innerHTML = `
      ${error ? `<div class="alert"><strong>La génération a échoué.</strong><br>${esc(error)}${/Réglages|Clé API/i.test(error) ? ' <a href="#/reglages">Ouvrir les réglages</a>' : ""}</div>` : ""}
      <div class="layout">
        <div>
          ${current ? `
            <div class="compare" id="cmp">
              <img ${src(ref?.media || current.media)} alt="Avant">
              <div class="after" style="clip-path:inset(0 0 0 50%)"><img ${src(current.media)} alt="Après"></div>
              <span class="tag" style="left:12px">Avant</span><span class="tag" style="right:12px">Après</span>
              <div class="bar" style="left:50%"></div>
            </div>
            <p class="muted small" style="margin-top:8px">Faites glisser le curseur pour comparer avant / après.</p>` : '<div class="empty">Aucun rendu pour le moment.</div>'}
          ${room.renders.length > 1 ? `
            <h3 style="margin-top:28px">Historique des rendus</h3>
            <div class="history">${room.renders.map((r) => `<button data-r="${r.id}" class="${r.id === current?.id ? "sel" : ""}" title="${new Date(r.createdAt).toLocaleString("fr-FR")}"><img ${src(r.media)} alt="">${r.saved ? '<span class="star">★</span>' : ""}</button>`).join("")}</div>` : ""}
        </div>
        <div class="sticky">
          ${current ? `
          <div class="panel">
            <h3>Votre rendu</h3>
            <p class="muted small">Généré le ${new Date(current.createdAt).toLocaleString("fr-FR")}${current.saved ? ' · <strong style="color:var(--blue)">Sauvegardé</strong>' : ""}</p>
            <div style="display:grid;gap:10px">
              <button class="btn btn--block" data-save>${current.saved ? "★ Sauvegardé (retirer)" : "☆ Sauvegarder le rendu"}</button>
              <button class="btn btn--ghost btn--block" data-dl>Enregistrer / partager l'image</button>
              <button class="btn btn--light btn--block" data-layout>Modifier l'aménagement</button>
              <button class="btn btn--light btn--block" data-furn>Modifier le meuble (couleur, matière…)</button>
              <button class="btn btn--light btn--block" data-again>↻ Générer une autre version</button>
              ${current.planSnapshot ? `<button class="btn btn--light btn--block btn--sm" data-restore>Reprendre l'aménagement de ce rendu</button>` : ""}
              <button class="btn btn--danger btn--block btn--sm" data-delr>Supprimer ce rendu</button>
            </div>
          </div>
          <details class="prompt panel"><summary>Instructions envoyées à l'IA</summary><pre>${esc(current.prompt || "")}</pre></details>` : `<div class="panel"><button class="btn btn--block" data-again>Lancer la génération</button><button class="btn btn--light btn--block" style="margin-top:10px" data-layout>Modifier l'aménagement</button></div>`}
        </div>
      </div>`;
      bind();
    };
    function bind() {
      const cmp = $("#cmp", body);
      if (cmp) {
        const after = $(".after", cmp), bar = $(".bar", cmp);
        const set = (clientX) => {
          const r = cmp.getBoundingClientRect();
          const p = Math.min(100, Math.max(0, (clientX - r.left) / r.width * 100));
          after.style.clipPath = `inset(0 0 0 ${p}%)`;
          bar.style.left = p + "%";
        };
        let dragging = false;
        cmp.addEventListener("pointerdown", (e) => {
          dragging = true;
          cmp.setPointerCapture(e.pointerId);
          set(e.clientX);
        });
        cmp.addEventListener("pointermove", (e) => dragging && set(e.clientX));
        cmp.addEventListener("pointerup", () => dragging = false);
      }
      $$("[data-r]", body).forEach((b) => b.onclick = () => {
        current = room.renders.find((r) => r.id === b.dataset.r);
        error = null;
        draw();
      });
      $("[data-layout]", body)?.addEventListener("click", () => go(3));
      $("[data-furn]", body)?.addEventListener("click", () => {
        const first = room.plan.items.find((i) => i.kind === "new");
        go(3, first ? `?item=${first.id}` : "");
      });
      $("[data-again]", body)?.addEventListener("click", async () => {
        if (await ensureAIReady()) run(startGeneration(room));
      });
      $("[data-dl]", body)?.addEventListener("click", async () => {
        const blob = await getMediaBlob(current.media);
        if (!blob) return toast("Image introuvable sur cet appareil", "err");
        const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        const name = `amenagement-${room.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "rendu"}.${ext}`;
        await shareOrDownload(blob, name, room.name);
      });
      $("[data-save]", body)?.addEventListener("click", async () => {
        const r = await api.updateRender(room.id, current.id, { saved: !current.saved });
        Object.assign(current, r);
        toast(r.saved ? "Rendu sauvegardé dans le projet" : "Rendu retiré des sauvegardes", "ok");
        draw();
      });
      $("[data-restore]", body)?.addEventListener("click", async () => {
        if (!await confirmDialog("Remplacer l'aménagement actuel par celui de ce rendu ?", "Reprendre", false)) return;
        room.plan = structuredClone(current.planSnapshot);
        await api.updateRoom(room.id, { plan: room.plan });
        go(3);
      });
      $("[data-delr]", body)?.addEventListener("click", async () => {
        if (!await confirmDialog("Supprimer ce rendu ?", "Supprimer")) return;
        await api.deleteRender(room.id, current.id);
        room.renders = room.renders.filter((r) => r.id !== current.id);
        current = room.renders[0] || null;
        draw();
      });
    }
    async function run(promise) {
      error = null;
      draw(true);
      const res = await promise;
      if (!body.isConnected) return;
      if (res.ok) {
        if (!room.renders.some((r) => r.id === res.render.id)) room.renders.unshift(res.render);
        current = room.renders.find((r) => r.id === res.render.id);
        toast("Rendu prêt !", "ok");
      } else error = res.error;
      draw();
    }
    if (pending.has(room.id)) run(pending.get(room.id));
    else draw();
  }

  // js/quick.js
  init_api();
  init_media();
  var pending2 = /* @__PURE__ */ new Map();
  async function ensureAIReady2() {
    store.status = await api.status();
    if (!store.status.configured) {
      if (await confirmDialog("Aucune clé API n'est renseignée sur cet appareil. Ouvrir les réglages pour l'ajouter ?", "Ouvrir les réglages", false)) location.hash = "#/reglages";
      return false;
    }
    if (!navigator.onLine) {
      toast("Pas de connexion internet : l'IA n'est pas disponible hors ligne.", "err");
      return false;
    }
    return true;
  }
  function pickImages({ camera, multiple = false, title }) {
    if (camera) return capturePhotos({ title });
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = multiple;
      input.onchange = () => resolve([...input.files]);
      input.click();
    });
  }
  async function renderQuick(view, { id }) {
    if (!id || id === "nouveau") {
      const room2 = await api.createRoom({ name: "Rendu rapide", mode: "quick", quick: { action: "replace", furniture: { photos: [] } } });
      location.replace(`#/rapide/${room2.id}`);
      return;
    }
    let room;
    try {
      room = await api.room(id);
    } catch {
      view.innerHTML = '<div class="empty">Projet introuvable. <a href="#/">Retour à mes projets</a></div>';
      return;
    }
    room.quick ??= { action: "replace", furniture: { photos: [] } };
    room.quick.furniture ??= { photos: [] };
    room.renders ??= [];
    const q = room.quick;
    let saveTimer = null;
    const persist2 = () => api.updateRoom(room.id, { name: room.name, photos: room.photos, quick: room.quick, mode: "quick" }).catch((e) => toast("Sauvegarde impossible : " + e.message, "err"));
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist2, 400);
    };
    const flush = async () => {
      clearTimeout(saveTimer);
      await persist2();
    };
    let current = room.renders[0] || null;
    let showResult = Boolean(current) || pending2.has(room.id);
    let loading = false;
    let tool = "zone";
    let error = null;
    view.innerHTML = `
    <div class="project-head">
      <div style="flex:1;min-width:240px">
        <span class="eyebrow">Rendu rapide</span>
        <input class="input" id="pname" value="${esc(room.name)}" style="font-family:var(--serif);font-size:28px;border:0;padding:0;background:transparent" aria-label="Nom du projet">
      </div>
      <button class="btn btn--light btn--sm" id="pdel">Supprimer</button>
    </div>
    <div class="layout quick">
      <div id="stage"></div>
      <div class="sticky" id="steps"></div>
    </div>`;
    $("#pname", view).addEventListener("input", (e) => {
      room.name = e.target.value;
      save();
    });
    $("#pdel", view).onclick = async () => {
      if (await confirmDialog("Supprimer définitivement ce projet et ses rendus ?", "Supprimer")) {
        await api.deleteRoom(room.id);
        location.hash = "#/";
      }
    };
    const stage = $("#stage", view);
    const steps = $("#steps", view);
    const photo = () => room.photos?.[0] || null;
    const ready = () => photo() && q.zone && q.furniture.photos.length;
    function drawSteps() {
      const p = photo();
      const fp = q.furniture.photos;
      const f = q.furniture;
      steps.innerHTML = `
      <div class="panel qstep ${p ? "done" : "todo"}">
        <h3><span class="n">1</span>Photo de la pièce</h3>
        ${p ? '<p class="small muted">Photo ajoutée. Vous pouvez la remplacer.</p>' : `<p class="small">Prise à hauteur d'yeux, en mode paysage, pièce bien éclairée.</p>`}
        <div class="choice"><button data-room-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-room-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
      </div>

      <div class="panel qstep ${q.zone ? "done" : p ? "todo" : "off"}">
        <h3><span class="n">2</span>La zone</h3>
        ${p ? `<p class="small">${q.zone ? "Zone tracée. Glissez-la pour la déplacer, ou tracez-en une nouvelle." : "<strong>Tracez un rectangle sur la photo</strong> à l'endroit où placer le meuble."}</p>
          <p class="small muted">Le meuble doit passer <strong>derrière</strong> un autre (table basse, fauteuil…) ? Choisissez « Objet devant, à garder » au-dessus de la photo et entourez cet objet.${(q.keep || []).length ? ` <strong>${q.keep.length} objet(s) gardé(s) devant.</strong>` : ""}</p>
          <div class="seg">
            <button data-action="replace" class="${q.action !== "add" ? "sel" : ""}">Remplacer ce qui s'y trouve</button>
            <button data-action="add" class="${q.action === "add" ? "sel" : ""}">Ajouter sans rien retirer</button>
          </div>` : `<p class="small muted">Ajoutez d'abord la photo de la pièce.</p>`}
      </div>

      <div class="panel qstep ${fp.length ? "done" : "todo"}">
        <h3><span class="n">3</span>Photo du meuble</h3>
        ${fp.length ? `<div class="qthumbs">${fp.map((x, i) => `<div class="thumb"><img ${src(x.media)} alt=""><div class="thumb__actions"><button title="Retirer" data-frm="${i}">✕</button></div></div>`).join("")}</div>` : '<p class="small">Le meuble entier, net, de face ou de trois-quarts. Une 2e photo sous un autre angle peut aider.</p>'}
        <div class="choice"><button data-f-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-f-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
        <details class="qmore" ${f.name || f.length || f.width || f.height || f.notes ? "open" : ""}>
          <summary>Nom et dimensions (facultatif)</summary>
          <div class="field" style="margin-top:12px"><label>Nom</label><input data-f="name" value="${esc(f.name || "")}" placeholder="Ex. Canapé 3 places Milano"></div>
          <div class="grid-3">
            <div class="field"><label>Long.</label><div class="unit" data-unit="cm"><input data-f="length" type="number" min="1" value="${f.length ?? ""}"></div></div>
            <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-f="width" type="number" min="1" value="${f.width ?? ""}"></div></div>
            <div class="field"><label>Haut.</label><div class="unit" data-unit="cm"><input data-f="height" type="number" min="1" value="${f.height ?? ""}"></div></div>
          </div>
          <div class="field" style="margin:0"><label>Précisions</label><input data-f="notes" value="${esc(f.notes || "")}" placeholder="Ex. pieds noirs, coussins assortis"></div>
        </details>
      </div>

      <div class="panel qstep ${q.texture ? "done" : "opt"}">
        <h3><span class="n">4</span>Texture <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">· facultatif</span></h3>
        ${q.texture ? `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><img ${src(q.texture.media)} alt="" style="width:84px;height:63px;object-fit:cover"><button class="btn btn--light btn--sm" data-trm>Retirer</button></div>` : `<p class="small">Photo d'un tissu, d'un cuir ou d'un bois : le meuble sera rendu dans cette matière.</p>`}
        <div class="choice"><button data-t-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-t-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
        <div class="field" style="margin:0"><label>Matière ou couleur en mots</label><input id="tnotes" value="${esc(q.textureNotes || "")}" placeholder="Ex. velours vert sauge"></div>
      </div>

      <div class="panel panel--sand">
        <div class="field"><label>Instructions pour l'IA (facultatif)</label><textarea id="qextra" placeholder="Ex. garder le tapis, ajouter un plaid beige">${esc(q.extraInstructions || "")}</textarea></div>
        <button class="btn btn--block btn--lg" data-gen ${ready() && !loading ? "" : "disabled"}>${loading ? "Création en cours…" : current ? "↻ Relancer le rendu ✨" : "Lancer le rendu ✨"}</button>
        ${!ready() ? `<p class="muted small" style="margin:10px 0 0">Il manque : ${[!p && "la photo de la pièce", p && !q.zone && "la zone", !fp.length && "la photo du meuble"].filter(Boolean).join(", ")}.</p>` : ""}
      </div>`;
      const addRoom = async (camera) => {
        const files = await pickImages({ camera, title: "Photographier la pièce" });
        if (!files?.length) return;
        try {
          const [ph] = await storeImages([files[0]]);
          if (photo() && q.zone && !await confirmDialog("Remplacer la photo de la pièce ? La zone tracée sera effacée.", "Remplacer", false)) return;
          room.photos = [ph];
          delete q.zone;
          delete q.keep;
          showResult = false;
          save();
          drawAll();
        } catch (e) {
          toast(e.message, "err");
        }
      };
      $("[data-room-cam]", steps).onclick = () => addRoom(true);
      $("[data-room-imp]", steps).onclick = () => addRoom(false);
      $$("[data-action]", steps).forEach((b) => b.onclick = () => {
        q.action = b.dataset.action;
        save();
        drawSteps();
      });
      const addFurn = async (camera) => {
        const files = await pickImages({ camera, multiple: true, title: "Photographier le meuble" });
        if (!files?.length) return;
        try {
          q.furniture.photos.push(...await storeImages(files.slice(0, 3)));
          q.furniture.photos = q.furniture.photos.slice(-3);
          save();
          drawSteps();
        } catch (e) {
          toast(e.message, "err");
        }
      };
      $("[data-f-cam]", steps).onclick = () => addFurn(true);
      $("[data-f-imp]", steps).onclick = () => addFurn(false);
      $$("[data-frm]", steps).forEach((b) => b.onclick = () => {
        q.furniture.photos.splice(Number(b.dataset.frm), 1);
        save();
        drawSteps();
      });
      $$("[data-f]", steps).forEach((inp) => inp.addEventListener("input", () => {
        const k = inp.dataset.f;
        q.furniture[k] = inp.type === "number" ? num(inp.value) : inp.value;
        save();
      }));
      const addTex = async (camera) => {
        const files = await pickImages({ camera, title: "Photographier la matière" });
        if (!files?.length) return;
        try {
          [q.texture] = await storeImages([files[0]]);
          save();
          drawSteps();
        } catch (e) {
          toast(e.message, "err");
        }
      };
      $("[data-t-cam]", steps).onclick = () => addTex(true);
      $("[data-t-imp]", steps).onclick = () => addTex(false);
      $("[data-trm]", steps)?.addEventListener("click", () => {
        delete q.texture;
        save();
        drawSteps();
      });
      $("#tnotes", steps).addEventListener("input", (e) => {
        q.textureNotes = e.target.value;
        save();
      });
      $("#qextra", steps).addEventListener("input", (e) => {
        q.extraInstructions = e.target.value;
        save();
      });
      $("[data-gen]", steps).onclick = async () => {
        if (!ready() || !await ensureAIReady2()) return;
        await flush();
        const p2 = api.generateQuick(room.id).then((r) => ({ ok: true, render: r })).catch((e) => ({ ok: false, error: e.message })).finally(() => setTimeout(() => pending2.delete(room.id), 0));
        pending2.set(room.id, p2);
        run(p2);
      };
    }
    function drawStage() {
      const p = photo();
      if (loading) {
        stage.innerHTML = `
        <div class="loader" style="aspect-ratio:${p ? `${p.w}/${p.h}` : "4/3"};max-height:70vh;margin:0 auto">
          ${p ? `<img ${src(p.media)} alt="">` : ""}
          <div><div class="spinner"></div><h2>Création de votre rendu…</h2>
          <p class="muted">Cela prend généralement 20 à 60 secondes.<br><strong>Gardez l'application ouverte</strong> pendant la création.</p></div>
        </div>`;
        return;
      }
      if (showResult && current) return drawResult();
      if (!p) {
        stage.innerHTML = `<div class="dropzone qempty" data-drop><strong>Commencez par la photo de la pièce</strong><span class="muted small">Touchez « Prendre » ou « Importer » à droite, ou déposez une image ici.</span></div>`;
        const z = $("[data-drop]", stage);
        z.onclick = () => $("[data-room-imp]", steps).click();
        ["dragenter", "dragover"].forEach((ev) => z.addEventListener(ev, (e) => {
          e.preventDefault();
          z.classList.add("drag");
        }));
        ["dragleave", "drop"].forEach((ev) => z.addEventListener(ev, (e) => {
          e.preventDefault();
          z.classList.remove("drag");
        }));
        z.addEventListener("drop", async (e) => {
          const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
          if (f) {
            room.photos = await storeImages([f]);
            delete q.zone;
            save();
            drawAll();
          }
        });
        return;
      }
      const keep = q.keep || [];
      stage.innerHTML = `
      ${error ? `<div class="alert"><strong>Le rendu a échoué.</strong><br>${esc(error)}${/Réglages|Clé API/i.test(error) ? ' <a href="#/reglages">Ouvrir les réglages</a>' : ""}</div>` : ""}
      <div class="seg tools" style="margin-bottom:10px">
        <button data-tool="zone" class="${tool === "zone" ? "sel" : ""}">▭ Zone du nouveau meuble</button>
        <button data-tool="keep" class="${tool === "keep" ? "sel keep" : ""}">▭ Objet devant, à garder</button>
      </div>
      <div class="zone-editor ${tool === "keep" ? "tool-keep" : ""}" id="zed">
        <img ${src(p.media)} alt="Photo de la pièce" draggable="false">
        <div class="zone ${q.zone ? "" : "hidden"}"><span>${q.action === "add" ? "Ajouter ici" : "Remplacer ici"}</span></div>
        ${keep.map((k, i) => `<div class="keepbox" style="left:${k.x * 100}%;top:${k.y * 100}%;width:${k.w * 100}%;height:${k.h * 100}%"><span>Devant</span><button data-krm="${i}" aria-label="Retirer">×</button></div>`).join("")}
      </div>
      <div class="btn-row" style="margin-top:10px;justify-content:space-between">
        <span class="muted small">${tool === "keep" ? "Entourez chaque objet qui doit rester <strong>devant</strong> le nouveau meuble (table basse, fauteuil, plante…). Il ne sera ni retiré ni modifié." : "Tracez la zone avec le doigt ou la souris, y compris la partie du meuble cachée derrière un autre objet."}</span>
        <span class="btn-row">
          ${q.zone ? '<button class="btn btn--light btn--sm" data-zclear>Effacer la zone</button>' : ""}
          ${current ? '<button class="btn btn--ghost btn--sm" data-showres>Voir le rendu</button>' : ""}
        </span>
      </div>`;
      bindZone($("#zed", stage));
      $$("[data-tool]", stage).forEach((b) => b.onclick = () => {
        tool = b.dataset.tool;
        drawStage();
      });
      $("[data-zclear]", stage)?.addEventListener("click", () => {
        delete q.zone;
        save();
        drawAll();
      });
      $("[data-showres]", stage)?.addEventListener("click", () => {
        showResult = true;
        drawStage();
      });
    }
    function bindZone(ed) {
      const box = $(".zone", ed);
      let ghost = null;
      const place = (el, z) => {
        el.style.left = `${z.x * 100}%`;
        el.style.top = `${z.y * 100}%`;
        el.style.width = `${z.w * 100}%`;
        el.style.height = `${z.h * 100}%`;
        el.classList.remove("hidden");
      };
      if (q.zone) place(box, q.zone);
      const rel = (e) => {
        const r = ed.getBoundingClientRect();
        return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
      };
      let drag = null;
      ed.addEventListener("pointerdown", (e) => {
        const rm = e.target.closest("[data-krm]");
        if (rm) {
          q.keep.splice(Number(rm.dataset.krm), 1);
          save();
          drawAll();
          return;
        }
        e.preventDefault();
        ed.setPointerCapture(e.pointerId);
        const P = rel(e);
        const z = q.zone;
        if (tool === "zone" && z && P.x > z.x && P.x < z.x + z.w && P.y > z.y && P.y < z.y + z.h) drag = { type: "move", ox: P.x - z.x, oy: P.y - z.y };
        else drag = { type: "draw", sx: P.x, sy: P.y };
        if (tool === "keep") {
          ghost = document.createElement("div");
          ghost.className = "keepbox hidden";
          ed.appendChild(ghost);
        }
      });
      ed.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const P = rel(e);
        if (drag.type === "move") {
          const z = q.zone;
          z.x = Math.min(1 - z.w, Math.max(0, P.x - drag.ox));
          z.y = Math.min(1 - z.h, Math.max(0, P.y - drag.oy));
          place(box, z);
        } else {
          drag.z = { x: Math.min(drag.sx, P.x), y: Math.min(drag.sy, P.y), w: Math.abs(P.x - drag.sx), h: Math.abs(P.y - drag.sy) };
          place(tool === "keep" ? ghost : box, drag.z);
        }
      });
      const end = () => {
        if (!drag) return;
        const wasDraw = drag.type === "draw";
        const big = drag.z && drag.z.w > 0.02 && drag.z.h > 0.02;
        if (wasDraw && tool === "keep") {
          if (big) {
            q.keep = [...q.keep || [], drag.z].slice(-4);
          }
          ghost?.remove();
          ghost = null;
        } else if (wasDraw) {
          if (big && drag.z.w > 0.03 && drag.z.h > 0.03) q.zone = drag.z;
          else if (q.zone) place(box, q.zone);
          else box.classList.add("hidden");
        }
        drag = null;
        save();
        if (wasDraw) drawAll();
      };
      ed.addEventListener("pointerup", end);
      ed.addEventListener("pointercancel", end);
    }
    function drawResult() {
      const p = photo();
      stage.innerHTML = `
      ${error ? `<div class="alert"><strong>Le rendu a échoué.</strong><br>${esc(error)}</div>` : ""}
      <div class="compare" id="cmp">
        <img ${src(p?.media || current.media)} alt="Avant">
        <div class="after" style="clip-path:inset(0 0 0 50%)"><img ${src(current.media)} alt="Après"></div>
        <span class="tag" style="left:12px">Avant</span><span class="tag" style="right:12px">Après</span>
        <div class="bar" style="left:50%"></div>
      </div>
      <p class="muted small" style="margin-top:8px">Faites glisser le curseur pour comparer avant / après.</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ${current.saved ? "" : "btn--ghost"} btn--sm" data-save>${current.saved ? "★ Sauvegardé" : "☆ Sauvegarder"}</button>
        <button class="btn btn--ghost btn--sm" data-dl>Enregistrer / partager l'image</button>
        <button class="btn btn--light btn--sm" data-edit>Modifier la zone</button>
        <button class="btn btn--danger btn--sm" data-delr>Supprimer ce rendu</button>
      </div>
      ${room.renders.length > 1 ? `<h3 style="margin-top:24px">Historique</h3>
        <div class="history">${room.renders.map((r) => `<button data-r="${r.id}" class="${r.id === current.id ? "sel" : ""}"><img ${src(r.media)} alt="">${r.saved ? '<span class="star">★</span>' : ""}</button>`).join("")}</div>` : ""}
      <details class="prompt panel" style="margin-top:20px"><summary>Instructions envoyées à l'IA</summary><pre>${esc(current.prompt || "")}</pre></details>`;
      const cmp = $("#cmp", stage);
      const after = $(".after", cmp), bar = $(".bar", cmp);
      const set = (x) => {
        const r = cmp.getBoundingClientRect();
        const v = Math.min(100, Math.max(0, (x - r.left) / r.width * 100));
        after.style.clipPath = `inset(0 0 0 ${v}%)`;
        bar.style.left = v + "%";
      };
      let dragging = false;
      cmp.addEventListener("pointerdown", (e) => {
        dragging = true;
        cmp.setPointerCapture(e.pointerId);
        set(e.clientX);
      });
      cmp.addEventListener("pointermove", (e) => dragging && set(e.clientX));
      cmp.addEventListener("pointerup", () => dragging = false);
      $$("[data-r]", stage).forEach((b) => b.onclick = () => {
        current = room.renders.find((r) => r.id === b.dataset.r);
        error = null;
        drawStage();
      });
      $("[data-edit]", stage).onclick = () => {
        showResult = false;
        error = null;
        drawStage();
      };
      $("[data-save]", stage).onclick = async () => {
        Object.assign(current, await api.updateRender(room.id, current.id, { saved: !current.saved }));
        toast(current.saved ? "Rendu sauvegardé" : "Rendu retiré des sauvegardes", "ok");
        drawStage();
      };
      $("[data-dl]", stage).onclick = async () => {
        const blob = await getMediaBlob(current.media);
        if (!blob) return toast("Image introuvable sur cet appareil", "err");
        const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
        await shareOrDownload(blob, `rendu-${room.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "rapide"}.${ext}`, room.name);
      };
      $("[data-delr]", stage).onclick = async () => {
        if (!await confirmDialog("Supprimer ce rendu ?", "Supprimer")) return;
        await api.deleteRender(room.id, current.id);
        room.renders = room.renders.filter((r) => r.id !== current.id);
        current = room.renders[0] || null;
        showResult = Boolean(current);
        drawAll();
      };
    }
    async function run(promise) {
      loading = true;
      error = null;
      showResult = true;
      drawAll();
      const res = await promise;
      loading = false;
      if (!view.isConnected) return;
      if (res.ok) {
        if (!room.renders.some((r) => r.id === res.render.id)) room.renders.unshift(res.render);
        current = room.renders.find((r) => r.id === res.render.id);
        toast("Rendu prêt !", "ok");
      } else {
        error = res.error;
        showResult = false;
      }
      drawAll();
    }
    function drawAll() {
      drawStage();
      drawSteps();
    }
    if (pending2.has(room.id)) run(pending2.get(room.id));
    else drawAll();
  }

  // js/settings.js
  init_api();
  init_providers();
  var isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  var isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  var fmt2 = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : `${Math.round(n / 1e6)} Mo`;
  async function renderSettings(view) {
    const settings = await api.settings();
    let providerId = getProvider(settings.provider).id;
    const [rooms, furniture] = await Promise.all([api.rooms(), api.furniture()]);
    const renders = rooms.reduce((s, r) => s + (r.renders?.length || 0), 0);
    view.innerHTML = `
    <div class="section-head"><div><span class="eyebrow">Réglages</span><h1>Réglages de cet appareil</h1></div></div>
    <div class="settings">
      <section class="panel">
        <h3>Moteur d'images IA</h3>
        <form id="sform" autocomplete="off">
          <div class="field ${PROVIDERS.length < 2 ? "hidden" : ""}"><label>Fournisseur</label>
            <select id="provider">${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === providerId ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></div>
          <div id="pfields"></div>
          <div class="btn-row">
            <button class="btn" type="submit">Enregistrer</button>
            <button class="btn btn--ghost" type="button" data-test>Tester la clé</button>
          </div>
          <div id="testout" class="small" style="margin-top:12px"></div>
        </form>
        <div class="alert alert--info small" style="margin-top:20px">
          La clé est enregistrée <strong>uniquement sur cet appareil</strong> et n'est jamais incluse dans les fichiers exportés.
          Les images sont envoyées directement de l'appareil à Google, sans intermédiaire.
          Conseils : dans Google Cloud, limitez la clé à l'API « Generative Language » et fixez un plafond de dépense (Facturation › Budgets et alertes).
        </div>
      </section>

      <section class="panel">
        <h3>Installation et stockage</h3>
        <div id="install"></div>
        <dl class="kv" id="storage"><dt>Stockage utilisé</dt><dd>…</dd></dl>
        <dl class="kv">
          <dt>Projets</dt><dd>${rooms.length} (${renders} rendu${renders > 1 ? "s" : ""})</dd>
          <dt>Meubles</dt><dd>${furniture.length}</dd>
          <dt>Version</dt><dd>${APP_VERSION}</dd>
        </dl>
      </section>

      <section class="panel">
        <h3>Sauvegarde et transfert</h3>
        <p class="small">Les données ne sont stockées que sur cet appareil. Faites une sauvegarde de temps en temps (iCloud Drive, Google Drive…) : elle permet aussi de tout transférer vers un autre appareil.</p>
        <div class="btn-row">
          <button class="btn btn--ghost" data-backup>Créer une sauvegarde complète</button>
          <button class="btn btn--light" data-restore>Restaurer / importer un fichier</button>
        </div>
        <p class="muted small" style="margin-top:10px">Pour ne partager que la bibliothèque de meubles : <a href="#/bibliotheque">Bibliothèque › Partager</a>.</p>
        ${"webkitdirectory" in document.createElement("input") && !matchMedia("(pointer: coarse)").matches ? `
        <hr>
        <h3>Reprendre l'ancienne version</h3>
        <p class="small">Sur l'ordinateur qui faisait tourner l'ancienne version (serveur Node.js), choisissez son dossier <strong>data</strong> (il contient db.json, uploads et renders). Projets, rendus et bibliothèque seront copiés ici.</p>
        <button class="btn btn--light" data-legacy>Choisir le dossier « data »…</button>` : ""}
      </section>
    </div>`;
    const drawFields = () => {
      const p = getProvider(providerId);
      const cfg = providerConfig(settings, p.id);
      $("#pfields", view).innerHTML = `
      ${p.help ? `<p class="small">${p.help}</p>` : ""}
      ${p.fields.map((f) => {
        const v = cfg[f.key] ?? "";
        if (f.type === "select") {
          return `<div class="field"><label>${esc(f.label)}</label><select name="${f.key}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(lab)}</option>`).join("")}</select>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`;
        }
        const list = f.suggestions ? `list="dl-${f.key}"` : "";
        return `<div class="field"><label>${esc(f.label)}</label>
          <div class="${f.type === "secret" ? "secret" : ""}">
            <input name="${f.key}" ${list} type="${f.type === "secret" ? "password" : "text"}" value="${esc(v)}" placeholder="${esc(f.placeholder || f.default || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">
            ${f.type === "secret" ? '<button type="button" class="btn btn--light btn--sm" data-reveal>Afficher</button>' : ""}
          </div>
          ${f.suggestions ? `<datalist id="dl-${f.key}">${f.suggestions.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>` : ""}
          ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ""}</div>`;
      }).join("")}`;
      $$("[data-reveal]", view).forEach((b) => b.onclick = () => {
        const inp = b.previousElementSibling;
        inp.type = inp.type === "password" ? "text" : "password";
        b.textContent = inp.type === "password" ? "Afficher" : "Masquer";
      });
    };
    drawFields();
    const readForm = () => {
      const p = getProvider(providerId);
      const form = $("#sform", view);
      const cfg = {};
      p.fields.forEach((f) => {
        cfg[f.key] = String(form.elements[f.key]?.value ?? "").trim();
      });
      return cfg;
    };
    const saveForm = async () => {
      settings.provider = providerId;
      settings.providers = { ...settings.providers || {}, [providerId]: readForm() };
      await api.saveSettings(settings);
      await refreshStatusLine();
    };
    $("#provider", view).onchange = (e) => {
      providerId = e.target.value;
      drawFields();
      $("#testout", view).innerHTML = "";
    };
    $("#sform", view).addEventListener("submit", async (e) => {
      e.preventDefault();
      await saveForm();
      toast("Réglages enregistrés", "ok");
    });
    $("[data-test]", view).onclick = async (e) => {
      const p = getProvider(providerId);
      const cfg = { ...providerConfig(settings, p.id), ...readForm() };
      const out = $("#testout", view);
      if (!p.isConfigured(cfg)) {
        out.innerHTML = `<span class="err-text">Renseignez d'abord la clé.</span>`;
        return;
      }
      if (!p.test) {
        out.textContent = "Test non disponible pour ce fournisseur.";
        return;
      }
      busy(e.currentTarget, true, "Test…");
      try {
        const r = await p.test(cfg);
        await saveForm();
        const model = cfg.imageModel;
        const found = !r.imageModels || !model || r.imageModels.includes(model);
        out.innerHTML = `<span class="ok-text">✓ Clé valide, enregistrée.</span>
        ${r.imageModels ? `<br>Modèles d'image accessibles : ${r.imageModels.map(esc).join(", ") || "aucun"}.` : ""}
        ${!found ? `<br><span class="err-text">Le modèle « ${esc(model)} » n'apparaît pas dans la liste : vérifiez son nom.</span>` : ""}
        <br><span class="muted">Le test ne vérifie pas la facturation : une première génération le confirmera.</span>`;
        const dl = $("#dl-imageModel", view);
        if (dl && r.imageModels?.length) dl.innerHTML = r.imageModels.map((x) => `<option value="${esc(x)}">`).join("");
        const dt = $("#dl-textModel", view);
        if (dt && r.textModels?.length) dt.innerHTML = r.textModels.map((x) => `<option value="${esc(x)}">`).join("");
      } catch (err) {
        out.innerHTML = `<span class="err-text">✕ ${esc(err.message)}</span>`;
      }
      busy(e.currentTarget, false);
    };
    const drawInstall = async () => {
      const persisted = await navigator.storage?.persisted?.().catch(() => false);
      const el = $("#install", view);
      if (isStandalone()) {
        el.innerHTML = `<p class="small"><span class="ok-text">✓ Application installée.</span> ${persisted ? "Stockage protégé contre l'effacement automatique." : ""}</p>`;
      } else if (isIOS()) {
        el.innerHTML = `<div class="alert small"><strong>À faire sur iPad :</strong> installez l'application, sinon Safari peut effacer les données après quelques semaines sans visite.
        Dans Safari : bouton <strong>Partager</strong> (carré avec une flèche) › <strong>Sur l'écran d'accueil</strong>, puis ouvrez l'app depuis l'icône.
        <br>Attention : l'app installée a son propre stockage, distinct de l'onglet Safari. Installez-la <em>avant</em> de saisir vos données (ou faites une sauvegarde ici, puis restaurez-la dans l'app).</div>`;
      } else {
        el.innerHTML = `<p class="small">Pour installer l'application sur cet ordinateur : icône d'installation dans la barre d'adresse (Chrome, Edge), ou menu Fichier › Ajouter au Dock (Safari sur Mac).</p>`;
      }
      if (!persisted && navigator.storage?.persist) {
        el.insertAdjacentHTML("beforeend", '<button class="btn btn--light btn--sm" data-persist>Protéger le stockage de cet appareil</button>');
        $("[data-persist]", el).onclick = async () => {
          const ok = await navigator.storage.persist().catch(() => false);
          toast(ok ? "Stockage protégé" : "Le navigateur a refusé (installez l'application puis réessayez).", ok ? "ok" : "err");
          drawInstall();
        };
      }
      const est = await navigator.storage?.estimate?.().catch(() => null);
      if (est) $("#storage", view).innerHTML = `<dt>Stockage utilisé</dt><dd>${fmt2(est.usage || 0)}${est.quota ? ` sur ${fmt2(est.quota)} disponibles` : ""}</dd>`;
    };
    drawInstall();
    $("[data-backup]", view).onclick = (e) => exportBackupDialog(e.currentTarget);
    $("[data-restore]", view).onclick = async () => {
      if (await pickAndImport()) renderSettings(view);
    };
    $("[data-legacy]", view)?.addEventListener("click", async () => {
      if (await pickLegacyFolder()) renderSettings(view);
    });
  }
  async function refreshStatusLine() {
    const st = await store.refreshStatus().catch(() => ({ configured: false }));
    const el = document.getElementById("status-line");
    if (!el) return;
    const offline = !navigator.onLine ? " · Hors ligne (génération indisponible)" : "";
    el.innerHTML = st.configured ? `Moteur IA : ${esc(st.imageModel)}${offline}` : `<a href="#/reglages">Clé API à renseigner dans les Réglages</a>${offline}`;
  }

  // js/app.js
  init_media();
  init_db();
  var app = document.getElementById("app");
  var HERO_SVG = `
<svg viewBox="0 0 400 260" fill="none" stroke="#0a3d7c" stroke-width="2" stroke-linejoin="round">
  <rect x="30" y="30" width="340" height="200" fill="#fff" stroke-width="5"/>
  <g stroke="#e3ded5" stroke-width="1">${Array.from({ length: 6 }, (_, i) => `<line x1="${30 + (i + 1) * 48.5}" y1="30" x2="${30 + (i + 1) * 48.5}" y2="230"/>`).join("")}${Array.from({ length: 3 }, (_, i) => `<line x1="30" y1="${30 + (i + 1) * 50}" x2="370" y2="${30 + (i + 1) * 50}"/>`).join("")}</g>
  <rect x="60" y="50" width="140" height="50" rx="4" fill="rgba(10,61,124,.15)"/><line x1="64" y1="100" x2="196" y2="100" stroke-width="5"/>
  <rect x="95" y="125" width="70" height="40" rx="3" fill="#e4ddd1" stroke="#8a8172"/>
  <rect x="270" y="60" width="70" height="110" rx="3" fill="#e4ddd1" stroke="#8a8172"/>
  <path d="M200 225 L150 150 A90 90 0 0 1 250 150 Z" fill="rgba(224,138,0,.12)" stroke="#e08a00" stroke-dasharray="5 4"/>
  <rect x="190" y="212" width="20" height="16" rx="3" fill="#e08a00" stroke="#fff"/>
</svg>`;
  async function renderHome(view) {
    const rooms = await api.rooms();
    const saved = rooms.flatMap((r) => (r.renders || []).filter((x) => x.saved).map((x) => ({ ...x, room: r })));
    const cover = (r) => (r.renders || []).find((x) => x.saved)?.media || r.renders?.[0]?.media || r.photos?.[r.refPhoto || 0]?.media;
    const lastStep = (r) => !r.plan ? 1 : r.renders?.length ? 4 : r.plan.items?.some((i) => i.kind === "new") ? 3 : 2;
    view.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">Studio d'aménagement IA</span>
        <h1>Imaginez votre nouveau meuble, <em>chez vous</em>.</h1>
        <p>Photographiez votre pièce, renseignez ses dimensions, placez vos meubles sur le plan, choisissez coloris et matières : l'IA crée une image réaliste de votre intérieur réaménagé.</p>
        <div class="btn-row" style="margin-top:28px">
          <a class="btn btn--lg" href="#/rapide/nouveau">Rendu rapide</a>
          <a class="btn btn--ghost btn--lg" href="#/projet/nouveau">Projet complet</a>
        </div>
        <p class="muted small" style="margin-top:14px"><strong>Rendu rapide</strong> : photo de la pièce, zone à remplacer, photo du meuble, c'est parti.
          <strong>Projet complet</strong> : dimensions, plan à l'échelle, plusieurs meubles et bibliothèque.</p>
      </div>
      <div class="hero__visual">${HERO_SVG}</div>
    </section>

    <div class="steps-intro">
      <div><h3>Votre pièce</h3><p class="muted small">Importez ou prenez des photos, indiquez longueur, largeur et hauteur.</p></div>
      <div><h3>Le plan</h3><p class="muted small">Un plan à l'échelle est généré : positionnez les meubles existants et le point de vue.</p></div>
      <div><h3>Vos meubles</h3><p class="muted small">Photographiez un meuble ou choisissez-le dans la bibliothèque, remplacez ou placez-le.</p></div>
      <div><h3>Le rendu</h3><p class="muted small">Générez l'image, comparez avant/après, sauvegardez ou modifiez.</p></div>
    </div>

    <div class="section-head"><h2>Mes projets</h2><a class="btn btn--ghost btn--sm" href="#/projet/nouveau">+ Nouveau projet</a></div>
    <div class="cards">
      <a class="card card--add" href="#/rapide/nouveau"><div><span>⚡</span>Rendu rapide</div></a>
      <a class="card card--add" href="#/projet/nouveau"><div><span>+</span>Projet complet</div></a>
      ${rooms.map((r) => `
        <a class="card" href="${r.mode === "quick" ? `#/rapide/${r.id}` : `#/projet/${r.id}/${lastStep(r)}`}">
          <div class="card__img">${cover(r) ? `<img ${src(cover(r))} alt="">` : '<span class="small">Pas encore de photo</span>'}</div>
          ${store.catName(r.category) ? `<span class="card__badge">${esc(store.catName(r.category))}</span>` : ""}
          <div class="card__body">
            <div class="card__title">${esc(r.name)}</div>
            <div class="card__meta">${r.mode === "quick" ? "Rendu rapide" : `${r.dims?.length || "–"} × ${r.dims?.width || "–"} cm`} · ${(r.renders || []).length} rendu(s)</div>
            <div class="card__meta">Modifié le ${new Date(r.updatedAt).toLocaleDateString("fr-FR")}</div>
          </div>
        </a>`).join("")}
    </div>

    ${saved.length ? `
      <div class="section-head" style="margin-top:56px"><h2>Rendus sauvegardés</h2></div>
      <div class="cards">${saved.map((s) => `
        <a class="card" href="${s.room.mode === "quick" ? `#/rapide/${s.room.id}` : `#/projet/${s.room.id}/4`}">
          <div class="card__img"><img ${src(s.media)} alt=""></div>
          <div class="card__body"><div class="card__title">${esc(s.room.name)}</div><div class="card__meta">${new Date(s.createdAt).toLocaleString("fr-FR")}</div></div>
        </a>`).join("")}</div>` : ""}`;
  }
  async function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path] = hash.split("?");
    const parts = path.split("/").filter(Boolean);
    const view = document.createElement("div");
    app.replaceChildren(view);
    window.scrollTo(0, 0);
    $("#nav").classList.remove("open");
    let nav = "home";
    try {
      if (parts[0] === "projet") {
        nav = parts[1] === "nouveau" ? "project" : "";
        await renderProject(view, { id: parts[1], step: parts[2] });
      } else if (parts[0] === "rapide") {
        nav = parts[1] === "nouveau" || !parts[1] ? "quick" : "";
        await renderQuick(view, { id: parts[1] });
      } else if (parts[0] === "bibliotheque") {
        nav = "library";
        await renderLibrary(view);
      } else if (parts[0] === "reglages") {
        nav = "settings";
        await renderSettings(view);
      } else {
        await renderHome(view);
      }
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="alert">Une erreur est survenue : ${esc(e.message)}</div>`;
    }
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  }
  $("#burger").onclick = () => $("#nav").classList.toggle("open");
  window.addEventListener("hashchange", route);
  window.addEventListener("online", refreshStatusLine);
  window.addEventListener("offline", refreshStatusLine);
  function installBanner() {
    if (isStandalone() || !isIOS()) return;
    try {
      if (sessionStorage.getItem("hideInstall")) return;
    } catch {
    }
    const el = document.createElement("div");
    el.className = "install-banner";
    el.innerHTML = `<span><strong>Installez l'application</strong> pour garder vos données : bouton Partager <span aria-hidden="true">⎋</span> › « Sur l'écran d'accueil ». Puis ouvrez-la depuis l'icône.</span>
    <button class="icon-btn" aria-label="Masquer">×</button>`;
    el.querySelector("button").onclick = () => {
      el.remove();
      try {
        sessionStorage.setItem("hideInstall", "1");
      } catch {
      }
    };
    document.body.prepend(el);
  }
  function loadImage(base) {
    const exts = ["svg", "png", "webp"];
    return new Promise((resolve) => {
      const tryNext = (i) => {
        if (i >= exts.length) return resolve(null);
        const im = new Image();
        im.onload = () => resolve(im.src);
        im.onerror = () => tryNext(i + 1);
        im.src = `img/${base}.${exts[i]}`;
      };
      tryNext(0);
    });
  }
  async function setupLogo() {
    const brand = $("#brand");
    const imgs = [...brand.querySelectorAll("img[data-logo]")];
    const srcs = await Promise.all(imgs.map((im) => loadImage(im.dataset.logo)));
    if (srcs.every(Boolean)) {
      imgs.forEach((im, i) => {
        im.src = srcs[i];
      });
      brand.classList.add("brand--split", "brand--intro");
      setTimeout(() => brand.classList.remove("brand--intro"), 1400);
    }
    const header = document.querySelector(".header");
    let compact = false;
    const onScroll = () => {
      const y = window.scrollY;
      if (!compact && y > 80) {
        compact = true;
        header.classList.add("header--compact");
      } else if (compact && y < 20) {
        compact = false;
        header.classList.remove("header--compact");
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
  var updating = false;
  function registerSW() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      const offerUpdate = (w) => {
        const t = document.createElement("div");
        t.className = "toast update";
        t.innerHTML = 'Nouvelle version disponible. <button class="btn btn--sm">Mettre à jour</button>';
        t.querySelector("button").onclick = () => {
          updating = true;
          w.postMessage("skipWaiting");
        };
        document.getElementById("toast-root").appendChild(t);
      };
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {
        });
      });
    }).catch((e) => console.warn("Service worker non enregistré", e));
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updating) {
        updating = false;
        location.reload();
      }
    });
  }
  (async () => {
    try {
      await openDB();
    } catch (e) {
      app.innerHTML = `<div class="alert">Stockage local indisponible : ${esc(e.message)}<br>En navigation privée, le stockage est désactivé.</div>`;
      return;
    }
    startMediaObserver();
    setupLogo();
    registerSW();
    installBanner();
    if (isStandalone()) navigator.storage?.persist?.().catch(() => {
    });
    await store.loadCategories();
    await refreshStatusLine();
    route();
    setTimeout(async () => {
      try {
        await collectGarbage(await api.rooms(), await api.furniture());
      } catch (e) {
        console.warn(e);
      }
    }, 4e3);
  })();
})();
