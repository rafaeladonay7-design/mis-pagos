# Mis Pagos

App web instalable (PWA) para organizar tarjetas de crédito y pagos fijos: calcula el último día para pagar cada uno
(recorriendo fines de semana y días inhábiles bancarios de México), reparte cada pago entre tus cobros y te dice cuánto te sobra.

- Ingreso semanal, catorcenal, quincenal o mensual.
- Tarjetas con fecha de corte y fecha límite (días después del corte o día fijo), pagos fijos y deuda total.
- Pagué todo, pagué una parte o no pude pagar: lo que falta pasa al siguiente mes.
- Calendario descargable (.ics) con recordatorios.
- Inicio de sesión con Google o correo, y sincronización entre dispositivos con Firebase. Sin Firebase configurado, funciona sin cuentas y guarda todo en el teléfono.

## Archivos

| Archivo | Qué hace |
|---|---|
| `calc.js` | Cálculo de fechas, cobros y reparto (sin interfaz) |
| `app.js` | Pantallas, formularios, cuenta y sincronización |
| `firebase-config.js` | Configuración de Firebase (vacía = sin cuentas) |
| `firestore.rules` | Reglas de seguridad: cada usuario solo lee y escribe `usuarios/<su uid>` |
| `sw.js`, `manifest.webmanifest` | Instalación y uso sin internet |

## Configurar Firebase

1. En [console.firebase.google.com](https://console.firebase.google.com) crea un proyecto.
2. Agrega una app **Web** y copia su configuración en `firebase-config.js`.
3. **Authentication → Método de acceso**: activa **Google** y **Correo electrónico/contraseña**.
4. **Firestore Database**: crea la base en modo de producción y, en **Reglas**, pega `firestore.rules` y publica.
5. **Authentication → Configuración → Dominios autorizados**: agrega el dominio donde publiques la app (por ejemplo `usuario.github.io`).

## Probar en tu computadora

```bash
python3 -m http.server 8765
```

y abre http://localhost:8765.
