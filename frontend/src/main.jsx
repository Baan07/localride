import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Car, CreditCard, LayoutDashboard, LocateFixed, LogOut, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { MapContainer, Marker, Popup, TileLayer, Polyline, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";
const defaultCenter = [
  Number(import.meta.env.VITE_DEFAULT_LAT || -38.9931),
  Number(import.meta.env.VITE_DEFAULT_LNG || -64.0942)
];

function api(path, { token, ...options } = {}) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Error de API");
    return data;
  });
}

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("localride-session") || "null"));
  const [activeTab, setActiveTab] = useState("ride");

  useEffect(() => {
    if (session) localStorage.setItem("localride-session", JSON.stringify(session));
    else localStorage.removeItem("localride-session");
  }, [session]);

  if (!session) return <AuthScreen onSession={setSession} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>LR</span><strong>LocalRide</strong></div>
        <button className={activeTab === "ride" ? "active" : ""} onClick={() => setActiveTab("ride")}><Car size={18} /> Pedir</button>
        <button className={activeTab === "track" ? "active" : ""} onClick={() => setActiveTab("track")}><LocateFixed size={18} /> Seguimiento</button>
        <button className={activeTab === "driver" ? "active" : ""} onClick={() => setActiveTab("driver")}><UserRound size={18} /> Conductor</button>
        <button className={activeTab === "payments" ? "active" : ""} onClick={() => setActiveTab("payments")}><CreditCard size={18} /> Pagos</button>
        <button className={activeTab === "admin" ? "active" : ""} onClick={() => setActiveTab("admin")}><LayoutDashboard size={18} /> Admin</button>
        <button className="logout" onClick={() => setSession(null)}><LogOut size={18} /> Salir</button>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Sesion activa</p>
            <h1>{session.user.name}</h1>
          </div>
          <span className="role"><ShieldCheck size={16} /> {session.user.role}</span>
        </header>
        {activeTab === "ride" && <RideView session={session} goTrack={() => setActiveTab("track")} />}
        {activeTab === "track" && <TrackView session={session} />}
        {activeTab === "driver" && <DriverView session={session} />}
        {activeTab === "payments" && <PaymentsView session={session} />}
        {activeTab === "admin" && <AdminView session={session} />}
      </main>
    </div>
  );
}

