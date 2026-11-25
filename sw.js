var V='gastos-v12';
var BASE=['./','index.html','config.js','manifest.webmanifest','icons/icon-192.png'];
// Al instalar se descargan de nuevo (sin caché del navegador) los archivos base.
self.addEventListener('install',function(e){e.waitUntil(caches.open(V).then(function(c){return c.addAll(BASE.map(function(u){return new Request(u,{cache:'reload'})}))}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==V}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
// Primero internet (siempre revalidando con el servidor); si no hay conexión, la copia guardada.
// Ojo: una navegación no se puede pasar a fetch() con opciones, por eso se usa su URL.
self.addEventListener('fetch',function(e){
  var r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(r.mode==='navigate'?r.url:r,{cache:'no-cache',credentials:'same-origin'}).then(function(res){
    if(res&&res.ok){var cp=res.clone();caches.open(V).then(function(c){c.put(r,cp)})}
    return res;
  }).catch(function(){return caches.match(r).then(function(m){return m||caches.match('index.html')})}));
});
