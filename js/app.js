'use strict';

// ================================================================
// INICIALIZACIÓN DE FIREBASE
// ================================================================
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();

// ================================================================
// ESTADO GLOBAL
// ================================================================
const Estado = {
  usuario:      null,
  tabActual:    'gastos',
  gastos:       [],
  ingresos:     [],
  categorias:   [],
  cuentas:      [],
  pins:         {},
  pinIngresado: '',
  gastoEditandoId: null,
  gastoAEliminarId: null,
  ingresoEditandoId: null,
  ingresoAEliminarId: null,
  categoriaEditandoId: null,
  cuentaEditandoId: null,
  cuentaHistorialId: null,
  cuentaADesactivarId: null,
  pinCambiandoRol: null,
  pinResetandoRol: null,
  pendienteAPagarId: null,
  nombreEditandoRol: null,
  nombres: {},
  gastosResumenActual: [],
  ingresosResumenActual: [],
  pendientes:   [],
  graficas: { dona: null, barras: null, linea: null, cuentaHistorial: null },
};

// ================================================================
// UTILIDADES
// ================================================================

function formatMonto(monto) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2
  }).format(monto || 0);
}

// Recibe 'YYYY-MM-DD', devuelve cadena legible en español
function formatFecha(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function primerDiaMes(mes, anio) {
  return `${anio}-${String(mes).padStart(2,'0')}-01`;
}

function ultimoDiaMes(mes, anio) {
  const ultimo = new Date(anio, mes, 0);
  return `${ultimo.getFullYear()}-${String(ultimo.getMonth()+1).padStart(2,'0')}-${String(ultimo.getDate()).padStart(2,'0')}`;
}

function nombreRol(rol) {
  // Usa el nombre personalizado si ya se cargó, si no usa el default
  if (Estado.nombres && Estado.nombres[rol]) return Estado.nombres[rol];
  return { socio1: 'Socio 1', socio2: 'Socio 2', admin: 'Administrador' }[rol] || rol;
}

function nombreMes(num) {
  return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
          'Agosto','Septiembre','Octubre','Noviembre','Diciembre'][num - 1] || '';
}

function mesAnterior(mes, anio) {
  return mes === 1 ? { mes: 12, anio: anio - 1 } : { mes: mes - 1, anio };
}

// ================================================================
// UI: SPINNER, TOASTS, MODALES
// ================================================================

function mostrarSpinner() { document.getElementById('spinnerOverlay').classList.remove('hidden'); }
function ocultarSpinner() { document.getElementById('spinnerOverlay').classList.add('hidden'); }

function mostrarToast(mensaje, tipo = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function abrirModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.classList.add('modal-abierto');
}

function cerrarModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.body.classList.remove('modal-abierto');
}

// Cerrar modal al hacer clic en el overlay (fuera del contenido)
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden');
    document.body.classList.remove('modal-abierto');
  }
});

// ================================================================
// PANTALLA PIN
// ================================================================

function inicializarPantallaPIN() {
  document.querySelectorAll('.pin-btn[data-num]').forEach(btn => {
    btn.addEventListener('click', () => ingresarDigito(btn.dataset.num));
  });
  document.getElementById('pinBorrar').addEventListener('click', borrarDigito);
  document.addEventListener('keydown', manejarTecladoFisico);
}

function manejarTecladoFisico(e) {
  if (!document.getElementById('pantallaPin') ||
       document.getElementById('pantallaPin').classList.contains('hidden')) return;
  if (/^[0-9]$/.test(e.key)) ingresarDigito(e.key);
  if (e.key === 'Backspace') borrarDigito();
}

function ingresarDigito(num) {
  if (Estado.pinIngresado.length >= 4) return;
  Estado.pinIngresado += num;
  actualizarDotsPIN();
  if (Estado.pinIngresado.length === 4) setTimeout(verificarPIN, 120);
}

function borrarDigito() {
  Estado.pinIngresado = Estado.pinIngresado.slice(0, -1);
  actualizarDotsPIN();
  document.getElementById('pinErrorMsg').classList.add('hidden');
}

function actualizarDotsPIN() {
  for (let i = 0; i < 4; i++) {
    document.getElementById(`dot${i}`).classList.toggle('activo', i < Estado.pinIngresado.length);
  }
}

async function verificarPIN() {
  const pin = Estado.pinIngresado;
  Estado.pinIngresado = '';
  actualizarDotsPIN();

  let rolEncontrado = null;
  if (pin === Estado.pins.admin)  rolEncontrado = 'admin';
  else if (pin === Estado.pins.socio1) rolEncontrado = 'socio1';
  else if (pin === Estado.pins.socio2) rolEncontrado = 'socio2';

  if (rolEncontrado) {
    await iniciarSesion(rolEncontrado);
  } else {
    const card = document.querySelector('.pin-card');
    card.classList.add('pin-error-animacion');
    document.getElementById('pinErrorMsg').classList.remove('hidden');
    setTimeout(() => card.classList.remove('pin-error-animacion'), 500);
  }
}

// ================================================================
// SESIÓN
// ================================================================

async function iniciarSesion(rol) {
  mostrarSpinner();
  Estado.usuario = { rol, nombre: nombreRol(rol) };
  localStorage.setItem('hr-gastos-usuario', rol);

  document.getElementById('usuarioActual').textContent = nombreRol(rol);
  document.querySelector('.tab-admin').classList.toggle('hidden', rol !== 'admin');

  // FAB 💰 solo visible para socios (no para admin)
  const fabPendiente = document.getElementById('fabPendiente');
  if (fabPendiente) fabPendiente.classList.toggle('hidden', rol === 'admin');

  // FAB ingresos solo para admin
  const fabIngreso = document.getElementById('fabNuevoIngreso');
  if (fabIngreso) fabIngreso.classList.toggle('hidden', rol !== 'admin');

  document.getElementById('pantallaPin').classList.add('hidden');
  document.getElementById('appPrincipal').classList.remove('hidden');

  try {
    await Promise.all([cargarCategorias(), cargarGastosMesActual(), mostrarPanelDeudas(), cargarCuentas()]);
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar datos. Verifica tu conexión a internet.', 'error');
  }
  ocultarSpinner();
}

function cerrarSesion() {
  Estado.usuario = null;
  Estado.gastos = [];
  Estado.ingresos = [];
  Estado.gastosResumenActual = [];
  Estado.ingresosResumenActual = [];
  localStorage.removeItem('hr-gastos-usuario');

  Estado.cuentas = [];

  // Destruir gráficas
  Object.keys(Estado.graficas).forEach(k => {
    if (Estado.graficas[k]) { Estado.graficas[k].destroy(); Estado.graficas[k] = null; }
  });

  document.getElementById('appPrincipal').classList.add('hidden');
  document.getElementById('pantallaPin').classList.remove('hidden');

  // Ocultar FABs
  const fabPendiente = document.getElementById('fabPendiente');
  if (fabPendiente) fabPendiente.classList.add('hidden');
  const fabIngreso = document.getElementById('fabNuevoIngreso');
  if (fabIngreso) fabIngreso.classList.add('hidden');

  // Resetear PIN y volver al tab Gastos
  Estado.pinIngresado = '';
  actualizarDotsPIN();
  document.getElementById('pinErrorMsg').classList.add('hidden');
  cambiarTabSilencioso('gastos');
}

// Exponer globalmente para el botón de cerrar sesión
window.cerrarSesion = cerrarSesion;

// ================================================================
// TABS
// ================================================================

function cambiarTab(tab) {
  cambiarTabSilencioso(tab);
  if (tab === 'ingresos') cargarIngresosMesActual();
  if (tab === 'cuentas')  cargarCuentas();
  if (tab === 'resumen')  cargarResumen();
  if (tab === 'graficas') cargarGraficas();
  if (tab === 'ajustes')  cargarAjustes();
}
window.cambiarTab = cambiarTab;

function cambiarTabSilencioso(tab) {
  Estado.tabActual = tab;

  document.querySelectorAll('.nav-tab').forEach(btn => {
    const activo = btn.dataset.tab === tab;
    btn.classList.toggle('activo', activo);
    btn.setAttribute('aria-selected', activo);
  });

  document.querySelectorAll('.tab-contenido').forEach(el => {
    el.classList.remove('activo');
    el.classList.add('hidden');
  });
  const contenido = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (contenido) {
    contenido.classList.remove('hidden');
    contenido.classList.add('activo');
  }
}

// ================================================================
// FIRESTORE: PINs
// ================================================================

async function cargarPINs() {
  try {
    const doc = await db.collection('config').doc('pins').get();
    if (doc.exists) {
      Estado.pins = { ...PINS_DEFAULT, ...doc.data() };
    } else {
      await db.collection('config').doc('pins').set(PINS_DEFAULT);
      Estado.pins = { ...PINS_DEFAULT };
    }
  } catch (err) {
    console.warn('Error cargando PINs, usando valores por defecto:', err);
    Estado.pins = { ...PINS_DEFAULT };
  }
}

// ================================================================
// FIRESTORE: NOMBRES DE SOCIOS
// ================================================================

async function cargarNombres() {
  try {
    const doc = await db.collection('config').doc('nombres').get();
    if (doc.exists) {
      Estado.nombres = { ...NOMBRES_DEFAULT, ...doc.data() };
    } else {
      await db.collection('config').doc('nombres').set(NOMBRES_DEFAULT);
      Estado.nombres = { ...NOMBRES_DEFAULT };
    }
  } catch (err) {
    console.warn('Error cargando nombres, usando valores por defecto:', err);
    Estado.nombres = { ...NOMBRES_DEFAULT };
  }
  poblarFiltroRegistradoPor();
}

function poblarFiltroRegistradoPor() {
  const sel = document.getElementById('filtroRegistradoPor');
  if (!sel) return;
  const val = sel.value;
  while (sel.options.length) sel.remove(0);
  sel.add(new Option('Todos', ''));
  sel.add(new Option(nombreRol('socio1'), 'socio1'));
  sel.add(new Option(nombreRol('socio2'), 'socio2'));
  sel.add(new Option(nombreRol('admin'), 'admin'));
  sel.value = val;
}

function poblarFiltroOrigen() {
  const sel = document.getElementById('filtroOrigen');
  if (!sel) return;
  const val = sel.value;
  while (sel.options.length) sel.remove(0);
  sel.add(new Option('Todos', ''));
  sel.add(new Option('💼 Fondos del negocio', 'fondos'));
  Estado.cuentas.forEach(c => {
    sel.add(new Option(`🏦 ${c.nombre}${c.banco ? ' — ' + c.banco : ''}`, c.id));
  });
  const validValues = new Set(['', 'fondos', ...Estado.cuentas.map(c => c.id)]);
  sel.value = validValues.has(val) ? val : '';
}

function poblarSelectOrigenCuenta() {
  const sel = document.getElementById('gastoOrigenCuenta');
  if (!sel) return;
  const val = sel.value;
  while (sel.options.length) sel.remove(0);
  sel.add(new Option('💼 Fondos del negocio (normal)', ''));
  Estado.cuentas.forEach(c => {
    sel.add(new Option(`🏦 ${c.nombre}${c.banco ? ' — ' + c.banco : ''}`, c.id));
  });
  // Restore selection only if still valid
  if (val && Estado.cuentas.some(c => c.id === val)) sel.value = val;
  else sel.value = '';
}
window.actualizarPreviewOrigenCuenta = function() {
  const sel     = document.getElementById('gastoOrigenCuenta');
  const preview = document.getElementById('gastoCuentaPreview');
  if (!sel || !preview) return;
  const cuentaId = sel.value;
  if (!cuentaId) { preview.classList.add('hidden'); return; }
  const cuenta = Estado.cuentas.find(c => c.id === cuentaId);
  if (!cuenta) { preview.classList.add('hidden'); return; }
  const monto      = parseFloat(document.getElementById('gastoMonto').value) || 0;
  const saldoAct   = +(cuenta.saldoActual || 0);
  const saldoNuevo = +(saldoAct - monto).toFixed(2);
  if (saldoNuevo < 0) {
    preview.innerHTML = `⚠️ El saldo quedará negativo: ${formatMonto(saldoAct)} → <strong style="color:var(--alerta)">${formatMonto(saldoNuevo)}</strong>`;
    preview.className = 'cuenta-preview cuenta-preview-alerta';
  } else {
    preview.innerHTML = `Saldo actual: ${formatMonto(saldoAct)} → quedará en <strong>${formatMonto(saldoNuevo)}</strong>`;
    preview.className = 'cuenta-preview';
  }
  preview.classList.remove('hidden');
};

function abrirEditarNombre(rol) {
  Estado.nombreEditandoRol = rol;
  document.getElementById('editarNombreTitulo').textContent =
    `Editar nombre — ${nombreRol(rol)}`;
  document.getElementById('nuevoNombreSocio').value = Estado.nombres[rol] || '';
  abrirModal('modalEditarNombre');
}
window.abrirEditarNombre = abrirEditarNombre;

async function guardarNombreSocio() {
  const nombre = document.getElementById('nuevoNombreSocio').value.trim();
  if (!nombre) return mostrarToast('Ingresa un nombre.', 'advertencia');

  mostrarSpinner();
  try {
    const update = {};
    update[Estado.nombreEditandoRol] = nombre;
    // set+merge funciona aunque el documento no exista aún
    await db.collection('config').doc('nombres').set(update, { merge: true });
    Estado.nombres[Estado.nombreEditandoRol] = nombre;
    poblarFiltroRegistradoPor();

    // Actualizar el badge si es el usuario actual
    if (Estado.usuario?.rol === Estado.nombreEditandoRol) {
      Estado.usuario.nombre = nombre;
      document.getElementById('usuarioActual').textContent = nombre;
    }

    mostrarToast(`Nombre actualizado a "${nombre}".`, 'exito');
    cerrarModal('modalEditarNombre');

    // Refrescar lista de gastos para mostrar el nuevo nombre
    if (Estado.gastos.length > 0) {
      aplicarFiltrosClienteSide();
    }
    // Refrescar panel de deudas
    await mostrarPanelDeudas();
    // Refrescar ajustes
    cargarAjustes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar el nombre.', 'error');
  }
  ocultarSpinner();
}
window.guardarNombreSocio = guardarNombreSocio;

// ================================================================
// FIRESTORE: CATEGORÍAS
// ================================================================

async function cargarCategorias() {
  try {
    const snap = await db.collection('categorias').orderBy('orden').get();
    if (snap.empty) {
      const batch = db.batch();
      CATEGORIAS_DEFAULT.forEach((nombre, i) => {
        batch.set(db.collection('categorias').doc(), { nombre, orden: i + 1 });
      });
      await batch.commit();
      Estado.categorias = CATEGORIAS_DEFAULT.map((nombre, i) => ({ nombre, orden: i + 1, id: null }));
    } else {
      Estado.categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    poblarSelectCategorias();
  } catch (err) {
    console.error('Error cargando categorías:', err);
    Estado.categorias = CATEGORIAS_DEFAULT.map((nombre, i) => ({ nombre, orden: i + 1, id: null }));
    poblarSelectCategorias();
  }
}

function poblarSelectCategorias() {
  ['filtroCategoria', 'gastoCategoria'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const primerValor = sel.options[0] ? sel.options[0].value : '';
    const primerTexto = sel.options[0] ? sel.options[0].textContent : 'Todas';
    while (sel.options.length) sel.remove(0);
    sel.add(new Option(primerTexto, primerValor));
    Estado.categorias.forEach(c => sel.add(new Option(c.nombre, c.nombre)));
  });
}

// ================================================================
// FIRESTORE: CARGAR GASTOS
// ================================================================

async function cargarGastosMesActual() {
  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();

  document.getElementById('filtroDesde').value = primerDiaMes(mes, anio);
  document.getElementById('filtroHasta').value = ultimoDiaMes(mes, anio);
  const sel = document.getElementById('filtroPeriodoRapido');
  if (sel) sel.value = 'mes-actual';

  await cargarGastosConFiltros();
}

async function cargarGastosConFiltros() {
  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;

  mostrarSkeletonGastos();
  try {
    let query = db.collection('gastos').orderBy('fecha', 'desc');
    if (desde) query = query.where('fecha', '>=', desde);
    if (hasta) query = query.where('fecha', '<=', hasta);

    const snap = await query.get();
    let gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Ordenar: dentro del mismo día, los más recientes primero
    gastos.sort((a, b) => {
      if (b.fecha !== a.fecha) return b.fecha.localeCompare(a.fecha);
      const ta = a.timestamp?.seconds || 0;
      const tb = b.timestamp?.seconds || 0;
      return tb - ta;
    });

    Estado.gastos = gastos;  // base sin filtros de cliente
    aplicarFiltrosClienteSide();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar los gastos. Verifica tu conexión.', 'error');
    renderizarListaGastos([]);
  }
}

