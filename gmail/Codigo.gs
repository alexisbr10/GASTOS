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
          payload: JSON.stringify({ token: TOKEN, texto: msg.getPlainBody(), asunto: msg.getSubject() }),
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

function desinstalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  console.log('Revisión automática desactivada.');
}
