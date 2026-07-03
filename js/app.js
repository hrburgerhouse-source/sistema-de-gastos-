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
  usuario:      null,   // { rol: 'socio1'|'socio2'|'admin', nombre: string }
  tabActual:    'gastos',
  gastos:       [],     // gastos cargados con los filtros actuales
  categorias:   [],     // categorías cargadas de Firestore
  pins:         {},     // PINs actuales
  pinIngresado: '',     // PIN en curso de ingreso en la pantalla
  gastoEditandoId: null,
  gastoAEliminarId: null,
  categoriaEditandoId: null,
  pinCambiandoRol: null,
  pinResetandoRol: null,
  pendienteAPagarId: null,
  nombreEditandoRol: null,
  nombres: {},
  gastosResumenActual: [],  // gastos del período en la tab Resumen
  pendientes:   [],         // compras pendientes de pago
  graficas: { dona: null, barras: null, linea: null },
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

  document.getElementById('pantallaPin').classList.add('hidden');
  document.getElementById('appPrincipal').classList.remove('hidden');

  try {
    await Promise.all([cargarCategorias(), cargarGastosMesActual(), mostrarPanelDeudas()]);
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar datos. Verifica tu conexión a internet.', 'error');
  }
  ocultarSpinner();
}

function cerrarSesion() {
  Estado.usuario = null;
  Estado.gastos = [];
  Estado.gastosResumenActual = [];
  localStorage.removeItem('hr-gastos-usuario');

  // Destruir gráficas
  Object.keys(Estado.graficas).forEach(k => {
    if (Estado.graficas[k]) { Estado.graficas[k].destroy(); Estado.graficas[k] = null; }
  });

  document.getElementById('appPrincipal').classList.add('hidden');
  document.getElementById('pantallaPin').classList.remove('hidden');

  // Ocultar FAB de pendientes
  const fabPendiente = document.getElementById('fabPendiente');
  if (fabPendiente) fabPendiente.classList.add('hidden');

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
}

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
    await db.collection('config').doc('nombres').update(update);
    Estado.nombres[Estado.nombreEditandoRol] = nombre;

    // Actualizar el badge si es el usuario actual
    if (Estado.usuario?.rol === Estado.nombreEditandoRol) {
      Estado.usuario.nombre = nombre;
      document.getElementById('usuarioActual').textContent = nombre;
    }

    mostrarToast(`Nombre actualizado a "${nombre}".`, 'exito');
    cerrarModal('modalEditarNombre');
    cargarAjustes(); // refrescar la vista de ajustes
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
  const desde = primerDiaMes(mes, anio);
  const hasta = ultimoDiaMes(mes, anio);

  document.getElementById('filtroDesde').value = desde;
  document.getElementById('filtroHasta').value = hasta;

  await cargarGastosConFiltros(desde, hasta, '', '');
}

async function cargarGastosConFiltros(desde, hasta, categoria, registradoPor) {
  mostrarSkeletonGastos();
  try {
    let query = db.collection('gastos').orderBy('fecha', 'desc');
    if (desde) query = query.where('fecha', '>=', desde);
    if (hasta) query = query.where('fecha', '<=', hasta);

    const snap = await query.get();
    let gastos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filtros que Firestore no puede combinar sin índice compuesto → se aplican en cliente
    if (categoria)    gastos = gastos.filter(g => g.categoria === categoria);
    if (registradoPor) gastos = gastos.filter(g => g.registradoPor === registradoPor);

    // Ordenar: dentro del mismo día, los más recientes primero
    gastos.sort((a, b) => {
      if (b.fecha !== a.fecha) return b.fecha.localeCompare(a.fecha);
      const ta = a.timestamp?.seconds || 0;
      const tb = b.timestamp?.seconds || 0;
      return tb - ta;
    });

    Estado.gastos = gastos;
    renderizarListaGastos(gastos);
  } catch (err) {
    console.error(err);
    mostrarToast('Error al cargar los gastos. Verifica tu conexión.', 'error');
    renderizarListaGastos([]);
  }
}

