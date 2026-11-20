import { createClient } from "jsr:@supabase/supabase-js@2";

// Recibe gastos automáticos de dos fuentes (cada persona se identifica con su token, tabla `atajo`):
//  - Apple Pay (automatización Wallet):   { token, monto, comercio, tarjeta }
//  - Correo de alerta del banco (Mail):   { token, texto, asunto }
// Solo crea gastos de esa persona. Evita duplicar el mismo pago que llega por las dos vías.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function parseMonto(v: unknown) {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  const usd = /us\s*\$|usd|d[oó]lar/i.test(raw) || (/\$/.test(raw) && !/s\/|pen|sol/i.test(raw));
  let s = raw.replace(/[^0-9.,]/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Math.abs(parseFloat(s));
  if (!isFinite(n) || n <= 0 || n > 10_000_000) return null;
  return { monto: Math.round(n * 100) / 100, moneda: usd ? "USD" : "PEN" };
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MON = "(?:S\\/\\.?|US\\$|USD|PEN|\\$)";

// Lee el texto de un correo de alerta de consumo (formato BCP y genéricos).
function parseAviso(texto: string, asunto: string) {
  const t = (asunto + "\n" + texto).replace(/ /g, " ");
  const plano = t.replace(/\s+/g, " ");
  let montoTxt = "", comercio = "", tarjeta = "";

  // "Realizaste un consumo de S/ 6.80 con tu Tarjeta de Crédito BCP en IZI*PUNKU MARKET."
  const m1 = t.match(new RegExp("consumo de\\s*(" + MON + "\\s*[\\d.,]+)\\s*con (?:tu|su)\\s+([^\\n]+?)\\s+en\\s+([^\\n]+?)\\.?[ \\t]*(?:\\n|$)", "i"))
    || plano.match(new RegExp("consumo de\\s*(" + MON + "\\s*[\\d.,]+)\\s*con (?:tu|su)\\s+(.+?)\\s+en\\s+(.+?)(?:\\.\\s+(?=Por|Para|Te |Si |Gracias)|\\.?\\s*$)", "i"));
  if (m1) { montoTxt = m1[1]; tarjeta = m1[2]; comercio = m1[3]; }

  if (!montoTxt) {
    const m2 = plano.match(new RegExp("(?:total del consumo|monto|importe)\\s*:?\\s*(" + MON + "\\s*[\\d.,]+)", "i"))
      || plano.match(new RegExp("(" + MON + "\\s*\\d[\\d.,]*)", "i"));
    if (m2) montoTxt = m2[1];
  }
  if (!comercio) {
    const m3 = t.match(/(?:empresa|comercio|establecimiento)\s*:?\s*\n?\s*([^\n]{2,60})/i);
    if (m3) comercio = m3[1].trim();
  }
  comercio = comercio.replace(/\s+(N[uú]mero|Fecha|Operaci[oó]n|Monto|Importe|Tarjeta)\b.*$/i, "").replace(/[.\s]+$/, "").trim();

  const last4 = plano.match(/\*{3,}\s*(\d{4})/);
  if (!tarjeta) {
    const mt = plano.match(/tarjeta de (cr[eé]dito|d[eé]bito)(\s+\w+)?/i);
    if (mt) tarjeta = mt[0];
  }
  if (last4) tarjeta = (tarjeta ? tarjeta + " " : "") + "•" + last4[1];

  // "20 de noviembre de 2026 - 02:26 PM"
  let cuando: Date | null = null;
  const mf = plano.match(/(\d{1,2})\s+(?:de\s+)?([a-zé]+)\s+(?:de\s+)?(\d{4})\s*[-–,]?\s*(\d{1,2}):(\d{2})\s*([AP])\.?\s*M/i);
  if (mf && MESES[mf[2].toLowerCase()]) {
    let h = parseInt(mf[4]) % 12;
    if (mf[6].toUpperCase() === "P") h += 12;
    const iso = `${mf[3]}-${String(MESES[mf[2].toLowerCase()]).padStart(2, "0")}-${mf[1].padStart(2, "0")}T${String(h).padStart(2, "0")}:${mf[5]}:00-05:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) cuando = d;
  }
  const mo = plano.match(/n[uú]mero de operaci[oó]n\s*:?\s*(\d{4,})/i);
  const operacion = mo ? mo[1] : null;
  return { montoTxt, comercio: comercio.slice(0, 80), tarjeta: tarjeta.slice(0, 60), cuando, operacion };
}

// Correo de Yape: "¡Acabas de yapear exitosamente!" — Monto de yapeo S/ 38.00, Nombre del Beneficiario, Nº de operación.
function esYape(texto: string, asunto: string) {
  return /acabas de yapear|monto de yapeo/i.test(asunto + " " + texto);
}
function esYapeRecibido(texto: string, asunto: string) {
  const t = asunto + " " + texto;
  return /te yapearon|recibiste un yape|te han yapeado|te enviaron/i.test(t) && !/acabas de yapear/i.test(t);
}
function parseYape(texto: string, asunto: string) {
  const plano = (asunto + "\n" + texto).replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const mm = plano.match(/monto de yapeo\*?\s*:?\s*((?:S\/\.?|US\$|\$)?\s*[\d.,]+)/i)
    || plano.match(/((?:S\/\.?|US\$)\s*\d[\d.,]*)/i);
  const mb = plano.match(/nombre del beneficiario\s*:?\s*(.+?)(?=\s*(?:N[º°o]\.?\s*de operaci|Celular|Fecha|\*Por tu|$))/i);
  const mo = plano.match(/N[º°o]\.?\s*de operaci[oó]n\s*:?\s*(\d{4,})/i);
  const f = parseAviso(texto, asunto).cuando;
  return {
    montoTxt: mm ? (/[S$]/.test(mm[1]) ? mm[1] : "S/ " + mm[1]) : "",
    comercio: (mb ? mb[1].trim() : "Yape").slice(0, 80),
    tarjeta: "", cuando: f,
    operacion: mo ? "Y" + mo[1] : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, error: "json" }, 400); }

  const token = String(b.token ?? "").trim();
  if (token.length < 20) return json({ ok: false, error: "token" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: at } = await sb.from("atajo").select("uid").eq("token", token).maybeSingle();
  if (!at) return json({ ok: false, error: "token" }, 401);
  const uid = at.uid as string;

  const esCorreo = b.texto != null && String(b.texto).trim() !== "";
  let montoIn: unknown = b.monto, comercio = String(b.comercio ?? "").trim().slice(0, 80);
  let tarjeta: string | null = String(b.tarjeta ?? "").trim().slice(0, 60) || null;
  let cuando: Date | null = null;
  let operacion: string | null = null;

  let medio = "tarjeta";
  if (esCorreo) {
    const tx = String(b.texto), asu = String(b.asunto ?? "");
    if (esYapeRecibido(tx, asu)) return json({ ok: true, ignorado: "yape recibido" });
    const yape = esYape(tx, asu);
    if (yape) medio = "yape";
    const p = yape ? parseYape(tx, asu) : parseAviso(tx, asu);
    console.log("correo", JSON.stringify({ asunto: String(b.asunto ?? "").slice(0, 120), monto: p.montoTxt, comercio: p.comercio, tarjeta: p.tarjeta, cuando: p.cuando, operacion: p.operacion }));
    montoIn = p.montoTxt; comercio = p.comercio; tarjeta = p.tarjeta || null; cuando = p.cuando; operacion = p.operacion;
  } else {
    console.log("applepay", JSON.stringify({ monto: b.monto, comercio: b.comercio, tarjeta: b.tarjeta }));
  }

  const m = parseMonto(montoIn);
  if (!m) return json({ ok: false, error: "monto" }, 400);
  const origen = esCorreo ? "correo" : "applepay";

  // categoría automática según el comercio (reglas de esa persona)
  let categoria: string | null = null;
  if (comercio) {
    const { data: reglas } = await sb.from("reglas").select("palabra,categoria").eq("uid", uid);
    const c = comercio.toLowerCase();
    const hit = (reglas ?? []).filter((r) => c.includes(r.palabra.toLowerCase()))
      .sort((x, y) => y.palabra.length - x.palabra.length)[0];
    if (hit) categoria = hit.categoria;
  }

  // Duplicados.
  //  - Correo: cada aviso trae un N° de operación único; si ya existe, es el mismo correo repetido.
  //  - Apple Pay + correo del mismo pago: el correo "reclama" UN registro de Apple Pay del mismo monto
  //    (±20 min) que aún no esté vinculado, prefiriendo el de comercio parecido. Así, dos movimientos
  //    distintos por el mismo monto (con N° de operación distintos) quedan como dos gastos.
  const ref = cuando ?? new Date();
  const ahora = Date.now();
  const palabras = (x: string) => new Set(String(x || "").toLowerCase().split(/[^a-z0-9áéíóúñ]+/).filter((w) => w.length >= 3));
  const parecido = (a: string, b: string) => { const A = palabras(a); let n = 0; palabras(b).forEach((w) => { if (A.has(w)) n++; }); return n; };

  if (operacion) {
    const { data: ya } = await sb.from("gastos").select("id").eq("uid", uid).eq("operacion", operacion).limit(1);
    if (ya && ya.length) return json({ ok: true, duplicado: true, operacion });
  }
  const desde = new Date(Math.min(ref.getTime(), ahora) - 20 * 60_000).toISOString();
  const { data: rec } = await sb.from("gastos").select("id,origen,medio,concepto,creado,tarjeta,vinculado,operacion")
    .eq("uid", uid).eq("monto", m.monto).in("origen", ["applepay", "correo"]).gte("creado", desde).limit(20);
  const lista = rec ?? [];

  // mismo atajo de Apple Pay disparado dos veces en 1 minuto
  if (!esCorreo && lista.some((g) => g.origen === "applepay" && g.concepto === comercio &&
      Math.abs(new Date(g.creado).getTime() - ahora) < 60_000)) {
    return json({ ok: true, duplicado: true });
  }

  if (medio === "yape") {
    const { data: man } = await sb.from("gastos").select("id,concepto,creado")
      .eq("uid", uid).eq("monto", m.monto).eq("origen", "manual").eq("medio", "yape").eq("vinculado", false)
      .gte("creado", new Date(ref.getTime() - 30 * 60_000).toISOString())
      .lte("creado", new Date(ref.getTime() + 30 * 60_000).toISOString()).limit(1);
    if (man && man.length) {
      const upd: Record<string, unknown> = { vinculado: true, operacion };
      if (!man[0].concepto) upd.concepto = comercio;
      await sb.from("gastos").update(upd).eq("id", man[0].id);
      return json({ ok: true, duplicado: true, via: "manual" });
    }
  }

  const otra = esCorreo ? "applepay" : "correo";
  const cand = lista
    .filter((g) => g.origen === otra && g.medio === "tarjeta" && !g.vinculado && Math.abs(new Date(g.creado).getTime() - ref.getTime()) < 20 * 60_000)
    .sort((x, y) => (parecido(comercio, y.concepto) - parecido(comercio, x.concepto)) ||
      (Math.abs(new Date(x.creado).getTime() - ref.getTime()) - Math.abs(new Date(y.creado).getTime() - ref.getTime())))[0];
  if (cand && medio !== "yape") {
    const upd: Record<string, unknown> = { vinculado: true };
    if (esCorreo) {
      if (operacion) upd.operacion = operacion;
      if (tarjeta && !String(cand.tarjeta ?? "").includes("•")) upd.tarjeta = tarjeta;
    }
    await sb.from("gastos").update(upd).eq("id", cand.id);
    return json({ ok: true, duplicado: true, via: cand.origen });
  }

  const fila: Record<string, unknown> = {
    monto: m.monto, moneda: m.moneda, concepto: comercio || null, categoria, medio,
    tarjeta, origen, uid, operacion,
  };
  if (cuando) {
    fila.creado = cuando.toISOString();
    fila.fecha = new Date(cuando.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
  }
  const { error } = await sb.from("gastos").insert(fila);
  if (error) { console.log("error guardar", error.message); return json({ ok: false, error: "guardar" }, 500); }
  return json({ ok: true, origen, monto: m.monto, comercio, categoria });
});
