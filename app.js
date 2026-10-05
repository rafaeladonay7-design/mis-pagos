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

  const V = P.vuelta;
  h += `<section class="resumen" aria-label="Resumen">`;
  h += proximo
    ? `<div class="tile main"><span class="lbl">Próximo pago</span><span class="big num">${C.dinero(proximo.monto)}</span><span class="sub">${esc(proximo.nombre)} · ${C.fmt(proximo.pago)} (${cuando(hoy, proximo.pago)})</span></div>`
    : `<div class="tile main"><span class="lbl">Próximo pago</span><span class="big">Nada pendiente</span></div>`;
  if (proxCobro && S.modo_reparto === "al_final") h += `<div class="tile"><span class="lbl">Libre el ${C.fmt(proxCobro.fecha)}</span><span class="big num">${C.dinero(proxCobro.libre)}</span><span class="sub">de ${C.dinero(P.ingreso)}</span></div>`;
  else if (proxCobro && V) h += `<div class="tile"><span class="lbl">Pagas hasta el ${C.fmt(V.fin)}</span><span class="big num">${C.dinero(V.pagas)}</span><span class="sub">${V.pagos.length} ${V.pagos.length === 1 ? "pago" : "pagos"}</span></div>`;
  if (V) h += `<div class="tile"><span class="lbl">Te sobra al ${C.fmt(V.fin)}</span><span class="big num">${C.dinero(V.sobra)}</span><span class="sub">ya con todo pagado</span></div>`;
  else h += `<div class="tile"><span class="lbl">Te sobra en ${C.MESES_LARGO[C.M(mesRef) - 1]}</span><span class="big num">${C.dinero(libreMes)}</span><span class="sub">con todo pagado</span></div>`;
  if (deuda > 0) h += `<div class="tile" style="grid-column:1/-1"><span class="lbl">Deuda total</span><span class="big num">${C.dinero(deuda)}</span><span class="sub">suma de lo que debes en tus cuentas</span></div>`;
  h += `</section>`;

  if (V) h += `<section class="card pad stack vuelta num" aria-label="Cuenta hasta tu último pago">
    <div class="sec-head"><h3>Del ${C.fmt(V.desde)} al ${C.fmt(V.fin)}</h3><span class="hint">hasta pagar todo una vez</span></div>
    <div class="linea-cuenta"><span>Cobras (${V.cobros} ${V.cobros === 1 ? "cobro" : "cobros"})</span><b>${C.dinero(V.cobras)}</b></div>
    <div class="linea-cuenta"><span>Pagas (${V.pagos.map(p => esc(p.nombre)).join(", ")})</span><b>− ${C.dinero(V.pagas)}</b></div>
    <div class="linea-cuenta total"><span>Te sobra</span><b>${C.dinero(V.sobra)}</b></div>
  </section>`;
  if (S.modo_reparto === "al_final") for (const p of P.sinCobro) h += `<div class="aviso">Antes de tu próximo cobro tienes que pagar ${esc(p.nombre)}: te faltan ${C.dinero(p.falta)}.</div>`;
  if (S.modo_reparto === "al_final") {
    const negativos = P.cobros.filter(c => c.libre < -0.005);
    if (negativos.length) h += `<div class="aviso">No te alcanza el cobro del ${negativos.map(c => C.fmt(c.fecha)).join(", ")}. Revisa la pestaña Cobros.</div>`;
  } else if (P.vueltas.some(v => v.minimo < -0.005)) h += `<div class="aviso">Hay un pago que llega antes de que te alcance. Revisa la pestaña Cobros.</div>`;

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
  if (p.compras && p.compras.length) partes.push(`incluye ${p.compras.length} ${p.compras.length === 1 ? "compra" : "compras"}`);
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
  return h + (S.modo_reparto === "al_final" ? cobrosPorSemana(P) : cobrosPorVuelta(P));
}