// ================================================================
// FILTROS
// ================================================================

function aplicarFiltros() {
  const desde        = document.getElementById('filtroDesde').value;
  const hasta        = document.getElementById('filtroHasta').value;
  const categoria    = document.getElementById('filtroCategoria').value;
  const registradoPor = document.getElementById('filtroRegistradoPor').value;
  cargarGastosConFiltros(desde, hasta, categoria, registradoPor);
}
window.aplicarFiltros = aplicarFiltros;

function limpiarFiltros() {
  const ahora = new Date();
  const mes   = ahora.getMonth() + 1;
  const anio  = ahora.getFullYear();
  document.getElementById('filtroDesde').value         = primerDiaMes(mes, anio);
  document.getElementById('filtroHasta').value         = ultimoDiaMes(mes, anio);
  document.getElementById('filtroCategoria').value     = '';
  document.getElementById('filtroRegistradoPor').value = '';
  aplicarFiltros();
}
window.limpiarFiltros = limpiarFiltros;

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
      <span>Total del período</span>
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
  abrirModal('modalGasto');
}
window.abrirModalNuevoGasto = abrirModalNuevoGasto;

function editarGasto(id) {
  const g = Estado.gastos.find(x => x.id === id);
  if (!g) return;
  Estado.gastoEditandoId = id;
  document.getElementById('modalGastoTitulo').textContent = 'Editar Gasto';
  poblarSelectCategorias();
  document.getElementById('gastoFecha').value        = g.fecha       || hoy();
  document.getElementById('gastoCategoria').value    = g.categoria   || '';
  document.getElementById('gastoDescripcion').value  = g.descripcion || '';
  document.getElementById('gastoMonto').value        = g.monto       || '';
  document.getElementById('gastoMetodoPago').value   = g.metodoPago  || '';
  document.getElementById('gastoNotas').value        = g.notas       || '';
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

  if (!fecha)                          return mostrarToast('Selecciona una fecha.', 'advertencia');
  if (!categoria)                      return mostrarToast('Selecciona una categoría.', 'advertencia');
  if (!descripcion)                    return mostrarToast('Ingresa una descripción.', 'advertencia');
  if (isNaN(monto) || monto <= 0)      return mostrarToast('El monto debe ser mayor a $0.00.', 'advertencia');
  if (!metodoPago)                     return mostrarToast('Selecciona el método de pago.', 'advertencia');

  const datos = {
    fecha, categoria, descripcion, monto, metodoPago, notas,
    registradoPor: Estado.usuario.rol,
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  };

  mostrarSpinner();
  try {
    if (Estado.gastoEditandoId) {
      await db.collection('gastos').doc(Estado.gastoEditandoId).update(datos);
      mostrarToast('Gasto actualizado correctamente.', 'exito');
    } else {
      await db.collection('gastos').add(datos);
      mostrarToast('Gasto registrado correctamente.', 'exito');
    }
    cerrarModalGasto();
    const desde        = document.getElementById('filtroDesde').value;
    const hasta        = document.getElementById('filtroHasta').value;
    const categoria_f  = document.getElementById('filtroCategoria').value;
    const registradoPor = document.getElementById('filtroRegistradoPor').value;
    await cargarGastosConFiltros(desde, hasta, categoria_f, registradoPor);
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
  Estado.gastoAEliminarId = id;
  const g = Estado.gastos.find(x => x.id === id);
  document.getElementById('confirmarMensaje').innerHTML =
    `¿Deseas eliminar el gasto <strong>"${g?.descripcion || ''}"</strong> por <strong>${formatMonto(g?.monto)}</strong>?<br><br>Esta acción no se puede deshacer.`;
  abrirModal('modalConfirmar');
}
window.confirmarEliminarGasto = confirmarEliminarGasto;

async function ejecutarEliminar() {
  if (!Estado.gastoAEliminarId) return;
  mostrarSpinner();
  try {
    await db.collection('gastos').doc(Estado.gastoAEliminarId).delete();
    mostrarToast('Gasto eliminado.', 'exito');
    cerrarModal('modalConfirmar');
    const desde        = document.getElementById('filtroDesde').value;
    const hasta        = document.getElementById('filtroHasta').value;
    const categoria    = document.getElementById('filtroCategoria').value;
    const registradoPor = document.getElementById('filtroRegistradoPor').value;
    await cargarGastosConFiltros(desde, hasta, categoria, registradoPor);
  } catch (err) {
    console.error(err);
    mostrarToast('Error al eliminar. Inténtalo de nuevo.', 'error');
  }
  Estado.gastoAEliminarId = null;
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
    const [snapActual, snapAnterior] = await Promise.all([
      db.collection('gastos')
        .where('fecha', '>=', primerDiaMes(mes, anio))
        .where('fecha', '<=', ultimoDiaMes(mes, anio))
        .orderBy('fecha').get(),
      (() => {
        const ant = mesAnterior(mes, anio);
        return db.collection('gastos')
          .where('fecha', '>=', primerDiaMes(ant.mes, ant.anio))
          .where('fecha', '<=', ultimoDiaMes(ant.mes, ant.anio))
          .orderBy('fecha').get();
      })()
    ]);

    const gastosActuales  = snapActual.docs.map(d => ({ id: d.id, ...d.data() }));
    const gastosAnteriores = snapAnterior.docs.map(d => ({ id: d.id, ...d.data() }));

    Estado.gastosResumenActual = gastosActuales;
    renderizarResumen(gastosActuales, gastosAnteriores, mes, anio);

    // Cargar pendientes del socio (si no es admin)
    if (Estado.usuario?.rol !== 'admin') {
      await cargarPendientes();
      renderizarMisPendientes();
    }
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

function renderizarResumen(actuales, anteriores, mes, anio) {
  const totalActual   = actuales.reduce((s, g) => s + (g.monto || 0), 0);
  const totalAnterior = anteriores.reduce((s, g) => s + (g.monto || 0), 0);
  const variacion     = totalAnterior > 0 ? (totalActual - totalAnterior) / totalAnterior * 100 : 0;

  // Promedio: total / días del mes que han pasado (o días del mes si ya terminó)
  const hoyDate  = new Date();
  const diasMes  = new Date(anio, mes, 0).getDate();
  const esActual = hoyDate.getFullYear() === anio && hoyDate.getMonth() + 1 === mes;
  const diasBase = esActual ? hoyDate.getDate() : diasMes;
  const promedio = diasBase > 0 ? totalActual / diasBase : 0;

  // Por categoría
  const porCat = {};
  actuales.forEach(g => { porCat[g.categoria] = (porCat[g.categoria] || 0) + (g.monto || 0); });
  const catOrdenadas = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const mayorCat = catOrdenadas[0];

  const ant = mesAnterior(mes, anio);
  const varClase  = variacion > 0 ? 'stat-negativo' : variacion < 0 ? 'stat-positivo' : '';
  const varIcono  = variacion > 0 ? '▲' : variacion < 0 ? '▼' : '–';
  const varTexto  = variacion !== 0 ? `${varIcono} ${Math.abs(variacion).toFixed(1)}%` : '– Sin cambio';

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">${nombreMes(mes)} ${anio}</div>
      <div class="stat-valor">${formatMonto(totalActual)}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${nombreMes(ant.mes)} ${ant.anio}</div>
      <div class="stat-valor">${formatMonto(totalAnterior)}</div>
    </div>
    <div class="stat-card ${varClase}">
      <div class="stat-label">Variación vs mes anterior</div>
      <div class="stat-valor">${varTexto}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Promedio diario</div>
      <div class="stat-valor">${formatMonto(promedio)}</div>
    </div>
    ${mayorCat ? `
    <div class="stat-card stat-card-wide">
      <div class="stat-label">Categoría con mayor gasto</div>
      <div class="stat-valor">${mayorCat[0]}</div>
      <div class="stat-sublabel">${formatMonto(mayorCat[1])} · ${totalActual > 0 ? (mayorCat[1]/totalActual*100).toFixed(1) : 0}% del total</div>
    </div>` : ''}`;

  if (!catOrdenadas.length) {
    document.getElementById('tablaCategoriasResumen').innerHTML =
      '<p style="color:var(--texto-muted);font-size:.88rem;text-align:center;padding:20px">Sin gastos en este período</p>';
    return;
  }

  const filas = catOrdenadas.map(([cat, monto]) => {
    const pct = totalActual > 0 ? (monto / totalActual * 100) : 0;
    return `
      <tr>
        <td>${cat}</td>
        <td style="font-weight:600;white-space:nowrap">${formatMonto(monto)}</td>
        <td>
          <div class="barra-progreso-wrapper">
            <div class="barra-progreso-bg">
              <div class="barra-progreso" style="width:${pct}%"></div>
            </div>
            <span style="min-width:38px;font-size:.8rem">${pct.toFixed(1)}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('tablaCategoriasResumen').innerHTML = `
    <table class="tabla-resumen">
      <thead><tr><th>Categoría</th><th>Monto</th><th>% del total</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td colspan="2"><strong>${formatMonto(totalActual)}</strong></td></tr></tfoot>
    </table>`;
}

// ================================================================
// TAB: GRÁFICAS
// ================================================================

async function cargarGraficas() {
  const mes  = parseInt(document.getElementById('graficaMes').value);
  const anio = parseInt(document.getElementById('graficaAnio').value);

  try {
    // Mes seleccionado
    const snapMes = await db.collection('gastos')
      .where('fecha', '>=', primerDiaMes(mes, anio))
      .where('fecha', '<=', ultimoDiaMes(mes, anio))
      .orderBy('fecha').get();
    const gastosMes = snapMes.docs.map(d => d.data());

    // Últimos 6 meses (para barras)
    const inicio6m = (() => {
      const d = new Date(anio, mes - 7, 1);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    })();
    const snap6m = await db.collection('gastos')
      .where('fecha', '>=', inicio6m)
      .where('fecha', '<=', ultimoDiaMes(mes, anio))
      .orderBy('fecha').get();
    const gastos6m = snap6m.docs.map(d => d.data());

    renderizarGraficas(gastosMes, gastos6m, mes, anio);
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

function renderizarGraficas(gastosMes, gastos6m, mes, anio) {
  // Destruir instancias anteriores
  Object.keys(Estado.graficas).forEach(k => {
    if (Estado.graficas[k]) { Estado.graficas[k].destroy(); Estado.graficas[k] = null; }
  });

  const colores = ['#FF6B35','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98D8C8','#F7DC6F','#FD79A8','#74B9FF'];
  const textoColor = colorTextoGrafica();
  const mutedColor = colorMutedGrafica();

  Chart.defaults.color = textoColor;

  // === DONA: por categoría ===
  const porCat = {};
  gastosMes.forEach(g => { porCat[g.categoria] = (porCat[g.categoria] || 0) + (g.monto || 0); });

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

  // === BARRAS: últimos 6 meses ===
  const mesesData = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anio, mes - 1 - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    mesesData[k] = 0;
  }
  gastos6m.forEach(g => {
    const k = g.fecha?.substring(0, 7);
    if (k in mesesData) mesesData[k] += (g.monto || 0);
  });

  Estado.graficas.barras = new Chart(document.getElementById('graficaBarras'), {
    type: 'bar',
    data: {
      labels: Object.keys(mesesData).map(k => {
        const [y, m] = k.split('-');
        return `${nombreMes(parseInt(m)).substring(0,3)} ${y}`;
      }),
      datasets: [{
        label: 'Gastos',
        data: Object.values(mesesData),
        backgroundColor: 'rgba(255,107,53,0.8)',
        borderColor: '#FF6B35',
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${formatMonto(ctx.parsed.y)}` } }
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
  gastosMes.forEach(g => { if (g.fecha in acumDia) acumDia[g.fecha] += (g.monto || 0); });

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
  await generarPDF(Estado.gastosResumenActual, primerDiaMes(mes, anio), ultimoDiaMes(mes, anio));
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

async function generarPDF(gastos, desde, hasta, periodoLabel) {
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
    nombreRol(g.registradoPor),
    formatMonto(g.monto)
  ]);

  doc.autoTable({
    startY: 42,
    head: [['Fecha', 'Categoría', 'Descripción', 'Método', 'Registrado por', 'Monto']],
    body: filas,
    foot: [['', '', '', '', 'TOTAL', formatMonto(gastos.reduce((s, g) => s + (g.monto||0), 0))]],
    headStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 10 },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
    columnStyles: { 2: { cellWidth: 70 }, 5: { halign: 'right', fontStyle: 'bold' } }
  });

  // Resumen por categoría
  const porCat = {};
  gastos.forEach(g => { porCat[g.categoria] = (porCat[g.categoria]||0) + (g.monto||0); });
  const catOrdenadas = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const total = gastos.reduce((s, g) => s + (g.monto||0), 0);

  const yFinal = doc.lastAutoTable.finalY + 12;
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 50);
  doc.text('Resumen por Categoría', 14, yFinal);

  doc.autoTable({
    startY: yFinal + 4,
    head: [['Categoría', 'Monto', '% del Total']],
    body: catOrdenadas.map(([c, m]) => [c, formatMonto(m), `${total > 0 ? (m/total*100).toFixed(1) : 0}%`]),
    foot: [['TOTAL', formatMonto(total), '100%']],
    headStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    footStyles: { fillColor: [255, 107, 53], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 3 }
  });

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
  await generarExcel(Estado.gastosResumenActual, primerDiaMes(mes, anio), ultimoDiaMes(mes, anio));
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

async function generarExcel(gastos, desde, hasta) {
  if (!gastos || !gastos.length) return mostrarToast('No hay gastos para exportar.', 'advertencia');

  const wb = XLSX.utils.book_new();

  // === Hoja 1: Detalle ===
  const header = `HR Burger House — Control de Gastos${desde && hasta ? ` | Período: ${desde} al ${hasta}` : ''}`;
  const filas = [
    [header],
    [`Generado: ${new Date().toLocaleDateString('es-ES')}`],
    [],
    ['Fecha', 'Categoría', 'Descripción', 'Método de Pago', 'Registrado por', 'Monto (USD)'],
    ...gastos.map(g => [
      g.fecha || '', g.categoria || '', g.descripcion || '',
      g.metodoPago || '', nombreRol(g.registradoPor), g.monto || 0
    ]),
    [],
    ['', '', '', '', 'TOTAL', gastos.reduce((s, g) => s + (g.monto||0), 0)]
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(filas);
  ws1['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 40 }, { wch: 15 }, { wch: 16 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Detalle de Gastos');

  // === Hoja 2: Resumen por categoría ===
  const porCat  = {};
  gastos.forEach(g => { porCat[g.categoria] = (porCat[g.categoria]||0) + (g.monto||0); });
  const total   = gastos.reduce((s, g) => s + (g.monto||0), 0);
  const resumen = Object.entries(porCat).sort((a, b) => b[1] - a[1]);

  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Categoría', 'Monto (USD)', '% del Total'],
    ...resumen.map(([c, m]) => [c, m, total > 0 ? +((m/total*100).toFixed(2)) : 0]),
    [],
    ['TOTAL', total, 100]
  ]);
  ws2['!cols'] = [{ wch: 25 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen por Categoría');

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

    // Refrescar panel, lista de gastos y ajustes si está abierto
    const desde        = document.getElementById('filtroDesde').value;
    const hasta        = document.getElementById('filtroHasta').value;
    const categoria    = document.getElementById('filtroCategoria').value;
    const regPor       = document.getElementById('filtroRegistradoPor').value;

    await Promise.all([
      mostrarPanelDeudas(),
      cargarGastosConFiltros(desde, hasta, categoria, regPor)
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
