/**
 * Mis gastos — lector de alertas de consumo BCP en Gmail.
 * Corre en tu cuenta de Google cada 5 minutos: busca los correos "Realizaste un consumo",
 * los envía a tu app de gastos y recuerda cuáles ya procesó para no repetirlos.
 *
 * Instalación (una sola vez):
 *   1. Pega este código en script.google.com (proyecto nuevo) y guarda.
 *   2. Arriba elige la función "instalar" y pulsa Ejecutar. Autoriza con tu cuenta de Gmail.
 *   Listo: desde ahí revisa solo cada 5 minutos.
 */

const URL_GASTOS = 'https://hlemajndaygejtxfbhyt.supabase.co/functions/v1/registrar-gasto';
const TOKEN = 'PEGA_AQUI_TU_CLAVE';            // la clave de Ajustes → "Generar clave del atajo"
const BUSQUEDA = 'subject:"Realizaste un consumo" newer_than:2d';

function revisarConsumos() {
  const props = PropertiesService.getScriptProperties();
  const hechos = JSON.parse(props.getProperty('hechos') || '[]');
  const vistos = new Set(hechos);
  const limite = Date.now() - 2 * 24 * 3600 * 1000;

  GmailApp.search(BUSQUEDA, 0, 50).forEach(function (hilo) {
    hilo.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (vistos.has(id) || msg.getDate().getTime() < limite) return;
      let r;
      try {
        r = UrlFetchApp.fetch(URL_GASTOS, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({ token: TOKEN, texto: msg.getPlainBody(), asunto: msg.getSubject() }),
          muteHttpExceptions: true,
        });
      } catch (e) {
        console.log('Sin conexión, se reintenta en 5 min: ' + e);
        return;
      }
      const code = r.getResponseCode();
      console.log(msg.getSubject() + ' → ' + code + ' ' + r.getContentText());
      if (code >= 500) return;              // error del servidor: reintenta la próxima vez
      vistos.add(id);                        // guardado, duplicado o no era un consumo
    });
  });

  props.setProperty('hechos', JSON.stringify(Array.from(vistos).slice(-400)));
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('revisarConsumos').timeBased().everyMinutes(5).create();
  revisarConsumos();
}
