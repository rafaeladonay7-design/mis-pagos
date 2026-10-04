"use strict";
const C = window.Calc;
const KEY = "mispagos.v1";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const numero = v => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return isFinite(n) ? n : NaN; };
const nuevoId = () => Math.random().toString(36).slice(2, 10);

// ---------- datos ----------
// Con Firebase configurado, cada persona entra con su cuenta y sus datos se guardan
// en la nube (usuarios/<uid>). Sin configurar, todo se queda en este teléfono.
const FB_CFG = window.FIREBASE_CONFIG || {};
const QUIERE_NUBE = !!FB_CFG.apiKey;
const NUBE = QUIERE_NUBE && !!window.firebase;
let auth = null, db = null, usuario = null, docRef = null, desuscribir = null;
let authListo = !QUIERE_NUBE, modoRegistro = false;
const llave = () => (usuario ? `${KEY}.${usuario.uid}` : KEY);

function cargarDe(k) {
  try { const t = localStorage.getItem(k); return t ? normalizarSeguro(JSON.parse(t)) : null; } catch { return null; }
}
const cargar = () => cargarDe(llave());
function nuevoEstado() {
  return {
    version: 1,
    ingreso: { monto: 0, frecuencia: "semanal", dia: 4, dia_mes: 30, inicio: C.iso(C.hoyLocal()) },
    regla_pago: "siguiente_habil", feriados_mexico: true, contar_desde: null, cuentas: [],
  };
}
let S = QUIERE_NUBE ? null : cargar();
let tab = ["inicio", "cobros", "cuentas", "ajustes"].find(t => t === new URLSearchParams(location.search).get("tab")) || "inicio";
let confirmarBorrado = false;

function guardar(msg) {
  try { localStorage.setItem(llave(), JSON.stringify(S)); }
  catch { if (!docRef) toast("No se pudo guardar en este dispositivo"); }
  if (docRef) subir();
  if (msg) toast(msg);
  render();
}

let toastTimer;
function toast(txt) {
  const t = $("#toast");
  t.textContent = txt; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
}

// ---------- utilidades de vista ----------
const FRECUENCIAS = { semanal: "Cada semana", catorcenal: "Cada 14 días", quincenal: "Cada quincena (15 y último día)", mensual: "Cada mes" };
function textoIngreso(ing) {
  if (!ing.monto) return "Sin configurar";
  const m = C.dinero(Number(ing.monto));
  if (ing.frecuencia === "semanal") return `${m} cada ${C.DIAS_LARGO[ing.dia]}`;
  if (ing.frecuencia === "catorcenal") return `${m} cada 14 días`;
  if (ing.frecuencia === "quincenal") return `${m} cada quincena`;
  return `${m} el día ${ing.dia_mes} de cada mes`;
}
function textoCuenta(c) {
  if (c.tipo === "tarjeta") {
    const lim = c.limite_tipo === "dia" ? `límite día ${c.dia_limite}` : `pagas ${c.dias_despues_corte} días después`;
    return `Corte día ${c.dia_corte} · ${lim}`;
  }
  return `Vence el día ${c.dia_limite} de cada mes`;
}
const cuando = (hoy, d) => { const n = C.diasEntre(hoy, d); return n === 0 ? "hoy" : n === 1 ? "mañana" : n < 0 ? `hace ${-n} días` : `en ${n} días`; };
const hecho = () => S && S.ingreso.monto > 0 && S.cuentas.length > 0;

// ---------- pantallas ----------
function render() {
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
  $("#tabs").hidden = !S;
  const app = $("#app");
  if (QUIERE_NUBE && !NUBE) { app.innerHTML = `<div class="card vacio" style="margin-top:40px"><p>Necesitas internet para abrir Mis Pagos la primera vez.</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`; return; }
  if (!authListo) { app.innerHTML = `<div class="vacio" style="margin-top:40px"><p>Cargando…</p></div>`; return; }
  if (NUBE && !usuario) { app.innerHTML = pantallaLogin(); return; }
  if (!S) { app.innerHTML = bienvenida(); return; }
  app.innerHTML = { inicio, cobros, cuentas, ajustes }[tab]();
}

function bienvenida() {
  return `<section class="bienvenida">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div class="stack"><h1>Mis Pagos</h1>
      <p class="hint" style="font-size:16px">Organiza tus tarjetas para pagar siempre el último día y saber cuánto te sobra de cada cobro.</p></div>
    <ol>
      <li><div><b>Pon lo que ganas</b><span>Cuánto te pagan y cada cuándo: semanal, quincenal, catorcenal o mensual.</span></div></li>
      <li><div><b>Agrega tus tarjetas y pagos</b><span>Fecha de corte, fecha límite y cuánto debes pagar.</span></div></li>
      <li><div><b>Mira tu plan</b><span>Qué pagar, cuándo y cuánto te queda libre cada cobro.</span></div></li>
    </ol>
    <div class="stack">
      <button class="btn block" data-accion="empezar">Empezar</button>
      <button class="btn ghost block" data-accion="importar">Tengo un respaldo</button>
    </div>
    <p class="hint">${usuario ? `Entraste como <b>${esc(usuario.email || "")}</b>. Tus datos se guardan en tu cuenta y solo tú los ves.` : "Tus datos se guardan solo en este teléfono. Nadie más los ve."}</p>
    ${usuario ? `<button class="enlace" data-accion="salir">¿No es tu cuenta? Cerrar sesión</button>` : ""}
  </section>`;
}

function pantallaLogin() {
  return `<section class="bienvenida">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div class="stack"><h1>Mis Pagos</h1>
      <p class="hint" style="font-size:16px">Entra para guardar tus tarjetas y pagos en tu cuenta y verlos en todos tus dispositivos.</p></div>
    <button class="btn block" data-accion="google">Entrar con Google</button>
    <div class="o"><span>o con tu correo</span></div>
    <form class="stack" id="f-login" novalidate>
      <label class="campo" for="l-correo">Correo<input id="l-correo" type="email" autocomplete="email" inputmode="email"></label>
      <label class="campo" for="l-clave">Contraseña<input id="l-clave" type="password" autocomplete="${modoRegistro ? "new-password" : "current-password"}"></label>
      <p class="error" id="l-error" hidden></p>
      <button class="btn block ghost">${modoRegistro ? "Crear cuenta" : "Entrar"}</button>
      <div class="row" style="justify-content:space-between">
        <button type="button" class="enlace" data-accion="modo-login">${modoRegistro ? "Ya tengo cuenta" : "Crear cuenta nueva"}</button>
        ${modoRegistro ? "" : `<button type="button" class="enlace" data-accion="olvide">Olvidé mi contraseña</button>`}
      </div>
    </form>
    <p class="hint">Solo tú puedes ver tus datos.</p>
  </section>`;
}

