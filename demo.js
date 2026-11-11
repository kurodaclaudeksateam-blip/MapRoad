/* MapRoad — datos de ejemplo para la VISTA PREVIA local.
   Solo se carga al abrir http://localhost:8766/?demo (panel) o /chofer/?demo (app del chofer).
   Todo es inventado y vive en memoria: no se lee ni se escribe nada en Supabase. */
(function(){
  let semilla = 20261111;
  const rnd = ()=>{ semilla = (semilla*1664525+1013904223)%4294967296; return semilla/4294967296; };
  const entre = (a,b)=>a+rnd()*(b-a), ent = (a,b)=>Math.floor(entre(a,b+1)), de = arr=>arr[Math.floor(rnd()*arr.length)];
  let nId = 0;
  const id = p=>'00000000-0000-4000-8000-'+(p+String(++nId).padStart(10,'0')).slice(-12);
  const fechaISO = d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  const dia = n=>{ const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return d; };
  const aISO = (d,min)=>new Date(d.getTime()+min*60000).toISOString();
  const svg = (txt,bg)=>'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${bg}"/><text x="120" y="128" font-size="20" text-anchor="middle" fill="#fff" font-family="sans-serif">${txt}</text></svg>`);
  const FIRMA = 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="140"><path d="M20 100 C60 20 90 130 130 70 S200 30 230 90 300 110 400 50" fill="none" stroke="#0f172a" stroke-width="3"/></svg>');

  const NOMBRES = ['Ferretería El Tornillo','Materiales Rivera','Constructora Altamira','Tlapalería La Central','Plomería Hidalgo','Eléctrica del Valle','Pinturas Sierra','Abarrotes Doña Lupita','Hotel Las Palmas','Clínica San Rafael','Taller Hermanos Soto','Papelería Escolar','Restaurante El Muelle','Agroinsumos del Pacífico','Carpintería Robles','Vidrios y Aluminios Leal','Refaccionaria Castro','Farmacia Santa Fe','Escuela Benito Juárez','Mueblería Moderna'];
  const CALLES = ['Av. Álvaro Obregón','Blvd. Emiliano Zapata','Calle Rosales','Av. Insurgentes','Blvd. Universitarios','Calle Juan Carrasco','Av. Revolución','Calle Ángel Flores','Blvd. Las Américas','Calle Río Humaya'];
  const COLONIAS = ['Centro','Las Quintas','Tierra Blanca','Chapultepec','Guadalupe','Villa Universidad','Los Pinos','Infonavit Humaya'];
  const ITEMS = ['Cable THW cal. 12 (rollo)','Tubo PVC 1/2" (tramo)','Cemento gris 50 kg','Pintura vinílica 19 L','Lámpara LED 18 W','Varilla 3/8" (pza)','Interruptor termomagnético','Llave mezcladora','Panel solar 550 W','Tablero de distribución'];
  const MOTIVOS = {cliente_ausente:['No había nadie en el domicilio','Negocio cerrado','No contestó el teléfono'], reprogramado:['Cliente pidió entregar otro día','Sin personal para recibir'], cancelado_sucursal:['Cliente pasará a recoger'], fallido:['Dirección incorrecta','Acceso bloqueado por obra','Mercancía dañada']};

  function construir(){
    const sociedades = [{id:id('a'), nombre:'Comercial del Pacífico', razonSocial:'Comercial del Pacífico S.A. de C.V.', rfc:'CPA010101AAA', activo:true},
                        {id:id('a'), nombre:'Distribuidora Noroeste', razonSocial:'Distribuidora Noroeste S.A. de C.V.', rfc:'DNO020202BBB', activo:true}];
    const centros = [
      {id:id('b'), sociedadId:sociedades[0].id, nombre:'CEDIS Culiacán', tipo:'cedis', direccion:'Carretera a Navolato km 4.5', lat:24.790, lng:-107.430, telefono:'667 555 0100', responsable:'Laura Méndez'},
      {id:id('b'), sociedadId:sociedades[0].id, nombre:'Sucursal Tres Ríos', tipo:'centro', direccion:'Blvd. Enrique Sánchez Alonso 1500', lat:24.822, lng:-107.398, telefono:'667 555 0111', responsable:'Óscar Vega'},
      {id:id('b'), sociedadId:sociedades[1].id, nombre:'Sucursal Mazatlán', tipo:'centro', direccion:'Av. Ejército Mexicano 2200', lat:23.249, lng:-106.411, telefono:'669 555 0120', responsable:'Irma Solís'}];
    const tiendas = centros.map(c=>({id:id('c'), nombre:c.nombre+' (salida)', direccion:c.direccion, colonia:'Industrial', cp:'80000', lat:c.lat, lng:c.lng, esOrigen:true, centroId:c.id, telefono:c.telefono, contacto:c.responsable, horario:'L-S 7:00 a 18:00'}));
    NOMBRES.slice(0,6).forEach((n,i)=>{ const c=centros[i%3]; tiendas.push({id:id('c'), nombre:n, direccion:de(CALLES)+' '+ent(100,2900), colonia:de(COLONIAS), cp:String(80000+ent(10,290)), lat:c.lat+entre(-.05,.05), lng:c.lng+entre(-.05,.05), esOrigen:false, centroId:c.id, contacto:'Encargado', telefono:'667 555 0'+ent(200,999), horario:'L-V 9:00 a 17:00'}); });

    const CH = ['Juan Carlos Pérez','Miguel Ángel Soto','Ramón Valenzuela','Jesús Beltrán','Héctor Lizárraga','Francisco Osuna','Daniel Zazueta','Arturo Félix'];
    const UN = [['VSA-101-A','Camioneta','Nissan','NP300',2022,1200,6],['VSA-102-B','Camión 3.5 t','Isuzu','ELF 300',2021,3500,18],['VSA-103-C','Van / panel','Ford','Transit',2023,1400,10],['VSA-104-D','Camioneta','Toyota','Hilux',2020,1000,5],
                ['VSA-105-E','Camión 3.5 t','Hino','Serie 300',2019,3800,20],['VSA-106-F','Rabón','Kenworth','T370',2018,8000,38],['VSB-201-G','Van / panel','Mercedes','Sprinter',2022,1600,12],['VSB-202-H','Camioneta','Chevrolet','S10',2021,1100,5]];
    const choferes = CH.map((n,i)=>({id:id('d'), nombre:n, telefono:'667 '+ent(100,999)+' '+ent(1000,9999), licencia:'SIN'+ent(100000,999999), licenciaTipo:de(['B','C','E']), numeroEmpleado:String(1040+i),
      licenciaVence:fechaISO(dia(i===2?12:i===5?-4:ent(90,700))), estatus:'activo', centroId:centros[i<4?0:i<6?1:2].id, contactoEmergencia:'Familiar · 667 555 '+ent(1000,9999)}));
    const unidades = UN.map((u,i)=>({id:id('e'), placa:u[0], numeroEconomico:'E-'+(11+i), tipo:u[1], marca:u[2], modelo:u[3], anio:u[4], capacidadKg:u[5], capacidadM3:u[6], estatus:'disponible',
      centroId:choferes[i].centroId, choferId:choferes[i].id, odometroKm:ent(40000,180000), rendimientoKmL:Math.round(entre(5,11)*10)/10,
      seguroVence:fechaISO(dia(i===1?-9:i===4?21:ent(60,330))), verificacionVence:fechaISO(dia(i===6?8:ent(40,300)))}));
    choferes.forEach((c,i)=>c.unidadId=unidades[i].id);
    unidades[5].estatus='mantenimiento';
    const usuarios = [{id:id('f'), usuario:'admin.demo', nombre:'Fernanda Cerezo', rol:'admin', activo:true, email:'admin@ejemplo.com'},
      {id:id('f'), usuario:'logistica.cln', nombre:'Laura Méndez', rol:'centro', centroId:centros[0].id, activo:true},
      {id:id('f'), usuario:'gerencia.pac', nombre:'Óscar Vega', rol:'sociedad', sociedadId:sociedades[0].id, activo:true},
      {id:id('f'), usuario:'auditoria', nombre:'Auditoría interna', rol:'auditor', activo:true}]
      .concat(choferes.slice(0,6).map(c=>({id:id('f'), usuario:c.nombre.toLowerCase().split(' ')[0][0]+c.nombre.toLowerCase().split(' ').pop().normalize('NFD').replace(/[̀-ͯ]/g,''), nombre:c.nombre, rol:'chofer', choferId:c.id, activo:true})));

    const rutas=[], pedidos=[], entregas=[], incidencias=[], ubic={};
    const ahora = new Date(), minHoy = ahora.getHours()*60+ahora.getMinutes();
    let folio = 48200;
    for(let n=-34; n<=0; n++){
      const d = dia(n); if(d.getDay()===0) continue;
      const f = fechaISO(d), hoy = n===0;
      choferes.forEach((ch,ci)=>{
        if(ci===5) return;                              // su unidad está en taller
        if(!hoy && rnd()<.22) return;
        const un = unidades[ci], centro = centros.find(c=>c.id===ch.centroId), origen = tiendas.find(t=>t.esOrigen&&t.centroId===centro.id);
        const rid = id('1'), nPar = ent(7,13), salida = 7*60+ent(10,95);
        // Hoy: unas concluidas, otras en curso y una sin iniciar
        const estatus = !hoy ? 'concluida' : ci===7 ? 'pendiente' : (ci<2 && minHoy>15*60) ? 'concluida' : (minHoy<salida ? 'pendiente' : 'en_curso');
        const ps=[]; let t = salida, ang = entre(0,6.28);
        const hasta = estatus==='concluida' ? nPar : estatus==='pendiente' ? 0 : Math.max(1, Math.min(nPar-2, Math.floor((minHoy-salida)/38)));
        for(let i=0;i<nPar;i++){
          ang += entre(.3,.9); const r = entre(.012,.075);
          const sinGeo = rnd()<.03;
          const p = {id:id('2'), rutaId:rid, centroId:centro.id, fecha:f, folio:'F'+(++folio), vehiculo:un.placa, intento:1,
            items:Array.from({length:ent(1,4)},()=>({nombre:de(ITEMS), cantidad:ent(1,12), codigo:'SKU'+ent(1000,9999)})),
            numeroCliente:'CLI-'+ent(1000,9999), nombreContacto:de(NOMBRES), telefono:'667 '+ent(100,999)+' '+ent(1000,9999), emailContacto:rnd()<.8?'compras'+ent(1,99)+'@ejemplo.com':'',
            direccion:de(CALLES)+' '+ent(100,2900), colonia:de(COLONIAS), cp:String(80000+ent(10,290)),
            lat:sinGeo?null:centro.lat+Math.sin(ang)*r, lng:sinGeo?null:centro.lng+Math.cos(ang)*r*1.1,
            fechaMin:f, fechaMax:fechaISO(dia(n+(rnd()<.12?-1:ent(0,2)))), oficinaVentas:'OV'+ent(1,4), sucursalSolicita:centro.nombre, nombreVendedor:de(['A. Ruiz','M. Camacho','P. Inzunza','L. Gastélum']),
            comentarios:rnd()<.2?de(['Entregar en almacén trasero','Preguntar por el encargado','Llamar antes de llegar']):'', folioFactura:'FA-'+folio,
            pesoKg:Math.round(entre(8,un.capacidadKg/nPar*1.15)), volumenM3:Math.round(entre(.05,un.capacidadM3/nPar*1.05)*100)/100, importeTotal:Math.round(entre(900,48000)*100)/100,
            ordenEnRuta:sinGeo?null:i+1, estatus:'pendiente', horaLlegada:null, createdAt:aISO(d,360)};
          if(i<hasta){
            t += ent(14,34); p.horaLlegada = aISO(d,t);
            const x = rnd(); const res = x<.885?'entregado':x<.93?'cliente_ausente':x<.965?'reprogramado':x<.985?'fallido':'cancelado_sucursal';
            t += ent(5,22); p.estatus = res;
            const parcial = res==='entregado' && p.items.length>1 && rnd()<.07, dist = rnd()<.06?ent(350,1900):ent(4,120);
            entregas.push({id:id('3'), pedidoId:p.id, rutaId:rid, centroId:centro.id, horaEntrega:aISO(d,t), resultado:res, motivo:res==='entregado'?null:de(MOTIVOS[res]),
              nuevaFecha:res==='reprogramado'?fechaISO(dia(n+ent(1,3))):null, entregaParcial:parcial,
              itemsEntregados:res==='entregado'?p.items.map((it,k)=>Object.assign({},it,{entregado:!(parcial&&k===0)})):null,
              comentarios:rnd()<.15?'Recibido sin novedad':null, fotos:rnd()<.93?[svg('Foto 1','#2a78d6'),svg('Foto 2','#1baf7a')].slice(0,ent(1,2)):[], firma:res==='entregado'&&rnd()<.88?FIRMA:null, documentos:[],
              recibeNombre:res==='entregado'&&rnd()<.82?de(['Almacenista','Sra. Gómez','Ing. Paredes','Encargado de turno','Vigilancia']):null,
              lat:p.lat, lng:p.lng, precisionM:ent(5,30), distanciaM:p.lat==null?null:dist, createdAt:aISO(d,t)});
          } else if(estatus==='en_curso' && i===hasta && rnd()<.5){ p.horaLlegada = aISO(d, Math.min(minHoy-3, t+20)); }
          ps.push(p); pedidos.push(p);
        }
        const conGeo = ps.filter(p=>p.lat!=null), seq = [origen, ...conGeo, origen];
        let kmPlan=0; for(let i=1;i<seq.length;i++) kmPlan += Math.hypot((seq[i].lat-seq[i-1].lat)*111, (seq[i].lng-seq[i-1].lng)*101);
        const fin = t+ent(18,40), odo = un.odometroKm - (0-n)*ent(40,80);
        const r = {id:rid, fecha:f, choferId:ch.id, unidadId:un.id, centroId:centro.id, origenTiendaId:origen.id, estatus, pedidoIds:ps.map(p=>p.id), ordenOptimizado:conGeo.map(p=>p.id),
          vehiculoTexto:un.placa, horaInicio:estatus==='pendiente'?null:aISO(d,salida), horaFin:estatus==='concluida'?aISO(d,fin):null, kmPlan:Math.round(kmPlan*10)/10, kmGps:0,
          odometroInicio:estatus==='pendiente'?null:odo, odometroFin:estatus==='concluida'&&rnd()<.8?Math.round(odo+kmPlan*entre(1.25,1.6)):null, combustibleInicio:estatus==='pendiente'?null:de(['Lleno','3/4','1/2']),
          checklistSalida:estatus==='pendiente'?null:{Llantas:true,Luces:rnd()>.04,Frenos:true,Niveles:true,Documentos:true}, createdAt:aISO(d,350),
          notificacionInicio:estatus==='pendiente'?null:{estatus:'ok', enviados:ps.filter(p=>p.emailContacto).map(p=>p.folio), fallidos:rnd()<.1?[ps[0].folio]:[], omitidos:ps.filter(p=>!p.emailContacto).map(p=>p.folio)}};
        if(estatus==='concluida') r.kmGps = Math.round(kmPlan*entre(1.15,1.45)*10)/10;
        if(estatus==='en_curso'){ un.estatus='en_ruta'; }
        // Recorrido GPS de hoy
        if(hoy && estatus!=='pendiente'){
          const pts=[]; const visit=[origen, ...conGeo.slice(0, Math.max(1,Math.min(conGeo.length,hasta+ (estatus==='concluida'?0:1))))]; if(estatus==='concluida') visit.push(origen);
          let tt=salida;
          for(let i=1;i<visit.length;i++){ for(let s=1;s<=3;s++){ tt+=4; if(estatus==='en_curso'&&tt>minHoy) break;
            pts.push({id:'u'+rid+pts.length, rutaId:rid, lat:visit[i-1].lat+(visit[i].lat-visit[i-1].lat)*s/3+entre(-.0015,.0015), lng:visit[i-1].lng+(visit[i].lng-visit[i-1].lng)*s/3+entre(-.0015,.0015), velocidadKmh:ent(18,62), registradaEn:aISO(d,tt)}); } tt+=10; }
          if(estatus==='en_curso' && pts.length){
            const u=pts[pts.length-1]; u.registradaEn = aISO(d, minHoy-(ci===3?27:ent(1,4)));   // el chofer 4 lleva rato sin señal
            r.ultimaLat=u.lat; r.ultimaLng=u.lng; r.ultimaUbicacion=u.registradaEn; r.kmGps=Math.round(kmPlan*.5*10)/10;
          }
          ubic[rid]=pts;
        }
        if(rnd()<(hoy?.0:.045)) incidencias.push({id:id('4'), rutaId:rid, choferId:ch.id, unidadId:un.id, centroId:centro.id, tipo:de(['trafico','llanta','falla_mecanica','clima','mercancia']), descripcion:'Reporte de ejemplo',
          lat:centro.lat+entre(-.04,.04), lng:centro.lng+entre(-.04,.04), hora:aISO(d,salida+ent(60,240)), atendida:true, atendidaPor:'Laura Méndez', notaAtencion:'Resuelto'});
        rutas.push(r);
      });
    }
    // Una incidencia abierta hoy y una ruta de hoy sin chofer
    const curso = rutas.filter(r=>r.fecha===fechaISO(dia(0)) && r.estatus==='en_curso');
    if(curso[0]) incidencias.push({id:id('4'), rutaId:curso[0].id, choferId:curso[0].choferId, unidadId:curso[0].unidadId, centroId:curso[0].centroId, tipo:'llanta', descripcion:'Llanta trasera ponchada, cambiando refacción',
      lat:curso[0].ultimaLat, lng:curso[0].ultimaLng, hora:new Date(Date.now()-22*60000).toISOString(), atendida:false});
    const pend = rutas.find(r=>r.fecha===fechaISO(dia(0)) && r.estatus==='pendiente'); if(pend) pend.choferId=null;
    return {sociedades, centros, tiendas, choferes, unidades, usuarios, rutas, pedidos, entregas, incidencias, ubic};
  }

  window.MPR_DEMO = {
    panel(rol){
      const t = construir(), u = t.usuarios.find(x=>x.rol===(rol||'admin')) || t.usuarios[0];
      const ubic = t.ubic; delete t.ubic;
      // Lo que en producción limita RLS: un usuario por centro o por sociedad solo ve lo suyo.
      const cs = u.rol==='centro' ? [u.centroId] : u.rol==='sociedad' ? t.centros.filter(c=>c.sociedadId===u.sociedadId).map(c=>c.id) : null;
      if(cs){
        ['tiendas','choferes','unidades','rutas','pedidos','entregas','incidencias'].forEach(k=>{ t[k]=t[k].filter(x=>cs.includes(x.centroId)); });
        t.centros=t.centros.filter(c=>cs.includes(c.id)); t.sociedades=t.sociedades.filter(s=>t.centros.some(c=>c.sociedadId===s.id)); t.usuarios=[u];
      }
      return {usuario:u, tablas:t, ubic, desde:fechaISO(dia(-34))};
    },
    // Ruta del día para la app del chofer: sin iniciar, con 7 paradas.
    chofer(){
      const t = construir(), hoy = fechaISO(dia(0));
      const r = Object.assign({}, t.rutas.filter(x=>x.fecha===hoy)[0], {estatus:'pendiente', horaInicio:null, horaFin:null, odometroInicio:null, checklistSalida:null});
      const ch = t.choferes[0], un = t.unidades[0], origen = t.tiendas.find(x=>x.id===r.origenTiendaId), centro = t.centros.find(c=>c.id===r.centroId);
      const ids = r.pedidoIds.slice(0,7);
      r.pedidoIds = ids; r.ordenOptimizado = r.ordenOptimizado.filter(i=>ids.includes(i)); r.choferId = ch.id;
      return {fecha:hoy, chofer:{id:ch.id, nombre:ch.nombre, telefono:ch.telefono}, unidad:{id:un.id, placa:un.placa, modelo:un.modelo, odometroKm:un.odometroKm},
        origen:{nombre:origen.nombre, lat:origen.lat, lng:origen.lng, telefono:origen.telefono}, centro:{nombre:centro.nombre, telefono:centro.telefono},
        ruta:r, pedidos:t.pedidos.filter(p=>ids.includes(p.id)).map(p=>Object.assign({},p,{estatus:'pendiente', horaLlegada:null})), bajada:new Date().toISOString()};
    }
  };
})();