// Aplica filtros de categoría, método, persona y texto sobre Estado.gastos (sin ir a Firestore)
function aplicarFiltrosClienteSide() {
  if (!Estado.gastos) return;
  const categoria     = document.getElementById('filtroCategoria').value;
  const registradoPor = document.getElementById('filtroRegistradoPor').value;
  const metodoPago    = document.getElementById('filtroMetodoPago')?.value || '';
  const texto         = (document.getElementById('filtroTexto')?.value || '').trim().toLowerCase();
  const origen        = document.getElementById('filtroOrigen')?.value || '';

  let gastos = Estado.gastos;
  if (categoria)     gastos = gastos.filter(g => g.categoria === categoria);
  if (registradoPor) gastos = gastos.filter(g => g.registradoPor === registradoPor);
  if (metodoPago)    gastos = gastos.filter(g => g.metodoPago === metodoPago);
  if (origen === 'fondos') gastos = gastos.filter(g => !g.cuentaId);
  else if (origen)         gastos = gastos.filter(g => g.cuentaId === origen);
  if (texto) {
    gastos = gastos.filter(g =>
      (g.descripcion   || '').toLowerCase().includes(texto) ||
      (g.categoria     || '').toLowerCase().includes(texto) ||
      (g.notas         || '').toLowerCase().includes(texto) ||
      (g.cuentaNombre  || '').toLowerCase().includes(texto)
    );
  }
  renderizarListaGastos(gastos);
}
window.aplicarFiltrosClienteSide = aplicarFiltrosClienteSide;

// ================================================================
// FILTROS
// ================================================================

function aplicarFiltros() {
  cargarGastosConFiltros();
}
window.aplicarFiltros = aplicarFiltros;

function limpiarFiltros() {
  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();
  document.getElementById('filtroDesde').value           = primerDiaMes(mes, anio);
  document.getElementById('filtroHasta').value           = ultimoDiaMes(mes, anio);
  document.getElementById('filtroCategoria').value       = '';
  document.getElementById('filtroRegistradoPor').value   = '';
  const textoEl = document.getElementById('filtroTexto');
  if (textoEl) textoEl.value = '';
  const metodoEl = document.getElementById('filtroMetodoPago');
  if (metodoEl) metodoEl.value = '';
  const origenEl = document.getElementById('filtroOrigen');
  if (origenEl) origenEl.value = '';
  const periodoEl = document.getElementById('filtroPeriodoRapido');
  if (periodoEl) periodoEl.value = 'mes-actual';
  cargarGastosConFiltros();
}
window.limpiarFiltros = limpiarFiltros;

function aplicarPeriodoRapido() {
  const val = document.getElementById('filtroPeriodoRapido').value;
  if (!val || val === 'personalizado') return;

  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();
  let desde, hasta;

  if (val === 'mes-actual') {
    desde = primerDiaMes(mes, anio);
    hasta = ultimoDiaMes(mes, anio);
  } else if (val === 'mes-anterior') {
    const ant = mesAnterior(mes, anio);
    desde = primerDiaMes(ant.mes, ant.anio);
    hasta = ultimoDiaMes(ant.mes, ant.anio);
  } else if (val === 'ultimos-3m') {
    const d = new Date(anio, mes - 4, 1);
    desde = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    hasta = ultimoDiaMes(mes, anio);
  } else if (val === 'anio-actual') {
    desde = `${anio}-01-01`;
    hasta = `${anio}-12-31`;
  } else if (val === 'todo') {
    desde = '2020-01-01';
    hasta = '2099-12-31';
  }

  if (desde) document.getElementById('filtroDesde').value = desde;
  if (hasta) document.getElementById('filtroHasta').value = hasta;
  cargarGastosConFiltros();
}
window.aplicarPeriodoRapido = aplicarPeriodoRapido;

// ================================================================
// RENDERIZAR LISTA DE GASTOS
// ================================================================

function mostrarSkeletonGastos() {
  document.getElementById('listaGastos').innerHTML =
    Array(5).fill('<div class="skeleton skeleton-gasto"></div>').join('');
}