function inicio() {
  const hoy = C.hoyLocal();
  let h = `<header class="top"><h1>Mis Pagos</h1><p>${esc(C.DIAS_LARGO[C.wd(hoy)])} ${C.DD(hoy)} de ${C.MESES_LARGO[C.M(hoy) - 1]}</p></header>`;
  if (!S.ingreso.monto) h += `<div class="card vacio"><p>Primero dime cuánto ganas y cada cuándo te pagan.</p><button class="btn" data-accion="ingreso">Poner mi ingreso</button></div>`;
  if (!S.cuentas.length) h += `<div class="card vacio"><p>Agrega tu primera tarjeta o pago para ver tu plan.</p><div class="row"><button class="btn" data-accion="nueva-tarjeta">+ Tarjeta</button><button class="btn ghost" data-accion="nuevo-fijo">+ Pago fijo</button></div></div>`;
  if (!hecho()) return h;

  const P = C.plan(S, hoy);
  const proximo = P.pagos.find(p => !p.pagado && !p.pospuesto && p.pago >= hoy);
  const proxCobro = P.cobros[0];
  const mesRef = proxCobro ? proxCobro.fecha : hoy;
  const libreMes = P.cobros.filter(c => C.M(c.fecha) === C.M(mesRef) && C.Y(c.fecha) === C.Y(mesRef)).reduce((s, c) => s + c.libre, 0);
  const deuda = S.cuentas.reduce((s, c) => s + (Number(c.deuda_total) || 0), 0);

  h += `<section class="resumen" aria-label="Resumen">`;
  h += proximo
    ? `<div class="tile main"><span class="lbl">Próximo pago</span><span class="big num">${C.dinero(proximo.monto)}</span><span class="sub">${esc(proximo.nombre)} · ${C.fmt(proximo.pago)} (${cuando(hoy, proximo.pago)})</span></div>`
    : `<div class="tile main"><span class="lbl">Próximo pago</span><span class="big">Nada pendiente</span></div>`;
  if (proxCobro) h += `<div class="tile"><span class="lbl">Libre el ${C.fmt(proxCobro.fecha)}</span><span class="big num">${C.dinero(proxCobro.libre)}</span><span class="sub">de ${C.dinero(P.ingreso)}</span></div>`;
  h += `<div class="tile"><span class="lbl">Te sobra en ${C.MESES_LARGO[C.M(mesRef) - 1]}</span><span class="big num">${C.dinero(libreMes)}</span><span class="sub">con todo pagado</span></div>`;
  if (deuda > 0) h += `<div class="tile" style="grid-column:1/-1"><span class="lbl">Deuda total</span><span class="big num">${C.dinero(deuda)}</span><span class="sub">suma de lo que debes en tus cuentas</span></div>`;
  h += `</section>`;

  for (const p of P.sinCobro) h += `<div class="aviso">Antes de tu próximo cobro tienes que pagar ${esc(p.nombre)}: te faltan ${C.dinero(p.falta)}.</div>`;
  const negativos = P.cobros.filter(c => c.libre < -0.005);
  if (negativos.length) h += `<div class="aviso">No te alcanza el cobro del ${negativos.map(c => C.fmt(c.fecha)).join(", ")}. Revisa la pestaña Cobros.</div>`;

  h += `<section class="sec"><div class="sec-head"><h2>Próximos pagos</h2><span class="hint">Toca un pago para cambiarlo</span></div><ul class="lista card">`;
  let mes = -1;
  for (const p of P.pagos.filter(p => !((p.pagado || p.pospuesto) && p.pago < C.add(hoy, -7)))) {
    if (C.M(p.pago) !== mes) { mes = C.M(p.pago); h += `<li class="mes-sep">${C.MESES_LARGO[mes - 1]}</li>`; }
    h += filaPago(p, hoy);
  }
  h += `</ul></section>`;
  return h;
}

function filaPago(p, hoy) {
  const aj = p.ajuste;
  let pill;
  if (p.pospuesto) pill = `<span class="pill neutral">No pagado · pasó al siguiente</span>`;
  else if (p.pagado && aj && aj.tipo === "parcial") pill = `<span class="pill ok">✓ Pagaste ${C.dinero(aj.pagado)}</span>`;
  else if (p.pagado) pill = `<span class="pill ok">✓ Pagado</span>`;
  else if (p.urgente) pill = `<span class="pill bad">¡Paga hoy!</span>`;
  else if (p.cubierto) pill = `<span class="pill info">Ya cubierto</span>`;
  else if (C.diasEntre(hoy, p.pago) <= 2) pill = `<span class="pill warn">${cuando(hoy, p.pago)}</span>`;
  else pill = `<span class="pill neutral">${cuando(hoy, p.pago)}</span>`;
  const partes = [];
  if (p.corte) partes.push(`corte ${C.fmt(p.corte)}`);
  partes.push(`límite ${C.fmt(p.limite)}`);
  if (+p.pago !== +p.limite && !p.urgente) partes.push(p.pago > p.limite ? "se recorre por día inhábil" : "se paga antes");
  if (p.estimado) partes.push("monto estimado");
  const arrastre = arrastreHacia(p.cuenta, p.clave);
  if (arrastre) partes.push(`incluye ${C.dinero(arrastre)} del mes anterior`);
  const k = `${p.cuenta.id}|${p.clave}`;
  const listo = p.pagado || p.pospuesto;
  const boton = listo ? "" : `<button class="btn sm" data-pagar="${esc(k)}">Ya pagué</button>`;
  return `<li class="pago${listo ? " hecho" : ""}">
    <div class="fecha"><span class="d">${C.DD(p.pago)}</span><span class="m">${C.MESES[C.M(p.pago) - 1]}</span><span class="m w">${C.DIAS_TXT[C.wd(p.pago)]}</span></div>
    <button class="info" data-abrir="${esc(k)}" aria-label="Opciones del pago de ${esc(p.nombre)}"><span class="nom">${esc(p.nombre)}</span><span class="det">${partes.join(" · ")}</span>${pill}</button>
    <div class="der"><button class="monto num" data-abrir="${esc(k)}">${p.estimado ? "~" : ""}${C.dinero(p.monto)}</button>${boton}</div></li>`;
}

// cuánto dinero llegó a este ciclo desde pagos que no se completaron
function arrastreHacia(c, clave) {
  return Object.values(c.ajustes || {}).filter(a => a.a === clave).reduce((s, a) => s + a.movido, 0);
}

