const admin = require("firebase-admin");

// 📧 Mismas constantes de EmailJS que usa la app FerrePOS
const EMAILJS_SERVICE_ID = "service_im7d7by";
const EMAILJS_TEMPLATE_ID = "template_d0fa1yo";
const EMAILJS_PUBLIC_KEY = "SQ8qjwz0sSzyoXxnc";
const REPORTE_EMAIL = "danielhumbertocaicedoarguello@gmail.com";

// 🔐 Inicializa Firebase Admin con la llave de servicio (variable de entorno en Vercel)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const cop = (n) => "$" + Number(n).toLocaleString("es-CO");

module.exports = async (req, res) => {
  // 🛡️ Seguridad: solo el cron de Vercel (con CRON_SECRET) o pruebas manuales autorizadas
  const autorizado =
    !process.env.CRON_SECRET ||
    req.headers.authorization === `Bearer ${process.env.CRON_SECRET}` ||
    req.query.prueba === "si";
  if (!autorizado) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }

  try {
    // 🇨 Fecha de HOY en Colombia (UTC-5)
    const ahoraCol = new Date(Date.now() - 5 * 3600 * 1000);
    const y = ahoraCol.getUTCFullYear();
    const m = ahoraCol.getUTCMonth();
    const d = ahoraCol.getUTCDate();
    const inicio = new Date(Date.UTC(y, m, d, 5, 0, 0));    // 00:00 de hoy en Colombia
    const fin = new Date(Date.UTC(y, m, d + 1, 5, 0, 0));   // 00:00 de mañana en Colombia

    // 🧾 Ventas de hoy
    const snapVentas = await db
      .collection("sales")
      .where("fecha", ">=", inicio.toISOString())
      .where("fecha", "<", fin.toISOString())
      .get();
    const ventas = snapVentas.docs.map((doc) => doc.data());

    const total = ventas.reduce((a, v) => a + (v.total || 0), 0);
    const numVentas = ventas.length;
    const ticket = numVentas ? Math.round(total / numVentas) : 0;

    const mapaVendedores = {};
    ventas.forEach((v) => {
      const nombre = v.vendedorNombre || "Sin nombre";
      if (!mapaVendedores[nombre]) mapaVendedores[nombre] = { numVentas: 0, total: 0 };
      mapaVendedores[nombre].numVentas += 1;
      mapaVendedores[nombre].total += v.total || 0;
    });
    const porVendedorTexto =
      Object.entries(mapaVendedores)
        .map(([nombre, v]) => `• ${nombre}: ${cop(v.total)} (${v.numVentas} ventas)`)
        .join("\n") || "Sin ventas en el día.";

    // ⚠️ Productos con bajo stock
    const snapProductos = await db.collection("products").get();
    const bajoStock = snapProductos.docs
      .map((doc) => doc.data())
      .filter((p) => p.stock <= p.minimo);
    const bajoStockTexto =
      bajoStock.map((p) => `• ${p.nombre}: stock ${p.stock} (mínimo ${p.minimo})`).join("\n") ||
      "Ninguno. Todo el inventario por encima del mínimo.";

    const fechaLegible = `${String(d).padStart(2, "0")}/${String(m + 1).padStart(2, "0")}/${y}`;

    // 📧 Envío por la API REST de EmailJS
    const respuesta = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          para: REPORTE_EMAIL,
          periodo: `Cierre del día ${fechaLegible} (envío automático 9:00 pm)`,
          fecha_envio: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }),
          total: cop(total),
          num_ventas: String(numVentas),
          ticket: cop(ticket),
          por_vendedor: porVendedorTexto,
          bajo_stock: bajoStockTexto,
        },
      }),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      throw new Error(`EmailJS respondió ${respuesta.status}: ${texto}`);
    }

    res.status(200).json({ ok: true, mensaje: `Reporte del ${fechaLegible} enviado a ${REPORTE_EMAIL}` });
  } catch (error) {
    console.error("Error en reporte-diario:", error);
    res.status(500).json({ ok: false, error: String((error && error.message) || error) });
  }
};