function renderizarListaGastos(gastos) {
  const lista = document.getElementById('listaGastos');

  if (!gastos.length) {
    lista.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio-icono">💸</div>
        <p>Aún no hay gastos en este período</p>
        <button class="btn btn-primario" onclick="abrirModalNuevoGasto()">+ Registrar primer gasto</button>
      </div>`;
    return;
  }

  // Agrupar por fecha
  const porFecha = {};
  gastos.forEach(g => { (porFecha[g.fecha] = porFecha[g.fecha] || []).push(g); });
  const fechas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a));

  const totalGeneral = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  const esAdmin      = Estado.usuario?.rol === 'admin';

  let html = `
    <div class="total-general-banner">
      <span>Total del período <span class="filtro-conteo">· ${gastos.length} gasto${gastos.length !== 1 ? 's' : ''}</span></span>
      <strong>${formatMonto(totalGeneral)}</strong>
    </div>`;

  fechas.forEach(fecha => {
    const del = porFecha[fecha];
    const totalDia = del.reduce((s, g) => s + (g.monto || 0), 0);
    html += `
      <div class="grupo-dia">
        <div class="grupo-dia-header">
          <span class="grupo-dia-fecha">${formatFecha(fecha)}</span>
          <span class="grupo-dia-total">${formatMonto(totalDia)}</span>
        </div>
        ${del.map(g => tarjetaGasto(g, esAdmin)).join('')}
      </div>`;
  });

  lista.innerHTML = html;
}

function tarjetaGasto(g, esAdmin) {
  const acciones = esAdmin ? `
    <div class="gasto-acciones">
      <button class="btn-accion btn-editar"   onclick="editarGasto('${g.id}')"              title="Editar">✏️</button>
      <button class="btn-accion btn-eliminar"  onclick="confirmarEliminarGasto('${g.id}')"   title="Eliminar">🗑️</button>
    </div>` : '';

  return `
    <div class="gasto-item" data-id="${g.id}">
      <div class="gasto-izquierda">
        <div class="gasto-categoria-badge">${g.categoria || '—'}</div>
        <div class="gasto-descripcion">${g.descripcion || '—'}</div>
        <div class="gasto-meta">
          <span class="gasto-metodo">${iconoMetodoPago(g.metodoPago)} ${g.metodoPago || ''}</span>
          <span class="gasto-registrado">· ${nombreRol(g.registradoPor)}</span>
          ${g.cuentaId ? `<span class="gasto-origen-badge">🏦 ${g.cuentaNombre || 'Cuenta'}</span>` : ''}
          ${g.notas ? `<span class="gasto-notas">· 📝 ${g.notas}</span>` : ''}
        </div>
      </div>
      <div class="gasto-derecha">
        <div class="gasto-monto">${formatMonto(g.monto)}</div>
        ${acciones}
      </div>
    </div>`;
}

function iconoMetodoPago(metodo) {
  return { Efectivo: '💵', Transferencia: '🏦', Tarjeta: '💳' }[metodo] || '💵';
}

// ================================================================
// MODAL: NUEVO / EDITAR GASTO
// ================================================================

function abrirModalNuevoGasto() {
  Estado.gastoEditandoId = null;
  document.getElementById('modalGastoTitulo').textContent = 'Nuevo Gasto';
  document.getElementById('formGasto').reset();
  document.getElementById('gastoFecha').value = hoy();
  poblarSelectCategorias();
  poblarSelectOrigenCuenta();
  document.getElementById('gastoCuentaPreview')?.classList.add('hidden');
  abrirModal('modalGasto');
}
window.abrirModalNuevoGasto = abrirModalNuevoGasto;

function editarGasto(id) {
  const g = Estado.gastos.find(x => x.id === id);
  if (!g) return;
  Estado.gastoEditandoId = id;
  document.getElementById('modalGastoTitulo').textContent = 'Editar Gasto';
  poblarSelectCategorias();
  poblarSelectOrigenCuenta();
  document.getElementById('gastoFecha').value        = g.fecha       || hoy();
  document.getElementById('gastoCategoria').value    = g.categoria   || '';
  document.getElementById('gastoDescripcion').value  = g.descripcion || '';
  document.getElementById('gastoMonto').value        = g.monto       || '';
  document.getElementById('gastoMetodoPago').value   = g.metodoPago  || '';
  document.getElementById('gastoNotas').value        = g.notas       || '';
  const selOrigen = document.getElementById('gastoOrigenCuenta');
  if (selOrigen) selOrigen.value = g.cuentaId || '';
  actualizarPreviewOrigenCuenta();
  abrirModal('modalGasto');
}
window.editarGasto = editarGasto;

function cerrarModalGasto() {
  cerrarModal('modalGasto');
  Estado.gastoEditandoId = null;
}
window.cerrarModalGasto = cerrarModalGasto;

async function guardarGasto() {
  const fecha       = document.getElementById('gastoFecha').value;
  const categoria   = document.getElementById('gastoCategoria').value;
  const descripcion = document.getElementById('gastoDescripcion').value.trim();
  const monto       = parseFloat(document.getElementById('gastoMonto').value);
  const metodoPago  = document.getElementById('gastoMetodoPago').value;
  const notas       = document.getElementById('gastoNotas').value.trim();
  const cuentaId    = document.getElementById('gastoOrigenCuenta')?.value || null;
  const cuentaObj   = cuentaId ? Estado.cuentas.find(c => c.id === cuentaId) : null;
  const cuentaNombre = cuentaObj
    ? (cuentaObj.nombre + (cuentaObj.banco ? ' — ' + cuentaObj.banco : ''))
    : null;

  if (!fecha)                     return mostrarToast('Selecciona una fecha.', 'advertencia');
  if (!categoria)                 return mostrarToast('Selecciona una categoría.', 'advertencia');
  if (!descripcion)               return mostrarToast('Ingresa una descripción.', 'advertencia');
  if (isNaN(monto) || monto <= 0) return mostrarToast('El monto debe ser mayor a $0.00.', 'advertencia');
  if (!metodoPago)                return mostrarToast('Selecciona el método de pago.', 'advertencia');

  const datos = {
    fecha, categoria, descripcion, monto, metodoPago, notas,
    cuentaId:     cuentaId     || null,
    cuentaNombre: cuentaNombre || null,
    registradoPor: Estado.usuario.rol,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };

  mostrarSpinner();
  try {
    if (Estado.gastoEditandoId) {
      const gastoAnterior   = Estado.gastos.find(x => x.id === Estado.gastoEditandoId);
      const cuentaIdAnterior = gastoAnterior?.cuentaId || null;
      const montoAnterior    = gastoAnterior?.monto    || 0;
      const mismaCuenta     = cuentaIdAnterior === cuentaId;
      const mismoMonto      = montoAnterior === monto;

      if (!cuentaIdAnterior && !cuentaId) {
        // Ninguna cuenta involucrada — simple update
        await db.collection('gastos').doc(Estado.gastoEditandoId).update(datos);
      } else if (mismaCuenta && mismoMonto) {
        // Misma cuenta, mismo monto — sin cambio de saldo
        await db.collection('gastos').doc(Estado.gastoEditandoId).update(datos);
      } else if (mismaCuenta && cuentaId) {
        // Misma cuenta, monto diferente — ajustar por diferencia
        const ahora = firebase.firestore.FieldValue.serverTimestamp();
        await db.runTransaction(async t => {
          const gastoRef  = db.collection('gastos').doc(Estado.gastoEditandoId);
          const cuentaRef = db.collection('cuentas').doc(cuentaId);
          const snap      = await t.get(cuentaRef);
          const saldoAct  = +(snap.data()?.saldoActual || 0);
          const diff      = montoAnterior - monto; // restore old, deduct new
          const saldoNvo  = +(saldoAct + diff).toFixed(2);
          t.update(gastoRef, datos);
          t.update(cuentaRef, { saldoActual: saldoNvo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
          const movRef = db.collection('cuentas').doc(cuentaId).collection('movimientos').doc();
          t.set(movRef, {
            tipo: 'corrección', gastoId: Estado.gastoEditandoId,
            fecha: ahora, saldoAnterior: saldoAct, saldoNuevo: saldoNvo,
            diferencia: +(saldoNvo - saldoAct).toFixed(2),
            actualizadoPor: Estado.usuario.rol, nota: `Corrección: ${descripcion}`
          });
        });
      } else {
        // Cuenta diferente (una o ambas pueden ser null)
        const ahora = firebase.firestore.FieldValue.serverTimestamp();
        await db.runTransaction(async t => {
          const gastoRef = db.collection('gastos').doc(Estado.gastoEditandoId);
          if (cuentaIdAnterior) {
            const refAnt  = db.collection('cuentas').doc(cuentaIdAnterior);
            const snapAnt = await t.get(refAnt);
            const sAnt    = +(snapAnt.data()?.saldoActual || 0);
            const sAntNvo = +(sAnt + montoAnterior).toFixed(2);
            t.update(refAnt, { saldoActual: sAntNvo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
            t.set(db.collection('cuentas').doc(cuentaIdAnterior).collection('movimientos').doc(), {
              tipo: 'corrección', gastoId: Estado.gastoEditandoId,
              fecha: ahora, saldoAnterior: sAnt, saldoNuevo: sAntNvo,
              diferencia: +(sAntNvo - sAnt).toFixed(2),
              actualizadoPor: Estado.usuario.rol,
              nota: `Corrección: ${gastoAnterior?.descripcion || descripcion}`
            });
          }
          if (cuentaId) {
            const refNva  = db.collection('cuentas').doc(cuentaId);
            const snapNva = await t.get(refNva);
            const sNva    = +(snapNva.data()?.saldoActual || 0);
            const sNvaNvo = +(sNva - monto).toFixed(2);
            t.update(refNva, { saldoActual: sNvaNvo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
            t.set(db.collection('cuentas').doc(cuentaId).collection('movimientos').doc(), {
              tipo: 'corrección', gastoId: Estado.gastoEditandoId,
              fecha: ahora, saldoAnterior: sNva, saldoNuevo: sNvaNvo,
              diferencia: +(sNvaNvo - sNva).toFixed(2),
              actualizadoPor: Estado.usuario.rol, nota: `Corrección: ${descripcion}`
            });
          }
          t.update(gastoRef, datos);
        });
      }
      mostrarToast('Gasto actualizado correctamente.', 'exito');
    } else {
      // Nuevo gasto
      if (cuentaId) {
        const ahora = firebase.firestore.FieldValue.serverTimestamp();
        await db.runTransaction(async t => {
          const cuentaRef = db.collection('cuentas').doc(cuentaId);
          const snap      = await t.get(cuentaRef);
          const saldoAnt  = +(snap.data()?.saldoActual || 0);
          const saldoNvo  = +(saldoAnt - monto).toFixed(2);
          const gastoRef  = db.collection('gastos').doc();
          t.set(gastoRef, datos);
          t.update(cuentaRef, { saldoActual: saldoNvo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
          t.set(db.collection('cuentas').doc(cuentaId).collection('movimientos').doc(), {
            tipo: 'gasto', gastoId: gastoRef.id,
            fecha: ahora, saldoAnterior: saldoAnt, saldoNuevo: saldoNvo,
            diferencia: +(saldoNvo - saldoAnt).toFixed(2),
            actualizadoPor: Estado.usuario.rol, nota: descripcion
          });
        });
      } else {
        await db.collection('gastos').add(datos);
      }
      mostrarToast('Gasto registrado correctamente.', 'exito');
    }
    cerrarModalGasto();
    await cargarGastosConFiltros();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.guardarGasto = guardarGasto;

// ================================================================
// ELIMINAR GASTO
// ================================================================

function confirmarEliminarGasto(id) {
  Estado.gastoAEliminarId   = id;
  Estado.ingresoAEliminarId = null;
  Estado.cuentaADesactivarId = null;
  const g = Estado.gastos.find(x => x.id === id);
  document.getElementById('confirmarMensaje').innerHTML =
    `¿Deseas eliminar el gasto <strong>"${g?.descripcion || ''}"</strong> por <strong>${formatMonto(g?.monto)}</strong>?<br><br>Esta acción no se puede deshacer.`;
  document.querySelector('#modalConfirmar .btn-peligro').textContent = 'Sí, eliminar';
  abrirModal('modalConfirmar');
}
window.confirmarEliminarGasto = confirmarEliminarGasto;

function confirmarEliminarIngreso(id) {
  Estado.ingresoAEliminarId = id;
  Estado.gastoAEliminarId   = null;
  Estado.cuentaADesactivarId = null;
  const i = Estado.ingresos.find(x => x.id === id);
  document.getElementById('confirmarMensaje').innerHTML =
    `¿Deseas eliminar el ingreso <strong>"${i?.descripcion || ''}"</strong> por <strong>${formatMonto(i?.monto)}</strong>?<br><br>Esta acción no se puede deshacer.`;
  document.querySelector('#modalConfirmar .btn-peligro').textContent = 'Sí, eliminar';
  abrirModal('modalConfirmar');
}
window.confirmarEliminarIngreso = confirmarEliminarIngreso;

async function ejecutarEliminar() {
  // Deactivate account (admin only)
  if (Estado.cuentaADesactivarId) {
    const id = Estado.cuentaADesactivarId;
    Estado.cuentaADesactivarId = null;
    mostrarSpinner();
    try {
      await db.collection('cuentas').doc(id).update({ activa: false });
      mostrarToast('Cuenta desactivada. Su historial se conserva.', 'exito');
      cerrarModal('modalConfirmar');
      await cargarCuentas();
      cargarSeccionCuentasAjustes();
    } catch (err) {
      console.error(err);
      mostrarToast('Error al desactivar la cuenta.', 'error');
    }
    ocultarSpinner();
    return;
  }

  const esIngreso = !!Estado.ingresoAEliminarId;
  const id = esIngreso ? Estado.ingresoAEliminarId : Estado.gastoAEliminarId;
  if (!id) return;

  mostrarSpinner();
  try {
    if (!esIngreso) {
      const gasto = Estado.gastos.find(x => x.id === id);
      if (gasto?.cuentaId) {
        // Reversal transaction: restore saldo and log a 'reverso' movement
        const ahora = firebase.firestore.FieldValue.serverTimestamp();
        await db.runTransaction(async t => {
          const gastoRef  = db.collection('gastos').doc(id);
          const cuentaRef = db.collection('cuentas').doc(gasto.cuentaId);
          const snap      = await t.get(cuentaRef);
          const saldoAct  = +(snap.data()?.saldoActual || 0);
          const saldoNvo  = +(saldoAct + (gasto.monto || 0)).toFixed(2);
          t.delete(gastoRef);
          t.update(cuentaRef, { saldoActual: saldoNvo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
          t.set(db.collection('cuentas').doc(gasto.cuentaId).collection('movimientos').doc(), {
            tipo: 'reverso', gastoId: id,
            fecha: ahora, saldoAnterior: saldoAct, saldoNuevo: saldoNvo,
            diferencia: +(saldoNvo - saldoAct).toFixed(2),
            actualizadoPor: Estado.usuario.rol,
            nota: `Gasto eliminado: ${gasto.descripcion || ''}`
          });
        });
      } else {
        await db.collection('gastos').doc(id).delete();
      }
      mostrarToast('Gasto eliminado.', 'exito');
      cerrarModal('modalConfirmar');
      Estado.gastoAEliminarId = null;
      await cargarGastosConFiltros();
    } else {
      await db.collection('ingresos').doc(id).delete();
      mostrarToast('Ingreso eliminado.', 'exito');
      cerrarModal('modalConfirmar');
      Estado.ingresoAEliminarId = null;
      await cargarIngresosConFiltros();
    }
  } catch (err) {
    console.error(err);
    mostrarToast('Error al eliminar. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.ejecutarEliminar = ejecutarEliminar;

// ================================================================
// TAB: RESUMEN
// ================================================================

async function cargarResumen() {
  const mes  = parseInt(document.getElementById('resumenMes').value);
  const anio = parseInt(document.getElementById('resumenAnio').value);

  mostrarSkeletonResumen();

  try {
    const ant = mesAnterior(mes, anio);
    const [snapActual, snapAnterior, snapIngresos] = await Promise.all([
      db.collection('gastos')
        .where('fecha', '>=', primerDiaMes(mes, anio))
        .where('fecha', '<=', ultimoDiaMes(mes, anio))
        .orderBy('fecha').get(),
      db.collection('gastos')
        .where('fecha', '>=', primerDiaMes(ant.mes, ant.anio))
        .where('fecha', '<=', ultimoDiaMes(ant.mes, ant.anio))
        .orderBy('fecha').get(),
      db.collection('ingresos')
        .where('fecha', '>=', primerDiaMes(mes, anio))
        .where('fecha', '<=', ultimoDiaMes(mes, anio))
        .orderBy('fecha').get()
    ]);

    const gastosActuales   = snapActual.docs.map(d => ({ id: d.id, ...d.data() }));
    const gastosAnteriores = snapAnterior.docs.map(d => ({ id: d.id, ...d.data() }));
    const ingresosActuales = snapIngresos.docs.map(d => ({ id: d.id, ...d.data() }));

    Estado.gastosResumenActual   = gastosActuales;
    Estado.ingresosResumenActual = ingresosActuales;
    renderizarResumen(gastosActuales, gastosAnteriores, ingresosActuales, mes, anio);

    if (Estado.usuario?.rol !== 'admin') {
      await cargarPendientes();
      renderizarMisPendientes();
    }
    await actualizarResumenCuentas();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar el resumen.', 'error');
  }
}
window.cargarResumen = cargarResumen;

function mostrarSkeletonResumen() {
  document.getElementById('statsGrid').innerHTML =
    Array(4).fill('<div class="stat-card skeleton skeleton-stat"></div>').join('');
  document.getElementById('tablaCategoriasResumen').innerHTML = '';
}

function renderizarResumen(actuales, anteriores, ingresos, mes, anio) {
  // Separar gastos por origen
  const gastosFondos  = actuales.filter(g => !g.cuentaId);
  const gastosCuentas = actuales.filter(g =>  g.cuentaId);
  const anterFondos   = anteriores.filter(g => !g.cuentaId);

  const totalFondos   = gastosFondos.reduce((s, g) => s + (g.monto || 0), 0);
  const totalCuentas  = gastosCuentas.reduce((s, g) => s + (g.monto || 0), 0);
  const totalIngresos = ingresos.reduce((s, i) => s + (i.monto || 0), 0);
  const gananciaNeta  = totalIngresos - totalFondos;
  const totalAnterior = anterFondos.reduce((s, g) => s + (g.monto || 0), 0);
  const variacion     = totalAnterior > 0 ? (totalFondos - totalAnterior) / totalAnterior * 100 : 0;

  const hoyDate  = new Date();
  const diasMes  = new Date(anio, mes, 0).getDate();
  const esActual = hoyDate.getFullYear() === anio && hoyDate.getMonth() + 1 === mes;
  const diasBase = esActual ? hoyDate.getDate() : diasMes;
  const promedio = diasBase > 0 ? totalFondos / diasBase : 0;

  // Categorías — solo fondos del negocio
  const porCatGastos = {};
  gastosFondos.forEach(g => { porCatGastos[g.categoria] = (porCatGastos[g.categoria] || 0) + (g.monto || 0); });
  const catGastosOrd = Object.entries(porCatGastos).sort((a, b) => b[1] - a[1]);
  const mayorCat     = catGastosOrd[0];

  const porCatIngresos = {};
  ingresos.forEach(i => { porCatIngresos[i.categoria] = (porCatIngresos[i.categoria] || 0) + (i.monto || 0); });
  const catIngresosOrd = Object.entries(porCatIngresos).sort((a, b) => b[1] - a[1]);

  const ant      = mesAnterior(mes, anio);
  const varClase = variacion > 0 ? 'stat-negativo' : variacion < 0 ? 'stat-positivo' : '';
  const varIcono = variacion > 0 ? '▲' : variacion < 0 ? '▼' : '–';
  const varTexto = variacion !== 0 ? `${varIcono} ${Math.abs(variacion).toFixed(1)}%` : '– Sin cambio';

  // Detalle de cuentas para la tarjeta azul
  const porCuentaGasto = {};
  gastosCuentas.forEach(g => {
    const k = g.cuentaNombre || g.cuentaId;
    porCuentaGasto[k] = (porCuentaGasto[k] || 0) + (g.monto || 0);
  });
  const detalleCuentas = Object.entries(porCuentaGasto)
    .map(([n, m]) => `<div class="desglose-origen-linea"><span>🏦 ${n}</span><strong>${formatMonto(m)}</strong></div>`)
    .join('');

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card stat-card-ingreso">
      <div class="stat-label">💰 Ingresos — ${nombreMes(mes)}</div>
      <div class="stat-valor">${formatMonto(totalIngresos)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">💸 Gastos operativos — ${nombreMes(mes)}</div>
      <div class="stat-valor">${formatMonto(totalFondos)}</div>
    </div>
    <div class="stat-card" style="border:2px solid #b8d4f0;box-shadow:0 0 0 2px rgba(41,128,185,0.08)">
      <div class="stat-label" style="color:#2980b9">🏦 Pagado desde cuentas — ${nombreMes(mes)}</div>
      <div class="stat-valor" style="color:#2980b9">${formatMonto(totalCuentas)}</div>
      ${totalCuentas > 0 && detalleCuentas
        ? `<div class="desglose-origen" style="margin-top:8px">${detalleCuentas}</div>`
        : `<div style="font-size:.8rem;color:var(--texto-muted);margin-top:4px">Sin gastos desde cuentas este mes</div>`}
    </div>
    <div class="stat-card ${gananciaNeta >= 0 ? 'stat-positivo' : 'stat-negativo'}">
      <div class="stat-label">Ganancia neta</div>
      <div class="stat-valor">${formatMonto(gananciaNeta)}</div>
    </div>
    <div class="stat-card ${varClase}">
      <div class="stat-label">Variación gastos vs ${nombreMes(ant.mes)}</div>
      <div class="stat-valor">${varTexto}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Promedio diario gastos</div>
      <div class="stat-valor">${formatMonto(promedio)}</div>
    </div>
    ${mayorCat ? `
    <div class="stat-card stat-card-wide">
      <div class="stat-label">Categoría con mayor gasto</div>
      <div class="stat-valor">${mayorCat[0]}</div>
      <div class="stat-sublabel">${formatMonto(mayorCat[1])} · ${totalFondos > 0 ? (mayorCat[1]/totalFondos*100).toFixed(1) : 0}% del total</div>
    </div>` : ''}`;

  // Tabla gastos operativos por categoría (fondos del negocio)
  if (!catGastosOrd.length) {
    document.getElementById('tablaCategoriasResumen').innerHTML =
      '<p style="color:var(--texto-muted);font-size:.88rem;text-align:center;padding:20px">Sin gastos en este período</p>';
  } else {
    const filasGastos = catGastosOrd.map(([cat, monto]) => {
      const pct = totalFondos > 0 ? (monto / totalFondos * 100) : 0;
      return `<tr>
        <td>${cat}</td>
        <td style="font-weight:600;white-space:nowrap">${formatMonto(monto)}</td>
        <td><div class="barra-progreso-wrapper">
          <div class="barra-progreso-bg"><div class="barra-progreso" style="width:${pct}%"></div></div>
          <span style="min-width:38px;font-size:.8rem">${pct.toFixed(1)}%</span>
        </div></td></tr>`;
    }).join('');
    document.getElementById('tablaCategoriasResumen').innerHTML = `
      <table class="tabla-resumen">
        <thead><tr><th>Categoría</th><th>Monto</th><th>% del total</th></tr></thead>
        <tbody>${filasGastos}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td colspan="2"><strong>${formatMonto(totalFondos)}</strong></td></tr></tfoot>
      </table>`;
  }

  // Tabla gastos desde cuentas por categoría (solo si hay datos)
  const cardCuentasCat  = document.getElementById('cardCuentasCategorias');
  const tablaCuentasCat = document.getElementById('tablaCuentasCategoriasResumen');
  if (cardCuentasCat && tablaCuentasCat) {
    if (!gastosCuentas.length) {
      cardCuentasCat.classList.add('hidden');
    } else {
      cardCuentasCat.classList.remove('hidden');
      const porCatCuentas = {};
      gastosCuentas.forEach(g => { porCatCuentas[g.categoria] = (porCatCuentas[g.categoria] || 0) + (g.monto || 0); });
      const catCuentasOrd = Object.entries(porCatCuentas).sort((a, b) => b[1] - a[1]);
      const filasCuentas = catCuentasOrd.map(([cat, monto]) => {
        const pct = totalCuentas > 0 ? (monto / totalCuentas * 100) : 0;
        return `<tr>
          <td>${cat}</td>
          <td style="font-weight:600;white-space:nowrap;color:#2980b9">${formatMonto(monto)}</td>
          <td><div class="barra-progreso-wrapper">
            <div class="barra-progreso-bg"><div class="barra-progreso" style="width:${pct}%;background:#2980b9"></div></div>
            <span style="min-width:38px;font-size:.8rem">${pct.toFixed(1)}%</span>
          </div></td></tr>`;
      }).join('');
      tablaCuentasCat.innerHTML = `
        <table class="tabla-resumen">
          <thead><tr><th>Categoría</th><th>Monto</th><th>% del total cuentas</th></tr></thead>
          <tbody>${filasCuentas}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td colspan="2" style="color:#2980b9"><strong>${formatMonto(totalCuentas)}</strong></td></tr></tfoot>
        </table>`;
    }
  }

  // Tabla ingresos por categoría
  const tablaIngresos = document.getElementById('tablaIngresosResumen');
  if (tablaIngresos) {
    if (!catIngresosOrd.length) {
      tablaIngresos.innerHTML =
        '<p style="color:var(--texto-muted);font-size:.88rem;text-align:center;padding:20px">Sin ingresos en este período</p>';
    } else {
      const filasIngresos = catIngresosOrd.map(([cat, monto]) => {
        const pct = totalIngresos > 0 ? (monto / totalIngresos * 100) : 0;
        return `<tr>
          <td>${cat}</td>
          <td style="font-weight:600;white-space:nowrap;color:var(--ingreso)">${formatMonto(monto)}</td>
          <td><div class="barra-progreso-wrapper">
            <div class="barra-progreso-bg"><div class="barra-progreso barra-ingreso" style="width:${pct}%"></div></div>
            <span style="min-width:38px;font-size:.8rem">${pct.toFixed(1)}%</span>
          </div></td></tr>`;
      }).join('');
      tablaIngresos.innerHTML = `
        <table class="tabla-resumen">
          <thead><tr><th>Categoría</th><th>Monto</th><th>% del total</th></tr></thead>
          <tbody>${filasIngresos}</tbody>
          <tfoot><tr><td><strong>Total</strong></td><td colspan="2" style="color:var(--ingreso)"><strong>${formatMonto(totalIngresos)}</strong></td></tr></tfoot>
        </table>`;
    }
  }
}

// ================================================================
// TAB: GRÁFICAS
// ================================================================

async function cargarGraficas() {
  const mes  = parseInt(document.getElementById('graficaMes').value);
  const anio = parseInt(document.getElementById('graficaAnio').value);

  const inicio6m = (() => {
    const d = new Date(anio, mes - 7, 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  })();
  const fin6m = ultimoDiaMes(mes, anio);

  try {
    const [snapGastosMes, snapGastos6m, snapIngresos6m] = await Promise.all([
      db.collection('gastos')
        .where('fecha', '>=', primerDiaMes(mes, anio))
        .where('fecha', '<=', fin6m)
        .orderBy('fecha').get(),
      db.collection('gastos')
        .where('fecha', '>=', inicio6m)
        .where('fecha', '<=', fin6m)
        .orderBy('fecha').get(),
      db.collection('ingresos')
        .where('fecha', '>=', inicio6m)
        .where('fecha', '<=', fin6m)
        .orderBy('fecha').get()
    ]);

    renderizarGraficas(
      snapGastosMes.docs.map(d => d.data()),
      snapGastos6m.docs.map(d => d.data()),
      snapIngresos6m.docs.map(d => d.data()),
      mes, anio
    );
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar gráficas.', 'error');
  }
}
window.cargarGraficas = cargarGraficas;

function colorTextoGrafica() {
  return getComputedStyle(document.documentElement).getPropertyValue('--texto').trim() || '#333';
}
function colorMutedGrafica() {
  return getComputedStyle(document.documentElement).getPropertyValue('--texto-muted').trim() || '#666';
}
function colorBordeGrafica() {
  return getComputedStyle(document.documentElement).getPropertyValue('--borde').trim() || '#dee2e6';
}

function renderizarGraficas(gastosMes, gastos6m, ingresos6m, mes, anio) {
  // Destruir instancias anteriores
  Object.keys(Estado.graficas).forEach(k => {
    if (Estado.graficas[k]) { Estado.graficas[k].destroy(); Estado.graficas[k] = null; }
  });

  const colores = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#FD79A8','#74B9FF'];
  const textoColor = colorTextoGrafica();
  const mutedColor = colorMutedGrafica();

  Chart.defaults.color = textoColor;

  // === DONA: por categoría (fondos del negocio) ===
  const porCat = {};
  gastosMes.filter(g => !g.cuentaId).forEach(g => { porCat[g.categoria] = (porCat[g.categoria] || 0) + (g.monto || 0); });

  Estado.graficas.dona = new Chart(document.getElementById('graficaDona'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(porCat),
      datasets: [{
        data: Object.values(porCat),
        backgroundColor: colores,
        borderWidth: 2,
        borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#fff',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, color: textoColor } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatMonto(ctx.parsed)}` } }
      }
    }
  });

  // === BARRAS: ingresos vs gastos últimos 6 meses (fondos + cuentas apilados) ===
  const mesesGastos        = {};
  const mesesGastosCuentas = {};
  const mesesIngresos      = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anio, mes - 1 - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    mesesGastos[k]        = 0;
    mesesGastosCuentas[k] = 0;
    mesesIngresos[k]      = 0;
  }
  gastos6m.forEach(g => {
    const k = g.fecha?.substring(0, 7);
    if (k in mesesGastos) {
      if (!g.cuentaId) mesesGastos[k]        += (g.monto || 0);
      else             mesesGastosCuentas[k] += (g.monto || 0);
    }
  });
  ingresos6m.forEach(i => {
    const k = i.fecha?.substring(0, 7);
    if (k in mesesIngresos) mesesIngresos[k] += (i.monto || 0);
  });

  const labelsBarras = Object.keys(mesesGastos).map(k => {
    const [y, m] = k.split('-');
    return `${nombreMes(parseInt(m)).substring(0,3)} ${y}`;
  });

  Estado.graficas.barras = new Chart(document.getElementById('graficaBarras'), {
    type: 'bar',
    data: {
      labels: labelsBarras,
      datasets: [
        {
          label: 'Ingresos',
          data: Object.values(mesesIngresos),
          backgroundColor: 'rgba(39,174,96,0.8)',
          borderColor: '#27ae60',
          borderWidth: 1.5,
          borderRadius: 4
        },
        {
          label: 'Gastos operativos',
          data: Object.values(mesesGastos),
          backgroundColor: 'rgba(255,107,53,0.8)',
          borderColor: '#FF6B35',
          borderWidth: 1.5,
          borderRadius: 0,
          stack: 'gastos'
        },
        {
          label: 'Desde cuentas',
          data: Object.values(mesesGastosCuentas),
          backgroundColor: 'rgba(41,128,185,0.75)',
          borderColor: '#2980b9',
          borderWidth: 1.5,
          borderRadius: 4,
          stack: 'gastos'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: true, labels: { font: { size: 11 }, color: textoColor } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatMonto(ctx.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: mutedColor, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: mutedColor, callback: v => '$' + v.toLocaleString(), font: { size: 11 } },
             grid: { color: 'rgba(128,128,128,0.15)' } }
      }
    }
  });

  // === LÍNEA: acumulado del mes ===
  const diasMes = new Date(anio, mes, 0).getDate();
  const acumDia = {};
  for (let d = 1; d <= diasMes; d++) {
    acumDia[`${anio}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = 0;
  }
  gastosMes.filter(g => !g.cuentaId).forEach(g => { if (g.fecha in acumDia) acumDia[g.fecha] += (g.monto || 0); });

  let suma = 0;
  const diasOrdenados = Object.keys(acumDia).sort();
  const valoresAcum   = diasOrdenados.map(d => { suma += acumDia[d]; return suma; });

  Estado.graficas.linea = new Chart(document.getElementById('graficaLinea'), {
    type: 'line',
    data: {
      labels: diasOrdenados.map(d => parseInt(d.split('-')[2])),
      datasets: [{
        label: 'Acumulado',
        data: valoresAcum,
        borderColor: '#FF6B35',
        backgroundColor: 'rgba(255,107,53,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Acumulado: ${formatMonto(ctx.parsed.y)}` } }
      },
      scales: {
        x: { ticks: { color: mutedColor, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: mutedColor, callback: v => '$' + v.toLocaleString(), font: { size: 11 } },
             grid: { color: 'rgba(128,128,128,0.15)' } }
      }
    }
  });
}

