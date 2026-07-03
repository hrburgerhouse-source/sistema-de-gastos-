// ================================================================
// CONFIGURACIÓN DE FIREBASE
// ----------------------------------------------------------------
// Reemplaza cada valor con los datos de tu proyecto Firebase.
// Los encuentras en: Consola Firebase → Configuración del proyecto
//                    → Tus aplicaciones → SDK de Firebase
// ================================================================
const FIREBASE_CONFIG = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_PROJECT_ID.firebaseapp.com",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_PROJECT_ID.appspot.com",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId:             "TU_APP_ID"
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
