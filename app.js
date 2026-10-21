import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, DIAS_GUARDADO } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = 'fotos';
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

const TURNOS = ['Apertura', 'Medio', 'Cierre'];
const ICONO_TURNO = { Apertura: '🌅', Medio: '☀️', Cierre: '🌙' };
const FOTOS_PASE = [
  { clave: 'tph', nombre: 'TPH (GCs)', ayuda: 'Pantalla TPH', obligatoria: () => true },
  { clave: 'rating', nombre: 'Rating', ayuda: 'App rating', obligatoria: () => false },
  { clave: 'stock', nombre: 'Stock', ayuda: 'Carro delivery', obligatoria: (turno) => turno !== 'Cierre' },
  { clave: 'califs', nombre: 'Calificaciones', ayuda: 'Calificaciones', obligatoria: () => false },
];

const $ = (sel, raiz = document) => raiz.querySelector(sel);

const estado = {
  iniciada: false,
  diaPedidos: hoy(),
  diaPases: hoy(),
  filtroTurno: '',
  busqueda: '',
  pedidos: [],
  pases: [],
  pendientes: [],          // fotos de pedidos elegidas que todavía no se guardaron
  fotosPase: {},           // clave -> { foto, mini, vista }
  turnoPedidos: leerLocal('turno') || '',
  turnoPase: leerLocal('turno') || '',
  visor: { items: [], i: 0 },
  guardando: false,
};

/* ═════════ Utilidades ═════════ */

function leerLocal(k) { try { return localStorage.getItem('mcdash.' + k); } catch { return null; } }
function guardarLocal(k, v) { try { localStorage.setItem('mcdash.' + k, v); } catch { /* sin almacenamiento */ } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hoy() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function sumarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function mismoDia(a, b) { return a.toDateString() === b.toDateString(); }
function fechaInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hora(iso) { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }
function fechaCorta(iso) { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }); }
function nombreDia(d) {
  if (mismoDia(d, hoy())) return 'Hoy';
  if (mismoDia(d, sumarDias(hoy(), -1))) return 'Ayer';
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' });
}
function plural(n, uno, varios) { return `${n} ${n === 1 ? uno : varios}`; }

function avisar(mensaje, tipo = 'info') {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = mensaje;
  $('#avisos').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 5000 : 3000);
}

function mensajeError(e) {
  const m = e?.message || String(e || '');
  if (!navigator.onLine || /fetch|network/i.test(m)) return 'Sin conexión a internet';
  if (/jwt|token|auth/i.test(m)) return 'La sesión venció, volvé a entrar';
  return m || 'Error desconocido';
}

function vacio(icono, titulo, texto = '') {
  return `<div class="vacio"><div class="vacio-icono">${icono}</div><div class="vacio-titulo">${esc(titulo)}</div>${texto ? `<div>${esc(texto)}</div>` : ''}</div>`;
}

/* ═════════ Fotos ═════════ */

function abrirImagen(archivo) {
  return new Promise((ok, mal) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No se pudo abrir la foto')); };
    img.src = url;
  });
}