// ================================================================
// TAB: AJUSTES
// ================================================================

async function cargarAjustes() {
  renderizarListaCategorias();

  // Mostrar los PINs (enmascarados)
  const { socio1, socio2, admin } = Estado.pins;
  const mask = p => (p || '????').split('').map(() => '•').join('');
  const el1 = document.getElementById('pinMostradoSocio1');
  const el2 = document.getElementById('pinMostradoSocio2');
  const el3 = document.getElementById('pinMostradoAdmin');
  if (el1) el1.textContent = mask(socio1);
  if (el2) el2.textContent = mask(socio2);
  if (el3) el3.textContent = mask(admin);

  // Mostrar nombres personalizados
  const n1 = document.getElementById('nombreMostradoSocio1');
  const n2 = document.getElementById('nombreMostradoSocio2');
  const n3 = document.getElementById('nombreMostradoAdmin');
  if (n1) n1.textContent = Estado.nombres.socio1 || 'Socio 1';
  if (n2) n2.textContent = Estado.nombres.socio2 || 'Socio 2';
  if (n3) n3.textContent = Estado.nombres.admin  || 'Administrador';

  // Cargar y renderizar pendientes
  await cargarPendientes();
  renderizarPendientesAdmin();

  // Cargar sección de cuentas
  cargarSeccionCuentasAjustes();
}
window.cargarAjustes = cargarAjustes;

function renderizarListaCategorias() {
  const lista = document.getElementById('listaCategorias');
  if (!lista) return;
  if (!Estado.categorias.length) {
    lista.innerHTML = '<p style="color:var(--texto-muted);font-size:.88rem">No hay categorías.</p>';
    return;
  }
  lista.innerHTML = Estado.categorias.map(c => `
    <div class="categoria-item">
      <span>${c.nombre}</span>
      <div class="categoria-item-acciones">
        <button class="btn-accion btn-editar"  onclick="abrirEditarCategoria('${c.id}','${c.nombre.replace(/'/g,"\\'")}')" title="Editar">✏️</button>
        <button class="btn-accion btn-eliminar" onclick="eliminarCategoria('${c.id}','${c.nombre.replace(/'/g,"\\'")}')" title="Eliminar">🗑️</button>
      </div>
    </div>`).join('');
}

function abrirModalCategoria() {
  Estado.categoriaEditandoId = null;
  document.getElementById('modalCategoriaTitulo').textContent = 'Nueva Categoría';
  document.getElementById('categoriaNombre').value = '';
  abrirModal('modalCategoria');
}
window.abrirModalCategoria = abrirModalCategoria;

function abrirEditarCategoria(id, nombre) {
  Estado.categoriaEditandoId = id;
  document.getElementById('modalCategoriaTitulo').textContent = 'Editar Categoría';
  document.getElementById('categoriaNombre').value = nombre;
  abrirModal('modalCategoria');
}
window.abrirEditarCategoria = abrirEditarCategoria;

async function guardarCategoria() {
  const nombre = document.getElementById('categoriaNombre').value.trim();
  if (!nombre) return mostrarToast('Ingresa el nombre de la categoría.', 'advertencia');

  mostrarSpinner();
  try {
    if (Estado.categoriaEditandoId) {
      await db.collection('categorias').doc(Estado.categoriaEditandoId).update({ nombre });
      mostrarToast('Categoría actualizada.', 'exito');
    } else {
      const orden = Estado.categorias.length + 1;
      await db.collection('categorias').add({ nombre, orden });
      mostrarToast('Categoría agregada.', 'exito');
    }
    cerrarModal('modalCategoria');
    await cargarCategorias();
    renderizarListaCategorias();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar la categoría.', 'error');
  }
  ocultarSpinner();
}
window.guardarCategoria = guardarCategoria;

async function eliminarCategoria(id, nombre) {
  if (!id) return mostrarToast('Esta categoría no se puede eliminar (sin ID).', 'advertencia');
  if (!confirm(`¿Eliminar la categoría "${nombre}"?\n\nLos gastos con esta categoría no se borrarán.`)) return;

  mostrarSpinner();
  try {
    await db.collection('categorias').doc(id).delete();
    mostrarToast('Categoría eliminada.', 'exito');
    await cargarCategorias();
    renderizarListaCategorias();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al eliminar la categoría.', 'error');
  }
  ocultarSpinner();
}
window.eliminarCategoria = eliminarCategoria;

// === CAMBIAR PIN ===

function abrirCambiarPin(rol) {
  Estado.pinCambiandoRol = rol;
  document.getElementById('cambiarPinTitulo').textContent = `Cambiar PIN — ${nombreRol(rol)}`;
  document.getElementById('pinActualAdmin').value  = '';
  document.getElementById('pinNuevo').value        = '';
  document.getElementById('pinNuevoConfirm').value = '';
  abrirModal('modalCambiarPin');
}
window.abrirCambiarPin = abrirCambiarPin;

async function guardarNuevoPin() {
  const pinAdmin  = document.getElementById('pinActualAdmin').value;
  const pinNuevo  = document.getElementById('pinNuevo').value;
  const pinConf   = document.getElementById('pinNuevoConfirm').value;

  if (pinAdmin !== Estado.pins.admin) return mostrarToast('PIN de administrador incorrecto.', 'error');
  if (!/^\d{4}$/.test(pinNuevo))     return mostrarToast('El PIN nuevo debe tener exactamente 4 dígitos.', 'advertencia');
  if (pinNuevo !== pinConf)           return mostrarToast('Los PINs nuevos no coinciden.', 'advertencia');

  mostrarSpinner();
  try {
    const update = {};
    update[Estado.pinCambiandoRol] = pinNuevo;
    await db.collection('config').doc('pins').update(update);
    Estado.pins[Estado.pinCambiandoRol] = pinNuevo;
    mostrarToast(`PIN de ${nombreRol(Estado.pinCambiandoRol)} actualizado.`, 'exito');
    cerrarModal('modalCambiarPin');
    cargarAjustes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al actualizar el PIN.', 'error');
  }
  ocultarSpinner();
}
window.guardarNuevoPin = guardarNuevoPin;

// ================================================================
// EXPORTACIÓN PDF
// ================================================================

async function exportarPDF() {
  await generarPDF(
    Estado.gastos,
    document.getElementById('filtroDesde').value,
    document.getElementById('filtroHasta').value
  );
}
window.exportarPDF = exportarPDF;

async function exportarPDFResumen() {
  const mes  = parseInt(document.getElementById('resumenMes').value);
  const anio = parseInt(document.getElementById('resumenAnio').value);
  await generarPDF(Estado.gastosResumenActual, primerDiaMes(mes, anio), ultimoDiaMes(mes, anio), null, Estado.ingresosResumenActual);
}
window.exportarPDFResumen = exportarPDFResumen;

async function exportarTodosPDF() {
  mostrarSpinner();
  try {
    const snap = await db.collection('gastos').orderBy('fecha', 'desc').get();
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await generarPDF(todos, null, null, 'Todos los registros');
  } catch (err) {
    mostrarToast('Error al cargar datos para exportar.', 'error');
  }
  ocultarSpinner();
}
window.exportarTodosPDF = exportarTodosPDF;

async function generarPDF(gastos, desde, hasta, periodoLabel, ingresos) {
  if (!gastos || !gastos.length) return mostrarToast('No hay gastos para exportar.', 'advertencia');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Cabecera
  doc.setFontSize(18);
  doc.setTextColor(255, 107, 53);
  doc.text('HR Burger House', 14, 18);

  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text('Control de Gastos', 14, 25);

  const periodo = periodoLabel
    || (desde && hasta ? `Período: ${desde}  al  ${hasta}` : desde ? `Desde: ${desde}` : 'Período: Todos');
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(periodo, 14, 31);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-ES', { year:'numeric', month:'long', day:'numeric' })}`, 14, 36);

  // Tabla de gastos
  const filas = gastos.map(g => [
    g.fecha       || '',
    g.categoria   || '',
    g.descripcion || '',
    g.metodoPago  || '',
    g.cuentaId ? `🏦 ${g.cuentaNombre || 'Cuenta'}` : '💼 Fondos',
    nombreRol(g.registradoPor),
    formatMonto(g.monto)
  ]);

  doc.autoTable({
    startY: 42,
    head: [['Fecha', 'Categoría', 'Descripción', 'Método', 'Origen', 'Registrado por', 'Monto']],
    body: filas,
    foot: [['', '', '', '', '', 'TOTAL', formatMonto(gastos.reduce((s, g) => s + (g.monto||0), 0))]],
    headStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 10 },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 2: { cellWidth: 60 }, 6: { halign: 'right', fontStyle: 'bold' } }
  });

  // Resumen: calcular totales por origen
  const totalFondosPDF  = gastos.filter(g => !g.cuentaId).reduce((s,g) => s+(g.monto||0), 0);
  const totalCuentasPDF = gastos.filter(g =>  g.cuentaId).reduce((s,g) => s+(g.monto||0), 0);
  const totalIngresosPDF = (ingresos || []).reduce((s,i) => s+(i.monto||0), 0);
  const gananciaNeta    = totalIngresosPDF - totalFondosPDF;

  // Gastos operativos por categoría (fondos del negocio)
  const porCatFondos = {};
  gastos.filter(g => !g.cuentaId).forEach(g => { porCatFondos[g.categoria] = (porCatFondos[g.categoria]||0) + (g.monto||0); });
  const catFondosOrd = Object.entries(porCatFondos).sort((a, b) => b[1] - a[1]);

  const yFinal = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  doc.text('Gastos operativos por categoría', 14, yFinal);

  doc.autoTable({
    startY: yFinal + 4,
    head: [['Categoría', 'Monto', '% del Total operativo']],
    body: catFondosOrd.map(([c, m]) => [c, formatMonto(m), `${totalFondosPDF > 0 ? (m/totalFondosPDF*100).toFixed(1) : 0}%`]),
    foot: [['Total operativo', formatMonto(totalFondosPDF), '100%']],
    headStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 3 }
  });

  // Gastos desde cuentas por categoría (si los hay)
  const gastosCuentasPDF = gastos.filter(g => g.cuentaId);
  if (gastosCuentasPDF.length) {
    const yCuentasCat = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setTextColor(41, 128, 185);
    doc.text('Gastos desde cuentas por categoría', 14, yCuentasCat);
    const porCatCuentas = {};
    gastosCuentasPDF.forEach(g => { porCatCuentas[g.categoria] = (porCatCuentas[g.categoria]||0) + (g.monto||0); });
    const catCuentasOrd = Object.entries(porCatCuentas).sort((a, b) => b[1] - a[1]);
    doc.autoTable({
      startY: yCuentasCat + 4,
      head: [['Categoría', 'Monto', '% del total cuentas']],
      body: catCuentasOrd.map(([c, m]) => [c, formatMonto(m), `${totalCuentasPDF > 0 ? (m/totalCuentasPDF*100).toFixed(1) : 0}%`]),
      foot: [['Total desde cuentas', formatMonto(totalCuentasPDF), '100%']],
      headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 }
    });

    // Detalle por cuenta
    const yOrigen = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);
    doc.text('Desglose por cuenta', 14, yOrigen);
    const porOrigen = {};
    gastosCuentasPDF.forEach(g => {
      const k = g.cuentaNombre || g.cuentaId;
      porOrigen[k] = (porOrigen[k] || 0) + (g.monto || 0);
    });
    doc.autoTable({
      startY: yOrigen + 4,
      head: [['Cuenta', 'Monto']],
      body: Object.entries(porOrigen).map(([n, m]) => [n, formatMonto(m)]),
      foot: [['Total desde cuentas', formatMonto(totalCuentasPDF)]],
      headStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 }
    });
  }

  // Resumen financiero (solo cuando se exporta desde Resumen con ingresos disponibles)
  if (ingresos) {
    const yRes = doc.lastAutoTable.finalY + 12;
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);
    doc.text('Resumen financiero del período', 14, yRes);
    doc.autoTable({
      startY: yRes + 4,
      head: [['Concepto', 'Monto']],
      body: [
        ['Ingresos', formatMonto(totalIngresosPDF)],
        ['Gastos operativos (fondos del negocio)', formatMonto(totalFondosPDF)],
        ['Pagado desde cuentas (capital aparte)', formatMonto(totalCuentasPDF)]
      ],
      foot: [['Ganancia neta', formatMonto(gananciaNeta)]],
      headStyles: { fillColor: [50, 50, 50], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      footStyles: { fillColor: gananciaNeta >= 0 ? [39, 174, 96] : [192, 57, 43], textColor: 255, fontStyle: 'bold', fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 3 }
    });
  }

  const nombreArchivo = `gastos-hr-burger-house-${(desde || new Date().toISOString()).substring(0,7)}.pdf`;
  doc.save(nombreArchivo);
  mostrarToast('PDF generado correctamente.', 'exito');
}