// Empieza en $0, suma cada cobro y resta cada pago el día que toca.
function cobrosPorVuelta(P) {
  let h = `<p class="hint">Empiezas en $0, sumas cada cobro y restas cada pago el día que toca. Lo que queda al final es lo que te sobra.${P.inicio > P.hoy ? ` Cuento desde el ${C.fmt(P.inicio)}.` : ""}</p>`;
  if (!P.vueltas.length) return h + `<div class="card vacio"><p>No tienes pagos pendientes.</p></div>`;
  P.vueltas.forEach((v, i) => {
    h += `<section class="sec"><div class="sec-head"><h2>${i === 0 ? "Esta vuelta" : "Siguiente vuelta"}</h2><span class="hint">${C.fmt(v.desde)} → ${C.fmt(v.fin)}</span></div><div class="card">`;
    for (const e of v.eventos) {
      const neg = e.saldo < -0.005;
      h += `<div class="mov ${e.tipo}"><span class="mfecha">${C.fmt(e.fecha)}</span>
        <span class="mnom">${e.tipo === "cobro" ? "Cobro" : `Pagas ${esc(e.nombre)}`}</span>
        <span class="mmonto num">${e.tipo === "cobro" ? "+" : "−"}${C.dinero(e.monto)}</span>
        <span class="msaldo num${neg ? " neg" : ""}">${neg ? `te faltan ${C.dinero(-e.saldo)}` : `llevas ${C.dinero(e.saldo)}`}</span></div>`;
    }
    h += `<div class="mov total"><span class="mnom">Te sobra al ${C.fmt(v.fin)}</span><span class="msaldo num">${C.dinero(v.sobra)}</span></div></div>`;
    if (v.minimo < -0.005) h += `<div class="aviso">En esta vuelta hay un pago antes de que te alcance. Revisa los renglones que dicen “te faltan”.</div>`;
    h += `</section>`;
  });
  h += porMesHtml(P);
  return h;
}

// Del 1 al último día de cada mes: lo que cobras, lo que pagas y lo que hay que
// guardar para que al mes siguiente no le falte antes de sus propios cobros.
function porMesHtml(P) {
  const meses = P.porMes.filter(x => x.cobros || x.pagos.length).slice(0, 3);
  if (!meses.length) return "";
  const nombre = x => C.MESES_LARGO[x.m - 1], cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  let h = `<section class="sec"><div class="sec-head"><h2>Por mes</h2><span class="hint">del 1 al último día</span></div>`;
  meses.forEach((x, i) => {
    const sig = C.MESES_LARGO[x.m % 12];
    h += `<div class="card pad stack vuelta num">
      <div class="sec-head"><h3>${cap(nombre(x))}</h3><span class="hint">${x.cobros} ${x.cobros === 1 ? "cobro" : "cobros"}</span></div>
      <div class="linea-cuenta"><span>Cobras</span><b>${C.dinero(x.cobras)}</b></div>
      <div class="linea-cuenta"><span>Pagas${x.pagos.length ? ` (${x.pagos.map(p => esc(p.nombre)).join(", ")})` : ""}</span><b>− ${C.dinero(x.pagas)}</b></div>
      ${x.recibe > 0.005 ? `<div class="linea-cuenta"><span>Guardado del mes anterior</span><b>+ ${C.dinero(x.recibe)}</b></div>` : ""}
      ${x.guarda > 0.005 ? `<div class="linea-cuenta"><span>Guarda para ${sig}</span><b>− ${C.dinero(x.guarda)}</b></div>` : ""}
      <div class="linea-cuenta total"><span>Te queda libre</span><b>${C.dinero(x.libre)}</b></div>
      ${x.guarda > 0.005 ? `<p class="hint">En ${sig} hay pagos antes de que te alcancen sus cobros; por eso guardas ${C.dinero(x.guarda)} de ${nombre(x)}.</p>` : ""}
      ${x.libre < -0.005 ? `<div class="aviso">Este mes no te alcanza: te faltan ${C.dinero(-x.libre)}.</div>` : ""}
    </div>`;
  });
  return h + `</section>`;
}

