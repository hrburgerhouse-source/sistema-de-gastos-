// ================================================================
// CONFIGURACIÓN DE FIREBASE
// ----------------------------------------------------------------
// Reemplaza cada valor con los datos de tu proyecto Firebase.
// Los encuentras en: Consola Firebase → Configuración del proyecto
//                    → Tus aplicaciones → SDK de Firebase
// ================================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDMKl8VBu9AV2k4PrXlCz8gS6J5m10vluk",
  authDomain:        "sistema-de-gastos-6a91d.firebaseapp.com",
  projectId:         "sistema-de-gastos-6a91d",
  storageBucket:     "sistema-de-gastos-6a91d.firebasestorage.app",
  messagingSenderId: "155599396111",
  appId:             "1:155599396111:web:6481a3fc8d5ccfb7cbf27a"
};

// ================================================================
// PINs POR DEFECTO
// Se sobrescriben con los valores guardados en Firestore
// (colección "config", documento "pins")
// ================================================================
const PINS_DEFAULT = {
  socio1: "1111",
  socio2: "2222",
  admin:  "9999"
};

// ================================================================
// CATEGORÍAS POR DEFECTO
// Se crean en Firestore si la colección "categorias" está vacía
// ================================================================
const CATEGORIAS_DEFAULT = [
  "Compras de insumos",
  "Pago de empleados",
  "Servicios",
  "Alquiler",
  "Mantenimiento",
  "Otros"
];