// ================================================================
// EXPORTACIÓN EXCEL
// ================================================================

async function exportarExcel() {
  await generarExcel(
    Estado.gastos,
    document.getElementById('filtroDesde').value,
    document.getElementById('filtroHasta').value
  );
}
window.exportarExcel = exportarExcel;

async function exportarExcelResumen() {
  const mes  = parseInt(document.getElementById('resumenMes').value);
  const anio = parseInt(document.getElementById('resumenAnio').value);
  await generarExcel(Estado.gastosResumenActual, primerDiaMes(mes, anio), ultimoDiaMes(mes, anio), Estado.ingresosResumenActual);
}
window.exportarExcelResumen = exportarExcelResumen;

async function exportarTodosExcel() {
  mostrarSpinner();
  try {
    const snap = await db.collection('gastos').orderBy('fecha', 'desc').get();
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await generarExcel(todos, null, null);
  } catch (err) {
    mostrarToast('Error al cargar datos para exportar.', 'error');
  }
  ocultarSpinner();
}
window.exportarTodosExcel = exportarTodosExcel;

async function generarExcel(gastos, desde, hasta, ingresos) {
  if (!gastos || !gastos.length) return mostrarToast('No hay gastos para exportar.', 'advertencia');

  const wb = XLSX.utils.book_new();

  // === Hoja 1: Detalle ===
  const header = `HR Burger House — Control de Gastos${desde && hasta ? ` | Período: ${desde} al ${hasta}` : ''}`;
  const filas = [
    [header],
    [`Generado: ${new Date().toLocaleDateString('es-ES')}`],
    [],
    ['Fecha', 'Categoría', 'Descripción', 'Método de Pago', 'Origen', 'Registrado por', 'Monto (USD)'],
    ...gastos.map(g => [
      g.fecha || '', g.categoria || '', g.descripcion || '',
      g.metodoPago || '',
      g.cuentaId ? (g.cuentaNombre || 'Cuenta') : 'Fondos del negocio',
      nombreRol(g.registradoPor), g.monto || 0
    ]),
    [],
    ['', '', '', '', '', 'TOTAL', gastos.reduce((s, g) => s + (g.monto||0), 0)]
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(filas);
  ws1['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 36 }, { wch: 15 }, { wch: 28 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Detalle de Gastos');

  // === Hoja 2: Resumen ===
  const totalFondos   = gastos.filter(g => !g.cuentaId).reduce((s,g) => s+(g.monto||0), 0);
  const totalCuentas  = gastos.filter(g =>  g.cuentaId).reduce((s,g) => s+(g.monto||0), 0);
  const totalIngresos = (ingresos || []).reduce((s,i) => s+(i.monto||0), 0);
  const gananciaNeta  = totalIngresos - totalFondos;

  const porCatFondos = {};
  gastos.filter(g => !g.cuentaId).forEach(g => { porCatFondos[g.categoria] = (porCatFondos[g.categoria]||0) + (g.monto||0); });
  const catFondos = Object.entries(porCatFondos).sort((a, b) => b[1] - a[1]);

  const ws2rows = [
    ['Gastos operativos por categoría (Fondos del negocio)'],
    [],
    ['Categoría', 'Monto (USD)', '% del Total operativo'],
    ...catFondos.map(([c, m]) => [c, m, totalFondos > 0 ? +((m/totalFondos*100).toFixed(2)) : 0]),
    [],
    ['Total operativo', totalFondos, 100]
  ];

  if (totalCuentas > 0) {
    const porCatCuentas = {};
    gastos.filter(g => g.cuentaId).forEach(g => { porCatCuentas[g.categoria] = (porCatCuentas[g.categoria]||0) + (g.monto||0); });
    const catCuentas = Object.entries(porCatCuentas).sort((a, b) => b[1] - a[1]);
    const porOrigen = {};
    gastos.filter(g => g.cuentaId).forEach(g => {
      const k = g.cuentaNombre || g.cuentaId;
      porOrigen[k] = (porOrigen[k] || 0) + (g.monto || 0);
    });
    ws2rows.push([], ['Gastos desde cuentas por categoría (capital aparte)'], []);
    ws2rows.push(['Categoría', 'Monto (USD)', '% del total cuentas']);
    catCuentas.forEach(([c, m]) => ws2rows.push([c, m, totalCuentas > 0 ? +((m/totalCuentas*100).toFixed(2)) : 0]));
    ws2rows.push([], ['Total desde cuentas', totalCuentas, 100]);
    ws2rows.push([], ['Detalle por cuenta'], []);
    ws2rows.push(['Cuenta', 'Monto (USD)']);
    Object.entries(porOrigen).forEach(([n, m]) => ws2rows.push([n, m]));
    ws2rows.push([], ['Total desde cuentas', totalCuentas]);
  }

  if (ingresos) {
    ws2rows.push([], [], ['Resumen financiero del período'], []);
    ws2rows.push(['Ingresos', totalIngresos]);
    ws2rows.push(['Gastos operativos (fondos del negocio)', totalFondos]);
    ws2rows.push(['Pagado desde cuentas (capital aparte)', totalCuentas]);
    ws2rows.push(['GANANCIA NETA', gananciaNeta]);
  }

  const ws2 = XLSX.utils.aoa_to_sheet(ws2rows);
  ws2['!cols'] = [{ wch: 42 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen');

  // === Hoja 3: Desglose por origen (si aplica) ===
  if (totalCuentas > 0) {
    const porOrigen = {};
    gastos.filter(g => g.cuentaId).forEach(g => {
      const k = g.cuentaNombre || g.cuentaId;
      porOrigen[k] = (porOrigen[k] || 0) + (g.monto || 0);
    });
    const ws3 = XLSX.utils.aoa_to_sheet([
      ['Origen', 'Monto (USD)'],
      ['Fondos del negocio', totalFondos],
      ...Object.entries(porOrigen).map(([n, m]) => [n, m]),
      [],
      ['TOTAL DESDE CUENTAS', totalCuentas]
    ]);
    ws3['!cols'] = [{ wch: 32 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Desglose por Origen');
  }

  const nombreArchivo = `gastos-hr-burger-house-${(desde || new Date().toISOString()).substring(0,7)}.xlsx`;
  XLSX.writeFile(wb, nombreArchivo);
  mostrarToast('Excel generado correctamente.', 'exito');
}

// ================================================================
// PANEL DE DEUDAS (top de la tab Gastos)
// ================================================================

async function mostrarPanelDeudas() {
  const panel = document.getElementById('panelDeudas');
  if (!panel) return;

  await cargarPendientes();
  const pendientes = Estado.pendientes.filter(p => p.estado === 'pendiente');
  const rol = Estado.usuario?.rol;

  if (!pendientes.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');

  if (rol === 'admin') {
    renderizarPanelAdmin(panel, pendientes);
  } else {
    renderizarPanelSocio(panel, pendientes, rol);
  }
}
window.mostrarPanelDeudas = mostrarPanelDeudas;

// Panel para ADMIN: ve lo que debe a cada socio
function renderizarPanelAdmin(panel, pendientes) {
  const totalS1 = pendientes.filter(p => p.socio === 'socio1').reduce((s, p) => s + (p.monto||0), 0);
  const totalS2 = pendientes.filter(p => p.socio === 'socio2').reduce((s, p) => s + (p.monto||0), 0);
  const totalDeuda = totalS1 + totalS2;

  const itemsHtml = pendientes.map(p => `
    <div class="deuda-item">
      <div class="deuda-item-izq">
        <div class="deuda-item-desc">${p.descripcion || '—'}</div>
        <div class="deuda-item-meta">${p.fecha} · ${nombreRol(p.socio)}${p.notas ? ' · ' + p.notas : ''}</div>
      </div>
      <div class="deuda-item-monto">${formatMonto(p.monto)}</div>
      <button class="btn-accion btn-editar" onclick="pagarDeudaDesdePanel('${p.id}')" title="Marcar como pagado" style="flex-shrink:0">✓</button>
    </div>`).join('');

  panel.innerHTML = `
    <div class="panel-deudas">
      <div class="deuda-box">
        <div class="deuda-box-header">
          <span class="deuda-box-titulo">💰 Deudas con socios</span>
          <span class="deuda-total-pill">Total: ${formatMonto(totalDeuda)}</span>
        </div>
        <div class="deuda-socios-grid">
          <div class="deuda-socio-card ${totalS1 === 0 ? 'sin-deuda' : ''}">
            <span class="deuda-socio-nombre">Socio 1</span>
            <span class="deuda-socio-monto">${formatMonto(totalS1)}</span>
            <span class="deuda-socio-sub">${pendientes.filter(p=>p.socio==='socio1').length} compra(s) pendiente(s)</span>
          </div>
          <div class="deuda-socio-card ${totalS2 === 0 ? 'sin-deuda' : ''}">
            <span class="deuda-socio-nombre">Socio 2</span>
            <span class="deuda-socio-monto">${formatMonto(totalS2)}</span>
            <span class="deuda-socio-sub">${pendientes.filter(p=>p.socio==='socio2').length} compra(s) pendiente(s)</span>
          </div>
        </div>
        <div class="deuda-items-lista">${itemsHtml}</div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primario" onclick="abrirModalPendiente()" style="font-size:.82rem;padding:8px 14px">+ Registrar compra</button>
          <button class="btn btn-secundario" onclick="cambiarTab('ajustes')" style="font-size:.82rem;padding:8px 14px">⚙️ Gestionar en Ajustes</button>
        </div>
      </div>
    </div>`;
}

// Panel para SOCIO: ve lo que se le debe a él
function renderizarPanelSocio(panel, pendientes, rol) {
  const misPendientes = pendientes.filter(p => p.socio === rol);

  if (!misPendientes.length) {
    panel.classList.add('hidden');
    return;
  }

  const total = misPendientes.reduce((s, p) => s + (p.monto||0), 0);

  const itemsHtml = misPendientes.map(p => `
    <div class="deuda-item">
      <div class="deuda-item-izq">
        <div class="deuda-item-desc">${p.descripcion || '—'}</div>
        <div class="deuda-item-meta">${p.fecha}${p.notas ? ' · ' + p.notas : ''}</div>
      </div>
      <div class="deuda-item-monto">${formatMonto(p.monto)}</div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="panel-deudas">
      <div class="deuda-box">
        <div class="deuda-box-header">
          <span class="deuda-box-titulo">💰 Te deben estas compras</span>
          <span class="deuda-total-pill">${formatMonto(total)}</span>
        </div>
        <div class="deuda-socio-total">
          <span class="deuda-socio-total-label">Total pendiente de cobro</span>
          <span class="deuda-socio-total-monto">${formatMonto(total)}</span>
        </div>
        <div class="deuda-items-lista">${itemsHtml}</div>
        <div style="margin-top:12px;">
          <button class="btn btn-primario" onclick="abrirModalPendiente()" style="font-size:.82rem;padding:8px 14px">+ Registrar nueva compra</button>
        </div>
      </div>
    </div>`;
}

// Pagar desde el panel — abre el modal de pago
function pagarDeudaDesdePanel(id) {
  abrirModalPagarDeuda(id);
}
window.pagarDeudaDesdePanel = pagarDeudaDesdePanel;

// Abrir modal de pago (admin)
function abrirModalPagarDeuda(id) {
  Estado.pendienteAPagarId = id;
  const p = Estado.pendientes.find(x => x.id === id);
  if (!p) return;

  document.getElementById('pagarDeudaInfo').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="font-weight:700;color:var(--texto);font-size:.95rem">${p.descripcion}</div>
        <div style="font-size:.78rem;color:var(--texto-muted);margin-top:3px">
          ${p.fecha} · ${nombreRol(p.socio)}${p.notas ? ' · ' + p.notas : ''}
        </div>
      </div>
      <div style="font-size:1.3rem;font-weight:700;color:var(--primario);white-space:nowrap">${formatMonto(p.monto)}</div>
    </div>`;

  document.getElementById('pagarDeudaFecha').value   = hoy();
  document.getElementById('pagarDeudaMetodo').value  = 'Efectivo';
  document.getElementById('pagarDeudaNotas').value   = '';
  abrirModal('modalPagarDeuda');
}
window.abrirModalPagarDeuda = abrirModalPagarDeuda;

// Confirmar pago: marca pendiente como pagado Y crea gasto
async function ejecutarPagoDeuda() {
  const id  = Estado.pendienteAPagarId;
  const p   = Estado.pendientes.find(x => x.id === id);
  if (!p) return;

  const metodoPago = document.getElementById('pagarDeudaMetodo').value;
  const fechaPago  = document.getElementById('pagarDeudaFecha').value;
  const notas      = document.getElementById('pagarDeudaNotas').value.trim();

  if (!fechaPago) return mostrarToast('Selecciona la fecha de pago.', 'advertencia');

  mostrarSpinner();
  try {
    // 1. Marcar pendiente como pagado
    await db.collection('pendientes').doc(id).update({
      estado:    'pagado',
      fechaPago,
      pagadoPor: Estado.usuario.rol,
      metodoPago
    });

    // 2. Registrar automáticamente el pago como gasto
    await db.collection('gastos').add({
      fecha:        fechaPago,
      categoria:    'Pago a socio',
      descripcion:  `Pago a ${nombreRol(p.socio)} — ${p.descripcion}`,
      monto:        p.monto,
      metodoPago,
      notas:        notas || `Liquidación compra del ${p.fecha}`,
      registradoPor: Estado.usuario.rol,
      timestamp:    firebase.firestore.FieldValue.serverTimestamp()
    });

    mostrarToast(`✓ Pago de ${formatMonto(p.monto)} a ${nombreRol(p.socio)} registrado.`, 'exito');
    cerrarModal('modalPagarDeuda');
    Estado.pendienteAPagarId = null;

    // Refrescar panel y lista de gastos
    await Promise.all([
      mostrarPanelDeudas(),
      cargarGastosConFiltros()
    ]);

    if (Estado.tabActual === 'ajustes') {
      await cargarPendientes();
      renderizarPendientesAdmin();
    }
  } catch (err) {
    console.error(err);
    mostrarToast('Error al registrar el pago. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.ejecutarPagoDeuda = ejecutarPagoDeuda;

// ================================================================
// RESET DE PIN
// ================================================================

function abrirResetPin(rol) {
  Estado.pinResetandoRol = rol;
  document.getElementById('resetPinTitulo').textContent = `Restablecer PIN — ${nombreRol(rol)}`;
  document.getElementById('resetPinMensaje').textContent =
    `El PIN de ${nombreRol(rol)} volverá al valor por defecto "${PINS_DEFAULT[rol]}". Esta acción no se puede deshacer.`;
  document.getElementById('resetPinAdmin').value = '';
  abrirModal('modalResetPin');
}
window.abrirResetPin = abrirResetPin;

async function confirmarResetPin() {
  const pinAdmin = document.getElementById('resetPinAdmin').value;

  if (pinAdmin !== Estado.pins.admin) {
    return mostrarToast('PIN de administrador incorrecto.', 'error');
  }

  mostrarSpinner();
  try {
    const rol = Estado.pinResetandoRol;
    const update = {};
    update[rol] = PINS_DEFAULT[rol];
    await db.collection('config').doc('pins').update(update);
    Estado.pins[rol] = PINS_DEFAULT[rol];
    mostrarToast(`PIN de ${nombreRol(rol)} restablecido a ${PINS_DEFAULT[rol]}.`, 'exito');
    cerrarModal('modalResetPin');
    cargarAjustes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al restablecer el PIN.', 'error');
  }
  ocultarSpinner();
}
window.confirmarResetPin = confirmarResetPin;

// ================================================================
// PENDIENTES DE PAGO
// ================================================================

async function cargarPendientes() {
  try {
    const snap = await db.collection('pendientes').orderBy('timestamp', 'desc').get();
    Estado.pendientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('Error cargando pendientes:', err);
    Estado.pendientes = [];
  }
}

// Vista admin — todos los pendientes
function renderizarPendientesAdmin() {
  const pendientes = Estado.pendientes;

  const totalS1 = pendientes
    .filter(p => p.socio === 'socio1' && p.estado === 'pendiente')
    .reduce((s, p) => s + (p.monto || 0), 0);
  const totalS2 = pendientes
    .filter(p => p.socio === 'socio2' && p.estado === 'pendiente')
    .reduce((s, p) => s + (p.monto || 0), 0);

  const resumenEl = document.getElementById('resumenPendientesAdmin');
  if (resumenEl) {
    resumenEl.innerHTML = `
      <div class="resumen-pendiente-card">
        <div class="resumen-pendiente-rol">Socio 1</div>
        <div class="resumen-pendiente-monto">${formatMonto(totalS1)}</div>
        <div class="resumen-pendiente-sub">pendiente de cobro</div>
      </div>
      <div class="resumen-pendiente-card">
        <div class="resumen-pendiente-rol">Socio 2</div>
        <div class="resumen-pendiente-monto">${formatMonto(totalS2)}</div>
        <div class="resumen-pendiente-sub">pendiente de cobro</div>
      </div>`;
  }

  const listaEl = document.getElementById('listaPendientesAdmin');
  if (!listaEl) return;

  if (!pendientes.length) {
    listaEl.innerHTML =
      '<p style="color:var(--texto-muted);font-size:.88rem;text-align:center;padding:16px 0">No hay compras pendientes registradas.</p>';
    return;
  }

  listaEl.innerHTML = pendientes.map(p => `
    <div class="pendiente-item">
      <div class="pendiente-info">
        <div class="pendiente-desc">${p.descripcion || '—'}</div>
        <div class="pendiente-meta">
          ${p.fecha} · ${nombreRol(p.socio)}
          ${p.estado === 'pagado' && p.fechaPago ? ` · Pagado el ${p.fechaPago}` : ''}
          ${p.notas ? ` · ${p.notas}` : ''}
        </div>
      </div>
      <div class="pendiente-derecha">
        <div class="pendiente-monto">${formatMonto(p.monto)}</div>
        <span class="badge-estado badge-${p.estado}">
          ${p.estado === 'pendiente' ? 'Pendiente' : '✓ Pagado'}
        </span>
        <div style="display:flex;gap:6px;">
          ${p.estado === 'pendiente' ? `
            <button class="btn-accion btn-editar" onclick="marcarPendientePagado('${p.id}')" title="Marcar como pagado">✓</button>` : ''}
          <button class="btn-accion btn-eliminar" onclick="eliminarPendiente('${p.id}')" title="Eliminar">🗑️</button>
        </div>
      </div>
    </div>`).join('');
}

// Vista socio — solo sus propios pendientes
function renderizarMisPendientes() {
  const cardEl = document.getElementById('cardMisPendientes');
  if (!cardEl) return;

  const rol = Estado.usuario?.rol;

  // Admin ve todo en Ajustes, no necesita esta sección
  if (rol === 'admin') {
    cardEl.classList.add('hidden');
    return;
  }

  const misPendientes = Estado.pendientes.filter(p => p.socio === rol);
  cardEl.classList.remove('hidden');

  const totalPendiente = misPendientes
    .filter(p => p.estado === 'pendiente')
    .reduce((s, p) => s + (p.monto || 0), 0);

  const listaEl = document.getElementById('misPendientesList');

  if (!misPendientes.length) {
    listaEl.innerHTML =
      '<p style="color:var(--texto-muted);font-size:.88rem">No tienes compras pendientes de cobro registradas.</p>';
    return;
  }

  listaEl.innerHTML = `
    <div class="alerta-pendiente">
      <span class="alerta-pendiente-label">💰 Total pendiente de cobro</span>
      <span class="alerta-pendiente-monto">${formatMonto(totalPendiente)}</span>
    </div>
    ${misPendientes.map(p => `
      <div class="pendiente-item">
        <div class="pendiente-info">
          <div class="pendiente-desc">${p.descripcion || '—'}</div>
          <div class="pendiente-meta">
            ${p.fecha}
            ${p.estado === 'pagado' && p.fechaPago ? ` · ✓ Pagado el ${p.fechaPago}` : ''}
            ${p.notas ? ` · ${p.notas}` : ''}
          </div>
        </div>
        <div class="pendiente-derecha">
          <div class="pendiente-monto">${formatMonto(p.monto)}</div>
          <span class="badge-estado badge-${p.estado}">
            ${p.estado === 'pendiente' ? 'Pendiente' : '✓ Pagado'}
          </span>
        </div>
      </div>`).join('')}`;
}

// Modal: abrir
function abrirModalPendiente() {
  const rol = Estado.usuario?.rol;
  const selSocio = document.getElementById('pendienteSocio');

  document.getElementById('pendienteFecha').value        = hoy();
  document.getElementById('pendienteDescripcion').value  = '';
  document.getElementById('pendienteMonto').value        = '';
  document.getElementById('pendienteNotas').value        = '';

  // Si es socio, preselecciona su rol y bloquea el selector
  if (rol !== 'admin') {
    selSocio.value    = rol;
    selSocio.disabled = true;
  } else {
    selSocio.value    = 'socio1';
    selSocio.disabled = false;
  }

  abrirModal('modalPendiente');
}
window.abrirModalPendiente = abrirModalPendiente;

// Modal: guardar
async function guardarPendiente() {
  const fecha       = document.getElementById('pendienteFecha').value;
  const socio       = document.getElementById('pendienteSocio').value;
  const descripcion = document.getElementById('pendienteDescripcion').value.trim();
  const monto       = parseFloat(document.getElementById('pendienteMonto').value);
  const notas       = document.getElementById('pendienteNotas').value.trim();

  if (!fecha)                     return mostrarToast('Selecciona una fecha.', 'advertencia');
  if (!descripcion)               return mostrarToast('Ingresa una descripción de la compra.', 'advertencia');
  if (isNaN(monto) || monto <= 0) return mostrarToast('El monto debe ser mayor a $0.00.', 'advertencia');

  mostrarSpinner();
  try {
    await db.collection('pendientes').add({
      fecha, socio, descripcion, monto, notas,
      estado: 'pendiente',
      registradoPor: Estado.usuario.rol,
      fechaPago: null,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    mostrarToast('Compra pendiente registrada correctamente.', 'exito');
    cerrarModal('modalPendiente');
    await cargarPendientes();
    await mostrarPanelDeudas();
    if (Estado.usuario?.rol === 'admin') renderizarPendientesAdmin();
    else renderizarMisPendientes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.guardarPendiente = guardarPendiente;

// Marcar como pagado desde Ajustes — usa el mismo modal de pago
function marcarPendientePagado(id) {
  abrirModalPagarDeuda(id);
}
window.marcarPendientePagado = marcarPendientePagado;

// Eliminar pendiente (solo admin)
async function eliminarPendiente(id) {
  if (!confirm('¿Eliminar este registro de compra pendiente?')) return;
  mostrarSpinner();
  try {
    await db.collection('pendientes').doc(id).delete();
    mostrarToast('Registro eliminado.', 'exito');
    await cargarPendientes();
    renderizarPendientesAdmin();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al eliminar. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.eliminarPendiente = eliminarPendiente;

// ================================================================
// TAB: INGRESOS
// ================================================================

const CATEGORIAS_INGRESOS = [
  'Ventas del día',
  'Delivery/Domicilios',
  'Eventos y catering',
  'Otros ingresos'
];

async function cargarIngresosMesActual() {
  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();

  document.getElementById('filtroIngresoDesde').value = primerDiaMes(mes, anio);
  document.getElementById('filtroIngresoHasta').value = ultimoDiaMes(mes, anio);
  const sel = document.getElementById('filtroIngresoPeriodo');
  if (sel) sel.value = 'mes-actual';

  await cargarIngresosConFiltros();
}

async function cargarIngresosConFiltros() {
  const desde = document.getElementById('filtroIngresoDesde').value;
  const hasta = document.getElementById('filtroIngresoHasta').value;

  mostrarSkeletonIngresos();
  try {
    let query = db.collection('ingresos').orderBy('fecha', 'desc');
    if (desde) query = query.where('fecha', '>=', desde);
    if (hasta) query = query.where('fecha', '<=', hasta);

    const snap = await query.get();
    let ingresos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    ingresos.sort((a, b) => {
      if (b.fecha !== a.fecha) return b.fecha.localeCompare(a.fecha);
      const ta = a.timestamp?.seconds || 0;
      const tb = b.timestamp?.seconds || 0;
      return tb - ta;
    });

    Estado.ingresos = ingresos;
    aplicarFiltrosIngresosClienteSide();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar los ingresos.', 'error');
    renderizarListaIngresos([]);
  }
}

function aplicarFiltrosIngresosClienteSide() {
  if (!Estado.ingresos) return;
  const categoria = document.getElementById('filtroIngresoCategoria').value;
  const metodo    = document.getElementById('filtroIngresoMetodo')?.value || '';
  const texto     = (document.getElementById('filtroIngresoTexto')?.value || '').trim().toLowerCase();

  let ingresos = Estado.ingresos;
  if (categoria) ingresos = ingresos.filter(i => i.categoria === categoria);
  if (metodo)    ingresos = ingresos.filter(i => (i.metodoPago || '').includes(metodo));
  if (texto) {
    ingresos = ingresos.filter(i =>
      (i.descripcion || '').toLowerCase().includes(texto) ||
      (i.categoria   || '').toLowerCase().includes(texto) ||
      (i.notas       || '').toLowerCase().includes(texto)
    );
  }
  renderizarListaIngresos(ingresos);
}
window.aplicarFiltrosIngresosClienteSide = aplicarFiltrosIngresosClienteSide;

function aplicarFiltrosIngresos() { cargarIngresosConFiltros(); }
window.aplicarFiltrosIngresos = aplicarFiltrosIngresos;

function limpiarFiltrosIngresos() {
  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();
  document.getElementById('filtroIngresoDesde').value     = primerDiaMes(mes, anio);
  document.getElementById('filtroIngresoHasta').value     = ultimoDiaMes(mes, anio);
  document.getElementById('filtroIngresoCategoria').value = '';
  const metodoEl = document.getElementById('filtroIngresoMetodo');
  if (metodoEl) metodoEl.value = '';
  const textoEl  = document.getElementById('filtroIngresoTexto');
  if (textoEl) textoEl.value = '';
  const periodoEl = document.getElementById('filtroIngresoPeriodo');
  if (periodoEl) periodoEl.value = 'mes-actual';
  cargarIngresosConFiltros();
}
window.limpiarFiltrosIngresos = limpiarFiltrosIngresos;

function aplicarPeriodoRapidoIngresos() {
  const val = document.getElementById('filtroIngresoPeriodo').value;
  if (!val || val === 'personalizado') return;

  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();
  let desde, hasta;

  if (val === 'mes-actual') {
    desde = primerDiaMes(mes, anio);
    hasta = ultimoDiaMes(mes, anio);
  } else if (val === 'mes-anterior') {
    const ant = mesAnterior(mes, anio);
    desde = primerDiaMes(ant.mes, ant.anio);
    hasta = ultimoDiaMes(ant.mes, ant.anio);
  } else if (val === 'ultimos-3m') {
    const d = new Date(anio, mes - 4, 1);
    desde = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    hasta = ultimoDiaMes(mes, anio);
  } else if (val === 'anio-actual') {
    desde = `${anio}-01-01`;
    hasta = `${anio}-12-31`;
  } else if (val === 'todo') {
    desde = '2020-01-01';
    hasta = '2099-12-31';
  }

  if (desde) document.getElementById('filtroIngresoDesde').value = desde;
  if (hasta) document.getElementById('filtroIngresoHasta').value = hasta;
  cargarIngresosConFiltros();
}
window.aplicarPeriodoRapidoIngresos = aplicarPeriodoRapidoIngresos;

function mostrarSkeletonIngresos() {
  document.getElementById('listaIngresos').innerHTML =
    Array(4).fill('<div class="skeleton skeleton-gasto"></div>').join('');
}

function renderizarListaIngresos(ingresos) {
  const lista   = document.getElementById('listaIngresos');
  const esAdmin = Estado.usuario?.rol === 'admin';

  if (!ingresos.length) {
    lista.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio-icono">💰</div>
        <p>No hay ingresos en este período</p>
        ${esAdmin ? `<button class="btn btn-primario btn-ingreso" onclick="abrirModalNuevoIngreso()">+ Registrar primer ingreso</button>` : ''}
      </div>`;
    return;
  }

  const porFecha = {};
  ingresos.forEach(i => { (porFecha[i.fecha] = porFecha[i.fecha] || []).push(i); });
  const fechas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a));
  const totalGeneral = ingresos.reduce((s, i) => s + (i.monto || 0), 0);

  let html = `
    <div class="total-general-banner total-ingreso-banner">
      <span>Total ingresos <span class="filtro-conteo">· ${ingresos.length} registro${ingresos.length !== 1 ? 's' : ''}</span></span>
      <strong>${formatMonto(totalGeneral)}</strong>
    </div>`;

  fechas.forEach(fecha => {
    const del      = porFecha[fecha];
    const totalDia = del.reduce((s, i) => s + (i.monto || 0), 0);
    html += `
      <div class="grupo-dia">
        <div class="grupo-dia-header">
          <span class="grupo-dia-fecha">${formatFecha(fecha)}</span>
          <span class="grupo-dia-total ingreso-dia-total">${formatMonto(totalDia)}</span>
        </div>
        ${del.map(i => tarjetaIngreso(i, esAdmin)).join('')}
      </div>`;
  });

  lista.innerHTML = html;
}

function tarjetaIngreso(ingreso, esAdmin) {
  const acciones = esAdmin ? `
    <div class="gasto-acciones">
      <button class="btn-accion btn-editar"   onclick="editarIngreso('${ingreso.id}')"            title="Editar">✏️</button>
      <button class="btn-accion btn-eliminar"  onclick="confirmarEliminarIngreso('${ingreso.id}')" title="Eliminar">🗑️</button>
    </div>` : '';

  const esMultiMetodo = ingreso.montoEfectivo !== undefined ||
                        ingreso.montoTransferencia !== undefined ||
                        ingreso.montoTarjetaBruto !== undefined;
  let metaHtml = '';

  if (esMultiMetodo) {
    const partes = [];
    if ((ingreso.montoEfectivo || 0) > 0)
      partes.push(`<span class="gasto-metodo">💵 ${formatMonto(ingreso.montoEfectivo)}</span>`);
    if ((ingreso.montoTransferencia || 0) > 0)
      partes.push(`<span class="gasto-metodo">🏦 ${formatMonto(ingreso.montoTransferencia)}</span>`);
    if ((ingreso.montoTarjetaBruto || 0) > 0) {
      const comision = ingreso.montoTarjetaComision ?? +(ingreso.montoTarjetaBruto * COMISION_TARJETA).toFixed(2);
      const neto     = ingreso.montoTarjeta         ?? +(ingreso.montoTarjetaBruto - comision).toFixed(2);
      partes.push(`<span class="gasto-metodo">💳 ${formatMonto(neto)}</span><span class="ingreso-comision-nota"> · bruto ${formatMonto(ingreso.montoTarjetaBruto)} − comisión ${formatMonto(comision)}</span>`);
    }
    metaHtml = partes.join('') + (ingreso.notas ? `<span class="gasto-notas">📝 ${ingreso.notas}</span>` : '');
  } else {
    let comisionHtml = '';
    if (ingreso.metodoPago === 'Tarjeta') {
      if (ingreso.montobruto && ingreso.montobruto !== ingreso.monto) {
        comisionHtml = `<span class="ingreso-comision-nota">· Bruto ${formatMonto(ingreso.montobruto)} − comisión ${formatMonto(ingreso.comision || 0)}</span>`;
      } else {
        const brutoEstimado    = ingreso.monto / (1 - COMISION_TARJETA);
        const comisionEstimada = brutoEstimado - ingreso.monto;
        comisionHtml = `<span class="ingreso-comision-nota">· Bruto ~${formatMonto(brutoEstimado)} − comisión ~${formatMonto(comisionEstimada)}</span>`;
      }
    }
    metaHtml = `<span class="gasto-metodo">${iconoMetodoPago(ingreso.metodoPago)} ${ingreso.metodoPago || ''}</span>${comisionHtml}${ingreso.notas ? `<span class="gasto-notas">· 📝 ${ingreso.notas}</span>` : ''}`;
  }

  return `
    <div class="gasto-item ingreso-item" data-id="${ingreso.id}">
      <div class="gasto-izquierda">
        <div class="gasto-categoria-badge ingreso-categoria-badge">${ingreso.categoria || '—'}</div>
        <div class="gasto-descripcion">${ingreso.descripcion || '—'}</div>
        <div class="gasto-meta">${metaHtml}</div>
      </div>
      <div class="gasto-derecha">
        <div class="gasto-monto ingreso-monto">${formatMonto(ingreso.monto)}</div>
        ${acciones}
      </div>
    </div>`;
}

// --- CRUD ingresos (solo admin) ---

function actualizarTotalIngreso() {
  const efectivo      = parseFloat(document.getElementById('ingresoEfectivo').value)      || 0;
  const transferencia = parseFloat(document.getElementById('ingresoTransferencia').value)  || 0;
  const tarjetaBruto  = parseFloat(document.getElementById('ingresoTarjeta').value)        || 0;
  const caja          = document.getElementById('ingresoComisionInfo');

  let tarjetaNeto = tarjetaBruto;
  if (tarjetaBruto > 0) {
    const comision = tarjetaBruto * COMISION_TARJETA;
    tarjetaNeto    = tarjetaBruto - comision;
    document.getElementById('comisionBruto').textContent = formatMonto(tarjetaBruto);
    document.getElementById('comisionMonto').textContent = '−' + formatMonto(comision);
    document.getElementById('comisionNeto').textContent  = formatMonto(tarjetaNeto);
    caja?.classList.remove('hidden');
  } else {
    caja?.classList.add('hidden');
  }

  const total = efectivo + transferencia + tarjetaNeto;
  const totalEl = document.getElementById('ingresoTotalNeto');
  if (totalEl) totalEl.textContent = formatMonto(total);
}
window.actualizarTotalIngreso = actualizarTotalIngreso;

function _resetCamposIngreso() {
  ['ingresoEfectivo', 'ingresoTransferencia', 'ingresoTarjeta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ingresoComisionInfo')?.classList.add('hidden');
  const totalEl = document.getElementById('ingresoTotalNeto');
  if (totalEl) totalEl.textContent = formatMonto(0);
}

function abrirModalNuevoIngreso() {
  Estado.ingresoEditandoId = null;
  document.getElementById('modalIngresoTitulo').textContent = 'Nuevo Ingreso';
  document.getElementById('formIngreso').reset();
  document.getElementById('ingresoFecha').value = hoy();
  _resetCamposIngreso();
  abrirModal('modalIngreso');
}
window.abrirModalNuevoIngreso = abrirModalNuevoIngreso;

function editarIngreso(id) {
  const ingreso = Estado.ingresos.find(x => x.id === id);
  if (!ingreso) return;
  Estado.ingresoEditandoId = id;
  document.getElementById('modalIngresoTitulo').textContent = 'Editar Ingreso';
  document.getElementById('ingresoFecha').value       = ingreso.fecha       || hoy();
  document.getElementById('ingresoCategoria').value   = ingreso.categoria   || '';
  document.getElementById('ingresoDescripcion').value = ingreso.descripcion || '';
  document.getElementById('ingresoNotas').value       = ingreso.notas       || '';

  // Poblar los tres campos de método
  if (ingreso.montoEfectivo !== undefined || ingreso.montoTransferencia !== undefined || ingreso.montoTarjetaBruto !== undefined) {
    // Entrada nueva con desglose
    document.getElementById('ingresoEfectivo').value      = ingreso.montoEfectivo      || '';
    document.getElementById('ingresoTransferencia').value  = ingreso.montoTransferencia  || '';
    document.getElementById('ingresoTarjeta').value        = ingreso.montoTarjetaBruto   || '';
  } else {
    // Entrada antigua — mapear según metodoPago
    _resetCamposIngreso();
    const metodo = ingreso.metodoPago || 'Efectivo';
    const valorBruto = ingreso.montobruto || ingreso.monto || '';
    if (metodo === 'Efectivo')      document.getElementById('ingresoEfectivo').value     = valorBruto;
    if (metodo === 'Transferencia') document.getElementById('ingresoTransferencia').value = valorBruto;
    if (metodo === 'Tarjeta')       document.getElementById('ingresoTarjeta').value       = valorBruto;
  }

  actualizarTotalIngreso();
  abrirModal('modalIngreso');
}
window.editarIngreso = editarIngreso;

function cerrarModalIngreso() {
  cerrarModal('modalIngreso');
  Estado.ingresoEditandoId = null;
}
window.cerrarModalIngreso = cerrarModalIngreso;

async function guardarIngreso() {
  const fecha         = document.getElementById('ingresoFecha').value;
  const categoria     = document.getElementById('ingresoCategoria').value;
  const descripcion   = document.getElementById('ingresoDescripcion').value.trim();
  const efectivo      = parseFloat(document.getElementById('ingresoEfectivo').value)      || 0;
  const transferencia = parseFloat(document.getElementById('ingresoTransferencia').value)  || 0;
  const tarjetaBruto  = parseFloat(document.getElementById('ingresoTarjeta').value)        || 0;
  const notas         = document.getElementById('ingresoNotas').value.trim();

  if (!fecha)       return mostrarToast('Selecciona una fecha.', 'advertencia');
  if (!categoria)   return mostrarToast('Selecciona una categoría.', 'advertencia');
  if (!descripcion) return mostrarToast('Ingresa una descripción.', 'advertencia');
  if (efectivo <= 0 && transferencia <= 0 && tarjetaBruto <= 0)
    return mostrarToast('Ingresa al menos un monto mayor a $0.00.', 'advertencia');

  const tarjetaComision = +(tarjetaBruto * COMISION_TARJETA).toFixed(2);
  const tarjetaNeto     = +(tarjetaBruto - tarjetaComision).toFixed(2);
  const totalNeto       = +(efectivo + transferencia + tarjetaNeto).toFixed(2);

  const metodos = [];
  if (efectivo > 0)      metodos.push('Efectivo');
  if (transferencia > 0) metodos.push('Transferencia');
  if (tarjetaBruto > 0)  metodos.push('Tarjeta');

  const datos = {
    fecha, categoria, descripcion,
    monto: totalNeto,
    montoEfectivo:       +efectivo.toFixed(2),
    montoTransferencia:  +transferencia.toFixed(2),
    montoTarjetaBruto:   +tarjetaBruto.toFixed(2),
    montoTarjetaComision: tarjetaComision,
    montoTarjeta:         tarjetaNeto,
    metodoPago: metodos.join(', ') || 'Efectivo',
    notas,
    registradoPor: Estado.usuario.rol,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };

  mostrarSpinner();
  try {
    if (Estado.ingresoEditandoId) {
      await db.collection('ingresos').doc(Estado.ingresoEditandoId).update(datos);
      mostrarToast('Ingreso actualizado correctamente.', 'exito');
    } else {
      await db.collection('ingresos').add(datos);
      mostrarToast('Ingreso registrado correctamente.', 'exito');
    }
    cerrarModalIngreso();
    await cargarIngresosConFiltros();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar. Inténtalo de nuevo.', 'error');
  }
  ocultarSpinner();
}
window.guardarIngreso = guardarIngreso;

// ================================================================
// INICIALIZACIÓN DE SELECTORES DE FECHA
// ================================================================

function inicializarSelectoresFecha() {
  const ahora     = new Date();
  const mesActual = ahora.getMonth() + 1;
  const anioActual = ahora.getFullYear();

  ['resumenMes', 'graficaMes'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    for (let m = 1; m <= 12; m++) {
      sel.add(new Option(nombreMes(m), m, m === mesActual, m === mesActual));
    }
  });

  ['resumenAnio', 'graficaAnio'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel || sel.options.length) return;
    for (let a = anioActual - 3; a <= anioActual + 1; a++) {
      sel.add(new Option(a, a, a === anioActual, a === anioActual));
    }
  });
}

// ================================================================
// ARRANQUE PRINCIPAL
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {
  mostrarSpinner();

  await cargarPINs();
  await cargarNombres();
  inicializarSelectoresFecha();
  inicializarPantallaPIN();

  // Restaurar sesión guardada
  const usuarioGuardado = localStorage.getItem('hr-gastos-usuario');
  if (usuarioGuardado && ['socio1', 'socio2', 'admin'].includes(usuarioGuardado)) {
    await iniciarSesion(usuarioGuardado);
  } else {
    ocultarSpinner();
  }
});

