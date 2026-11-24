/**
 * Mis gastos — lector de correos bancarios en Gmail (BCP, Yape, Interbank, BBVA).
 * Corre en los servidores de Google cada minuto: no depende del iPhone ni de abrir el correo.
 *
 * Instalación (una sola vez, desde la computadora):
 *   1. script.google.com → Nuevo proyecto → pega este código → Guardar.
 *   2. Arriba elige la función "instalar" → Ejecutar → autoriza con tu Gmail.
 */

const URL_GASTOS = 'https://hlemajndaygejtxfbhyt.supabase.co/functions/v1/registrar-gasto';
const TOKEN = 'PEGA_AQUI_TU_CLAVE';
const REMITENTES = [
  'notificaciones@notificacionesbcp.com.pe',
  'notificaciones@yape.pe',
  'servicioalcliente@netinterbank.com.pe',
  'procesos@bbva.com.pe',
];
const BUSQUEDA = 'from:(' + REMITENTES.join(' OR ') + ') newer_than:2d';

function revisarCorreos() {
  const props = PropertiesService.getScriptProperties();
  const vistos = new Set(JSON.parse(props.getProperty('hechos') || '[]'));
  let cambios = false;

  GmailApp.search(BUSQUEDA, 0, 50).forEach(function (hilo) {
    hilo.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (vistos.has(id)) return;
      let r;
      try {
        r = UrlFetchApp.fetch(URL_GASTOS, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ token: TOKEN, texto: msg.getPlainBody(), asunto: msg.getSubject(), fecha_correo: msg.getDate().toISOString() }),
          muteHttpExceptions: true,
        });
      } catch (e) {
        console.log('Sin conexión, se reintenta en 1 minuto: ' + e);
        return;
      }
      const code = r.getResponseCode();
      console.log(msg.getSubject() + ' → ' + code + ' ' + r.getContentText());
      if (code >= 500) return;          // error del servidor: se reintenta
      vistos.add(id); cambios = true;   // guardado, duplicado o no era un gasto
    });
  });

  if (cambios) props.setProperty('hechos', JSON.stringify(Array.from(vistos).slice(-500)));
}

// Activa la revisión cada minuto. Los correos que ya están en la bandeja se marcan como
// vistos sin enviarse (ya entraron por el iPhone), así no se repite nada.
function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  const ids = [];
  GmailApp.search(BUSQUEDA, 0, 100).forEach(function (h) { h.getMessages().forEach(function (m) { ids.push(m.getId()); }); });
  PropertiesService.getScriptProperties().setProperty('hechos', JSON.stringify(ids));
  ScriptApp.newTrigger('revisarCorreos').timeBased().everyMinutes(1).create();
  console.log('Listo: ' + ids.length + ' correos existentes marcados como vistos. Revisando cada minuto.');
}

// Envía una vez los correos de los últimos N días (por defecto 2) aunque ya estén marcados como vistos.
// El servidor descarta los repetidos y los movimientos a tus propias cuentas.
function recuperar(dias) {
  dias = dias || 2;
  const props = PropertiesService.getScriptProperties();
  const vistos = new Set(JSON.parse(props.getProperty('hechos') || '[]'));
  GmailApp.search('from:(' + REMITENTES.join(' OR ') + ') newer_than:' + dias + 'd', 0, 100).forEach(function (h) {
    h.getMessages().forEach(function (msg) {
      const r = UrlFetchApp.fetch(URL_GASTOS, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ token: TOKEN, texto: msg.getPlainBody(), asunto: msg.getSubject(), fecha_correo: msg.getDate().toISOString() }),
      });
      console.log(msg.getDate() + ' · ' + msg.getSubject() + ' → ' + r.getContentText());
      vistos.add(msg.getId());
    });
  });
  props.setProperty('hechos', JSON.stringify(Array.from(vistos).slice(-500)));
}

// Carga TODOS los correos del mes en curso (desde el día 1). Ejecútala una vez con ▶ Ejecutar.
// Si el mes tiene muchos correos y Google corta a los ~5 minutos, vuelve a ejecutarla: continúa
// donde quedó. El servidor descarta los repetidos y los movimientos a tus propias cuentas.
function recuperarMes() {
  const hoy = new Date();
  recuperarDesde(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
}

function recuperarDesde(inicio) {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const vistos = new Set(JSON.parse(props.getProperty('hechos') || '[]'));
  const ayer = new Date(inicio.getTime() - 86400000);
  const q = 'from:(' + REMITENTES.join(' OR ') + ') after:' +
    Utilities.formatDate(ayer, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const clave = 'recuperado_' + Utilities.formatDate(inicio, Session.getScriptTimeZone(), 'yyyyMMdd');
  const listos = new Set(JSON.parse(props.getProperty(clave) || '[]'));
  const cuenta = { guardados: 0, repetidos: 0, ignorados: 0, errores: 0 };
  let pendientes = false;

  for (let start = 0; ; start += 100) {
    const hilos = GmailApp.search(q, start, 100);
    hilos.forEach(function (h) {
      h.getMessages().forEach(function (msg) {
        const id = msg.getId();
        if (msg.getDate() < inicio || listos.has(id)) return;
        if (Date.now() - t0 > 5 * 60 * 1000) { pendientes = true; return; }
        let txt = '';
        try {
          const r = UrlFetchApp.fetch(URL_GASTOS, {
            method: 'post', contentType: 'application/json', muteHttpExceptions: true,
            payload: JSON.stringify({ token: TOKEN, texto: msg.getPlainBody(), asunto: msg.getSubject(), fecha_correo: msg.getDate().toISOString() }),
          });
          txt = r.getContentText();
          if (r.getResponseCode() >= 500) { cuenta.errores++; pendientes = true; return; }
        } catch (e) { cuenta.errores++; pendientes = true; return; }
        if (/"duplicado":true/.test(txt)) cuenta.repetidos++;
        else if (/"ignorado"/.test(txt)) cuenta.ignorados++;
        else if (/"ok":true/.test(txt)) cuenta.guardados++;
        else cuenta.errores++;
        console.log(msg.getDate() + ' · ' + msg.getSubject() + ' → ' + txt);
        listos.add(id); vistos.add(id);
      });
    });
    if (hilos.length < 100 || pendientes) break;
  }

  props.setProperty(clave, JSON.stringify(Array.from(listos)));
  props.setProperty('hechos', JSON.stringify(Array.from(vistos).slice(-500)));
  console.log('Nuevos: ' + cuenta.guardados + ' · ya estaban: ' + cuenta.repetidos +
    ' · no eran gasto: ' + cuenta.ignorados + ' · con error: ' + cuenta.errores);
  console.log(pendientes ? 'Faltan correos: vuelve a ejecutar recuperarMes.' : 'Listo: mes completo.');
}

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Revisión automática desactivada.');
}