function cobros() {
  let h = `<header class="top"><h1>Cobros</h1><p>${esc(textoIngreso(S.ingreso))}</p></header>`;
  if (!hecho()) return h + `<div class="card vacio"><p>Configura tu ingreso y al menos una cuenta para ver tus cobros.</p><button class="btn" data-ir="cuentas">Ir a Cuentas</button></div>`;
  const P = C.plan(S);
  h += `<p class="hint">Cada pago sale de los cobros más cercanos a su fecha. Lo que no se necesita te queda libre.${P.inicio > P.hoy ? ` Cuento desde el ${C.fmt(P.inicio)}.` : ""}</p>`;
  h += `<section class="sec"><h2>Cada cobro</h2><div class="card">`;
  for (const c of P.cobros) {
    const pct = Math.max(0, Math.min(100, (c.total / P.ingreso) * 100));
    const cls = c.libre < -0.005 ? "neg" : c.libre < 0.005 ? "cero" : "";
    const desg = c.lista.length ? "Pagas " + c.lista.map(([n, x]) => `${esc(n)} ${C.dinero(x)}`).join(" + ") : "No pagas nada con este cobro";
    h += `<div class="semana"><div class="arriba"><span class="dia">${C.fmt(c.fecha)}</span>
      <span class="num">libre <span class="libre ${cls}">${C.dinero(c.libre)}</span></span></div>
      <div class="barra" role="img" aria-label="Usas ${Math.round(pct)}% de este cobro"><span style="width:${pct}%"></span></div>
      <span class="desg num">${desg}</span></div>`;
  }
  h += `</div></section>`;

  const meses = new Map();
  for (const c of P.cobros) {
    const k = `${C.Y(c.fecha)}-${C.M(c.fecha)}`;
    const v = meses.get(k) || { m: C.M(c.fecha), cobras: 0, vence: 0, libre: 0 };
    v.cobras += P.ingreso; v.libre += c.libre; meses.set(k, v);
  }
  for (const p of P.pagos) { const v = meses.get(`${C.Y(p.pago)}-${C.M(p.pago)}`); if (v) v.vence += p.monto; }
  h += `<section class="sec"><h2>Por mes</h2><div class="card tabla-wrap"><table class="num"><thead><tr><th>Mes</th><th>Cobras</th><th>Vence</th><th>Te sobra</th></tr></thead><tbody>`;
  for (const v of meses.values()) h += `<tr><td>${C.MESES_LARGO[v.m - 1]}</td><td>${C.dinero(v.cobras)}</td><td>${C.dinero(v.vence)}</td><td class="sobra">${C.dinero(v.libre)}</td></tr>`;
  h += `</tbody></table></div><p class="hint">“Te sobra” es lo libre de los cobros de ese mes, ya con todo pagado.</p></section>`;
  return h;
}

function cuentas() {
  let h = `<header class="top"><h1>Mis cuentas</h1><p>Tu ingreso, tarjetas y pagos fijos</p></header>`;
  h += `<section class="sec"><h2>Lo que ganas</h2><div class="card cuenta"><div><div class="nom num">${esc(textoIngreso(S.ingreso))}</div>
    <div class="det">${esc(FRECUENCIAS[S.ingreso.frecuencia])}</div></div><button class="btn ghost sm" data-accion="ingreso">Editar</button></div></section>`;
  h += `<section class="sec"><div class="sec-head"><h2>Tarjetas y pagos</h2></div>`;
  if (S.cuentas.length) {
    h += `<div class="card">`;
    for (const c of S.cuentas) {
      const extra = [`Pago normal ${C.dinero(Number(c.pago_estimado) || 0)}`];
      if (Number(c.deuda_total) > 0) extra.push(`debes ${C.dinero(Number(c.deuda_total))}`);
      h += `<div class="cuenta"><div><span class="tipo">${c.tipo === "tarjeta" ? "Tarjeta" : "Pago fijo"}</span><div class="nom">${esc(c.nombre)}</div>
        <div class="det">${esc(textoCuenta(c))}</div><div class="det num">${extra.join(" · ")}</div></div>
        <button class="btn ghost sm" data-editar="${esc(c.id)}">Editar</button></div>`;
    }
    h += `</div>`;
  } else h += `<div class="card vacio"><p>Todavía no tienes cuentas.</p></div>`;
  h += `<div class="row"><button class="btn" data-accion="nueva-tarjeta">+ Tarjeta</button><button class="btn ghost" data-accion="nuevo-fijo">+ Pago fijo</button></div>`;
  h += `<p class="hint">Pago fijo: préstamos, Mercado Pago, renta, servicios… cualquier cosa con fecha límite cada mes.</p></section>`;
  return h;
}