// ================================================================
// TAB: CUENTAS DE AHORRO
// ================================================================

async function cargarCuentas() {
  const lista = document.getElementById('listaCuentas');
  if (lista) lista.innerHTML = Array(2).fill('<div class="skeleton skeleton-gasto"></div>').join('');
  try {
    const snap = await db.collection('cuentas').get();
    Estado.cuentas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.activa !== false)
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
    renderizarCuentas();
    poblarFiltroOrigen();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar cuentas.', 'error');
    renderizarCuentas();
  }
}
window.cargarCuentas = cargarCuentas;

function renderizarCuentas() {
  const banner = document.getElementById('cuentasTotalBanner');
  const lista  = document.getElementById('listaCuentas');
  if (!banner || !lista) return;

  if (!Estado.cuentas.length) {
    banner.innerHTML = '';
    lista.innerHTML = `
      <div class="estado-vacio">
        <div class="estado-vacio-icono">🏦</div>
        <p>No hay cuentas de ahorro activas.</p>
        ${Estado.usuario?.rol === 'admin'
          ? '<button class="btn btn-primario" onclick="cambiarTab(\'ajustes\')">Ir a Ajustes para agregar cuentas</button>'
          : ''}
      </div>`;
    return;
  }

  const totalGeneral = Estado.cuentas.reduce((s, c) => s + (c.saldoActual || 0), 0);
  banner.innerHTML = `
    <div class="total-general-banner">
      <span>Total en todas las cuentas</span>
      <strong style="${totalGeneral < 0 ? 'color:#e74c3c' : ''}">${formatMonto(totalGeneral)}</strong>
    </div>`;

  lista.innerHTML = Estado.cuentas.map(c => tarjetaCuenta(c)).join('');
}