function AuthScreen({ onSession }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("passenger");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    if (mode === "register") body.role = role;

    try {
      const data = await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      onSession(data);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="brand auth-brand"><span>LR</span><strong>LocalRide</strong></div>
        <h1>{mode === "login" ? "Entrar" : "Crear cuenta"}</h1>
        <form onSubmit={submit} className="form-grid one">
          {mode === "register" && <input name="name" placeholder="Nombre completo" required />}
          <input name="email" type="email" placeholder="Email" required defaultValue="pasajero@localride.test" />
          <input name="password" type="password" placeholder="Contrasena" required defaultValue="LocalRide123!" />
          {mode === "register" && <input name="phone" placeholder="Telefono" />}
          {mode === "register" && (
            <div className="segmented">
              <button type="button" className={role === "passenger" ? "selected" : ""} onClick={() => setRole("passenger")}>Pasajero</button>
              <button type="button" className={role === "driver" ? "selected" : ""} onClick={() => setRole("driver")}>Conductor</button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <button className="primary">Continuar</button>
        </form>
        <button className="link-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Crear una cuenta nueva" : "Ya tengo cuenta"}
        </button>
      </section>
    </main>
  );
}

function RideView({ session, goTrack }) {
  const [pickup, setPickup] = useState({ address: "Plaza principal", lat: defaultCenter[0], lng: defaultCenter[1] });
  const [dropoff, setDropoff] = useState({ address: "Terminal", lat: defaultCenter[0] + 0.012, lng: defaultCenter[1] + 0.012 });
  const [drivers, setDrivers] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    refreshNearby();
    refreshEstimate();
  }, []);

  useEffect(() => {
    getBrowserPosition().then((position) => {
      const nextPickup = { ...pickup, lat: position.lat, lng: position.lng };
      const nextDropoff = { ...dropoff, lat: position.lat + 0.012, lng: position.lng + 0.012 };
      setPickup(nextPickup);
      setDropoff(nextDropoff);
      refreshNearbyAt(nextPickup);
      refreshEstimateFor(nextPickup, nextDropoff);
    });
  }, []);

  async function refreshNearby() {
    return refreshNearbyAt(pickup);
  }

  async function refreshNearbyAt(point) {
    const data = await api(`/api/drivers/nearby?lat=${point.lat}&lng=${point.lng}&radiusMeters=10000`, { token: session.token });
    setDrivers(data.drivers);
  }

  async function refreshEstimate() {
    return refreshEstimateFor(pickup, dropoff);
  }

  async function refreshEstimateFor(nextPickup, nextDropoff) {
    const data = await api("/api/trips/estimate", {
      method: "POST",
      token: session.token,
      body: JSON.stringify({ pickup: nextPickup, dropoff: nextDropoff })
    });
    setEstimate(data.estimate);
  }

  async function createTrip(event) {
    event.preventDefault();
    setMessage("Creando viaje...");

    try {
      const data = await api("/api/trips", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ pickup, dropoff, paymentMethod: "mercado_pago" })
      });
      localStorage.setItem("localride-last-trip-id", data.trip.id);

      try {
        const preference = await api("/api/payments/checkout-pro", {
          method: "POST",
          token: session.token,
          body: JSON.stringify({ tripId: data.trip.id })
        });
        const checkoutUrl = preference.initPoint || preference.sandboxInitPoint;
        if (checkoutUrl) window.location.href = checkoutUrl;
        else setMessage(`Viaje creado: ${data.trip.status}. Checkout sin URL disponible.`);
      } catch (paymentError) {
        setMessage(`Viaje creado: ${data.trip.status}. Mercado Pago: ${paymentError.message}`);
        goTrack();
      }
    } catch (tripError) {
      setMessage(tripError.message);
    }
  }

  return (
    <section className="grid two">
      <div className="panel map-panel">
        <RealMap pickup={pickup} dropoff={dropoff} drivers={drivers} onPickup={setPickup} onDropoff={setDropoff} />
      </div>
      <div className="panel">
        <p className="eyebrow">Nuevo viaje</p>
        <h2>Pedir coche</h2>
        <form className="form-grid one" onSubmit={createTrip}>
          <label>Origen<input value={pickup.address} onChange={(e) => setPickup({ ...pickup, address: e.target.value })} /></label>
          <label>Destino<input value={dropoff.address} onChange={(e) => setDropoff({ ...dropoff, address: e.target.value })} /></label>
          <div className="fare-card">
            <span>Estimado</span>
            <strong>{estimate ? money(estimate.amount) : "Calculando..."}</strong>
            <small>{estimate ? `${Math.round(estimate.distanceMeters / 100) / 10} km` : "PostGIS"}</small>
          </div>
          <button type="button" className="secondary" onClick={() => { refreshNearby(); refreshEstimate(); }}>Recalcular</button>
          <button className="primary">Confirmar y pagar con Mercado Pago</button>
          {message && <p className="ok">{message}</p>}
        </form>
      </div>
    </section>
  );
}