function achicar(img, maxLado, calidad, filtro = '') {
  const escala = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * escala);
  const h = Math.round(img.naturalHeight * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = w;
  lienzo.height = h;
  const ctx = lienzo.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  if (filtro) ctx.filter = filtro;
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((ok, mal) =>
    lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto'))), 'image/jpeg', calidad));
}

// Devuelve la foto grande, la miniatura y (si se pide) una copia en blanco y negro para leer el número.
// No se guarda la imagen original en memoria: con muchas fotos el celular se queda sin RAM.
async function prepararFoto(archivo, paraLeer = false) {
  const img = await abrirImagen(archivo);
  const [foto, mini, ocr] = await Promise.all([
    achicar(img, 1400, 0.82),
    achicar(img, 360, 0.7),
    paraLeer ? achicar(img, 1800, 0.9, 'grayscale(1) contrast(1.4)') : null,
  ]);
  return { foto, mini, ocr, vista: URL.createObjectURL(mini) };
}

function nuevaRuta(carpeta) {
  const id = crypto.randomUUID();
  const dia = fechaInput(new Date());
  return { foto: `${carpeta}/${dia}/${id}.jpg`, mini: `${carpeta}/${dia}/${id}_mini.jpg` };
}

async function subir(ruta, blob) {
  const { error } = await sb.storage.from(BUCKET).upload(ruta, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
}

async function borrarArchivos(rutas) {
  const lista = rutas.filter(Boolean);
  if (!lista.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(lista);
  if (error) throw error;
}

// Las fotos son privadas: se piden links temporales y se guardan un rato.
const cacheLinks = new Map();
async function linksFirmados(rutas) {
  const ahora = Date.now();
  const faltan = [...new Set(rutas.filter((r) => r && !(cacheLinks.get(r)?.vence > ahora)))];
  if (faltan.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(faltan, 3600);
    if (error) throw error;
    data.forEach((d) => { if (d.signedUrl) cacheLinks.set(d.path, { url: d.signedUrl, vence: ahora + 50 * 60 * 1000 }); });
  }
  return Object.fromEntries(rutas.map((r) => [r, cacheLinks.get(r)?.url || '']));
}

/* ═════════ Lectura automática del número (OCR, en el mismo celular) ═════════ */

let ocrPromesa = null;
function obtenerOcr() {
  if (!ocrPromesa) {
    ocrPromesa = new Promise((ok, mal) => {
      if (window.Tesseract) return ok();
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el lector'));
      document.head.appendChild(s);
    }).then(() => window.Tesseract.createWorker('spa'));
    ocrPromesa.catch(() => { ocrPromesa = null; });
  }
  return ocrPromesa;
}

async function leerNumero(imagen) {
  const lector = await obtenerOcr();
  const { data } = await lector.recognize(imagen);
  return extraerNumero(data.text);
}

// Busca el número de pedido en el texto del ticket.
// Primero mira lo que viene después de palabras clave; si no hay, el primer número largo.
export function extraerNumero(texto) {
  if (!texto) return '';
  const conEtiqueta = [
    /pick\s*-?\s*up[^\d\n]{0,15}(\d{4,12})/i,
    /(?:pedido|orden|order)[^\d\n]{0,15}(\d{4,12})/i,
    /(?:\bn[°º.]|\bnro\.?|#)\s*(\d{4,12})/i,
  ];
  for (const patron of conEtiqueta) {
    const m = texto.match(patron);
    if (m) return m[1];
  }
  const largos = (texto.match(/\b\d{5,12}\b/g) || []).filter((n) => !/^20\d{2}$/.test(n));
  return largos[0] || '';
}

/* ═════════ Chips de turno y navegación por día ═════════ */

function pintarChips(contenedor, opciones, valor, alElegir) {
  contenedor.innerHTML = opciones.map((o) =>
    `<button type="button" class="chip" data-valor="${esc(o.valor)}" aria-pressed="${o.valor === valor}">${esc(o.texto)}</button>`).join('');
  contenedor.onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    contenedor.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    alElegir(b.dataset.valor);
  };
}

const opcionesTurno = TURNOS.map((t) => ({ valor: t, texto: `${ICONO_TURNO[t]} ${t}` }));

function pintarNavDia(contenedor, dia, alCambiar) {
  const min = sumarDias(hoy(), -DIAS_GUARDADO);
  contenedor.innerHTML = `
    <button type="button" class="btn btn-icono" data-mover="-1" aria-label="Día anterior" ${dia <= min ? 'disabled' : ''}>‹</button>
    <label class="navdia-centro">
      <span>📅 ${esc(nombreDia(dia))}</span>
      <input type="date" value="${fechaInput(dia)}" min="${fechaInput(min)}" max="${fechaInput(hoy())}" aria-label="Elegir día">
    </label>
    <button type="button" class="btn btn-icono" data-mover="1" aria-label="Día siguiente" ${mismoDia(dia, hoy()) ? 'disabled' : ''}>›</button>`;
  contenedor.querySelectorAll('[data-mover]').forEach((b) => {
    b.onclick = () => alCambiar(sumarDias(dia, Number(b.dataset.mover)));
  });
  $('input', contenedor).onchange = (e) => {
    if (!e.target.value) return;
    const [a, m, d] = e.target.value.split('-').map(Number);
    alCambiar(new Date(a, m - 1, d));
  };
}

/* ═════════ PEDIDOS · carga ═════════ */

async function agregarFotosPedido(archivos) {
  for (const archivo of archivos) {
    const p = { id: crypto.randomUUID(), numero: '', estado: 'procesando', nota: 'Preparando foto…' };
    estado.pendientes.push(p);
    pintarPendientes();
    try {
      Object.assign(p, await prepararFoto(archivo, true));
      p.estado = 'leyendo';
      p.nota = 'Leyendo número…';
    } catch (e) {
      p.estado = 'error';
      p.nota = e.message;
    }
    pintarPendientes();
  }
  procesarColaOcr();
}

let ocrCorriendo = false;
async function procesarColaOcr() {
  if (ocrCorriendo) return;
  ocrCorriendo = true;
  try {
    let p;
    while ((p = estado.pendientes.find((x) => x.estado === 'leyendo'))) {
      let leido = '';
      try { leido = await leerNumero(p.ocr); } catch (e) { console.error('OCR', e); }
      p.ocr = null;
      if (!estado.pendientes.includes(p)) continue;
      if (p.numero) {
        p.estado = 'listo'; p.nota = '';
      } else if (leido) {
        p.numero = leido; p.estado = 'listo'; p.nota = 'Número detectado. Revisá que esté bien.';
        await revisarDuplicado(p);
      } else {
        p.estado = 'listo'; p.nota = 'No se pudo leer. Escribilo a mano.'; p.sinLeer = true;
      }
      pintarPendientes();
    }
  } finally {
    ocrCorriendo = false;
  }
}

async function revisarDuplicado(p) {
  const numero = p.numero.trim();
  p.duplicado = null;
  if (!numero) return;
  const { data } = await sb.from('pedidos').select('creado').eq('numero', numero)
    .order('creado', { ascending: false }).limit(1);
  if (p.numero.trim() === numero && data?.length) p.duplicado = data[0].creado;
}

function quitarPendiente(p) {
  if (p.vista) URL.revokeObjectURL(p.vista);
  estado.pendientes = estado.pendientes.filter((x) => x !== p);
}

function pintarPendientes() {
  const cont = $('#pendientes');
  const ids = new Set(estado.pendientes.map((p) => p.id));
  [...cont.children].forEach((el) => { if (!ids.has(el.dataset.id)) el.remove(); });

  estado.pendientes.forEach((p) => {
    let fila = cont.querySelector(`[data-id="${p.id}"]`);
    if (!fila) {
      fila = document.createElement('div');
      fila.className = 'pendiente';
      fila.dataset.id = p.id;
      fila.innerHTML = `
        <img class="pendiente-mini" alt="Foto del ticket">
        <div class="pendiente-cuerpo">
          <span class="etiqueta">N.º de pedido</span>
          <input class="campo" inputmode="numeric" autocomplete="off" placeholder="Escribí el número" aria-label="Número de pedido">
          <p class="pendiente-nota"></p>
        </div>
        <button type="button" class="btn btn-icono btn-peligro" aria-label="Quitar esta foto">✕</button>`;
      const input = $('input', fila);
      input.oninput = () => {
        p.numero = input.value.trim();
        p.sinLeer = false;
        if (p.estado === 'listo' || p.estado === 'errorGuardar') p.nota = '';
        clearTimeout(p.espera);
        p.espera = setTimeout(() => revisarDuplicado(p).then(pintarPendientes), 600);
      };
      $('button', fila).onclick = () => { quitarPendiente(p); pintarPendientes(); };
      $('img', fila).onclick = () => {
        if (!p.foto) return;
        abrirVisor([{ blob: p.foto, titulo: p.numero ? `#${p.numero}` : 'Foto sin guardar', detalle: 'Todavía no se guardó', archivo: 'pedido.jpg' }], 0);
      };
      cont.appendChild(fila);
    }

    const img = $('img', fila);
    if (p.vista && img.getAttribute('src') !== p.vista) img.src = p.vista;
    const input = $('input', fila);
    if (document.activeElement !== input) input.value = p.numero;
    input.disabled = p.estado === 'procesando' || p.estado === 'error';

    const nota = $('.pendiente-nota', fila);
    let texto = p.nota;
    let clase = '';
    if (p.estado === 'error' || p.estado === 'errorGuardar') clase = 'error';
    else if (p.duplicado) { texto = `⚠️ Ya hay un pedido con este número (cargado el ${fechaCorta(p.duplicado)} a las ${hora(p.duplicado)})`; clase = 'alerta'; }
    else if (p.sinLeer) clase = 'alerta';
    else if (p.estado === 'listo' && p.numero && texto) clase = 'ok';
    nota.textContent = texto || '';
    nota.className = `pendiente-nota ${clase}`;
  });

  const cantidad = estado.pendientes.filter((p) => p.foto).length;
  $('#bloque-pendientes').hidden = estado.pendientes.length === 0;
  const btn = $('#btn-guardar-pedidos');
  if (!estado.guardando) {
    btn.textContent = cantidad ? `💾 Guardar ${plural(cantidad, 'pedido', 'pedidos')}` : 'Guardar';
    btn.disabled = cantidad === 0;
  }
}

async function guardarPedidos() {
  if (estado.guardando) return;
  const turno = estado.turnoPedidos;
  const responsable = $('#pedidos-responsable').value.trim();
  if (!turno) return avisar('Elegí el turno', 'error');
  if (!responsable) { $('#pedidos-responsable').focus(); return avisar('Escribí quién es el responsable', 'error'); }
  const lista = estado.pendientes.filter((p) => p.foto);
  if (!lista.length) return;
  if (lista.some((p) => p.estado === 'leyendo' && !p.numero)) {
    return avisar('Esperá a que termine de leer los números', 'error');
  }

  guardarLocal('responsable', responsable);
  estado.guardando = true;
  const btn = $('#btn-guardar-pedidos');
  btn.disabled = true;
  let guardados = 0;

  for (const p of lista) {
    btn.textContent = `Guardando ${guardados + 1} de ${lista.length}…`;
    const ruta = nuevaRuta('pedidos');
    try {
      await subir(ruta.foto, p.foto);
      await subir(ruta.mini, p.mini);
      const { error } = await sb.from('pedidos').insert({
        numero: p.numero.trim(), turno, responsable, foto: ruta.foto, miniatura: ruta.mini,
      });
      if (error) throw error;
      quitarPendiente(p);
      guardados++;
    } catch (e) {
      console.error(e);
      borrarArchivos([ruta.foto, ruta.mini]).catch(() => {});
      p.estado = 'errorGuardar';
      p.nota = 'No se pudo guardar: ' + mensajeError(e);
    }
  }

  estado.guardando = false;
  pintarPendientes();
  if (guardados) {
    avisar(`✅ ${plural(guardados, 'pedido guardado', 'pedidos guardados')}`, 'ok');
    navigator.vibrate?.(60);
    if (!estado.pendientes.length) $('#pedidos-archivos').value = '';
    if (!estado.busqueda) { estado.diaPedidos = hoy(); cargarPedidos(); }
  }
  if (guardados < lista.length) {
    avisar(`${lista.length - guardados} no se pudieron guardar. Revisá la conexión y tocá Guardar de nuevo.`, 'error');
  }
}

/* ═════════ PEDIDOS · lista y búsqueda ═════════ */

let consultaPedidos = 0;
async function cargarPedidos() {
  const nro = ++consultaPedidos;
  const busq = estado.busqueda;
  const lista = $('#lista-pedidos');

  $('#controles-dia-pedidos').hidden = Boolean(busq);
  $('#titulo-lista-pedidos').textContent = busq ? '🔎 Resultados' : '🛵 Pedidos';
  if (!busq) pintarNavDia($('#navdia-pedidos'), estado.diaPedidos, (d) => { estado.diaPedidos = d; cargarPedidos(); });

  let q = sb.from('pedidos').select('id,creado,numero,turno,responsable,foto,miniatura').order('creado', { ascending: false });
  if (busq) {
    q = q.ilike('numero', `%${busq}%`).limit(60);
  } else {
    q = q.gte('creado', estado.diaPedidos.toISOString()).lt('creado', sumarDias(estado.diaPedidos, 1).toISOString());
    if (estado.filtroTurno) q = q.eq('turno', estado.filtroTurno);
  }

  const { data, error } = await q;
  if (nro !== consultaPedidos) return;
  if (error) {
    lista.innerHTML = vacio('⚠️', 'No se pudieron cargar los pedidos', mensajeError(error));
    $('#resumen-pedidos').textContent = '';
    return;
  }
  estado.pedidos = data;

  if (busq) {
    $('#resumen-pedidos').innerHTML = data.length
      ? `<strong>${data.length}</strong> ${data.length === 1 ? 'resultado' : 'resultados'} para “${esc(busq)}” en los últimos ${DIAS_GUARDADO} días`
      : '';
  } else {
    $('#resumen-pedidos').innerHTML = data.length
      ? `<strong>${data.length}</strong> ${data.length === 1 ? 'pedido' : 'pedidos'} · ${esc(nombreDia(estado.diaPedidos))}`
      : '';
  }

  if (!data.length) {
    lista.innerHTML = busq
      ? vacio('🔍', 'No se encontró ese número', `Se buscó en los últimos ${DIAS_GUARDADO} días.`)
      : vacio('📦', 'No hay pedidos este día');
    return;
  }

  let links = {};
  try { links = await linksFirmados(data.map((p) => p.miniatura)); } catch (e) { console.error(e); }
  if (nro !== consultaPedidos) return;

  const resaltar = (t) => (busq ? esc(t).replace(new RegExp(`(${busq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : esc(t));
  lista.innerHTML = data.map((p, i) => `
    <button type="button" class="tarjeta" data-i="${i}">
      <img src="${esc(links[p.miniatura] || '')}" alt="" loading="lazy">
      <span class="tarjeta-cuerpo">
        ${p.numero ? `<span class="tarjeta-num">#${resaltar(p.numero)}</span>` : '<span class="tarjeta-num sin-numero">Sin número</span>'}
        <span class="tarjeta-info">${busq ? `📅 ${fechaCorta(p.creado)} · ` : ''}${ICONO_TURNO[p.turno] || ''} ${hora(p.creado)}</span>
        <span class="tarjeta-info">👤 ${esc(p.responsable)}</span>
      </span>
    </button>`).join('');
}

function itemsVisorPedidos() {
  return estado.pedidos.map((p) => ({
    ruta: p.foto,
    titulo: p.numero ? `Pedido #${p.numero}` : 'Pedido sin número',
    detalle: `${fechaCorta(p.creado)} ${hora(p.creado)} · ${p.turno} · ${p.responsable}`,
    archivo: `pedido-${p.numero || 'sin-numero'}.jpg`,
    pedido: p,
  }));
}

async function imprimirPedidos() {
  if (!estado.pedidos.length) return avisar('No hay pedidos para imprimir', 'error');
  const ventana = window.open('', '_blank');
  if (!ventana) return avisar('El navegador bloqueó la ventana. Permití las ventanas emergentes.', 'error');
  ventana.document.write('<p style="font-family:sans-serif">Preparando…</p>');
  try {
    const links = await linksFirmados(estado.pedidos.map((p) => p.foto));
    const titulo = estado.busqueda ? `Búsqueda “${esc(estado.busqueda)}”` : `Pedidos PeYa · ${esc(nombreDia(estado.diaPedidos))} ${fechaInput(estado.diaPedidos)}`;
    ventana.document.open();
    ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
      <style>body{font-family:system-ui,sans-serif;margin:16px}h1{font-size:20px}
      .p{display:flex;gap:16px;break-inside:avoid;border-bottom:1px solid #ccc;padding:12px 0}
      .p img{width:260px;max-height:360px;object-fit:contain;border:1px solid #ddd}
      .n{font-size:22px;font-weight:800}</style></head><body><h1>${titulo}</h1>
      ${estado.pedidos.map((p) => `<div class="p"><img src="${esc(links[p.foto])}"><div>
        <div class="n">#${esc(p.numero || 'sin número')}</div>
        <div>${fechaCorta(p.creado)} ${hora(p.creado)}</div><div>Turno: ${esc(p.turno)}</div><div>Responsable: ${esc(p.responsable)}</div>
      </div></div>`).join('')}
      <script>Promise.all([...document.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>print())<\/script>
      </body></html>`);
    ventana.document.close();
  } catch (e) {
    ventana.close();
    avisar('No se pudo preparar el PDF: ' + mensajeError(e), 'error');
  }
}

/* ═════════ PASE DE TURNO ═════════ */

function pintarFotosPase() {
  const cont = $('#fotos-pase');
  cont.innerHTML = FOTOS_PASE.map((f) => {
    const cargada = estado.fotosPase[f.clave];
    const obligatoria = f.obligatoria(estado.turnoPase);
    const apagada = f.clave === 'stock' && estado.turnoPase === 'Cierre';
    return `
      <div class="slot ${apagada ? 'apagado' : ''}" data-clave="${f.clave}">
        <div class="slot-titulo">${esc(f.nombre)} ${obligatoria ? '<span class="req">*</span>' : '<span class="opc">(opcional)</span>'}</div>
        <label class="slot-zona ${cargada ? 'con-foto' : ''}">
          <input type="file" accept="image/*" hidden ${apagada ? 'disabled' : ''}>
          ${cargada ? `<img src="${cargada.vista}" alt="${esc(f.nombre)}">` : `<span class="zona-icono">📷</span><span>${esc(f.ayuda)}</span>`}
        </label>
        ${cargada ? '<button type="button" class="btn btn-fantasma btn-chico">Quitar</button>' : ''}
      </div>`;
  }).join('');

  cont.querySelectorAll('.slot').forEach((slot) => {
    const clave = slot.dataset.clave;
    $('input', slot).onchange = async (e) => {
      const archivo = e.target.files[0];
      if (!archivo) return;
      try {
        const { foto, mini, vista } = await prepararFoto(archivo);
        quitarFotoPase(clave);
        estado.fotosPase[clave] = { foto, mini, vista };
      } catch (err) {
        avisar(err.message, 'error');
      }
      pintarFotosPase();
    };
    const quitar = $('button', slot);
    if (quitar) quitar.onclick = () => { quitarFotoPase(clave); pintarFotosPase(); };
  });
}

function quitarFotoPase(clave) {
  const f = estado.fotosPase[clave];
  if (f?.vista) URL.revokeObjectURL(f.vista);
  delete estado.fotosPase[clave];
}

function limpiarPase() {
  FOTOS_PASE.forEach((f) => quitarFotoPase(f.clave));
  $('#pase-notas').value = '';
  pintarFotosPase();
}

async function guardarPase() {
  if (estado.guardando) return;
  const turno = estado.turnoPase;
  const responsable = $('#pase-responsable').value.trim();
  if (!turno) return avisar('Elegí el turno', 'error');
  if (!responsable) { $('#pase-responsable').focus(); return avisar('Escribí quién es el responsable', 'error'); }
  const falta = FOTOS_PASE.find((f) => f.obligatoria(turno) && !estado.fotosPase[f.clave]);
  if (falta) return avisar(`Falta la foto de ${falta.nombre}`, 'error');

  guardarLocal('responsable', responsable);
  estado.guardando = true;
  const btn = $('#btn-guardar-pase');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  const subidas = [];
  try {
    const fotos = {};
    for (const f of FOTOS_PASE) {
      const cargada = estado.fotosPase[f.clave];
      if (!cargada || (f.clave === 'stock' && turno === 'Cierre')) continue;
      const ruta = nuevaRuta('pases');
      await subir(ruta.foto, cargada.foto);
      subidas.push(ruta.foto);
      await subir(ruta.mini, cargada.mini);
      subidas.push(ruta.mini);
      fotos[f.clave] = { foto: ruta.foto, mini: ruta.mini };
    }
    const { error } = await sb.from('pases').insert({ turno, responsable, notas: $('#pase-notas').value.trim(), fotos });
    if (error) throw error;
    limpiarPase();
    avisar(`✅ Pase de ${turno} guardado`, 'ok');
    navigator.vibrate?.(60);
    estado.diaPases = hoy();
    cargarPases();
  } catch (e) {
    console.error(e);
    borrarArchivos(subidas).catch(() => {});
    avisar('No se pudo guardar el pase: ' + mensajeError(e), 'error');
  } finally {
    estado.guardando = false;
    btn.disabled = false;
    btn.textContent = 'Guardar pase';
  }
}

let consultaPases = 0;
async function cargarPases() {
  const nro = ++consultaPases;
  const lista = $('#lista-pases');
  pintarNavDia($('#navdia-pases'), estado.diaPases, (d) => { estado.diaPases = d; cargarPases(); });

  const { data, error } = await sb.from('pases').select('*')
    .gte('creado', estado.diaPases.toISOString()).lt('creado', sumarDias(estado.diaPases, 1).toISOString())
    .order('creado', { ascending: false });
  if (nro !== consultaPases) return;
  if (error) { lista.innerHTML = vacio('⚠️', 'No se pudieron cargar los pases', mensajeError(error)); return; }
  estado.pases = data;
  if (!data.length) { lista.innerHTML = vacio('📭', 'No hay pases este día'); return; }

  let links = {};
  try { links = await linksFirmados(data.flatMap((p) => Object.values(p.fotos || {}).map((f) => f.mini))); } catch (e) { console.error(e); }
  if (nro !== consultaPases) return;

  lista.innerHTML = data.map((p, i) => {
    const fotos = FOTOS_PASE.filter((f) => p.fotos?.[f.clave]);
    return `
      <article class="pase">
        <div class="pase-cabeza">
          <span class="insignia insignia-${esc(p.turno)}">${ICONO_TURNO[p.turno] || ''} ${esc(p.turno)}</span>
          <span class="pase-hora">${hora(p.creado)}</span>
          <button type="button" class="btn btn-icono btn-peligro" data-borrar="${i}" aria-label="Borrar pase">🗑</button>
        </div>
        <div class="pase-resp">👤 ${esc(p.responsable)}</div>
        ${p.notas ? `<div class="pase-notas">📝 ${esc(p.notas)}</div>` : ''}
        <div class="pase-fotos">
          ${fotos.map((f, j) => `<button type="button" class="pase-foto" data-pase="${i}" data-foto="${j}">
              <img src="${esc(links[p.fotos[f.clave].mini] || '')}" alt="" loading="lazy">${esc(f.nombre)}</button>`).join('') || '<span class="ayuda">Sin fotos</span>'}
        </div>
      </article>`;
  }).join('');
}

function itemsVisorPase(p) {
  return FOTOS_PASE.filter((f) => p.fotos?.[f.clave]).map((f) => ({
    ruta: p.fotos[f.clave].foto,
    titulo: f.nombre,
    detalle: `Pase ${p.turno} · ${fechaCorta(p.creado)} ${hora(p.creado)} · ${p.responsable}`,
    archivo: `${f.clave}-${fechaInput(new Date(p.creado))}.jpg`,
  }));
}

async function borrarPase(p) {
  if (!confirm(`¿Borrar el pase de ${p.turno} de ${p.responsable}? No se puede deshacer.`)) return;
  try {
    await borrarArchivos(Object.values(p.fotos || {}).flatMap((f) => [f.foto, f.mini]));
    const { error } = await sb.from('pases').delete().eq('id', p.id);
    if (error) throw error;
    avisar('Pase borrado', 'ok');
    cargarPases();
  } catch (e) {
    avisar('No se pudo borrar: ' + mensajeError(e), 'error');
  }
}

/* ═════════ Visor de fotos ═════════ */

function abrirVisor(items, i) {
  estado.visor = { items, i };
  $('#visor').hidden = false;
  document.body.classList.add('sin-scroll');
  mostrarEnVisor();
}

function cerrarVisor() {
  $('#visor').hidden = true;
  document.body.classList.remove('sin-scroll');
  $('#visor-marco').classList.remove('zoom');
  const it = estado.visor.items[estado.visor.i];
  if (it?.urlLocal) URL.revokeObjectURL(it.urlLocal);
  estado.visor = { items: [], i: 0 };
}

async function mostrarEnVisor() {
  const { items, i } = estado.visor;
  const it = items[i];
  if (!it) return cerrarVisor();
  const img = $('#visor-img');
  $('#visor-marco').classList.remove('zoom');
  $('#visor-editar').hidden = true;
  $('#visor-titulo').textContent = it.titulo;
  $('#visor-detalle').textContent = it.detalle || '';
  $('#visor-contador').textContent = items.length > 1 ? `${i + 1} de ${items.length}` : '';
  $('#visor-ant').disabled = i === 0;
  $('#visor-sig').disabled = i === items.length - 1;
  $('#visor-ant').hidden = $('#visor-sig').hidden = items.length < 2;
  $('#visor-btn-editar').hidden = $('#visor-borrar').hidden = !it.pedido;
  $('#visor-compartir').hidden = !navigator.canShare;

  img.removeAttribute('src');
  $('#visor-cargando').hidden = false;
  try {
    let url;
    if (it.blob) url = it.urlLocal ||= URL.createObjectURL(it.blob);
    else url = (await linksFirmados([it.ruta]))[it.ruta];
    if (estado.visor.items[estado.visor.i] !== it) return;
    img.onload = () => { $('#visor-cargando').hidden = true; };
    img.src = url;
  } catch (e) {
    $('#visor-cargando').textContent = 'No se pudo cargar la foto';
  }
}

function moverVisor(paso) {
  const n = estado.visor.i + paso;
  if (n < 0 || n >= estado.visor.items.length) return;
  estado.visor.i = n;
  mostrarEnVisor();
}

async function archivoDelVisor() {
  const it = estado.visor.items[estado.visor.i];
  if (it.blob) return new File([it.blob], it.archivo, { type: 'image/jpeg' });
  const url = (await linksFirmados([it.ruta]))[it.ruta];
  const blob = await (await fetch(url)).blob();
  return new File([blob], it.archivo, { type: 'image/jpeg' });
}

async function descargarDelVisor() {
  try {
    const archivo = await archivoDelVisor();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(archivo);
    a.download = archivo.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    avisar('No se pudo descargar: ' + mensajeError(e), 'error');
  }
}

async function compartirDelVisor() {
  try {
    const archivo = await archivoDelVisor();
    const it = estado.visor.items[estado.visor.i];
    if (navigator.canShare?.({ files: [archivo] })) {
      await navigator.share({ files: [archivo], title: it.titulo, text: `${it.titulo} · ${it.detalle || ''}` });
    } else {
      descargarDelVisor();
    }
  } catch (e) {
    if (e.name !== 'AbortError') avisar('No se pudo compartir: ' + mensajeError(e), 'error');
  }
}

async function guardarNumeroVisor(e) {
  e.preventDefault();
  const it = estado.visor.items[estado.visor.i];
  const numero = $('#visor-numero').value.trim();
  const { error } = await sb.from('pedidos').update({ numero }).eq('id', it.pedido.id);
  if (error) return avisar('No se pudo cambiar: ' + mensajeError(error), 'error');
  it.pedido.numero = numero;
  it.titulo = numero ? `Pedido #${numero}` : 'Pedido sin número';
  it.archivo = `pedido-${numero || 'sin-numero'}.jpg`;
  $('#visor-titulo').textContent = it.titulo;
  $('#visor-editar').hidden = true;
  avisar('Número actualizado', 'ok');
  cargarPedidos();
}

async function borrarPedidoVisor() {
  const it = estado.visor.items[estado.visor.i];
  const p = it.pedido;
  if (!confirm(`¿Borrar el pedido ${p.numero ? '#' + p.numero : 'sin número'}? No se puede deshacer.`)) return;
  try {
    await borrarArchivos([p.foto, p.miniatura]);
    const { error } = await sb.from('pedidos').delete().eq('id', p.id);
    if (error) throw error;
    avisar('Pedido borrado', 'ok');
    estado.visor.items.splice(estado.visor.i, 1);
    if (!estado.visor.items.length) cerrarVisor();
    else { estado.visor.i = Math.min(estado.visor.i, estado.visor.items.length - 1); mostrarEnVisor(); }
    cargarPedidos();
  } catch (e) {
    avisar('No se pudo borrar: ' + mensajeError(e), 'error');
  }
}

function prepararVisor() {
  $('#visor-cerrar').onclick = cerrarVisor;
  $('#visor-ant').onclick = () => moverVisor(-1);
  $('#visor-sig').onclick = () => moverVisor(1);
  $('#visor-descargar').onclick = descargarDelVisor;
  $('#visor-compartir').onclick = compartirDelVisor;
  $('#visor-borrar').onclick = borrarPedidoVisor;
  $('#visor-btn-editar').onclick = () => {
    const it = estado.visor.items[estado.visor.i];
    $('#visor-numero').value = it.pedido.numero;
    $('#visor-editar').hidden = false;
    $('#visor-numero').focus();
  };
  $('#visor-editar-cancelar').onclick = () => { $('#visor-editar').hidden = true; };
  $('#visor-editar').onsubmit = guardarNumeroVisor;

  const marco = $('#visor-marco');
  $('#visor-img').onclick = () => marco.classList.toggle('zoom');

  // Deslizar con el dedo para pasar de foto
  let inicioX = 0, inicioY = 0;
  marco.addEventListener('touchstart', (e) => { inicioX = e.touches[0].clientX; inicioY = e.touches[0].clientY; }, { passive: true });
  marco.addEventListener('touchend', (e) => {
    if (marco.classList.contains('zoom')) return;
    const dx = e.changedTouches[0].clientX - inicioX;
    const dy = Math.abs(e.changedTouches[0].clientY - inicioY);
    if (Math.abs(dx) > 50 && dy < 70) moverVisor(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if ($('#visor').hidden || e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') cerrarVisor();
    if (e.key === 'ArrowRight') moverVisor(1);
    if (e.key === 'ArrowLeft') moverVisor(-1);
  });
}

/* ═════════ Borrado automático de fotos viejas ═════════ */

async function limpiarViejos() {
  const limite = sumarDias(hoy(), -DIAS_GUARDADO).toISOString();
  try {
    const { data: pedidos } = await sb.from('pedidos').select('id,foto,miniatura').lt('creado', limite).limit(300);
    if (pedidos?.length) {
      await borrarArchivos(pedidos.flatMap((p) => [p.foto, p.miniatura]));
      await sb.from('pedidos').delete().in('id', pedidos.map((p) => p.id));
    }
    const { data: pases } = await sb.from('pases').select('id,fotos').lt('creado', limite).limit(100);
    if (pases?.length) {
      await borrarArchivos(pases.flatMap((p) => Object.values(p.fotos || {}).flatMap((f) => [f.foto, f.mini])));
      await sb.from('pases').delete().in('id', pases.map((p) => p.id));
    }
  } catch (e) {
    console.warn('Limpieza de fotos viejas:', e);
  }
}

/* ═════════ Arranque ═════════ */

function cambiarVista(vista) {
  document.querySelectorAll('.pestanas button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
  $('#vista-pedidos').hidden = vista !== 'pedidos';
  $('#vista-pases').hidden = vista !== 'pases';
  guardarLocal('vista', vista);
  window.scrollTo(0, 0);
}

let esperaRecarga = {};
function recargarLuego(que) {
  clearTimeout(esperaRecarga[que]);
  esperaRecarga[que] = setTimeout(() => (que === 'pedidos' ? cargarPedidos() : cargarPases()), 700);
}

function iniciarApp() {
  if (estado.iniciada) return;
  estado.iniciada = true;

  const responsable = leerLocal('responsable') || '';
  $('#pedidos-responsable').value = responsable;
  $('#pase-responsable').value = responsable;

  document.querySelectorAll('.pestanas button').forEach((b) => { b.onclick = () => cambiarVista(b.dataset.vista); });
  cambiarVista(leerLocal('vista') === 'pases' ? 'pases' : 'pedidos');

  pintarChips($('#pedidos-turno'), opcionesTurno, estado.turnoPedidos, (t) => { estado.turnoPedidos = t; guardarLocal('turno', t); });
  pintarChips($('#pase-turno'), opcionesTurno, estado.turnoPase, (t) => { estado.turnoPase = t; guardarLocal('turno', t); pintarFotosPase(); });
  pintarChips($('#pedidos-filtro'), [{ valor: '', texto: 'Todos' }, ...opcionesTurno], '', (t) => { estado.filtroTurno = t; cargarPedidos(); });

  $('#pedidos-archivos').onchange = (e) => { const archivos = [...e.target.files]; e.target.value = ''; if (archivos.length) agregarFotosPedido(archivos); };
  $('#btn-guardar-pedidos').onclick = guardarPedidos;
  $('#btn-descartar').onclick = () => {
    if (estado.pendientes.length > 1 && !confirm('¿Descartar todas las fotos sin guardar?')) return;
    [...estado.pendientes].forEach(quitarPendiente);
    pintarPendientes();
  };
  $('#btn-imprimir').onclick = imprimirPedidos;

  let esperaBusqueda;
  $('#buscar').oninput = (e) => {
    clearTimeout(esperaBusqueda);
    esperaBusqueda = setTimeout(() => {
      estado.busqueda = e.target.value.replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 20);
      cargarPedidos();
    }, 300);
  };

  $('#lista-pedidos').onclick = (e) => {
    const t = e.target.closest('.tarjeta');
    if (t) abrirVisor(itemsVisorPedidos(), Number(t.dataset.i));
  };
  $('#lista-pases').onclick = (e) => {
    const borrar = e.target.closest('[data-borrar]');
    if (borrar) return borrarPase(estado.pases[Number(borrar.dataset.borrar)]);
    const foto = e.target.closest('.pase-foto');
    if (foto) abrirVisor(itemsVisorPase(estado.pases[Number(foto.dataset.pase)]), Number(foto.dataset.foto));
  };

  $('#btn-guardar-pase').onclick = guardarPase;
  $('#btn-limpiar-pase').onclick = limpiarPase;
  $('#btn-salir').onclick = async () => {
    if (estado.pendientes.length && !confirm('Tenés fotos sin guardar. ¿Salir igual?')) return;
    await sb.auth.signOut();
    location.reload();
  };

  window.addEventListener('beforeunload', (e) => { if (estado.pendientes.length) e.preventDefault(); });

  prepararVisor();
  pintarPendientes();
  pintarFotosPase();
  cargarPedidos();
  cargarPases();

  sb.channel('cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => recargarLuego('pedidos'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pases' }, () => recargarLuego('pases'))
    .subscribe();

  // Si el celular quedó en segundo plano, al volver se actualiza
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    cargarPedidos();
    cargarPases();
  });

  setTimeout(limpiarViejos, 3000);
}

function mostrarLogin(error = '') {
  $('#pantalla-app').hidden = true;
  $('#pantalla-login').hidden = false;
  $('#login-error').hidden = !error;
  $('#login-error').textContent = error;
}

function prepararLogin() {
  $('#form-login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#btn-entrar');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({
      email: $('#login-email').value.trim(),
      password: $('#login-pass').value,
    });
    btn.disabled = false;
    btn.textContent = 'Entrar';
    if (error) mostrarLogin(/invalid/i.test(error.message) ? 'Email o contraseña incorrectos' : mensajeError(error));
  };
}

if (SUPABASE_URL.includes('TU-PROYECTO')) {
  mostrarLogin('Falta configurar config.js con los datos de Supabase (ver LEEME.md).');
  $('#btn-entrar').disabled = true;
} else {
  prepararLogin();
  sb.auth.onAuthStateChange((_evento, sesion) => {
    // Supabase recomienda no llamar a la base dentro de este aviso, por eso el setTimeout.
    setTimeout(() => {
      if (sesion) {
        $('#pantalla-login').hidden = true;
        $('#pantalla-app').hidden = false;
        iniciarApp();
      } else if (!estado.iniciada) {
        mostrarLogin();
      } else {
        location.reload();
      }
    }, 0);
  });
}