function tarjetaCuenta(cuenta) {
  const esEncargado = Estado.usuario?.rol === cuenta.encargado;
  const ahora = new Date();

  let metaActualizacion = 'Sin actualizaciones aún';
  let avisoObsoleto = '';
  if (cuenta.actualizadoEn) {
    const fechaAct = cuenta.actualizadoEn.toDate ? cuenta.actualizadoEn.toDate() : new Date(cuenta.actualizadoEn);
    const diasSinAct = Math.floor((ahora - fechaAct) / (1000 * 60 * 60 * 24));
    const fechaStr = fechaAct.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    const horaStr  = fechaAct.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    metaActualizacion = `Actualizado el ${fechaStr} a las ${horaStr} por ${nombreRol(cuenta.actualizadoPor || cuenta.encargado)}`;
    if (diasSinAct >= 7) {
      avisoObsoleto = `<div class="cuenta-aviso-obsoleto">⚠️ Sin actualizar hace ${diasSinAct} día${diasSinAct !== 1 ? 's' : ''}</div>`;
    }
  }

  const botonActualizar = esEncargado
    ? `<button class="btn btn-primario cuenta-btn-actualizar" onclick="abrirModalDepositar('${cuenta.id}')">➕ Depositar</button>`
    : '';

  return `
    <div class="cuenta-card">
      <div class="cuenta-card-header">
        <div class="cuenta-nombre">${cuenta.nombre}${cuenta.banco ? `<span class="cuenta-banco"> — ${cuenta.banco}</span>` : ''}</div>
        <div class="cuenta-encargado">👤 ${nombreRol(cuenta.encargado)}</div>
      </div>
      <div class="cuenta-saldo-grande" style="${(cuenta.saldoActual || 0) < 0 ? 'color:#e74c3c' : ''}">${formatMonto(cuenta.saldoActual || 0)}</div>
      <div class="cuenta-meta-actualizado">${metaActualizacion}</div>
      ${avisoObsoleto}
      <div class="cuenta-acciones">
        ${botonActualizar}
        <button class="btn btn-secundario" onclick="abrirModalHistorialCuenta('${cuenta.id}')">📋 Ver historial</button>
      </div>
    </div>`;
}

// ----------------------------------------------------------------
// Depositar / corregir saldo (solo el encargado)
// ----------------------------------------------------------------

function _poblarSaldoActual(elId, cuenta) {
  document.getElementById(elId).innerHTML = `
    <div class="saldo-referencia">
      <span>Saldo actual</span>
      <strong>${formatMonto(cuenta.saldoActual || 0)}</strong>
    </div>`;
}

function abrirModalDepositar(id) {
  const cuenta = Estado.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  if (Estado.usuario?.rol !== cuenta.encargado) {
    return mostrarToast('Solo el encargado puede depositar en esta cuenta.', 'advertencia');
  }
  Estado.cuentaEditandoId = id;
  document.getElementById('actualizarSaldoTitulo').textContent = `Depositar — ${cuenta.nombre}`;
  _poblarSaldoActual('depositarSaldoActual', cuenta);
  _poblarSaldoActual('ajusteSaldoActual', cuenta);
  document.getElementById('montoDepositarInput').value = '';
  document.getElementById('notaDepositarInput').value  = '';
  document.getElementById('nuevoSaldoInput').value     = '';
  document.getElementById('notaAjusteInput').value     = '';
  document.getElementById('previewDeposito').classList.add('hidden');
  document.getElementById('previewDeposito').innerHTML = '';
  document.getElementById('modoDepositar').classList.remove('hidden');
  document.getElementById('modoAjuste').classList.add('hidden');
  abrirModal('modalActualizarSaldo');
}
window.abrirModalDepositar  = abrirModalDepositar;
window.abrirModalActualizarSaldo = abrirModalDepositar; // alias compatibilidad

function activarModoAjuste() {
  document.getElementById('modoDepositar').classList.add('hidden');
  document.getElementById('modoAjuste').classList.remove('hidden');
  const cuenta = Estado.cuentas.find(c => c.id === Estado.cuentaEditandoId);
  document.getElementById('actualizarSaldoTitulo').textContent = `Corregir — ${cuenta?.nombre || ''}`;
}
window.activarModoAjuste = activarModoAjuste;

function activarModoDepositar() {
  document.getElementById('modoAjuste').classList.add('hidden');
  document.getElementById('modoDepositar').classList.remove('hidden');
  const cuenta = Estado.cuentas.find(c => c.id === Estado.cuentaEditandoId);
  document.getElementById('actualizarSaldoTitulo').textContent = `Depositar — ${cuenta?.nombre || ''}`;
}
window.activarModoDepositar = activarModoDepositar;

function actualizarPreviewDeposito() {
  const id = Estado.cuentaEditandoId;
  const cuenta = Estado.cuentas.find(c => c.id === id);
  const preview = document.getElementById('previewDeposito');
  if (!cuenta || !preview) return;
  const monto = parseFloat(document.getElementById('montoDepositarInput').value);
  if (!monto || monto <= 0) { preview.classList.add('hidden'); return; }
  const saldoActual = cuenta.saldoActual || 0;
  const saldoNuevo  = +(saldoActual + monto).toFixed(2);
  preview.classList.remove('hidden');
  preview.innerHTML = `${formatMonto(saldoActual)} + depósito ${formatMonto(monto)} = <strong>${formatMonto(saldoNuevo)}</strong>`;
}
window.actualizarPreviewDeposito = actualizarPreviewDeposito;

