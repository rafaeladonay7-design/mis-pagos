// Motor de cálculo: fechas de pago, cobros y reparto. Sin acceso a la página,
// para poder probarlo aparte.
(function (g) {
  "use strict";

  const DIAS_TXT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  const DIAS_LARGO = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const MESES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];

  // fechas en UTC para no tener problemas con el horario de verano
  const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const iso = d => d.toISOString().slice(0, 10);
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return D(y, m, d); };
  const add = (d, n) => new Date(d.getTime() + n * 864e5);
  const wd = d => (d.getUTCDay() + 6) % 7; // 0 = lunes
  const Y = d => d.getUTCFullYear(), M = d => d.getUTCMonth() + 1, DD = d => d.getUTCDate();
  const diasMes = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const enMes = (y, m, dia) => D(y, m, Math.min(dia, diasMes(y, m)));
  const sumarMes = (y, m, n = 1) => { m += n; return [y + Math.floor((m - 1) / 12), (((m - 1) % 12) + 12) % 12 + 1]; };
  const diasEntre = (a, b) => Math.round((b - a) / 864e5);
  const hoyLocal = () => { const a = new Date(); return D(a.getFullYear(), a.getMonth() + 1, a.getDate()); };
  const fmt = d => `${DIAS_TXT[wd(d)]} ${DD(d)} ${MESES[M(d) - 1]}`;
  const dinero = x => (x < -0.005 ? "-" : "") + "$" + Math.abs(x).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function pascua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const gg = Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3);
    const h = (19 * a + b - d - gg + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const x = h + l - 7 * m + 114;
    return D(y, Math.floor(x / 31), (x % 31) + 1);
  }
  const nLunes = (y, m, n) => { const d = D(y, m, 1); return add(d, ((7 - wd(d)) % 7) + 7 * (n - 1)); };
  const inhCache = {};
  function inhabiles(y) { // días inhábiles bancarios en México (CNBV)
    if (!inhCache[y]) {
      const p = pascua(y);
      inhCache[y] = new Set([D(y, 1, 1), nLunes(y, 2, 1), nLunes(y, 3, 3), add(p, -3), add(p, -2), D(y, 5, 1),
        D(y, 9, 16), D(y, 11, 2), nLunes(y, 11, 3), D(y, 12, 12), D(y, 12, 25)].map(iso));
    }
    return inhCache[y];
  }
  const habil = (d, fer) => wd(d) < 5 && !(fer && inhabiles(Y(d)).has(iso(d)));

  // 'siguiente_habil': el banco recorre la fecha al siguiente día hábil y ese día se paga.
  // 'ultimo_habil': se paga el día hábil anterior. 'exacto': siempre la fecha límite.
  function fechaPago(lim, regla, fer) {
    const paso = { ultimo_habil: -1, siguiente_habil: 1 }[regla];
    let d = lim;
    while (paso && !habil(d, fer)) d = add(d, paso);
    return d;
  }

  function limiteDeCorte(c, corte) {
    if (c.limite_tipo === "dia") {
      const [y, m] = c.dia_limite > DD(corte) ? [Y(corte), M(corte)] : sumarMes(Y(corte), M(corte));
      return enMes(y, m, c.dia_limite);
    }
    return add(corte, Number(c.dias_despues_corte || 20));
  }

  // Corte en el que entra una compra: el del mes de la compra si fue ese día o antes;
  // si no, el del mes siguiente.
  function primerCorte(c, fecha) {
    const f = typeof fecha === "string" ? parse(fecha) : fecha;
    const este = enMes(Y(f), M(f), c.dia_corte);
    if (f <= este) return este;
    const [y, m] = sumarMes(Y(f), M(f));
    return enMes(y, m, c.dia_corte);
  }
  // Mensualidades de una compra: [{corte, numero, cuota}] (la última ajusta los centavos).
  function cuotasDeCompra(c, compra) {
    const n = Math.max(1, Number(compra.meses) || 1), total = Number(compra.monto) || 0;
    const base = Math.floor((total / n) * 100) / 100, primero = primerCorte(c, compra.fecha), out = [];
    for (let k = 0; k < n; k++) {
      const [y, m] = sumarMes(Y(primero), M(primero), k);
      const cuota = k === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base;
      out.push({ corte: enMes(y, m, c.dia_corte), numero: k + 1, de: n, cuota });
    }
    return out;
  }
  // Compras que caen en el estado de cuenta con este corte.
  function comprasDelCorte(c, corte) {
    const res = [];
    for (const compra of c.compras || []) {
      const q = cuotasDeCompra(c, compra).find(x => +x.corte === +corte);
      if (q) res.push({ compra, ...q });
    }
    return res;
  }

  function calcularPagos(cfg, desde, hasta) {
    const reglaG = cfg.regla_pago || "siguiente_habil", fer = cfg.feriados_mexico !== false, res = [];
    const agregar = (c, corte, lim) => {
      const clave = iso(lim);
      let pago = fechaPago(lim, c.regla_pago || reglaG, fer);
      if (Math.max(lim, pago) < desde || pago > hasta) return;
      let urgente = false;
      if (pago < desde) { pago = desde; urgente = true; }
      const montos = c.montos || {};
      // monto = lo normal de ese estado de cuenta + las compras registradas que caen en él
      const base = clave in montos ? Number(montos[clave]) : Number(c.pago_estimado || 0);
      const compras = corte ? comprasDelCorte(c, corte) : [];
      const enCompras = Math.round(compras.reduce((t, x) => t + x.cuota, 0) * 100) / 100;
      res.push({
        cuenta: c, nombre: c.nombre, corte, limite: lim, pago, clave, urgente,
        base, compras, enCompras, monto: Math.round((base + enCompras) * 100) / 100,
        estimado: !(clave in montos),
        pagado: (c.pagados || []).includes(clave),
        pospuesto: (c.pospuestos || []).includes(clave),  // no se pudo pagar; el monto pasó al siguiente
        ajuste: (c.ajustes || {})[clave] || null,
        cubierto: (c.cubiertos || []).includes(clave),
      });
    };
    for (const c of cfg.cuentas || []) {
      if (c.tipo === "tarjeta") {
        let [y, m] = sumarMes(Y(desde), M(desde), -2);
        for (;;) {
          const corte = enMes(y, m, c.dia_corte);
          if (corte > hasta) break;
          agregar(c, corte, limiteDeCorte(c, corte));
          [y, m] = sumarMes(y, m);
        }
      } else {
        let [y, m] = sumarMes(Y(desde), M(desde), -1);
        for (;;) {
          const lim = enMes(y, m, c.dia_limite);
          if (lim > add(hasta, 7)) break;
          agregar(c, null, lim);
          [y, m] = sumarMes(y, m);
        }
      }
    }
    return res.sort((a, b) => a.pago - b.pago || a.nombre.localeCompare(b.nombre));
  }

  function calcularCobros(cfg, desde, hasta) {
    const ing = cfg.ingreso, fer = cfg.feriados_mexico !== false, out = [];
    const antes = d => { while (!habil(d, fer)) d = add(d, -1); return d; };
    if (ing.frecuencia === "semanal") {
      let d = add(desde, (Number(ing.dia) - wd(desde) + 7) % 7);
      while (d <= hasta) { out.push(d); d = add(d, 7); }
    } else if (ing.frecuencia === "catorcenal") {
      let d = parse(ing.inicio);
      while (d < desde) d = add(d, 14);
      while (add(d, -14) >= desde) d = add(d, -14);
      while (d <= hasta) { out.push(d); d = add(d, 14); }
    } else { // quincenal (15 y último día) o mensual; si cae en día inhábil se cobra antes
      let [y, m] = sumarMes(Y(desde), M(desde), -1);
      while (D(y, m, 1) <= hasta) {
        const dias = ing.frecuencia === "quincenal" ? [15, diasMes(y, m)] : [Math.min(Number(ing.dia_mes), diasMes(y, m))];
        for (const dd of dias) { const f = antes(D(y, m, dd)); if (f >= desde && f <= hasta) out.push(f); }
        [y, m] = sumarMes(y, m);
      }
    }
    return out.sort((a, b) => a - b);
  }

  // modo 'primero': cada cobro se usa primero para pagar (empezando por el pago más
  // cercano) y lo que sobra se junta al final, cuando ya está todo pagado.
  // modo 'al_final': cada pago sale de los cobros más cercanos a su fecha, así las
  // primeras semanas quedan libres.
  function repartir(pagos, cobros, inicio, ingreso, modo) {
    const usado = new Map(cobros.map(c => [+c, 0])), aparta = new Map(cobros.map(c => [+c, []]));
    const sinCobro = [];
    const pendientes = pagos.filter(p => !p.pagado && !p.pospuesto && !p.cubierto && p.pago >= inicio && p.monto > 0);
    const primero = modo !== "al_final";
    // en modo 'primero' cada pago solo usa cobros de su propia vuelta, para que lo
    // que sobra al final de una vuelta no se vaya a adelantar la siguiente
    const desdeDe = new Map();
    if (primero) for (const r of vueltas(pendientes, inicio)) for (const p of r.pagos) desdeDe.set(p, r.desde);
    const orden = [...pendientes].sort((a, b) => (primero ? a.pago - b.pago : b.pago - a.pago));
    for (const p of orden) {
      const desde = primero ? desdeDe.get(p) : inicio;
      const ventana = cobros.filter(c => c >= desde && c <= p.pago);
      let resta = p.monto;
      for (const c of primero ? ventana : [...ventana].reverse()) {
        const tomar = Math.min(resta, ingreso - usado.get(+c));
        if (tomar > 0.005) { usado.set(+c, usado.get(+c) + tomar); resta -= tomar; aparta.get(+c).push([p.nombre, tomar]); }
      }
      if (resta > 0.005) {
        if (ventana.length) aparta.get(+ventana[ventana.length - 1]).push([p.nombre, resta]);
        else sinCobro.push({ ...p, falta: resta });
      }
    }
    return { aparta, sinCobro };
  }

  // Una vuelta va desde 'desde' hasta que cada cuenta se pagó una vez.
  function vueltas(pendientes, inicio) {
    const out = [];
    let resto = [...pendientes].sort((a, b) => a.pago - b.pago), desde = inicio;
    while (resto.length) {
      const primeros = new Map();
      for (const p of resto) if (!primeros.has(p.cuenta.id)) primeros.set(p.cuenta.id, p);
      const fin = new Date(Math.max(...[...primeros.values()].map(p => +p.pago)));
      out.push({ desde, fin, pagos: resto.filter(p => p.pago <= fin) });
      resto = resto.filter(p => p.pago > fin);
      desde = add(fin, 1);
    }
    return out;
  }

  function plan(cfg, hoy = hoyLocal(), dias = 120) {
    const hasta = add(hoy, dias);
    const inicio = cfg.contar_desde && parse(cfg.contar_desde) > hoy ? parse(cfg.contar_desde) : hoy;
    const ingreso = Number(cfg.ingreso.monto);
    // un mes extra para que los últimos cobros ya tomen en cuenta los pagos siguientes
    const todos = calcularPagos(cfg, hoy, add(hasta, 35));
    const cobrosTodos = calcularCobros(cfg, inicio, add(hasta, 35));
    const { aparta, sinCobro } = repartir(todos, cobrosTodos, inicio, ingreso, cfg.modo_reparto);
    const pagos = todos.filter(p => p.pago <= hasta);
    const cobros = cobrosTodos.filter(c => c <= hasta).map(c => {
      const lista = aparta.get(+c), total = lista.reduce((s, [, x]) => s + x, 0);
      return { fecha: c, lista, total, libre: ingreso - total };
    });
    // la "vuelta": desde que empiezas a contar hasta que pagaste una vez cada cuenta
    // Cada vuelta empieza en $0: suma cada cobro y resta cada pago el día que se paga.
    const pend = todos.filter(p => !p.pagado && !p.pospuesto && !p.cubierto && p.pago >= inicio && p.monto > 0);
    // solo vueltas completas: los pagos se calculan 35 días más allá, así que una vuelta
    // que termina antes de 'hasta' ya tiene el pago de cada cuenta
    const detalle = vueltas(pend, inicio).filter(v => v.fin <= hasta).map(v => {
      const cobrosV = cobrosTodos.filter(c => c >= v.desde && c <= v.fin);
      const ev = [...cobrosV.map(c => ({ fecha: c, tipo: "cobro", nombre: "Cobro", monto: ingreso })),
                  ...v.pagos.map(p => ({ fecha: p.pago, tipo: "pago", nombre: p.nombre, monto: p.monto, pago: p }))]
        .sort((a, b) => a.fecha - b.fecha || (a.tipo === "cobro" ? -1 : 1));  // el cobro del día entra antes de pagar
      let saldo = 0, minimo = 0;
      for (const e of ev) { saldo += e.tipo === "cobro" ? e.monto : -e.monto; e.saldo = saldo; minimo = Math.min(minimo, saldo); }
      const cobras = cobrosV.length * ingreso, pagas = v.pagos.reduce((s, p) => s + p.monto, 0);
      return { desde: v.desde, fin: v.fin, cobros: cobrosV.length, cobras, pagas, sobra: cobras - pagas, pagos: v.pagos, eventos: ev, minimo };
    });
    const vuelta = detalle[0] || null;

    // Por mes de calendario. "guarda" es lo que hay que dejar para que al mes
    // siguiente no le falte dinero antes de que lleguen sus propios cobros.
    const evMes = (y, m) => [
      ...cobrosTodos.filter(c => Y(c) === y && M(c) === m).map(c => ({ fecha: c, delta: ingreso, cobro: true })),
      ...pend.filter(p => Y(p.pago) === y && M(p.pago) === m).map(p => ({ fecha: p.pago, delta: -p.monto, pago: p })),
    ].sort((a, b) => a.fecha - b.fecha || b.delta - a.delta);
    const faltaAlInicio = ev => { let s = 0, min = 0; for (const e of ev) { s += e.delta; min = Math.min(min, s); } return -min; };
    const porMes = [];
    let [y, m] = [Y(inicio), M(inicio)], recibe = 0;
    for (let i = 0; i < 4; i++) {
      const ev = evMes(y, m), [y2, m2] = sumarMes(y, m);
      const cobrasM = ev.filter(e => e.cobro).reduce((t, e) => t + e.delta, 0);
      const pagasM = -ev.filter(e => e.pago).reduce((t, e) => t + e.delta, 0);
      const guarda = faltaAlInicio(evMes(y2, m2));
      porMes.push({ y, m, cobros: ev.filter(e => e.cobro).length, cobras: cobrasM, pagas: pagasM,
        pagos: ev.filter(e => e.pago).map(e => e.pago), recibe, guarda, libre: cobrasM - pagasM + recibe - guarda });
      recibe = guarda; [y, m] = [y2, m2];
    }
    return { hoy, inicio, ingreso, pagos, cobros, sinCobro, vuelta, vueltas: detalle, porMes };
  }

  // ---------- calendario (.ics) ----------
  function ics(cfg, hoy = hoyLocal()) {
    const P = plan(cfg, hoy, 92);
    const e = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const bytes = s => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length;
    const fold = l => { const out = []; let cur = ""; for (const ch of l) { if (bytes(cur + ch) > 74) { out.push(cur); cur = " " + ch; } else cur += ch; } out.push(cur); return out.join("\r\n"); };
    const f = d => iso(d).replace(/-/g, "");
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//mis-pagos//ES", "X-WR-CALNAME:Mis Pagos"];
    const evento = (d, titulo, desc, uid) => L.push("BEGIN:VEVENT", `UID:${uid}@mis-pagos`, `DTSTAMP:${f(hoy)}T000000Z`,
      `DTSTART;VALUE=DATE:${f(d)}`, `DTEND;VALUE=DATE:${f(add(d, 1))}`, `SUMMARY:${e(titulo)}`, `DESCRIPTION:${e(desc)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15H", "DESCRIPTION:Mañana", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:PT9H", "DESCRIPTION:Hoy", "END:VALARM", "END:VEVENT");
    for (const p of P.pagos) {
      if (p.pagado || p.pospuesto) continue;
      const desc = [`Fecha límite: ${fmt(p.limite)} ${Y(p.limite)}`];
      if (p.corte) desc.push(`Corte: ${fmt(p.corte)}`);
      if (p.estimado) desc.push("Monto estimado: revisa tu estado de cuenta.");
      evento(p.pago, `💳 Pagar ${p.nombre} ${p.estimado ? "~" : ""}${dinero(p.monto)}`, desc.join("\n"),
        `pago-${p.cuenta.id}-${p.clave}`);
    }
    for (const c of cfg.modo_reparto === "al_final" ? P.cobros : []) {
      if (!c.lista.length) continue;
      evento(c.fecha, `💰 Cobro: aparta ${dinero(c.total)}`, c.lista.map(([n, x]) => `${n}: ${dinero(x)}`).join("\n") +
        `\nTe queda libre: ${dinero(c.libre)}`, `cobro-${iso(c.fecha)}`);
    }
    L.push("END:VCALENDAR");
    return L.map(fold).join("\r\n") + "\r\n";
  }

  g.Calc = { plan, ics, calcularPagos, calcularCobros, cuotasDeCompra, primerCorte, limiteDeCorte, fmt, dinero, iso, parse, add, wd, Y, M, DD, diasEntre, hoyLocal,
    DIAS_TXT, DIAS_LARGO, MESES, MESES_LARGO, D };
})(typeof window !== "undefined" ? window : globalThis);