function ajustes() {
  const reglas = { siguiente_habil: "Pagar el siguiente día hábil", ultimo_habil: "Pagar el día hábil anterior", exacto: "Pagar el día exacto" };
  let h = `<header class="top"><h1>Ajustes</h1></header>`;
  if (usuario) h += `<section class="sec"><h2>Tu cuenta</h2><div class="card pad stack">
    <p>Entraste como <b>${esc(usuario.email || usuario.displayName || "")}</b>. Tus datos se guardan en tu cuenta y se ven igual en todos tus dispositivos.</p>
    <div class="row"><button class="btn ghost" data-accion="salir">Cerrar sesión</button></div></div></section>`;
  h += `<section class="sec"><h2>Cómo pagar</h2><div class="card pad stack">
    <label class="campo" for="aj-regla">Si la fecha límite cae en fin de semana o día festivo
      <select id="aj-regla">${Object.entries(reglas).map(([k, v]) => `<option value="${k}" ${S.regla_pago === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <small>En México los bancos recorren la fecha límite al siguiente día hábil.</small></label>
    <label class="check"><input type="checkbox" id="aj-feriados" ${S.feriados_mexico !== false ? "checked" : ""}> Contar los días festivos bancarios de México</label>
    <label class="campo" for="aj-desde">Empezar a contar cobros desde
      <input type="date" id="aj-desde" value="${esc(S.contar_desde || "")}">
      <small>Útil si tus cobros anteriores ya se gastaron. Déjalo vacío para contar desde hoy.</small></label>
  </div></section>`;
  h += `<section class="sec"><h2>Calendario</h2><div class="card pad stack">
    <p>Descarga tus pagos de los próximos 3 meses para agregarlos a tu calendario, con recordatorio un día antes y el mismo día.</p>
    <button class="btn" data-accion="ics" ${hecho() ? "" : "disabled"}>Descargar calendario</button>
    <p class="hint">En iPhone se guarda en Archivos: ábrelo desde ahí y toca “Agregar todo”. Vuelve a descargarlo cuando cambies algo.</p>
  </div></section>`;
  h += `<section class="sec"><h2>Respaldo</h2><div class="card pad stack">
    <p>${usuario ? "Tus datos ya están en tu cuenta. Si quieres, guarda además una copia." : "Tus datos viven solo en este teléfono. Guarda un respaldo por si cambias de teléfono o borras el navegador."}</p>
    <div class="row"><button class="btn" data-accion="exportar">Copiar respaldo</button><button class="btn ghost" data-accion="importar">Cargar respaldo</button></div>
  </div></section>`;
  h += `<section class="sec"><h2>Instalar en tu teléfono</h2><div class="card pad stack">
    <p><b>iPhone:</b> abre esta página en Safari, toca Compartir y luego “Agregar a inicio”.</p>
    <p><b>Android:</b> en Chrome, abre el menú ⋮ y toca “Instalar app”.</p>
  </div></section>`;
  h += `<section class="sec"><div class="card pad stack">
    ${confirmarBorrado
      ? `<p>Se borrarán tu ingreso y todas tus cuentas${usuario ? " de tu cuenta, en todos tus dispositivos" : " de este teléfono"}. No se puede deshacer.</p><div class="row"><button class="btn danger full" data-accion="borrar-si">Sí, borrar todo</button><button class="btn ghost" data-accion="borrar-no">Cancelar</button></div>`
      : `<button class="btn danger" data-accion="borrar">Borrar todos mis datos</button>`}
  </div></section>`;
  return h;
}

// ---------- formularios ----------
const dlg = $("#dlg");
function abrir(html) { dlg.innerHTML = html; dlg.showModal(); const f = dlg.querySelector("input:not([type=radio]), select"); if (f && window.matchMedia("(pointer:fine)").matches) f.focus(); }
function cerrar() { dlg.close(); dlg.innerHTML = ""; }

function formIngreso() {
  const ing = S.ingreso;
  abrir(`<form class="form" id="f-ingreso" novalidate>
    <h2>Lo que ganas</h2>
    <label class="campo" for="i-monto">¿Cuánto te pagan cada vez?<input id="i-monto" inputmode="decimal" placeholder="Ej. 3000" value="${esc(ing.monto || "")}"></label>
    <label class="campo" for="i-frec">¿Cada cuándo?<select id="i-frec">${Object.entries(FRECUENCIAS).map(([k, v]) => `<option value="${k}" ${ing.frecuencia === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label class="campo" for="i-dia" data-si="semanal">¿Qué día te pagan?<select id="i-dia">${C.DIAS_LARGO.map((d, i) => `<option value="${i}" ${Number(ing.dia) === i ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <label class="campo" for="i-inicio" data-si="catorcenal">Fecha de un cobro reciente<input type="date" id="i-inicio" value="${esc(ing.inicio || C.iso(C.hoyLocal()))}"><small>Con esa fecha calculo los siguientes cada 14 días.</small></label>
    <label class="campo" for="i-diames" data-si="mensual">¿Qué día del mes?<input id="i-diames" inputmode="numeric" value="${esc(ing.dia_mes || 30)}"><small>Si cae en fin de semana, cuento que te pagan antes.</small></label>
    <p class="hint" data-si="quincenal">Cuento los días 15 y último de cada mes. Si caen en fin de semana, cuento que te pagan antes.</p>
    <p class="error" id="i-error" hidden></p>
    <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cancelar</button><button class="btn">Guardar</button></div>
  </form>`);
  const sync = () => dlg.querySelectorAll("[data-si]").forEach(e => e.hidden = e.dataset.si !== $("#i-frec").value);
  $("#i-frec").addEventListener("change", sync); sync();
}

function guardarIngreso() {
  const monto = numero($("#i-monto").value), frec = $("#i-frec").value, err = $("#i-error");
  const diaMes = parseInt($("#i-diames").value, 10);
  const fallo = t => { err.textContent = t; err.hidden = false; };
  if (!(monto > 0)) return fallo("Escribe cuánto te pagan, por ejemplo 3000.");
  if (frec === "mensual" && !(diaMes >= 1 && diaMes <= 31)) return fallo("El día del mes debe ser de 1 a 31.");
  if (frec === "catorcenal" && !$("#i-inicio").value) return fallo("Pon la fecha de un cobro reciente.");
  S.ingreso = { monto, frecuencia: frec, dia: Number($("#i-dia").value), dia_mes: diaMes || 30, inicio: $("#i-inicio").value || C.iso(C.hoyLocal()) };
  cerrar();
  if (!S.cuentas.length) tab = "cuentas";
  guardar("Ingreso guardado");
}

function proximoCiclo(c) {
  const hoy = C.hoyLocal();
  return C.calcularPagos({ ...S, cuentas: [c] }, hoy, C.add(hoy, 70)).find(p => !p.pagado && p.pago >= hoy);
}

function formCuenta(c, tipo) {
  const nueva = !c;
  c = c || { tipo, limite_tipo: "dias", dias_despues_corte: 20 };
  const esTarjeta = c.tipo === "tarjeta";
  const prox = nueva ? null : proximoCiclo(c);
  const proxMonto = prox ? (prox.estimado ? "" : prox.monto) : "";
  abrir(`<form class="form" id="f-cuenta" data-id="${esc(c.id || "")}" data-tipo="${esc(c.tipo)}" novalidate>
    <h2>${nueva ? (esTarjeta ? "Nueva tarjeta" : "Nuevo pago fijo") : esc(c.nombre)}</h2>
    <label class="campo" for="c-nombre">Nombre<input id="c-nombre" autocomplete="off" placeholder="${esTarjeta ? "Ej. BBVA Azul" : "Ej. Préstamo, Mercado Pago"}" value="${esc(c.nombre || "")}"></label>
    ${esTarjeta ? `
      <label class="campo" for="c-corte">Día de corte<input id="c-corte" inputmode="numeric" placeholder="1 a 31" value="${esc(c.dia_corte || "")}"></label>
      <div class="campo"><span>Fecha límite de pago</span>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="c-ltipo" value="dias" ${c.limite_tipo !== "dia" ? "checked" : ""}>Días después del corte</label>
          <label><input type="radio" name="c-ltipo" value="dia" ${c.limite_tipo === "dia" ? "checked" : ""}>Día fijo del mes</label>
        </div></div>
      <label class="campo" for="c-dias" data-lt="dias">¿Cuántos días después del corte?<input id="c-dias" inputmode="numeric" value="${esc(c.dias_despues_corte ?? 20)}"><small>Casi siempre son 20.</small></label>
      <label class="campo" for="c-dialim" data-lt="dia">¿Qué día del mes?<input id="c-dialim" inputmode="numeric" placeholder="1 a 31" value="${esc(c.dia_limite || "")}"></label>
    ` : `
      <label class="campo" for="c-dialim">¿Qué día del mes vence?<input id="c-dialim" inputmode="numeric" placeholder="1 a 31" value="${esc(c.dia_limite || "")}"></label>
    `}
    <div class="dos">
      <label class="campo" for="c-normal">Pago de cada mes<input id="c-normal" inputmode="decimal" placeholder="0.00" value="${esc(c.pago_estimado ?? "")}">
        <small>${esTarjeta ? "El “pago para no generar intereses” de siempre." : "Lo que pagas normalmente."}</small></label>
      <label class="campo" for="c-prox">Próximo pago${prox ? ` (${C.fmt(prox.pago)})` : ""}<input id="c-prox" inputmode="decimal" placeholder="Igual que cada mes" value="${esc(proxMonto)}">
        <small>Solo si este mes es distinto.</small></label>
    </div>
    <label class="campo" for="c-deuda">¿Cuánto debes en total? (opcional)<input id="c-deuda" inputmode="decimal" placeholder="0.00" value="${esc(c.deuda_total ?? "")}"></label>
    <p class="error" id="c-error" hidden></p>
    <div class="acciones">
      ${nueva ? "" : `<button type="button" class="btn danger" data-accion="borrar-cuenta">Eliminar</button>`}
      <button type="button" class="btn ghost" data-accion="cerrar">Cancelar</button><button class="btn">Guardar</button>
    </div>
  </form>`);
  if (esTarjeta) {
    const sync = () => { const v = dlg.querySelector("input[name=c-ltipo]:checked").value; dlg.querySelectorAll("[data-lt]").forEach(e => e.hidden = e.dataset.lt !== v); };
    dlg.querySelectorAll("input[name=c-ltipo]").forEach(r => r.addEventListener("change", sync)); sync();
  }
}

function guardarCuenta(form) {
  const err = $("#c-error"), fallo = t => { err.textContent = t; err.hidden = false; };
  const tipo = form.dataset.tipo, id = form.dataset.id;
  const nombre = $("#c-nombre").value.trim();
  const dia = v => { const n = parseInt(v, 10); return n >= 1 && n <= 31 ? n : NaN; };
  if (!nombre) return fallo("Ponle un nombre, por ejemplo el banco.");
  const previa = S.cuentas.find(x => x.id === id);
  const c = previa ? { ...previa } : { id: nuevoId(), tipo, montos: {}, pagados: [], cubiertos: [] };
  c.nombre = nombre;
  if (tipo === "tarjeta") {
    c.dia_corte = dia($("#c-corte").value);
    if (!c.dia_corte) return fallo("El día de corte debe ser de 1 a 31.");
    c.limite_tipo = dlg.querySelector("input[name=c-ltipo]:checked").value;
    if (c.limite_tipo === "dia") {
      c.dia_limite = dia($("#c-dialim").value);
      if (!c.dia_limite) return fallo("El día límite debe ser de 1 a 31.");
    } else {
      c.dias_despues_corte = parseInt($("#c-dias").value, 10);
      if (!(c.dias_despues_corte >= 1 && c.dias_despues_corte <= 60)) return fallo("Los días después del corte deben ser de 1 a 60.");
    }
  } else {
    c.dia_limite = dia($("#c-dialim").value);
    if (!c.dia_limite) return fallo("El día que vence debe ser de 1 a 31.");
  }
  const normal = numero($("#c-normal").value);
  if (!(normal >= 0)) return fallo("Escribe cuánto pagas cada mes (puede ser 0).");
  c.pago_estimado = normal;
  const deuda = numero($("#c-deuda").value);
  c.deuda_total = deuda >= 0 ? deuda : null;
  const prox = proximoCiclo(c), pm = numero($("#c-prox").value);
  c.montos = { ...(c.montos || {}) };
  if (prox) { if (pm >= 0) c.montos[prox.clave] = pm; else delete c.montos[prox.clave]; }
  if (previa) S.cuentas[S.cuentas.indexOf(previa)] = c; else S.cuentas.push(c);
  cerrar();
  guardar(previa ? "Cambios guardados" : `${nombre} agregada`);
}

// ---------- opciones de un pago ----------
const redondear = x => Math.round(x * 100) / 100;
function pagoDe(c, clave) {
  const lim = C.parse(clave);
  return C.calcularPagos({ ...S, cuentas: [c] }, C.add(lim, -12), C.add(lim, 12)).find(p => p.clave === clave);
}
function siguienteCiclo(c, clave) {
  const desde = C.add(C.parse(clave), 1);
  return C.calcularPagos({ ...S, cuentas: [c] }, desde, C.add(desde, 75)).find(p => p.clave > clave);
}
function sumarA(c, clave, cantidad) {
  const p = pagoDe(c, clave);
  c.montos = { ...(c.montos || {}), [clave]: redondear((p ? p.monto : 0) + cantidad) };
}
function moverAlSiguiente(c, clave, cantidad, tipo, pagado) {
  const sig = siguienteCiclo(c, clave);
  if (!sig) return null;
  sumarA(c, sig.clave, cantidad);
  c.ajustes = { ...(c.ajustes || {}), [clave]: { tipo, movido: redondear(cantidad), a: sig.clave, ...(pagado != null ? { pagado } : {}) } };
  return sig;
}
function deshacerPago(c, clave) {
  const aj = (c.ajustes || {})[clave];
  if (aj) {
    const quedan = redondear(Number(c.montos[aj.a]) - aj.movido);
    c.montos = { ...c.montos };
    if (quedan === redondear(Number(c.pago_estimado) || 0)) delete c.montos[aj.a]; else c.montos[aj.a] = quedan;
    c.ajustes = { ...c.ajustes }; delete c.ajustes[clave];
  }
  c.pagados = (c.pagados || []).filter(x => x !== clave);
  c.pospuestos = (c.pospuestos || []).filter(x => x !== clave);
}

function formPago(k) {
  const { c, clave } = buscarPago(k);
  const p = pagoDe(c, clave);
  if (!p) return;
  const sig = siguienteCiclo(c, clave);
  const aj = p.ajuste;
  const titulo = `<div class="stack" style="gap:4px"><span class="tipo">${esc(p.nombre)}</span>
    <h2 class="num" style="font-size:30px">${C.dinero(p.monto)}</h2>
    <p class="hint">Pagas el ${C.fmt(p.pago)}${p.corte ? ` · corte ${C.fmt(p.corte)}` : ""} · límite ${C.fmt(p.limite)}</p></div>`;
  let cuerpo;
  if (p.pagado || p.pospuesto) {
    let txt = "Ya está pagado.";
    if (p.pospuesto) txt = `No lo pagaste. ${C.dinero(aj.movido)} pasaron a tu pago que vence el ${C.fmt(C.parse(aj.a))}.`;
    else if (aj && aj.tipo === "parcial") txt = `Pagaste ${C.dinero(aj.pagado)}. Los ${C.dinero(aj.movido)} que faltaron pasaron a tu pago que vence el ${C.fmt(C.parse(aj.a))}.`;
    cuerpo = `<div class="aviso info">${txt}</div>
      <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cerrar</button><button type="button" class="btn" data-accion="pago-deshacer">Deshacer</button></div>`;
  } else {
    const despuesCorte = p.corte && C.hoyLocal() > p.corte;
    cuerpo = `
      <div class="campo"><span>¿Qué pasó con este pago?</span>
        <div class="opciones">
          <button type="button" class="btn ghost" data-accion="pago-todo">Pagué todo</button>
          <button type="button" class="btn ghost" data-op="parte">Pagué una parte</button>
          <button type="button" class="btn ghost" data-op="nopude">No pude pagar</button>
        </div></div>
      <div class="caja" data-panel="parte" hidden>
        <label class="campo" for="p-parte">¿Cuánto pagaste?<input id="p-parte" inputmode="decimal" placeholder="0.00"></label>
        <p class="hint">${sig ? `Lo que falte se suma a tu pago del ${C.fmt(sig.pago)}.` : "No encontré el siguiente pago de esta cuenta."}</p>
        <button type="button" class="btn" data-accion="pago-parte" ${sig ? "" : "disabled"}>Guardar</button>
      </div>
      <div class="caja" data-panel="nopude" hidden>
        <p>${sig ? `Los ${C.dinero(p.monto)} se suman a tu pago del ${C.fmt(sig.pago)}.` : "No encontré el siguiente pago de esta cuenta."}</p>
        ${p.corte ? `<p class="hint">El banco puede cobrarte intereses y comisión por pago tardío. Si puedes, paga al menos el pago mínimo.</p>` : ""}
        <button type="button" class="btn" data-accion="pago-nopude" ${sig ? "" : "disabled"}>Pasar al siguiente mes</button>
      </div>
      <hr class="sep">
      <div class="linea">
        <label class="campo" for="p-monto">Cambiar el monto de este pago<input id="p-monto" inputmode="decimal" value="${esc(p.monto)}"></label>
        <button type="button" class="btn ghost" data-accion="pago-monto">Guardar</button>
      </div>
      <div class="linea">
        <label class="campo" for="p-gasto">¿Gastaste más? Súmalo aquí<input id="p-gasto" inputmode="decimal" placeholder="¿Cuánto?"></label>
        <button type="button" class="btn ghost" data-accion="pago-gasto">Sumar</button>
      </div>
      ${despuesCorte && sig ? `<p class="hint">Lo que gastes después del corte (${C.fmt(p.corte)}) va en el pago del ${C.fmt(sig.pago)}: ábrelo y súmalo ahí.</p>` : ""}
      <p class="error" id="p-error" hidden></p>
      <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cerrar</button></div>`;
  }
  abrir(`<form class="form" id="f-pago" data-k="${esc(k)}" novalidate>${titulo}${cuerpo}</form>`);
}

function accionPago(accion) {
  const k = $("#f-pago").dataset.k, { c, clave } = buscarPago(k), p = pagoDe(c, clave);
  const err = $("#p-error"), fallo = t => { err.textContent = t; err.hidden = false; };
  let msg;
  if (accion === "pago-todo") { c.pagados = [...new Set([...(c.pagados || []), clave])]; msg = `${c.nombre}: pagado`; }
  else if (accion === "pago-parte") {
    const x = numero($("#p-parte").value);
    if (!(x > 0)) return fallo("Escribe cuánto pagaste.");
    if (x >= p.monto) { c.pagados = [...new Set([...(c.pagados || []), clave])]; msg = `${c.nombre}: pagado`; }
    else {
      const sig = moverAlSiguiente(c, clave, p.monto - x, "parcial", x);
      c.pagados = [...new Set([...(c.pagados || []), clave])];
      msg = `Faltaron ${C.dinero(p.monto - x)}: pasaron al ${C.fmt(sig.pago)}`;
    }
  } else if (accion === "pago-nopude") {
    const sig = moverAlSiguiente(c, clave, p.monto, "pospuesto");
    c.pospuestos = [...new Set([...(c.pospuestos || []), clave])];
    msg = `${C.dinero(p.monto)} pasaron al ${C.fmt(sig.pago)}`;
  } else if (accion === "pago-monto") {
    const x = numero($("#p-monto").value);
    if (!(x >= 0)) return fallo("Escribe el monto como número, por ejemplo 1500.");
    c.montos = { ...(c.montos || {}), [clave]: redondear(x) }; msg = "Monto actualizado";
  } else if (accion === "pago-gasto") {
    const x = numero($("#p-gasto").value);
    if (!(x > 0)) return fallo("Escribe cuánto gastaste de más.");
    sumarA(c, clave, x); msg = `Se sumaron ${C.dinero(x)}`;
  } else if (accion === "pago-deshacer") { deshacerPago(c, clave); msg = "Listo, lo regresé como estaba"; }
  cerrar();
  guardar(msg);
}

function formImportar() {
  abrir(`<form class="form" id="f-importar" novalidate>
    <h2>Cargar respaldo</h2>
    <label class="campo" for="r-texto">Pega aquí tu respaldo<textarea id="r-texto" rows="5" placeholder="Pega el texto que copiaste"></textarea></label>
    <label class="campo" for="r-archivo">o elige el archivo<input type="file" id="r-archivo" accept=".json,application/json,text/plain"></label>
    ${S ? `<p class="hint">Esto reemplaza lo que tienes ahora en este teléfono.</p>` : ""}
    <p class="error" id="r-error" hidden></p>
    <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cancelar</button><button class="btn">Cargar</button></div>
  </form>`);
  $("#r-archivo").addEventListener("change", async e => { const f = e.target.files[0]; if (f) $("#r-texto").value = await f.text(); });
}

function leerRespaldo(texto) {
  let t = texto.trim();
  if (!t.startsWith("{")) t = desdeBase64(t.replace(/^.*#importar=/, ""));
  return normalizar(JSON.parse(t));
}

// Todo lo que entra (respaldo, link, nube o teléfono) se reconstruye campo por campo:
// solo números, fechas y textos con su forma esperada. Así un link malicioso no puede
// meter código en la página.
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGLAS = ["siguiente_habil", "ultimo_habil", "exacto"];
function normalizar(d) {
  if (!d || typeof d !== "object" || !d.ingreso || typeof d.ingreso !== "object" || !Array.isArray(d.cuentas)) throw new Error("formato");
  const num = (v, min, max, def) => { const n = Number(v); return v !== null && v !== "" && isFinite(n) && n >= min && n <= max ? n : def; };
  const ent = (v, min, max, def) => { const n = num(v, min, max, NaN); return Number.isInteger(n) ? n : def; };
  const fecha = v => (typeof v === "string" && FECHA.test(v) ? v : null);
  const fechas = a => (Array.isArray(a) ? [...new Set(a.map(fecha).filter(Boolean))].slice(0, 500) : []);
  const montos = m => {
    const o = {};
    if (m && typeof m === "object") for (const [k, v] of Object.entries(m)) { const n = num(v, 0, 1e9, NaN); if (FECHA.test(k) && !isNaN(n)) o[k] = n; }
    return o;
  };
  const i = d.ingreso;
  const ingreso = {
    monto: num(i.monto, 0, 1e9, 0),
    frecuencia: Object.keys(FRECUENCIAS).includes(i.frecuencia) ? i.frecuencia : "semanal",
    dia: ent(i.dia, 0, 6, 4), dia_mes: ent(i.dia_mes, 1, 31, 30), inicio: fecha(i.inicio) || C.iso(C.hoyLocal()),
  };
  const vistos = new Set();
  const cuentas = d.cuentas.filter(c => c && typeof c === "object").slice(0, 100).map(c => {
    const tipo = c.tipo === "tarjeta" ? "tarjeta" : "fijo";
    let id = String(c.id ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    while (!id || vistos.has(id)) id = nuevoId();
    vistos.add(id);
    const o = {
      id, tipo, nombre: String(c.nombre ?? "").trim().slice(0, 60) || "Sin nombre",
      pago_estimado: num(c.pago_estimado, 0, 1e9, 0), deuda_total: num(c.deuda_total, 0, 1e10, null),
      montos: montos(c.montos), pagados: fechas(c.pagados), cubiertos: fechas(c.cubiertos), pospuestos: fechas(c.pospuestos), ajustes: {},
    };
    if (REGLAS.includes(c.regla_pago)) o.regla_pago = c.regla_pago;
    if (tipo === "tarjeta") {
      o.dia_corte = ent(c.dia_corte, 1, 31, 1);
      o.limite_tipo = c.limite_tipo === "dia" ? "dia" : "dias";
      if (o.limite_tipo === "dia") o.dia_limite = ent(c.dia_limite, 1, 31, 1);
      else o.dias_despues_corte = ent(c.dias_despues_corte, 1, 60, 20);
    } else o.dia_limite = ent(c.dia_limite, 1, 31, 1);
    if (c.ajustes && typeof c.ajustes === "object") {
      for (const [k, a] of Object.entries(c.ajustes)) {
        if (!FECHA.test(k) || !a || !fecha(a.a)) continue;
        o.ajustes[k] = { tipo: a.tipo === "parcial" ? "parcial" : "pospuesto", movido: num(a.movido, 0, 1e9, 0), a: a.a };
        if (a.pagado != null) o.ajustes[k].pagado = num(a.pagado, 0, 1e9, 0);
      }
    }
    return o;
  });
  return {
    version: 1, ingreso, regla_pago: REGLAS.includes(d.regla_pago) ? d.regla_pago : "siguiente_habil",
    feriados_mexico: d.feriados_mexico !== false, contar_desde: fecha(d.contar_desde), cuentas,
  };
}
const normalizarSeguro = d => { try { return d ? normalizar(d) : null; } catch { return null; } };
function aBase64(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function desdeBase64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }

function descargar(nombre, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement("a"); a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- eventos ----------
function buscarPago(k) {
  const [id, clave] = k.split("|");
  return { c: S.cuentas.find(x => x.id === id), clave };
}

document.addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; confirmarBorrado = false; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.ir) { tab = b.dataset.ir; render(); return; }
  if (b.dataset.pagar) { const { c, clave } = buscarPago(b.dataset.pagar); c.pagados = [...new Set([...(c.pagados || []), clave])]; guardar(`${c.nombre}: pagado`); return; }
  if (b.dataset.abrir) { formPago(b.dataset.abrir); return; }
  if (b.dataset.op) {
    dlg.querySelectorAll("[data-panel]").forEach(e => e.hidden = e.dataset.panel !== b.dataset.op);
    dlg.querySelectorAll("[data-op]").forEach(x => x.classList.toggle("activo", x === b));
    const i = dlg.querySelector(`[data-panel="${b.dataset.op}"] input`); if (i) i.focus();
    return;
  }
  if (b.dataset.accion && b.dataset.accion.startsWith("pago-")) { accionPago(b.dataset.accion); return; }
  if (b.dataset.editar) { formCuenta(S.cuentas.find(x => x.id === b.dataset.editar)); return; }
  switch (b.dataset.accion) {
    case "empezar": S = nuevoEstado(); guardar(); formIngreso(); break;
    case "ingreso": formIngreso(); break;
    case "nueva-tarjeta": formCuenta(null, "tarjeta"); break;
    case "nuevo-fijo": formCuenta(null, "fijo"); break;
    case "cerrar": cerrar(); break;
    case "importar": formImportar(); break;
    case "import-no": importEnEspera = null; cerrar(); break;
    case "import-si": {
      const d = importEnEspera; importEnEspera = null; cerrar();
      if (d) { S = d; tab = "inicio"; guardar(usuario ? "Tus datos se guardaron en tu cuenta" : "Datos cargados"); }
      break;
    }
    case "borrar-cuenta": {
      const id = $("#f-cuenta").dataset.id;
      if (b.dataset.seguro) { S.cuentas = S.cuentas.filter(x => x.id !== id); cerrar(); guardar("Cuenta eliminada"); }
      else { b.dataset.seguro = "1"; b.textContent = "Toca otra vez para eliminar"; }
      break;
    }
    case "ics": descargar("mis-pagos.ics", C.ics(S), "text/calendar;charset=utf-8"); toast("Calendario descargado"); break;
    case "exportar": {
      const texto = JSON.stringify(S);
      try { await navigator.clipboard.writeText(texto); toast("Respaldo copiado. Pégalo en tus notas o mándatelo."); }
      catch { descargar("mis-pagos-respaldo.json", texto, "application/json"); toast("Respaldo descargado"); }
      break;
    }
    case "borrar": confirmarBorrado = true; render(); break;
    case "borrar-no": confirmarBorrado = false; render(); break;
    case "borrar-si":
      try { localStorage.removeItem(llave()); } catch {}
      if (docRef) docRef.delete().catch(() => toast("No se pudo borrar de la nube. Revisa tu internet."));
      S = null; confirmarBorrado = false; tab = "inicio"; render(); toast("Datos borrados"); break;
    case "google": entrarConGoogle(); break;
    case "modo-login": modoRegistro = !modoRegistro; render(); break;
    case "olvide": {
      const correo = $("#l-correo").value.trim();
      if (!correo) { errorLogin({ code: "falta-correo" }); break; }
      auth.sendPasswordResetEmail(correo).then(() => toast("Te mandé un correo para cambiar tu contraseña"), errorLogin);
      break;
    }
    case "salir":
      try { localStorage.removeItem(llave()); } catch {}
      tab = "inicio"; auth.signOut(); break;
  }
});

document.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "f-login") {
    const correo = $("#l-correo").value.trim(), clave = $("#l-clave").value;
    const op = modoRegistro ? auth.createUserWithEmailAndPassword(correo, clave) : auth.signInWithEmailAndPassword(correo, clave);
    op.catch(errorLogin);
  }
  else if (f.id === "f-ingreso") guardarIngreso();
  else if (f.id === "f-cuenta") guardarCuenta(f);
  else if (f.id === "f-importar") {
    try { S = leerRespaldo($("#r-texto").value); cerrar(); tab = "inicio"; guardar("Respaldo cargado"); }
    catch { const err = $("#r-error"); err.textContent = "Ese texto no es un respaldo de Mis Pagos. Copia el respaldo completo."; err.hidden = false; }
  }
});

document.addEventListener("change", e => {
  if (!S) return;
  if (e.target.id === "aj-regla") { S.regla_pago = e.target.value; guardar("Guardado"); }
  if (e.target.id === "aj-feriados") { S.feriados_mexico = e.target.checked; guardar("Guardado"); }
  if (e.target.id === "aj-desde") { S.contar_desde = e.target.value || null; guardar("Guardado"); }
});

dlg.addEventListener("click", e => { if (e.target === dlg) cerrar(); });

// ---------- arranque ----------
// Un link con #importar=... carga esos datos. Con cuentas, se guardan en la cuenta
// en cuanto la persona entra (aunque tenga que iniciar sesión primero).
const PENDIENTE = "mispagos.importar";
(function importarDesdeLink() {
  const m = location.hash.match(/^#importar=(.+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  let d;
  try { d = leerRespaldo(m[1]); } catch { setTimeout(() => toast("El link de respaldo no es válido"), 300); return; }
  if (QUIERE_NUBE) { try { localStorage.setItem(PENDIENTE, JSON.stringify(d)); } catch {} return; }
  setTimeout(() => confirmarImport(d), 0);
})();
function tomarPendiente() {
  try { const t = localStorage.getItem(PENDIENTE); localStorage.removeItem(PENDIENTE); return t ? normalizarSeguro(JSON.parse(t)) : null; } catch { return null; }
}

// Antes de reemplazar nada, se muestra qué trae el link y la persona decide.
let importEnEspera = null;
function confirmarImport(d) {
  importEnEspera = d;
  const nombres = d.cuentas.map(c => esc(c.nombre)).join(", ") || "ninguna";
  abrir(`<form class="form" id="f-confirmar" novalidate>
    <h2>¿Cargar estos datos?</h2>
    <p>Abriste un link con datos de Mis Pagos:</p>
    <div class="caja"><p><b>Ingreso:</b> ${esc(textoIngreso(d.ingreso))}</p><p><b>Cuentas:</b> ${nombres}</p></div>
    <p class="hint">${S && S.cuentas && S.cuentas.length ? "Esto reemplaza todo lo que tienes ahora. " : ""}Carga solo links que tú hayas creado o que vengan de alguien de confianza.</p>
    <div class="acciones"><button type="button" class="btn ghost" data-accion="import-no">No cargar</button><button type="button" class="btn" data-accion="import-si">Cargar datos</button></div>
  </form>`);
}
// ---------- cuenta y nube ----------
const ERRORES = {
  "auth/invalid-email": "Ese correo no es válido.",
  "auth/missing-email": "Escribe tu correo.",
  "falta-correo": "Escribe tu correo arriba y vuelve a tocar “Olvidé mi contraseña”.",
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "No hay una cuenta con ese correo. Toca “Crear cuenta nueva”.",
  "auth/missing-password": "Escribe tu contraseña.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese correo. Toca “Ya tengo cuenta”.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
  "auth/network-request-failed": "Sin conexión. Revisa tu internet.",
  "auth/unauthorized-domain": "Este sitio no está autorizado para iniciar sesión. Agrégalo en Firebase → Authentication → Configuración → Dominios autorizados.",
  "auth/operation-not-allowed": "Este tipo de inicio de sesión no está activado en Firebase.",
};
function errorLogin(e) {
  if (!e || ["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) return;
  const el = $("#l-error"), txt = ERRORES[e.code] || `No se pudo entrar (${e.code || e.message}).`;
  if (el) { el.textContent = txt; el.hidden = false; } else toast(txt);
}
function entrarConGoogle() {
  const prov = new firebase.auth.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: "select_account" });
  auth.signInWithPopup(prov).catch(e => {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) return auth.signInWithRedirect(prov).catch(errorLogin);
    errorLogin(e);
  });
}

function subir() {
  if (!docRef || !S) return;
  docRef.set({ datos: JSON.parse(JSON.stringify(S)), actualizado: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(e => toast(e.code === "permission-denied" ? "No tienes permiso para guardar. Vuelve a iniciar sesión." : "No se pudo guardar en la nube."));
}

if (NUBE) {
  firebase.initializeApp(FB_CFG);
  auth = firebase.auth();
  db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});  // funciona sin internet
  auth.getRedirectResult().catch(errorLogin);
  auth.onAuthStateChanged(u => {
    if (desuscribir) { desuscribir(); desuscribir = null; }
    usuario = u; authListo = true; docRef = null; S = null;
    if (!u) { render(); return; }
    // copia en el teléfono de esta cuenta; la primera vez, lo que había sin cuenta
    const local = cargar() || cargarDe(KEY);
    S = local;
    docRef = db.collection("usuarios").doc(u.uid);
    const importado = tomarPendiente();
    if (importado) setTimeout(() => confirmarImport(importado), 0);
    let revisado = false;
    desuscribir = docRef.onSnapshot({ includeMetadataChanges: true }, snap => {
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists) {
        // la nube no tiene nada: si lo confirma el servidor, se sube lo que hay en el teléfono
        if (!snap.metadata.fromCache && !revisado) {
          revisado = true;
          if (local) { subir(); try { localStorage.removeItem(KEY); } catch {} }
        }
        render();
        return;
      }
      revisado = true;
      const nube = normalizarSeguro(snap.data().datos);
      if (!nube) { toast("Los datos de tu cuenta tienen un formato inesperado."); return; }
      if (JSON.stringify(nube) !== JSON.stringify(S)) {
        S = nube;
        try { localStorage.setItem(llave(), JSON.stringify(S)); } catch {}
      }
      render();
    }, () => toast("No se pudieron cargar tus datos. Revisa tu internet."));
    render();
  });
}

window.addEventListener("storage", e => {
  // otra pestaña recibió un link de importar mientras aquí ya hay sesión
  // solo la pestaña que la persona está viendo; las demás lo ignoran
  if (e.key === PENDIENTE && e.newValue && usuario && docRef && document.visibilityState === "visible") {
    const d = tomarPendiente();
    if (d) confirmarImport(d);
  }
});

render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