async function guardarDeposito() {
  const id = Estado.cuentaEditandoId;
  const cuenta = Estado.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  if (Estado.usuario?.rol !== cuenta.encargado) {
    return mostrarToast('Solo el encargado puede depositar en esta cuenta.', 'advertencia');
  }
  const monto = parseFloat(document.getElementById('montoDepositarInput').value);
  const nota  = document.getElementById('notaDepositarInput').value.trim();
  if (!monto || monto <= 0 || isNaN(monto)) {
    return mostrarToast('Ingresa un monto mayor a $0.00.', 'advertencia');
  }
  const montoFijo  = +monto.toFixed(2);
  const cuentaRef  = db.collection('cuentas').doc(id);
  const movRef     = cuentaRef.collection('movimientos').doc();
  const ahora      = firebase.firestore.FieldValue.serverTimestamp();
  mostrarSpinner();
  try {
    await db.runTransaction(async t => {
      const snap        = await t.get(cuentaRef);
      const saldoActual = +(snap.data()?.saldoActual || 0);
      const saldoNuevo  = +(saldoActual + montoFijo).toFixed(2);
      t.update(cuentaRef, { saldoActual: saldoNuevo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
      t.set(movRef, { tipo: 'deposito', fecha: ahora, saldoAnterior: saldoActual, saldoNuevo, diferencia: montoFijo, actualizadoPor: Estado.usuario.rol, nota });
    });
    mostrarToast('Depósito registrado correctamente.', 'exito');
    cerrarModal('modalActualizarSaldo');
    await cargarCuentas();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al registrar el depósito.', 'error');
  }
  ocultarSpinner();
}
window.guardarDeposito = guardarDeposito;

async function guardarAjuste() {
  const id = Estado.cuentaEditandoId;
  const cuenta = Estado.cuentas.find(c => c.id === id);
  if (!cuenta) return;
  if (Estado.usuario?.rol !== cuenta.encargado) {
    return mostrarToast('Solo el encargado puede corregir esta cuenta.', 'advertencia');
  }
  const nuevoSaldo = parseFloat(document.getElementById('nuevoSaldoInput').value);
  const nota       = document.getElementById('notaAjusteInput').value.trim();
  if (isNaN(nuevoSaldo) || nuevoSaldo < 0) {
    return mostrarToast('Ingresa un saldo válido (mayor o igual a $0.00).', 'advertencia');
  }
  if (!nota) {
    return mostrarToast('El motivo de la corrección es obligatorio.', 'advertencia');
  }
  const saldoFijo = +nuevoSaldo.toFixed(2);
  const cuentaRef = db.collection('cuentas').doc(id);
  const movRef    = cuentaRef.collection('movimientos').doc();
  const ahora     = firebase.firestore.FieldValue.serverTimestamp();
  mostrarSpinner();
  try {
    await db.runTransaction(async t => {
      const snap        = await t.get(cuentaRef);
      const saldoActual = +(snap.data()?.saldoActual || 0);
      const diferencia  = +(saldoFijo - saldoActual).toFixed(2);
      t.update(cuentaRef, { saldoActual: saldoFijo, actualizadoEn: ahora, actualizadoPor: Estado.usuario.rol });
      t.set(movRef, { tipo: 'ajuste', fecha: ahora, saldoAnterior: saldoActual, saldoNuevo: saldoFijo, diferencia, actualizadoPor: Estado.usuario.rol, nota });
    });
    mostrarToast('Saldo corregido correctamente.', 'exito');
    cerrarModal('modalActualizarSaldo');
    await cargarCuentas();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar la corrección.', 'error');
  }
  ocultarSpinner();
}
window.guardarAjuste = guardarAjuste;

// ----------------------------------------------------------------
// Historial de cuenta
// ----------------------------------------------------------------

async function abrirModalHistorialCuenta(id) {
  const cuenta = Estado.cuentas.find(c => c.id === id);
  if (!cuenta) return;

  Estado.cuentaHistorialId = id;
  document.getElementById('historialCuentaTitulo').textContent = `Historial — ${cuenta.nombre}`;
  document.getElementById('listaHistorialCuenta').innerHTML =
    Array(3).fill('<div class="skeleton skeleton-gasto"></div>').join('');
  document.getElementById('graficaCuentaWrapper').classList.add('hidden');

  abrirModal('modalHistorialCuenta');

  let movimientos = [];
  try {
    console.log('[historial] consultando movimientos para cuenta:', id);
    const snap = await db.collection('cuentas').doc(id).collection('movimientos').get();
    console.log('[historial] docs recibidos:', snap.size);
    movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const fa = a.fecha?.toDate ? a.fecha.toDate() : (a.fecha ? new Date(a.fecha) : new Date(0));
        const fb = b.fecha?.toDate ? b.fecha.toDate() : (b.fecha ? new Date(b.fecha) : new Date(0));
        return fb - fa;
      })
      .slice(0, 50);
  } catch (err) {
    console.error('[historial] ERROR Firestore — cuentaId:', id, err);
    document.getElementById('listaHistorialCuenta').innerHTML =
      `<p style="color:red;text-align:center;padding:16px;font-weight:bold">
        Error Firestore al cargar el historial.<br>
        <code style="font-size:.8rem;word-break:break-all">${err.code || err.name || ''}: ${err.message || String(err)}</code>
      </p>`;
    return;
  }

  try {
    renderizarHistorialCuenta(movimientos, cuenta);
  } catch (err) {
    console.error('[historial] ERROR render — cuentaId:', id, err);
    document.getElementById('listaHistorialCuenta').innerHTML =
      `<p style="color:red;text-align:center;padding:16px;font-weight:bold">
        Error al renderizar el historial.<br>
        <code style="font-size:.8rem;word-break:break-all">${err.name || ''}: ${err.message || String(err)}</code>
      </p>`;
  }
}
window.abrirModalHistorialCuenta = abrirModalHistorialCuenta;

function cerrarModalHistorialCuenta() {
  if (Estado.graficas.cuentaHistorial) {
    Estado.graficas.cuentaHistorial.destroy();
    Estado.graficas.cuentaHistorial = null;
  }
  cerrarModal('modalHistorialCuenta');
}
window.cerrarModalHistorialCuenta = cerrarModalHistorialCuenta;

function renderizarHistorialCuenta(movimientos, cuenta) {
  const wrapper = document.getElementById('graficaCuentaWrapper');
  const ctx     = document.getElementById('graficaCuentaHistorial');

  // Destroy any existing chart — both tracked state and canvas registry
  try {
    if (Estado.graficas.cuentaHistorial) {
      Estado.graficas.cuentaHistorial.destroy();
      Estado.graficas.cuentaHistorial = null;
    }
    const existingChart = Chart.getChart ? Chart.getChart(ctx) : undefined;
    if (existingChart) existingChart.destroy();
  } catch(e) {
    console.warn('[historial] chart destroy error (ignorado):', e.message);
    Estado.graficas.cuentaHistorial = null;
  }

  // Gráfica de línea solo si hay 2+ movimientos
  if (movimientos.length >= 2) {
    const movCrono = [...movimientos].reverse();
    const labels = movCrono.map(m => {
      const f = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
      return f.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    });
    const data = movCrono.map(m => m.saldoNuevo || 0);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--primario').trim() || '#FF6B35';

    try {
      Estado.graficas.cuentaHistorial = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Saldo',
            data,
            borderColor: color,
            backgroundColor: 'rgba(255,107,53,0.08)',
            tension: 0.3,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: color
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              ticks: {
                color: colorTextoGrafica(),
                callback: v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })
              },
              grid: { color: colorBordeGrafica() }
            },
            x: { ticks: { color: colorTextoGrafica() }, grid: { display: false } }
          }
        }
      });
      wrapper.classList.remove('hidden');
    } catch(e) {
      console.warn('[historial] chart creation error (gráfica omitida):', e.message);
      wrapper.classList.add('hidden');
    }
  } else {
    wrapper.classList.add('hidden');
  }

  // Lista de movimientos
  const listaEl = document.getElementById('listaHistorialCuenta');
  if (!movimientos.length) {
    listaEl.innerHTML = '<p style="color:var(--texto-muted);font-size:.88rem;text-align:center;padding:20px">Sin movimientos registrados todavía.</p>';
    return;
  }

  const TIPO_ICON = { gasto: '🧾', reverso: '↩️', corrección: '🔧', ajuste: '✏️', deposito: '💵' };

  listaEl.innerHTML = movimientos.map(m => {
    const fechaRaw = m.fecha?.toDate ? m.fecha.toDate() : (m.fecha ? new Date(m.fecha) : null);
    const fechaStr = fechaRaw ? fechaRaw.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    const horaStr  = fechaRaw ? fechaRaw.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—';
    const difClase = (m.diferencia || 0) >= 0 ? 'movimiento-diff-positivo' : 'movimiento-diff-negativo';
    const difSigno = (m.diferencia || 0) >= 0 ? '+' : '-';
    const icono    = TIPO_ICON[m.tipo] || '✏️';
    const tipoLabel = m.tipo ? m.tipo.charAt(0).toUpperCase() + m.tipo.slice(1) : 'Ajuste';

    return `
      <div class="movimiento-item">
        <div class="movimiento-izq">
          <div class="movimiento-tipo">${icono} ${tipoLabel}</div>
          <div class="movimiento-fecha">${fechaStr} · ${horaStr}</div>
          <div class="movimiento-saldos">${formatMonto(m.saldoAnterior)} → <strong>${formatMonto(m.saldoNuevo)}</strong></div>
          <div class="movimiento-meta">Por ${nombreRol(m.actualizadoPor)}${m.nota ? ' · ' + m.nota : ''}</div>
        </div>
        <div class="${difClase}">${difSigno}${formatMonto(Math.abs(m.diferencia || 0))}</div>
      </div>`;
  }).join('');
}

// ----------------------------------------------------------------
// Resumen: tarjeta de cuentas
// ----------------------------------------------------------------

async function actualizarResumenCuentas() {
  const cardEl = document.getElementById('cardCuentasResumen');
  if (!cardEl) return;
  try {
    // Si ya se cargaron las cuentas en este tab, reusar; si no, cargar fresh
    let cuentas = Estado.cuentas;
    if (!cuentas.length) {
      const snap = await db.collection('cuentas').get();
      cuentas = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.activa !== false);
    }
    if (!cuentas.length) { cardEl.classList.add('hidden'); return; }

    const total = cuentas.reduce((s, c) => s + (c.saldoActual || 0), 0);

    // Dato más antiguo: cuenta con la fecha de actualización más vieja
    let masAntigua = null;
    cuentas.forEach(c => {
      if (!c.actualizadoEn) return;
      const f = c.actualizadoEn.toDate ? c.actualizadoEn.toDate() : new Date(c.actualizadoEn);
      if (!masAntigua || f < masAntigua) masAntigua = f;
    });

    document.getElementById('resumenCuentasTotal').textContent = formatMonto(total);
    document.getElementById('resumenCuentasFecha').textContent = masAntigua
      ? `Dato más antiguo: ${masAntigua.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}`
      : 'Sin actualizaciones aún';
    cardEl.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    cardEl.classList.add('hidden');
  }
}

// ----------------------------------------------------------------
// Admin: gestión de cuentas (Ajustes)
// ----------------------------------------------------------------

function cargarSeccionCuentasAjustes() {
  const listaEl = document.getElementById('listaCuentasAdmin');
  if (!listaEl) return;

  db.collection('cuentas').get().then(snap => {
    const todas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    if (!todas.length) {
      listaEl.innerHTML = '<p style="color:var(--texto-muted);font-size:.88rem">No hay cuentas registradas aún.</p>';
      return;
    }

    listaEl.innerHTML = todas.map(c => `
      <div class="pendiente-item">
        <div class="pendiente-info">
          <div class="pendiente-desc">${c.nombre}${c.banco ? ` — ${c.banco}` : ''}</div>
          <div class="pendiente-meta">
            Encargado: ${nombreRol(c.encargado)} · Saldo: ${formatMonto(c.saldoActual || 0)}
            ${c.activa === false ? ' · <span style="color:var(--alerta);font-weight:600">Inactiva</span>' : ''}
          </div>
        </div>
        <div class="pendiente-derecha">
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="btn-accion btn-editar" onclick="abrirModalGestionCuenta('${c.id}')" title="Editar">✏️</button>
            ${c.activa !== false
              ? `<button class="btn-accion btn-eliminar" onclick="confirmarDesactivarCuenta('${c.id}','${c.nombre.replace(/'/g,"\\'")}')" title="Desactivar">🔒</button>`
              : `<button class="btn-accion" onclick="reactivarCuenta('${c.id}')" title="Reactivar" style="background:var(--exito-light);color:var(--exito)">🔓</button>`}
          </div>
        </div>
      </div>`).join('');
  }).catch(err => {
    console.error(err);
    listaEl.innerHTML = '<p style="color:var(--alerta);font-size:.88rem">Error al cargar cuentas.</p>';
  });
}

function confirmarDesactivarCuenta(id, nombre) {
  Estado.cuentaADesactivarId = id;
  Estado.gastoAEliminarId   = null;
  Estado.ingresoAEliminarId = null;
  document.getElementById('confirmarMensaje').innerHTML =
    `¿Desactivar la cuenta <strong>"${nombre}"</strong>?<br><br>Se ocultará de la pestaña Cuentas pero su historial de movimientos se conserva.`;
  document.querySelector('#modalConfirmar .btn-peligro').textContent = 'Sí, desactivar';
  abrirModal('modalConfirmar');
}
window.confirmarDesactivarCuenta = confirmarDesactivarCuenta;

async function reactivarCuenta(id) {
  mostrarSpinner();
  try {
    await db.collection('cuentas').doc(id).update({ activa: true });
    mostrarToast('Cuenta reactivada correctamente.', 'exito');
    await cargarCuentas();
    cargarSeccionCuentasAjustes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al reactivar la cuenta.', 'error');
  }
  ocultarSpinner();
}
window.reactivarCuenta = reactivarCuenta;

function abrirModalGestionCuenta(id = null) {
  if (Estado.usuario?.rol !== 'admin') return;
  Estado.cuentaEditandoId = id || null;
  const esEdicion = !!id;
  document.getElementById('gestionCuentaTitulo').textContent = esEdicion ? 'Editar cuenta' : 'Nueva cuenta';

  // Poblar select con nombres actuales
  const sel = document.getElementById('cuentaEncargadoSelect');
  sel.innerHTML = `
    <option value="socio1">${nombreRol('socio1')}</option>
    <option value="socio2">${nombreRol('socio2')}</option>
    <option value="admin">${nombreRol('admin')}</option>`;

  const campoSaldo = document.getElementById('campoSaldoInicial');

  if (esEdicion) {
    db.collection('cuentas').doc(id).get().then(doc => {
      if (!doc.exists) return;
      const c = doc.data();
      document.getElementById('cuentaNombreInput').value = c.nombre || '';
      document.getElementById('cuentaBancoInput').value  = c.banco  || '';
      sel.value = c.encargado || 'admin';
      campoSaldo.classList.add('hidden');
    });
  } else {
    document.getElementById('cuentaNombreInput').value  = '';
    document.getElementById('cuentaBancoInput').value   = '';
    sel.value = 'admin';
    campoSaldo.classList.remove('hidden');
    document.getElementById('cuentaSaldoInicialInput').value = '';
  }

  abrirModal('modalGestionCuenta');
}
window.abrirModalGestionCuenta = abrirModalGestionCuenta;

async function guardarCuenta() {
  if (Estado.usuario?.rol !== 'admin') return;

  const nombre    = document.getElementById('cuentaNombreInput').value.trim();
  const banco     = document.getElementById('cuentaBancoInput').value.trim();
  const encargado = document.getElementById('cuentaEncargadoSelect').value;
  const id        = Estado.cuentaEditandoId;

  if (!nombre)    return mostrarToast('Ingresa el nombre de la cuenta.', 'advertencia');
  if (!encargado) return mostrarToast('Selecciona el encargado.', 'advertencia');

  mostrarSpinner();
  try {
    if (id) {
      await db.collection('cuentas').doc(id).update({ nombre, banco, encargado });
      mostrarToast('Cuenta actualizada correctamente.', 'exito');
    } else {
      const saldoInicial = parseFloat(document.getElementById('cuentaSaldoInicialInput').value) || 0;
      const ahora = firebase.firestore.FieldValue.serverTimestamp();
      const docRef = await db.collection('cuentas').add({
        nombre, banco, encargado,
        saldoActual:    +saldoInicial.toFixed(2),
        actualizadoEn:  ahora,
        actualizadoPor: Estado.usuario.rol,
        activa:         true
      });
      if (saldoInicial > 0) {
        await db.collection('cuentas').doc(docRef.id).collection('movimientos').add({
          fecha:          ahora,
          saldoAnterior:  0,
          saldoNuevo:     +saldoInicial.toFixed(2),
          diferencia:     +saldoInicial.toFixed(2),
          actualizadoPor: Estado.usuario.rol,
          nota:           'Saldo inicial'
        });
      }
      mostrarToast('Cuenta creada correctamente.', 'exito');
    }
    cerrarModal('modalGestionCuenta');
    await cargarCuentas();
    cargarSeccionCuentasAjustes();
  } catch (err) {
    console.error(err);
    mostrarToast('Error al guardar la cuenta.', 'error');
  }
  ocultarSpinner();
}
window.guardarCuenta = guardarCuenta;