function RealMap({ pickup, dropoff, drivers, onPickup, onDropoff }) {
  function MapClicks() {
    useMapEvents({
      click(event) {
        onDropoff({ ...dropoff, lat: event.latlng.lat, lng: event.latlng.lng });
      },
      contextmenu(event) {
        onPickup({ ...pickup, lat: event.latlng.lat, lng: event.latlng.lng });
      }
    });
    return null;
  }

  return (
    <MapContainer center={[pickup.lat, pickup.lng]} zoom={13} className="leaflet-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapClicks />
      <Marker position={[pickup.lat, pickup.lng]}><Popup>Origen</Popup></Marker>
      <Marker position={[dropoff.lat, dropoff.lng]}><Popup>Destino</Popup></Marker>
      <Polyline positions={[[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]} />
      {drivers.map((driver) => (
        <Marker key={driver.id} position={[Number(driver.lat), Number(driver.lng)]}>
          <Popup>{driver.name} - {driver.vehicle_model}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function TrackView({ session }) {
  const [trip, setTrip] = useState(null);
  const [location, setLocation] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTrip() {
      setError("");
      try {
        const data = await api("/api/trips/active", { token: session.token });
        if (data.trip) {
          setTrip(data.trip);
          return;
        }

        const lastTripId = localStorage.getItem("localride-last-trip-id");
        if (lastTripId) {
          const fallback = await api(`/api/trips/${lastTripId}`, { token: session.token });
          setTrip(fallback.trip);
          return;
        }

        setTrip(null);
      } catch (err) {
        setError(err.message);
      }
    }

    loadTrip();
  }, [session.token]);

  useEffect(() => {
    if (!trip) return;
    const ws = new WebSocket(`${WS_URL}/ws?token=${session.token}&tripId=${trip.id}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "trip.updated") setTrip(data.trip);
      if (data.type === "driver.location") setLocation(data.location);
    };
    return () => ws.close();
  }, [trip?.id, session.token]);

  async function updateStatus(status) {
    const data = await api(`/api/trips/${trip.id}/status`, {
      method: "PATCH",
      token: session.token,
      body: JSON.stringify({ status })
    });
    setTrip(data.trip);
  }

  if (!trip) return <EmptyState title="Sin viaje activo" text={error || "Crea un pedido para ver seguimiento en vivo."} />;

  return (
    <section className="grid two">
      <div className="panel">
        <p className="eyebrow">Seguimiento</p>
        <h2>{trip.status}</h2>
        <div className="status-list">
          {["requested", "accepted", "driver_arriving", "in_progress", "completed"].map((status) => (
            <span key={status} className={trip.status === status ? "current" : ""}>{status}</span>
          ))}
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => updateStatus("driver_arriving")}>En camino</button>
          <button className="secondary" onClick={() => updateStatus("in_progress")}>Iniciar</button>
          <button className="primary" onClick={() => updateStatus("completed")}>Finalizar</button>
        </div>
      </div>
      <div className="panel">
        <p className="eyebrow">Detalle</p>
        <h2>{money(trip.fare_amount)}</h2>
        <dl className="receipt">
          <dt>Origen</dt><dd>{trip.pickup_address}</dd>
          <dt>Destino</dt><dd>{trip.dropoff_address}</dd>
          <dt>Distancia</dt><dd>{Math.round(trip.distance_meters / 100) / 10} km</dd>
          <dt>Ubicacion conductor</dt><dd>{location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : "Esperando"}</dd>
        </dl>
      </div>
    </section>
  );
}

function DriverView({ session }) {
  const [online, setOnline] = useState(false);
  const disabled = session.user.role !== "driver";

  async function updateAvailability(next) {
    setOnline(next);
    const position = await getBrowserPosition();
    await api("/api/drivers/me/availability", {
      method: "PATCH",
      token: session.token,
      body: JSON.stringify({ online: next, lat: position.lat, lng: position.lng })
    });
  }

  return (
    <section className="panel">
      <p className="eyebrow">Conductores</p>
      <h2>Disponibilidad y verificacion</h2>
      {disabled ? <p>Tu usuario no tiene rol conductor.</p> : (
        <div className="driver-toggle">
          <button className={online ? "primary" : "secondary"} onClick={() => updateAvailability(!online)}>
            {online ? "Salir de linea" : "Ponerme online"}
          </button>
          <p>La ubicacion se guarda en PostGIS y se usa para asignar viajes cercanos.</p>
        </div>
      )}
    </section>
  );
}

function PaymentsView({ session }) {
  const [tripId, setTripId] = useState("");
  const [result, setResult] = useState(null);

  async function createPreference(event) {
    event.preventDefault();
    const data = await api("/api/payments/checkout-pro", {
      method: "POST",
      token: session.token,
      body: JSON.stringify({ tripId })
    });
    setResult(data);
  }

  return (
    <section className="panel">
      <p className="eyebrow">Mercado Pago</p>
      <h2>Checkout Pro</h2>
      <form className="form-grid one" onSubmit={createPreference}>
        <input value={tripId} onChange={(e) => setTripId(e.target.value)} placeholder="ID del viaje" />
        <button className="primary">Crear preferencia</button>
      </form>
      {result && <a className="pay-link" href={result.initPoint || result.sandboxInitPoint}>Abrir checkout</a>}
    </section>
  );
}

function AdminView({ session }) {
  const [dashboard, setDashboard] = useState(null);
  useEffect(() => {
    if (session.user.role === "admin") {
      api("/api/admin/dashboard", { token: session.token }).then(setDashboard);
    }
  }, [session]);

  if (session.user.role !== "admin") return <EmptyState title="Solo administradores" text="El panel controla tarifas, verificacion y auditoria." />;
  return (
    <section className="panel">
      <p className="eyebrow">Operacion</p>
      <h2>Panel local</h2>
      <div className="metrics">
        {dashboard && Object.entries(dashboard.metrics).map(([key, value]) => (
          <div className="metric" key={key}><span>{key}</span><strong>{String(value)}</strong></div>
        ))}
      </div>
    </section>
  );
}

function EmptyState({ title, text }) {
  return <section className="panel empty"><MapPin size={32} /><h2>{title}</h2><p>{text}</p></section>;
}

async function getBrowserPosition() {
  if (!navigator.geolocation) return { lat: defaultCenter[0], lng: defaultCenter[1] };
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: defaultCenter[0], lng: defaultCenter[1] }),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  });
}

function money(value) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0));
}

createRoot(document.getElementById("root")).render(<App />);
