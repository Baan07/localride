# LocalRide

Plataforma web tipo Uber para una localidad: React, Node.js/Express, PostgreSQL con PostGIS, WebSocket, OpenStreetMap/Leaflet y Mercado Pago Checkout Pro desde backend.

La maqueta estatica original sigue disponible en `index.html`, `styles.css` y `app.js`. La version full-stack nueva vive en `frontend/`, `backend/` y `database/`.

## Funcionalidades

- Roles: pasajero, conductor y administrador.
- Autenticacion JWT con hash de contrasenas.
- Pedido de viaje con origen/destino por coordenadas.
- Calculo real de distancia con PostGIS `ST_Distance`.
- Busqueda y asignacion de conductores cercanos con PostGIS `ST_DWithin`.
- Seguimiento en vivo con WebSocket por canal de viaje.
- Mapa real con OpenStreetMap y React Leaflet.
- Checkout Pro de Mercado Pago creado desde el backend.
- Webhook de Mercado Pago con validacion de firma e idempotencia basica.
- Auditoria de acciones sensibles.
- Verificacion de conductores, tarifas, comisiones y politica de cancelacion configurable.

## Ejecutar en desarrollo

1. Copia variables:

```bash
cp .env.example .env
```

2. Levanta PostgreSQL/PostGIS:

```bash
docker compose up -d postgres
```

3. Instala dependencias:

```bash
npm install
```

4. Migra y carga datos demo:

```bash
npm run db:migrate
npm run db:seed
```

5. Inicia frontend y backend:

```bash
npm run dev
```

En PowerShell de Windows, si aparece bloqueo de `npm.ps1`, usa `npm.cmd`:

```powershell
npm.cmd run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:4000`

Usuarios demo despues del seed:

- `admin@localride.test`
- `pasajero@localride.test`
- `ana@localride.test`

Contrasena: `LocalRide123!`

## Mercado Pago

El `Access Token` queda solo en `backend` mediante `MP_ACCESS_TOKEN`. La app crea preferencias en:

```http
POST /api/payments/checkout-pro
```

El webhook recibe eventos en:

```http
POST /api/payments/webhooks/mercado-pago
```

Configura en Mercado Pago una URL publica HTTPS, por ejemplo:

```text
https://tudominio.com/api/payments/webhooks/mercado-pago?source_news=webhooks
```

## Referencias tecnicas

- Mercado Pago recomienda crear una preferencia por cada flujo de pago desde backend con Checkout Pro.
- Mercado Pago Webhooks notifican cambios por HTTP POST y esperan respuesta `200` o `201`.
- PostGIS `ST_DWithin` permite busquedas por radio usando indices espaciales.
- React Leaflet usa Leaflet para renderizar mapas y requiere altura definida del contenedor.
