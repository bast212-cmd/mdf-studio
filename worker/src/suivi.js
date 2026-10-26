// Page de suivi des rendus, servie par le relais sur /suivi.
// Les chiffres viennent de /suivi/data, protégé par le même code d'accès que l'application.
export const SUIVI_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>MDF Studio · Suivi des rendus</title>
<style>
  :root { --blue: #1d2740; --page: #f8f5f0; --line: #e4ddd1; --gray: #6e6e73; --cognac: #b5603f; --ok: #2e7d4f; --ko: #b3261e; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Montserrat, system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--page); color: #1d1d1f; font-size: 15px; }
  header { background: #fff; border-bottom: 1px solid var(--line); padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
  header strong { color: var(--blue); font-size: 18px; }
  header span { color: var(--gray); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
  h2 { color: var(--blue); font-size: 15px; text-transform: uppercase; letter-spacing: .08em; margin: 28px 0 12px; }
  .panel { background: #fff; border: 1px solid var(--line); padding: 18px 20px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .kpi b { display: block; font-size: 28px; color: var(--blue); font-weight: 600; margin-top: 4px; }
  .kpi span { color: var(--gray); font-size: 13px; }
  .bars { display: flex; align-items: flex-end; gap: 4px; height: 160px; padding-top: 8px; }
  .bar { flex: 1; min-width: 6px; background: var(--blue); position: relative; }
  .bar i { position: absolute; left: 0; right: 0; bottom: 0; background: var(--ko); }
  .axis { display: flex; justify-content: space-between; color: var(--gray); font-size: 11px; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--gray); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .ko { color: var(--ko); }
  .muted { color: var(--gray); font-size: 13px; }
  form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input { font: inherit; padding: 10px 12px; border: 1px solid var(--line); min-width: 220px; }
  button { font: inherit; font-weight: 600; background: var(--blue); color: #fff; border: 0; padding: 11px 18px; cursor: pointer; }
  .err { color: var(--ko); margin-top: 10px; }
  .hidden { display: none; }
</style>
</head>
<body>
<header><div><strong>MDF Studio</strong> <span>Suivi des rendus · 30 derniers jours</span></div><button id="logout" class="hidden" type="button">Changer de code</button></header>
<main>
  <section id="login" class="panel hidden">
    <form id="f"><input id="code" type="password" placeholder="Code d'accès du relais" autocomplete="current-password"><button>Voir le suivi</button></form>
    <p class="err hidden" id="lerr"></p>
  </section>
  <section id="setup" class="panel hidden">
    <p><strong>Le suivi n'est pas encore activé.</strong></p>
    <p class="muted">Créez la base D1 « mdf-studio-suivi » dans Cloudflare (Storage &amp; databases › D1), puis renseignez son identifiant dans worker/wrangler.toml (voir le README, section 3).</p>
  </section>
  <div id="out" class="hidden">
    <div class="kpis">
      <div class="panel kpi"><span>Appels à l'IA</span><b id="k-n">0</b></div>
      <div class="panel kpi"><span>Échecs</span><b id="k-ko">0</b></div>
      <div class="panel kpi"><span>Durée moyenne d'un rendu</span><b id="k-ms">–</b></div>
      <div class="panel kpi"><span>Coût estimé (indicatif)</span><b id="k-cost">–</b></div>
    </div>
    <h2>Par jour</h2>
    <div class="panel"><div class="bars" id="bars"></div><div class="axis"><span id="d0"></span><span>en rouge : échecs</span><span id="d1"></span></div></div>
    <h2>Par appareil</h2>
    <div class="panel"><table id="t-dev"></table></div>
    <h2>Par type d'appel et modèle</h2>
    <div class="panel"><table id="t-mod"></table></div>
    <h2>Derniers échecs</h2>
    <div class="panel"><table id="t-err"></table></div>
    <p class="muted">Coût estimé à partir du tarif public de Google par image générée (environ 0,04 $ pour les modèles Flash, 0,13 $ pour les modèles Pro, 0,002 $ pour une analyse ou un contrôle) : à rapprocher de la facture Google Cloud.</p>
  </div>
</main>
<script>
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { 'rendu-rapide': 'Rendu rapide', projet: 'Projet complet', rendu: 'Rendu', analyse: 'Analyse de la pièce', controle: 'Contrôle du rendu', autre: 'Autre' };
  const price = (kind, model) => (kind === 'analyse' || kind === 'controle' ? 0.002 : /pro/i.test(model || '') ? 0.134 : 0.039);
  const date = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  let code = '';
  try { code = localStorage.getItem('mdf-suivi-code') || ''; } catch (e) {}

  async function load() {
    const r = await fetch('suivi/data', { headers: { 'x-access-code': code } });
    const j = await r.json();
    if (!r.ok) {
      $('#login').classList.remove('hidden'); $('#out').classList.add('hidden'); $('#logout').classList.add('hidden');
      if (code) { $('#lerr').textContent = (j.error && j.error.message) || 'Accès refusé'; $('#lerr').classList.remove('hidden'); }
      return;
    }
    try { localStorage.setItem('mdf-suivi-code', code); } catch (e) {}
    $('#login').classList.add('hidden'); $('#logout').classList.remove('hidden');
    if (!j.configured) { $('#setup').classList.remove('hidden'); return; }
    $('#out').classList.remove('hidden');
    const t = j.totals;
    $('#k-n').textContent = t.n || 0;
    $('#k-ko').textContent = (t.ko || 0) + (t.n ? ' (' + Math.round(100 * (t.ko || 0) / t.n) + ' %)' : '');
    $('#k-ms').textContent = t.avg_ms ? Math.round(t.avg_ms / 1000) + ' s' : '–';
    const cost = j.models.reduce((s, m) => s + (m.ok || 0) * price(m.kind, m.model), 0);
    $('#k-cost').textContent = cost.toFixed(2).replace('.', ',') + ' $';
    // 30 barres, jours sans appel compris
    const byDay = Object.fromEntries(j.days.map((d) => [d.day, d]));
    const list = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); list.push(byDay[d] || { day: d, n: 0, ko: 0 }); }
    const max = Math.max(1, ...list.map((d) => d.n));
    $('#bars').innerHTML = list.map((d) => '<div class="bar" title="' + d.day + ' : ' + d.n + ' appel(s), ' + (d.ko || 0) + ' échec(s)" style="height:' + (100 * d.n / max) + '%"><i style="height:' + (d.n ? 100 * (d.ko || 0) / d.n : 0) + '%"></i></div>').join('');
    $('#d0').textContent = list[0].day.split('-').reverse().slice(0, 2).join('/');
    $('#d1').textContent = "aujourd'hui";
    $('#t-dev').innerHTML = '<tr><th>Appareil</th><th class="num">Appels</th><th class="num">Échecs</th><th class="num">Dernier</th></tr>'
      + (j.devices.map((d) => '<tr><td>' + esc(d.device) + '</td><td class="num">' + d.n + '</td><td class="num ' + (d.ko ? 'ko' : '') + '">' + (d.ko || 0) + '</td><td class="num">' + date(d.last) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">Aucun appel</td></tr>');
    $('#t-mod').innerHTML = '<tr><th>Type</th><th>Modèle</th><th class="num">Appels</th><th class="num">Réussis</th></tr>'
      + (j.models.map((m) => '<tr><td>' + esc(KIND[m.kind] || m.kind) + '</td><td>' + esc(m.model) + '</td><td class="num">' + m.n + '</td><td class="num">' + (m.ok || 0) + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">Aucun appel</td></tr>');
    $('#t-err').innerHTML = '<tr><th>Date</th><th>Appareil</th><th>Type</th><th>Erreur</th></tr>'
      + (j.errors.map((e) => '<tr><td>' + date(e.ts) + '</td><td>' + esc(e.device || '(sans nom)') + '</td><td>' + esc(KIND[e.kind] || e.kind) + '</td><td class="ko">' + e.status + ' · ' + esc(e.error || '') + '</td></tr>').join('') || '<tr><td colspan="4" class="muted">Aucun échec</td></tr>');
  }
  $('#f').onsubmit = (e) => { e.preventDefault(); code = $('#code').value.trim(); load(); };
  $('#logout').onclick = () => { code = ''; try { localStorage.removeItem('mdf-suivi-code'); } catch (e) {} location.reload(); };
  load().catch((e) => { $('#login').classList.remove('hidden'); $('#lerr').textContent = 'Erreur : ' + e.message; $('#lerr').classList.remove('hidden'); });
</script>
</body>
</html>`;