function cobrosPorSemana(P) {
  let h = `<p class="hint">Cada pago sale de los cobros más cercanos a su fecha; lo que sobra queda en los primeros cobros.${P.inicio > P.hoy ? ` Cuento desde el ${C.fmt(P.inicio)}.` : ""}</p>`;
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
        <div class="der"><button class="btn ghost sm" data-editar="${esc(c.id)}">Editar</button>${c.tipo === "tarjeta" ? `<button class="btn sm" data-compra-nueva="${esc(c.id)}">+ Compra</button>` : ""}</div>
        ${c.tipo === "tarjeta" ? listaCompras(c) : ""}</div>`;
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
    <label class="campo" for="aj-modo">¿Cuándo quieres que te sobre el dinero?
      <select id="aj-modo">
        <option value="primero" ${S.modo_reparto !== "al_final" ? "selected" : ""}>Al final, ya con todo pagado</option>
        <option value="al_final" ${S.modo_reparto === "al_final" ? "selected" : ""}>Al principio, y pagar con los últimos cobros</option>
      </select>
      <small>“Al final” usa cada cobro primero para pagar. “Al principio” te deja libre el dinero de los primeros cobros.</small></label>
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

// Compras de una tarjeta que todavía tienen mensualidades por pagar (o de hace poco)
function listaCompras(c) {
  const hoy = C.hoyLocal();
  const filas = (c.compras || []).map(x => {
    const cuotas = C.cuotasDeCompra(c, x);
    const ultima = C.limiteDeCorte(c, cuotas[cuotas.length - 1].corte);
    const pendientes = cuotas.filter(q => C.limiteDeCorte(c, q.corte) >= hoy).length;
    return { x, cuotas, ultima, pendientes };
  }).filter(f => f.ultima >= C.add(hoy, -30)).sort((a, b) => (a.x.fecha < b.x.fecha ? 1 : -1));
  if (!filas.length) return "";
  return `<ul class="compras">${filas.map(({ x, cuotas, pendientes }) => `<li><button class="compra" data-compra="${esc(c.id)}|${esc(x.id)}">
    <span class="nom">${esc(x.descripcion || (x.existente ? "Mensualidades" : "Compra"))}</span><span class="num">${x.existente ? `${C.dinero(cuotas[0].cuota)}/mes` : C.dinero(x.monto)}</span>
    <span class="det">${C.fmt(C.parse(x.fecha))} · ${x.meses > 1 ? `${x.meses} meses de ${C.dinero(cuotas[0].cuota)} · ${pendientes ? `quedan ${pendientes}` : "pagada"}` : "de contado"}</span></button></li>`).join("")}</ul>`;
}

// "Ya traigo mensualidades": un pago que ya viene en el pago normal (ej. $342) se
// marca como N mensualidades, para que la app sepa cuándo se termina.
function formMensualidad(c) {
  const hoy = C.hoyLocal();
  const ciclos = C.calcularPagos({ ...S, cuentas: [c] }, hoy, C.add(hoy, 400)).filter(p => !p.pagado && !p.pospuesto).slice(0, 12);
  const normal = Number(c.pago_estimado) || 0;
  const def = ciclos.find(p => !p.cubierto && Math.abs(p.base - normal) < 0.005) || ciclos[0];
  if (!ciclos.length) return toast("No encontré pagos próximos de esta tarjeta.");
  abrir(`<form class="form" id="f-mensualidad" data-cuenta="${esc(c.id)}" novalidate>
    <div class="stack" style="gap:2px"><span class="tipo">${esc(c.nombre)}</span><h2>Mensualidades que ya traes</h2></div>
    <p class="hint">Para algo que ya pagas a meses, como una compra a meses sin intereses. Así la app sabe cuándo se termina.</p>
    <label class="campo" for="n-desc">¿Qué es? (opcional)<input id="n-desc" autocomplete="off" placeholder="Ej. Celular, Liverpool"></label>
    <div class="dos">
      <label class="campo" for="n-cuota">Mensualidad<input id="n-cuota" inputmode="decimal" value="${normal || ""}" placeholder="0.00"><small>Lo que pagas cada mes.</small></label>
      <label class="campo" for="n-faltan">¿Cuántas te faltan?<input id="n-faltan" inputmode="numeric" placeholder="Ej. 6"><small>Contando la primera de abajo.</small></label>
    </div>
    <label class="campo" for="n-desde">¿En qué pago va la primera que falta?<select id="n-desde">${ciclos.map(p => `<option value="${esc(p.clave)}" ${p === def ? "selected" : ""}>${C.fmt(p.limite)} · ${C.dinero(p.monto)}</option>`).join("")}</select></label>
    <label class="check"><input type="checkbox" id="n-incluida" checked> Ya está dentro de mi pago de cada mes (${C.dinero(normal)})</label>
    <div class="caja" id="n-vista" aria-live="polite"></div>
    <p class="error" id="n-error" hidden></p>
    <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cancelar</button><button class="btn">Guardar</button></div>
  </form>`);
  const vista = () => {
    const cuota = numero($("#n-cuota").value), n = parseInt($("#n-faltan").value, 10), desde = ciclos.find(p => p.clave === $("#n-desde").value);
    const caja = $("#n-vista");
    if (!(cuota > 0) || !(n >= 1 && n <= 48) || !desde) { caja.innerHTML = `<p class="hint">Pon la mensualidad y cuántas te faltan para ver cuándo terminas.</p>`; return; }
    const cuotas = C.cuotasDeCompra(c, { fecha: C.iso(desde.corte), monto: cuota * n, meses: n });
    const ultima = C.limiteDeCorte(c, cuotas[cuotas.length - 1].corte);
    const incl = $("#n-incluida").checked;
    caja.innerHTML = `<p>${n === 1 ? "Tu última mensualidad" : `Pagas ${C.dinero(cuota)} en ${n} pagos; la última`} vence el <b>${C.fmt(ultima)} ${C.Y(ultima)}</b>.</p>
      <p class="hint">${incl ? `Tu pago de cada mes baja de ${C.dinero(normal)} a ${C.dinero(Math.max(0, normal - cuota))} y estas mensualidades se suman aparte hasta que terminen.` : "Se suman encima de tu pago de cada mes."}</p>`;
  };
  ["n-cuota", "n-faltan", "n-desde", "n-incluida"].forEach(id => { const e = $("#" + id); e.addEventListener("input", vista); e.addEventListener("change", vista); });
  vista();
}

function guardarMensualidad(form) {
  const err = $("#n-error"), fallo = t => { err.textContent = t; err.hidden = false; };
  const c = S.cuentas.find(x => x.id === form.dataset.cuenta);
  if (!c) return cerrar();
  const cuota = redondear(numero($("#n-cuota").value)), n = parseInt($("#n-faltan").value, 10);
  if (!(cuota > 0)) return fallo("Escribe cuánto pagas cada mes.");
  if (!(n >= 1 && n <= 48)) return fallo("Escribe cuántas mensualidades te faltan (de 1 a 48).");
  const hoy = C.hoyLocal();
  const ciclos = C.calcularPagos({ ...S, cuentas: [c] }, hoy, C.add(hoy, 1600));
  const desde = ciclos.find(p => p.clave === $("#n-desde").value);
  if (!desde) return fallo("Elige en qué pago va la primera.");
  const compra = { id: nuevoId(), fecha: C.iso(desde.corte), descripcion: $("#n-desc").value.trim().slice(0, 60) || "Mensualidades", monto: redondear(cuota * n), meses: n };
  if ($("#n-incluida").checked) {
    // se saca del pago normal para no contarlo dos veces, y se guarda cómo regresarlo
    const normal = Number(c.pago_estimado) || 0, restado = redondear(Math.min(normal, cuota));
    const claves = new Set(C.cuotasDeCompra(c, compra).map(q => C.iso(C.limiteDeCorte(c, q.corte))));
    const ex = { estimado: restado, montos: {}, fijados: [] };
    c.montos = { ...(c.montos || {}) };
    // los pagos estimados de antes de la primera mensualidad conservan su monto actual
    for (const p of ciclos) if (p.limite < desde.limite && !p.pagado && p.estimado) { c.montos[p.clave] = p.base; ex.fijados.push(p.clave); }
    for (const k of claves) if (k in c.montos) { const r = redondear(Math.min(Number(c.montos[k]), cuota)); c.montos[k] = redondear(Number(c.montos[k]) - r); ex.montos[k] = r; }
    c.pago_estimado = redondear(normal - restado);
    compra.existente = ex;
  }
  c.compras = [...(c.compras || []), compra];
  cerrar();
  const ultima = C.limiteDeCorte(c, C.cuotasDeCompra(c, compra)[n - 1].corte);
  guardar(`Listo: ${n} ${n === 1 ? "mensualidad" : "mensualidades"} de ${C.dinero(cuota)}, la última el ${C.fmt(ultima)}`);
}

function quitarMensualidad(c, k) {
  const ex = k.existente;
  if (ex) {
    c.pago_estimado = redondear((Number(c.pago_estimado) || 0) + ex.estimado);
    c.montos = { ...(c.montos || {}) };
    for (const [clave, r] of Object.entries(ex.montos)) c.montos[clave] = redondear((Number(c.montos[clave]) || 0) + r);
    for (const clave of ex.fijados) delete c.montos[clave];
  }
  c.compras = (c.compras || []).filter(x => x.id !== k.id);
}

function formCompra(c, compra) {
  if (compra && compra.existente) {
    const cuotas = C.cuotasDeCompra(c, compra), lim = q => C.limiteDeCorte(c, q.corte);
    abrir(`<form class="form" id="f-compra" data-cuenta="${esc(c.id)}" data-id="${esc(compra.id)}" novalidate>
      <div class="stack" style="gap:2px"><span class="tipo">${esc(c.nombre)}</span><h2>${esc(compra.descripcion || "Mensualidades")}</h2></div>
      <div class="caja"><p><b class="num">${C.dinero(cuotas[0].cuota)}</b> al mes, ${compra.meses} ${compra.meses === 1 ? "mensualidad" : "mensualidades"}.</p>
        <p class="hint">De tu pago del ${C.fmt(lim(cuotas[0]))} al del ${C.fmt(lim(cuotas[cuotas.length - 1]))} ${C.Y(lim(cuotas[cuotas.length - 1]))}.</p></div>
      <p class="hint">Para cambiarlas, elimínalas y vuelve a agregarlas. Al eliminarlas, tu pago de cada mes regresa a como estaba.</p>
      <div class="acciones"><button type="button" class="btn danger" data-accion="borrar-compra">Eliminar</button><button type="button" class="btn" data-accion="cerrar">Cerrar</button></div>
    </form>`);
    return;
  }
  const nueva = !compra;
  compra = compra || { fecha: C.iso(C.hoyLocal()), meses: 1, monto: "", descripcion: "" };
  const opcionesMeses = [3, 6, 9, 12, 18, 24];
  const aMeses = compra.meses > 1;
  abrir(`<form class="form" id="f-compra" data-cuenta="${esc(c.id)}" data-id="${esc(compra.id || "")}" novalidate>
    <div class="stack" style="gap:2px"><span class="tipo">${esc(c.nombre)}</span><h2>${nueva ? "Nueva compra" : "Editar compra"}</h2></div>
    <label class="campo" for="k-desc">¿Qué compraste? (opcional)<input id="k-desc" autocomplete="off" placeholder="Ej. Liverpool, Amazon, súper" value="${esc(compra.descripcion)}"></label>
    <div class="dos">
      <label class="campo" for="k-monto">Monto total<input id="k-monto" inputmode="decimal" placeholder="0.00" value="${esc(compra.monto)}"><small>Lo que costó en total.</small></label>
      <label class="campo" for="k-fecha">Fecha de la compra<input type="date" id="k-fecha" value="${esc(compra.fecha)}" ${compra.de_estado ? "disabled" : ""}><small>${compra.de_estado ? `Venía en tu pago que vence el ${C.fmt(C.parse(compra.de_estado))}.` : "Define en qué corte entra."}</small></label>
    </div>
    <div class="campo"><span>¿Cómo la pagas?</span>
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="k-forma" value="contado" ${aMeses ? "" : "checked"}>De contado</label>
        <label><input type="radio" name="k-forma" value="meses" ${aMeses ? "checked" : ""}>A meses</label>
      </div></div>
    <label class="campo" for="k-meses" data-forma="meses">¿A cuántos meses?
      <select id="k-meses">${opcionesMeses.map(n => `<option value="${n}" ${compra.meses === n ? "selected" : ""}>${n} meses</option>`).join("")}
        ${aMeses && !opcionesMeses.includes(compra.meses) ? `<option value="${compra.meses}" selected>${compra.meses} meses</option>` : ""}</select></label>
    <div class="caja" id="k-vista" aria-live="polite"></div>
    <p class="error" id="k-error" hidden></p>
    <div class="acciones">
      ${nueva ? "" : `<button type="button" class="btn danger" data-accion="borrar-compra">Eliminar</button>`}
      <button type="button" class="btn ghost" data-accion="cerrar">Cancelar</button><button class="btn">Guardar</button>
    </div>
  </form>`);
  const vista = () => {
    const forma = dlg.querySelector("input[name=k-forma]:checked").value;
    dlg.querySelectorAll("[data-forma]").forEach(e => e.hidden = e.dataset.forma !== forma);
    const monto = numero($("#k-monto").value), f = $("#k-fecha").value;
    const meses = forma === "meses" ? parseInt($("#k-meses").value, 10) : 1;
    const caja = $("#k-vista");
    if (!(monto > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(f)) { caja.innerHTML = `<p class="hint">Pon el monto y la fecha para ver en qué pagos cae.</p>`; return; }
    const cuotas = C.cuotasDeCompra(c, { fecha: f, monto, meses });
    const pago = q => C.limiteDeCorte(c, q.corte);
    caja.innerHTML = meses > 1
      ? `<p>Pagarás <b class="num">${C.dinero(cuotas[0].cuota)}</b> al mes por ${meses} meses.</p>
         <p class="hint">Entra en tu corte del ${C.fmt(cuotas[0].corte)}. La primera mensualidad vence el ${C.fmt(pago(cuotas[0]))} y la última el ${C.fmt(pago(cuotas[cuotas.length - 1]))}.</p>`
      : `<p>Se suma completa a tu pago que vence el <b>${C.fmt(pago(cuotas[0]))}</b>.</p><p class="hint">Entra en tu corte del ${C.fmt(cuotas[0].corte)}.</p>`;
  };
  dlg.querySelectorAll("input[name=k-forma]").forEach(r => r.addEventListener("change", vista));
  ["k-monto", "k-fecha", "k-meses"].forEach(id => $("#" + id).addEventListener("input", vista));
  $("#k-meses").addEventListener("change", vista);
  vista();
}

function guardarCompra(form) {
  const err = $("#k-error"), fallo = t => { err.textContent = t; err.hidden = false; };
  const c = S.cuentas.find(x => x.id === form.dataset.cuenta);
  if (!c) return cerrar();
  const monto = numero($("#k-monto").value), f = $("#k-fecha").value;
  if (!(monto > 0)) return fallo("Escribe cuánto costó, por ejemplo 1200.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return fallo("Elige la fecha de la compra.");
  const meses = dlg.querySelector("input[name=k-forma]:checked").value === "meses" ? parseInt($("#k-meses").value, 10) : 1;
  const previa = (c.compras || []).find(x => x.id === form.dataset.id);
  const compra = { id: form.dataset.id || nuevoId(), fecha: previa && previa.de_estado ? previa.fecha : f, descripcion: $("#k-desc").value.trim().slice(0, 60), monto: redondear(monto), meses };
  if (previa && previa.de_estado) {
    // si cambia el monto, el pago de donde salió se ajusta por la diferencia
    compra.de_estado = previa.de_estado;
    const base = pagoDe(c, previa.de_estado);
    if (base) c.montos = { ...(c.montos || {}), [previa.de_estado]: redondear(Math.max(0, base.base + previa.monto - compra.monto)) };
  }
  c.compras = [...(c.compras || []).filter(x => x.id !== compra.id), compra];
  cerrar();
  const primera = C.limiteDeCorte(c, C.cuotasDeCompra(c, compra)[0].corte);
  guardar(meses > 1 ? `Compra a ${meses} meses: la primera vence el ${C.fmt(primera)}` : `Compra sumada a tu pago que vence el ${C.fmt(primera)}`);
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
  const proxMonto = prox ? (prox.estimado ? "" : prox.base) : "";
  const ciclos = esTarjeta && !nueva ? ciclosParaMeses(c) : [];
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
        <small>Solo si este mes es distinto. Sin contar las compras que registras aparte.</small></label>
    </div>
    <label class="campo" for="c-deuda">¿Cuánto debes en total? (opcional)<input id="c-deuda" inputmode="decimal" placeholder="0.00" value="${esc(c.deuda_total ?? "")}"></label>
    ${esTarjeta && !nueva ? `<hr class="sep"><div class="stack"><h3>Compras y meses</h3>
      <button type="button" class="btn ghost block" data-compra-nueva="${esc(c.id)}">+ Agregar una compra nueva</button>
      <button type="button" class="btn ghost block" data-mensualidad="${esc(c.id)}">Ya traigo mensualidades (ej. ${C.dinero(Number(c.pago_estimado) || 0)} por X meses)</button>
      ${ciclos.length ? htmlAMeses(c, ciclos) : ""}</div>` : ""}
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
  if (ciclos.length) activarAMeses(ciclos);
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
  c.montos = { ...(c.montos || {}), [clave]: redondear((p ? p.base : 0) + cantidad) };
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
    <p class="hint">Pagas el ${C.fmt(p.pago)}${p.corte ? ` · corte ${C.fmt(p.corte)}` : ""} · límite ${C.fmt(p.limite)}</p></div>
    ${p.compras.length ? `<div class="caja desglose num">
      <div class="linea-cuenta"><span>Pago normal${p.estimado ? " (estimado)" : ""}</span><b>${C.dinero(p.base)}</b></div>
      ${p.compras.map(x => `<div class="linea-cuenta"><span>${esc(x.compra.descripcion || "Compra")}${x.de > 1 ? ` · ${x.numero} de ${x.de}` : ""}</span><b>${C.dinero(x.cuota)}</b></div>`).join("")}
      <div class="linea-cuenta total"><span>Total</span><b>${C.dinero(p.monto)}</b></div></div>` : ""}`;
  let cuerpo;
  if (p.pagado || p.pospuesto) {
    let txt = "Ya está pagado.";
    if (p.pospuesto) txt = `No lo pagaste. ${C.dinero(aj.movido)} pasaron a tu pago que vence el ${C.fmt(C.parse(aj.a))}.`;
    else if (aj && aj.tipo === "parcial") txt = `Pagaste ${C.dinero(aj.pagado)}. Los ${C.dinero(aj.movido)} que faltaron pasaron a tu pago que vence el ${C.fmt(C.parse(aj.a))}.`;
    cuerpo = `<div class="aviso info">${txt}</div>
      <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cerrar</button><button type="button" class="btn" data-accion="pago-deshacer">Deshacer</button></div>`;
  } else {
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
      ${c.tipo === "tarjeta" && p.base > 0 ? htmlAMeses(c, [p]) : ""}
      ${c.tipo === "tarjeta" ? `<button type="button" class="btn ghost block" data-compra-nueva="${esc(c.id)}">+ Agregar una compra con esta tarjeta</button>
        <p class="hint">Pones la fecha y si es a meses, y se suma sola al estado de cuenta que le toca.</p>` : `
      <div class="linea">
        <label class="campo" for="p-gasto">¿Gastaste más? Súmalo aquí<input id="p-gasto" inputmode="decimal" placeholder="¿Cuánto?"></label>
        <button type="button" class="btn ghost" data-accion="pago-gasto">Sumar</button>
      </div>`}
      <p class="error" id="p-error" hidden></p>
      <div class="acciones"><button type="button" class="btn ghost" data-accion="cerrar">Cerrar</button></div>`;
  }
  abrir(`<form class="form" id="f-pago" data-k="${esc(k)}" novalidate>${titulo}${cuerpo}</form>`);
  if (c.tipo === "tarjeta" && p.base > 0) activarAMeses([p]);
}

// ---------- pasar a meses una compra que ya viene en un pago ----------
function ciclosParaMeses(c) {
  const hoy = C.hoyLocal();
  return C.calcularPagos({ ...S, cuentas: [c] }, hoy, C.add(hoy, 100)).filter(p => !p.pagado && !p.pospuesto && p.base > 0).slice(0, 3);
}
function htmlAMeses(c, ciclos) {
  const uno = ciclos.length === 1;
  return `<button type="button" class="btn ghost block" data-op="ameses">Pasar a meses una compra${uno ? " de este pago" : ""}</button>
    <div class="caja" data-panel="ameses" data-cuenta="${esc(c.id)}" hidden>
      <p class="hint">Para una compra que ya viene dentro de tu pago. Se resta de ese pago y se divide en mensualidades desde ese mismo pago.</p>
      ${uno ? `<input type="hidden" id="m-ciclo" value="${esc(ciclos[0].clave)}">`
            : `<label class="campo" for="m-ciclo">¿De qué pago sale?<select id="m-ciclo">${ciclos.map(q => `<option value="${esc(q.clave)}">${C.fmt(q.limite)} · ${C.dinero(q.monto)}</option>`).join("")}</select></label>`}
      <label class="campo" for="m-desc">¿Qué compra es? (opcional)<input id="m-desc" autocomplete="off" placeholder="Ej. Liverpool"></label>
      <div class="dos">
        <label class="campo" for="m-monto">Monto de la compra<input id="m-monto" inputmode="decimal" placeholder="0.00"><small id="m-max"></small></label>
        <label class="campo" for="m-meses">¿A cuántos meses?<select id="m-meses">${[3, 6, 9, 12, 18, 24].map(n => `<option value="${n}">${n} meses</option>`).join("")}</select><small>Los que te dé tu banco.</small></label>
      </div>
      <p class="hint" id="m-vista"></p>
      <p class="hint">Si tu banco cobra intereses por pasarla a meses, pon el total con intereses que te indique.</p>
      <p class="error" id="m-error" hidden></p>
      <button type="button" class="btn" data-accion="aplicar-ameses">Pasar a meses</button>
    </div>`;
}
let ciclosAMeses = [];
function activarAMeses(ciclos) {
  ciclosAMeses = ciclos;
  const vista = () => {
    const p = ciclosAMeses.find(q => q.clave === $("#m-ciclo").value) || ciclosAMeses[0];
    const x = numero($("#m-monto").value), n = parseInt($("#m-meses").value, 10), cuota = Math.floor((x / n) * 100) / 100;
    $("#m-max").textContent = `Máximo ${C.dinero(p.base)}.`;
    $("#m-vista").textContent = x > 0 && x <= p.base + 0.005
      ? `Ese pago queda en ${C.dinero(p.monto - x + cuota)} y pagarás ${C.dinero(cuota)} al mes por ${n} meses.`
      : x > p.base ? `No puede ser más de ${C.dinero(p.base)}.` : "Pon el monto para ver cómo queda.";
  };
  ["m-monto", "m-meses", "m-ciclo"].forEach(id => { const e = $("#" + id); e.addEventListener("input", vista); e.addEventListener("change", vista); });
  vista();
}
function aplicarAMeses() {
  const panel = dlg.querySelector("[data-panel=ameses]"), c = S.cuentas.find(x => x.id === panel.dataset.cuenta);
  const err = $("#m-error"), fallo = t => { err.textContent = t; err.hidden = false; };
  const p = c && ciclosAMeses.find(q => q.clave === $("#m-ciclo").value);
  if (!p) return fallo("No encontré ese pago. Cierra y vuelve a abrir.");
  const x = redondear(numero($("#m-monto").value)), n = parseInt($("#m-meses").value, 10);
  if (!(x > 0)) return fallo("Escribe el monto de la compra.");
  if (x > p.base + 0.005) return fallo(`No puede ser más de ${C.dinero(p.base)}, lo que trae ese pago sin contar otras compras.`);
  c.montos = { ...(c.montos || {}), [p.clave]: redondear(p.base - x) };
  c.compras = [...(c.compras || []), { id: nuevoId(), fecha: C.iso(p.corte), descripcion: $("#m-desc").value.trim().slice(0, 60) || "Pasada a meses", monto: x, meses: n, de_estado: p.clave }];
  cerrar();
  guardar(`Listo: ${C.dinero(x)} a ${n} meses desde tu pago del ${C.fmt(p.limite)}`);
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
    // el total que escribe la persona ya incluye las compras registradas
    c.montos = { ...(c.montos || {}), [clave]: redondear(Math.max(0, x - p.enCompras)) }; msg = "Monto actualizado";
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
    if (tipo === "tarjeta") {
      const ids = new Set();
      o.compras = (Array.isArray(c.compras) ? c.compras : []).filter(x => x && typeof x === "object" && fecha(x.fecha)).slice(0, 300).map(x => {
        let cid = String(x.id ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
        while (!cid || ids.has(cid)) cid = nuevoId();
        ids.add(cid);
        const o2 = { id: cid, fecha: x.fecha, descripcion: String(x.descripcion ?? "").trim().slice(0, 60), monto: num(x.monto, 0, 1e9, 0), meses: ent(x.meses, 1, 48, 1) };
        if (fecha(x.de_estado)) o2.de_estado = x.de_estado;  // compra que ya venía en ese estado de cuenta y se pasó a meses
        if (x.existente && typeof x.existente === "object") {  // mensualidades que ya venían dentro del pago normal
          o2.existente = { estimado: num(x.existente.estimado, 0, 1e9, 0), montos: montos(x.existente.montos), fijados: fechas(x.existente.fijados) };
        }
        return o2;
      });
    }
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
    modo_reparto: d.modo_reparto === "al_final" ? "al_final" : "primero",
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
  if (b.dataset.compraNueva) { const c = S.cuentas.find(x => x.id === b.dataset.compraNueva); if (c) formCompra(c); return; }
  if (b.dataset.mensualidad) { const c = S.cuentas.find(x => x.id === b.dataset.mensualidad); if (c) formMensualidad(c); return; }
  if (b.dataset.compra) {
    const [cid, kid] = b.dataset.compra.split("|"), c = S.cuentas.find(x => x.id === cid);
    const k = c && (c.compras || []).find(x => x.id === kid);
    if (k) formCompra(c, k);
    return;
  }
  if (b.dataset.op) {
    dlg.querySelectorAll("[data-panel]").forEach(e => e.hidden = e.dataset.panel !== b.dataset.op);
    dlg.querySelectorAll("[data-op]").forEach(x => x.classList.toggle("activo", x === b));
    const i = dlg.querySelector(`[data-panel="${b.dataset.op}"] input`); if (i) i.focus();
    return;
  }
  if (b.dataset.accion === "aplicar-ameses") { aplicarAMeses(); return; }
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
    case "borrar-compra": {
      const f = $("#f-compra"), c = S.cuentas.find(x => x.id === f.dataset.cuenta);
      if (b.dataset.seguro) {
        const k = (c.compras || []).find(x => x.id === f.dataset.id);
        if (k && k.existente) { quitarMensualidad(c, k); cerrar(); guardar("Listo: tu pago de cada mes regresó a como estaba"); break; }
        if (k && k.de_estado) { const base = pagoDe(c, k.de_estado); if (base) c.montos = { ...(c.montos || {}), [k.de_estado]: redondear(base.base + k.monto) }; }
        c.compras = (c.compras || []).filter(x => x.id !== f.dataset.id); cerrar();
        guardar(k && k.de_estado ? "Listo: la compra regresó completa a su pago" : "Compra eliminada");
      }
      else { b.dataset.seguro = "1"; b.textContent = "Toca otra vez para eliminar"; }
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
  else if (f.id === "f-compra") guardarCompra(f);
  else if (f.id === "f-mensualidad") guardarMensualidad(f);
  else if (f.id === "f-cuenta") guardarCuenta(f);
  else if (f.id === "f-importar") {
    try { S = leerRespaldo($("#r-texto").value); cerrar(); tab = "inicio"; guardar("Respaldo cargado"); }
    catch { const err = $("#r-error"); err.textContent = "Ese texto no es un respaldo de Mis Pagos. Copia el respaldo completo."; err.hidden = false; }
  }
});

document.addEventListener("change", e => {
  if (!S) return;
  if (e.target.id === "aj-regla") { S.regla_pago = e.target.value; guardar("Guardado"); }
  if (e.target.id === "aj-modo") { S.modo_reparto = e.target.value; guardar("Guardado"); }
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

// pantalla fija: en iPhone, Safari ignora user-scalable=no; esto bloquea el zoom con dos dedos
["gesturestart", "gesturechange"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));

render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
