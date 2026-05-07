import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Car, CreditCard, LayoutDashboard, LocateFixed, LogOut, MapPin, ShieldCheck, UserRound } from "lucide-react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:4000";
const defaultCenter = [
  Number(import.meta.env.VITE_DEFAULT_LAT || -38.9931),
  Number(import.meta.env.VITE_DEFAULT_LNG || -64.0942)
];
const serviceAreaViewbox = "-64.24,-38.88,-63.95,-39.10";
const OSRM_URL = import.meta.env.VITE_OSRM_URL || "https://router.project-osrm.org";
const BRAND_NAME = "Rio Movil";
const BRAND_LOGO = "/rio-movil-logo.png";
const LOCAL_POPULAR_PLACES = [
  {
    id: "la-anonima-rio-colorado",
    name: "La Anonima",
    label: "La Anonima - 9 de Julio 746 Rio Colorado",
    aliases: ["la anonima", "anonima", "anoni", "la anoni", "supermercado la anonima"],
    lat: -38.98832,
    lng: -64.09719
  },
  {
    id: "cooperativa-obrera-rio-colorado",
    name: "Cooperativa Obrera",
    label: "Cooperativa Obrera - Av. San Martin 879 Rio Colorado",
    aliases: ["cooperativa obrera", "coope", "cooperativa", "supermercado cooperativa"],
    lat: -38.99605,
    lng: -64.09215
  },
  {
    id: "supermercado-dragon-rio-colorado",
    name: "Supermercado Dragon",
    label: "Supermercado Dragon - Av. Berutti 451 Rio Colorado",
    aliases: ["supermercado dragon", "dragon", "super dragon"],
    lat: -38.98895,
    lng: -64.1002
  },
  {
    id: "despensa-teresita-rio-colorado",
    name: "Despensa Teresita",
    label: "Despensa Teresita - Av. San Martin Rio Colorado",
    aliases: ["despensa teresita", "teresita", "despensa"],
    lat: -38.9962,
    lng: -64.0952
  },
  {
    id: "casa-aznarez-rio-colorado",
    name: "Casa Aznarez",
    label: "Casa Aznarez - Hipolito Yrigoyen 176 Rio Colorado",
    aliases: ["casa aznarez", "aznarez", "ferreteria aznarez", "tienda aznarez"],
    lat: -38.9914,
    lng: -64.0964
  },
  {
    id: "plaza-san-martin-rio-colorado",
    name: "Plaza San Martin",
    label: "Plaza San Martin Rio Colorado",
    aliases: ["plaza san martin", "plaza principal", "plaza"],
    lat: defaultCenter[0],
    lng: defaultCenter[1]
  },
  {
    id: "terminal-rio-colorado",
    name: "Terminal",
    label: "Terminal de Omnibus Rio Colorado",
    aliases: ["terminal", "terminal omnibus", "terminal de omnibus"],
    lat: -38.9982,
    lng: -64.0858
  },
  {
    id: "hospital-rio-colorado",
    name: "Hospital",
    label: "Hospital Rio Colorado",
    aliases: ["hospital", "guardia", "salud"],
    lat: -38.9873,
    lng: -64.0893
  }
];
const pickupIcon = createMapIcon("A", "pickup");
const dropoffIcon = createMapIcon("B", "dropoff");
const driverIcon = createMapIcon("C", "driver");

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
  const initialPaymentRoute = getPaymentRoute();
  const [activeTab, setActiveTab] = useState(initialPaymentRoute ? "payments" : "ride");

  useEffect(() => {
    if (session) localStorage.setItem("localride-session", JSON.stringify(session));
    else localStorage.removeItem("localride-session");
  }, [session]);

  if (!session) return <AuthScreen onSession={setSession} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><img src={BRAND_LOGO} alt={BRAND_NAME} /><strong>{BRAND_NAME}</strong></div>
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
        {activeTab === "payments" && <PaymentsView session={session} initialStatus={initialPaymentRoute} />}
        {activeTab === "admin" && <AdminView session={session} />}
      </main>
    </div>
  );
}

function AuthScreen({ onSession }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("passenger");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState({ email: "", password: "" });

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
        <div className="brand auth-brand"><img src={BRAND_LOGO} alt={BRAND_NAME} /><strong>{BRAND_NAME}</strong></div>
        <h1>{mode === "login" ? "Entrar" : "Crear cuenta"}</h1>
        <form onSubmit={submit} className="form-grid one">
          {mode === "register" && <input name="name" placeholder="Nombre completo" required />}
          <input name="email" type="email" placeholder="Email" required value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} />
          <input name="password" type="password" placeholder="Contrasena" required value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
          {mode === "register" && <input name="phone" placeholder="Telefono" />}
          {mode === "register" && (
            <div className="segmented">
              <button type="button" className={role === "passenger" ? "selected" : ""} onClick={() => setRole("passenger")}>Pasajero</button>
              <button type="button" className={role === "driver" ? "selected" : ""} onClick={() => setRole("driver")}>Conductor</button>
            </div>
          )}
          {mode === "register" && role === "driver" && (
            <div className="driver-register-fields">
              <p className="eyebrow">Datos del vehiculo</p>
              <input name="vehicleMake" placeholder="Marca, ej. Fiat" required />
              <input name="vehicleModel" placeholder="Modelo, ej. Cronos" required />
              <input name="vehicleColor" placeholder="Color, ej. Gris" required />
              <input name="plate" placeholder="Patente, ej. AB314CD" required />
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
  const savedRidePoints = loadSavedRidePoints();
  const [pickup, setPickup] = useState(savedRidePoints?.pickup || { address: "Plaza principal", lat: defaultCenter[0], lng: defaultCenter[1] });
  const [dropoff, setDropoff] = useState(savedRidePoints?.dropoff || { address: "Terminal", lat: defaultCenter[0] + 0.012, lng: defaultCenter[1] + 0.012 });
  const [drivers, setDrivers] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [route, setRoute] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("mercado_pago");
  const [carType, setCarType] = useState("standard");
  const [message, setMessage] = useState("");
  const [estimateError, setEstimateError] = useState("");

  useEffect(() => {
    refreshNearby();
    refreshEstimate();
  }, []);

  useEffect(() => {
    if (savedRidePoints?.pickup) return;
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
    const nextRoute = await fetchRoute(nextPickup, nextDropoff);
    setRoute(nextRoute);
    setEstimateError("");
    try {
      const data = await api("/api/trips/estimate", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({
          pickup: nextPickup,
          dropoff: nextDropoff,
          route: nextRoute ? { distanceMeters: nextRoute.distanceMeters, durationSeconds: nextRoute.durationSeconds } : undefined
        })
      });
      setEstimate(data.estimate);
    } catch (err) {
      setEstimate(null);
      setEstimateError(err.message);
    }
  }

  function selectPickup(place) {
    const nextPickup = placeToPoint(place);
    setPickup(nextPickup);
    refreshNearbyAt(nextPickup);
    refreshEstimateFor(nextPickup, dropoff);
  }

  function selectDropoff(place) {
    const nextDropoff = placeToPoint(place);
    setDropoff(nextDropoff);
    refreshEstimateFor(pickup, nextDropoff);
  }

  async function createTrip(event) {
    event.preventDefault();
    setMessage("Creando viaje...");

    try {
      const data = await api("/api/trips", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({
          pickup,
          dropoff,
          route: route ? { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds } : undefined,
          paymentMethod
        })
      });
      localStorage.setItem("localride-last-trip-id", data.trip.id);
      localStorage.setItem("localride-last-ride-points", JSON.stringify({ pickup, dropoff }));

      if (paymentMethod !== "mercado_pago") {
        setMessage(`Viaje creado: ${tripStatusLabel(data.trip.status)}. Pago en efectivo al conductor.`);
        goTrack();
        return;
      }

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
        <RealMap
          pickup={pickup}
          dropoff={dropoff}
          route={route}
          drivers={drivers}
          onPickup={(point) => { setPickup(point); refreshNearbyAt(point); refreshEstimateFor(point, dropoff); }}
          onDropoff={(point) => { setDropoff(point); refreshEstimateFor(pickup, point); }}
        />
      </div>
      <div className="panel">
        <p className="eyebrow">Nuevo viaje</p>
        <h2>Pedir coche</h2>
        <form className="form-grid one" onSubmit={createTrip}>
          <AddressSearch label="Origen" value={pickup.address} onText={(address) => setPickup({ ...pickup, address })} onSelect={selectPickup} />
          <AddressSearch label="Destino" value={dropoff.address} onText={(address) => setDropoff({ ...dropoff, address })} onSelect={selectDropoff} />
          <label>
            Tipo de coche
            <select value={carType} onChange={(event) => setCarType(event.target.value)}>
              <option value="standard">Auto comun</option>
              <option value="comfort">Comfort</option>
              <option value="xl">Auto grande</option>
            </select>
          </label>
          <label>
            Forma de pago
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="mercado_pago">Mercado Pago</option>
              <option value="cash">Efectivo</option>
            </select>
          </label>
          <div className="fare-card">
            <span>Estimado</span>
            <strong>{estimate ? money(estimate.amount) : estimateError ? "Fuera de zona" : "Calculando..."}</strong>
            <small>
              {estimate
                ? `${Math.round(estimate.distanceMeters / 100) / 10} km por calles${estimate.amount === estimate.minimumFare ? " · tarifa minima" : ""}`
                : estimateError || "Calculando ruta"}
            </small>
          </div>
          <button type="button" className="secondary" onClick={() => { refreshNearby(); refreshEstimate(); }}>Recalcular</button>
          <button className="primary" disabled={Boolean(estimateError)}>{paymentMethod === "mercado_pago" ? "Confirmar y pagar con Mercado Pago" : "Confirmar viaje"}</button>
          {message && <p className="ok">{message}</p>}
        </form>
      </div>
    </section>
  );
}

function AddressSearch({ label, value, onText, onSelect }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (value.trim().length < 3) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const localResults = searchLocalPopularPlaces(value);
      setResults(localResults);
      setLoading(localResults.length === 0);
      try {
        const nextResults = await searchRioColorado(value, localResults);
        if (requestIdRef.current === requestId) setResults(nextResults);
      } catch {
        if (requestIdRef.current === requestId && localResults.length === 0) setResults([]);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [value]);

  return (
    <label className="address-field">
      {label}
      <div className="address-input-wrap">
        <input
          value={value}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Delete" && value) {
              event.preventDefault();
              setResults([]);
              onText("");
            }
          }}
          placeholder={`Buscar ${label.toLowerCase()} en Rio Colorado o La Adela`}
        />
        {value && <button type="button" className="clear-input" aria-label={`Borrar ${label.toLowerCase()}`} onClick={() => { setResults([]); onText(""); }}>x</button>}
      </div>
      {(results.length > 0 || loading) && (
        <div className="suggestions">
          {loading && <span>Buscando calles...</span>}
          {results.map((place) => (
            <button key={place.place_id} type="button" onClick={() => { onSelect(place); setResults([]); }}>
              {displayAddress(place)}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

function RealMap({ pickup, dropoff, route, drivers, onPickup, onDropoff }) {
  function MapClicks() {
    useMapEvents({
      click(event) {
        onDropoff({ ...dropoff, address: "Destino seleccionado en mapa", lat: event.latlng.lat, lng: event.latlng.lng });
      },
      contextmenu(event) {
        onPickup({ ...pickup, address: "Origen seleccionado en mapa", lat: event.latlng.lat, lng: event.latlng.lng });
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
      <FitRoute pickup={pickup} dropoff={dropoff} route={route} />
      <Marker icon={pickupIcon} position={[pickup.lat, pickup.lng]}><Popup>Origen</Popup></Marker>
      <Marker icon={dropoffIcon} position={[dropoff.lat, dropoff.lng]}><Popup>Destino</Popup></Marker>
      {route?.coordinates?.length > 0 && <Polyline pathOptions={{ color: "#0e7c66", weight: 5, opacity: 0.88 }} positions={route.coordinates} />}
      {drivers.map((driver) => (
        <Marker icon={driverIcon} key={driver.id} position={[Number(driver.lat), Number(driver.lng)]}>
          <Popup>{driver.name} - {vehicleLabel(driver)}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function FitRoute({ pickup, dropoff, route }) {
  const map = useMap();

  useEffect(() => {
    const points = route?.coordinates?.length ? route.coordinates : [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]];
    map.fitBounds(points, { padding: [38, 38], maxZoom: 15 });
  }, [map, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng, route]);

  return null;
}

function TrackView({ session }) {
  const [trip, setTrip] = useState(null);
  const [history, setHistory] = useState([]);
  const [location, setLocation] = useState(null);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [lastCompletedTrip, setLastCompletedTrip] = useState(null);

  useEffect(() => {
    async function loadTrip() {
      setError("");
      try {
        const data = await api("/api/trips/active", { token: session.token });
        api("/api/trips", { token: session.token }).then((historyData) => setHistory(historyData.trips || [])).catch(() => {});
        if (data.trip) {
          if (data.trip.status === "completed") {
            setLastCompletedTrip(data.trip);
            setTrip(null);
          } else {
            setTrip(data.trip);
          }
          return;
        }

        const lastTripId = session.user.role === "passenger" ? localStorage.getItem("localride-last-trip-id") : "";
        if (lastTripId) {
          const fallback = await api(`/api/trips/${lastTripId}`, { token: session.token });
          if (fallback.trip?.status === "completed") {
            setLastCompletedTrip(fallback.trip);
            setTrip(null);
          } else {
            setTrip(fallback.trip);
          }
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
      if (data.type === "trip.updated") {
        if (data.trip?.status === "completed") {
          setLastCompletedTrip(data.trip);
          setTrip(null);
          localStorage.setItem("localride-last-completed-trip-id", data.trip.id);
        } else {
          setTrip(data.trip);
        }
      }
      if (data.type === "driver.location") setLocation(data.location);
    };
    return () => ws.close();
  }, [trip?.id, session.token]);

  async function updateStatus(status) {
    setActionMessage("");
    try {
      const data = await api(`/api/trips/${trip.id}/status`, {
        method: "PATCH",
        token: session.token,
        body: JSON.stringify({ status })
      });
      setTrip(data.trip);
      if (status === "completed") {
        setLastCompletedTrip(data.trip);
        setTrip(null);
        localStorage.setItem("localride-last-completed-trip-id", data.trip.id);
      }
    } catch (err) {
      setActionMessage(err.message);
    }
  }

  async function openCheckout() {
    setCheckoutLoading(true);
    setActionMessage("");
    try {
      const preference = await api("/api/payments/checkout-pro", {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ tripId: trip.id })
      });
      const checkoutUrl = preference.initPoint || preference.sandboxInitPoint;
      if (!checkoutUrl) throw new Error("Mercado Pago no devolvio URL de checkout");
      window.location.href = checkoutUrl;
    } catch (err) {
      setActionMessage(err.message);
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (!trip) {
    return (
      <section className="grid two">
        {lastCompletedTrip ? (
          <CompletedTripCard session={session} trip={lastCompletedTrip} onRated={setLastCompletedTrip} />
        ) : (
          <EmptyState title="Sin viaje activo" text={error || "Crea un pedido para ver seguimiento en vivo."} />
        )}
        {session.user.role === "driver" && <DriverRequestsPanel session={session} onAccepted={setTrip} />}
        <TripHistory trips={history} />
      </section>
    );
  }

  return (
    <section className="grid two">
      <div className="panel">
        <p className="eyebrow">Seguimiento</p>
        <h2>{tripStatusLabel(trip.status)}</h2>
        <div className="status-list">
          {["requested", "accepted", "driver_arriving", "in_progress", "completed"].map((status) => (
            <span key={status} className={trip.status === status ? "current" : ""}>{tripStatusLabel(status)}</span>
          ))}
        </div>
        {session.user.role === "driver" ? (
          <div className="actions">
            <button className="secondary" onClick={() => updateStatus("driver_arriving")}>En camino</button>
            <button className="secondary" onClick={() => updateStatus("in_progress")}>Iniciar</button>
            <button className="primary" onClick={() => updateStatus("completed")}>Finalizar</button>
          </div>
        ) : trip.payment_method === "cash" ? (
          <div className="actions">
            <span className="cash-badge">Pago en efectivo al conductor</span>
            <button className="secondary" onClick={() => updateStatus("cancelled")}>Cancelar viaje</button>
          </div>
        ) : (
          <div className="actions">
            <button className="primary" disabled={checkoutLoading} onClick={openCheckout}>
              {checkoutLoading ? "Abriendo pago..." : "Pagar con Mercado Pago"}
            </button>
            <button className="secondary" onClick={() => updateStatus("cancelled")}>Cancelar viaje</button>
          </div>
        )}
        {actionMessage && <p className="error">{actionMessage}</p>}
      </div>
      <div className="panel">
        <p className="eyebrow">Detalle</p>
        <h2>{money(trip.fare_amount)}</h2>
        <dl className="receipt">
          <dt>Origen</dt><dd>{trip.pickup_address}</dd>
          <dt>Destino</dt><dd>{trip.dropoff_address}</dd>
          <dt>Distancia</dt><dd>{Math.round(trip.distance_meters / 100) / 10} km</dd>
          <dt>Pago</dt><dd>{paymentMethodLabel(trip.payment_method)}</dd>
          {trip.driver_name && (
            <>
              <dt>Conductor</dt><dd>{trip.driver_name}</dd>
              <dt>Vehiculo</dt><dd>{vehicleLabel(trip)}</dd>
              <dt>Patente</dt><dd>{trip.plate}</dd>
            </>
          )}
          <dt>Ubicacion conductor</dt><dd>{location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : "Esperando"}</dd>
        </dl>
      </div>
      <TripHistory trips={history} />
    </section>
  );
}

function CompletedTripCard({ session, trip, onRated }) {
  const [rating, setRating] = useState(trip.passenger_rating || 5);
  const [comment, setComment] = useState(trip.passenger_rating_comment || "");
  const [message, setMessage] = useState("");

  async function submitRating(event) {
    event.preventDefault();
    try {
      const data = await api(`/api/trips/${trip.id}/rating`, {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ rating, comment })
      });
      onRated(data.trip);
      setMessage("Gracias por calificar el viaje.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="panel complete-card">
      <p className="eyebrow">Viaje cerrado</p>
      <h2>Viaje finalizado</h2>
      <dl className="receipt">
        <dt>Origen</dt><dd>{trip.pickup_address}</dd>
        <dt>Destino</dt><dd>{trip.dropoff_address}</dd>
        <dt>Total</dt><dd>{money(trip.fare_amount)}</dd>
      </dl>
      {session.user.role === "passenger" && (
        <form className="form-grid one" onSubmit={submitRating}>
          <label>
            Calificacion al chofer
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              <option value={5}>5 - Excelente</option>
              <option value={4}>4 - Muy bueno</option>
              <option value={3}>3 - Bueno</option>
              <option value={2}>2 - Regular</option>
              <option value={1}>1 - Malo</option>
            </select>
          </label>
          <label>Comentario<input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Opcional" /></label>
          <button className="primary">Enviar calificacion</button>
        </form>
      )}
      {session.user.role === "driver" && <p className="ok">El viaje fue cerrado correctamente.</p>}
      {message && <p className={message.includes("Gracias") ? "ok" : "error"}>{message}</p>}
    </section>
  );
}

function DriverRequestsPanel({ session, onAccepted }) {
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const seenRequestIds = useRef(new Set());
  const didInitialLoad = useRef(false);

  useEffect(() => {
    loadRequests();
    const timer = setInterval(loadRequests, 5000);
    return () => clearInterval(timer);
  }, []);

  async function loadRequests() {
    try {
      const data = await api("/api/trips/driver/requests", { token: session.token });
      const nextRequests = data.trips || [];
      notifyForNewRequests(nextRequests, seenRequestIds, didInitialLoad, soundEnabledRef);
      setRequests(nextRequests);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function enableSound() {
    playNotificationSound();
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    setMessage("Sonido de pedidos activado.");
  }

  async function acceptRequest(tripId) {
    try {
      const data = await api(`/api/trips/${tripId}/accept`, {
        method: "POST",
        token: session.token
      });
      setMessage("Pedido aceptado.");
      setRequests((current) => current.filter((trip) => trip.id !== tripId));
      onAccepted(data.trip);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function rejectRequest(tripId) {
    try {
      await api(`/api/trips/${tripId}/reject`, {
        method: "POST",
        token: session.token
      });
      setRequests((current) => current.filter((trip) => trip.id !== tripId));
      setMessage("Pedido rechazado.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="panel history-panel">
      <div className="section-row">
        <div>
          <p className="eyebrow">Pedidos</p>
          <h2>Solicitudes pendientes</h2>
        </div>
        <div className="mini-actions">
          <button className="secondary" onClick={enableSound}>{soundEnabled ? "Sonido activo" : "Activar sonido"}</button>
          <button className="secondary" onClick={loadRequests}>Actualizar</button>
        </div>
      </div>
      {message && <p className={message.includes("aceptado") ? "ok" : "error"}>{message}</p>}
      <div className="request-box">
        {requests.length === 0 && <span>No hay pedidos pendientes.</span>}
        {requests.map((request) => (
          <DriverRequestCard key={request.id} request={request} onAccept={acceptRequest} onReject={rejectRequest} />
        ))}
      </div>
    </section>
  );
}

function DriverRequestCard({ request, onAccept, onReject }) {
  return (
    <article className="driver-request-card new-request">
      <div className="request-card-head">
        <div>
          <p className="eyebrow">Nuevo pedido</p>
          <strong>{money(request.fare_amount)}</strong>
        </div>
        <span>{paymentMethodLabel(request.payment_method)}</span>
      </div>
      <dl className="request-details">
        <dt>Origen</dt><dd>{request.pickup_address}</dd>
        <dt>Destino</dt><dd>{request.dropoff_address}</dd>
        <dt>Viaje</dt><dd>{formatKm(request.distance_meters)}</dd>
        <dt>Hasta pasajero</dt><dd>{request.distance_to_pickup_meters ? formatKm(request.distance_to_pickup_meters) : "Sin ubicacion"}</dd>
      </dl>
      <div className="request-card-foot">
        <span>{formatDateTime(request.created_at)}</span>
        <div className="actions">
          <button className="secondary" onClick={() => onReject(request.id)}>Rechazar</button>
          <button className="primary" onClick={() => onAccept(request.id)}>Aceptar</button>
        </div>
      </div>
    </article>
  );
}

function TripHistory({ trips }) {
  return (
    <div className="panel history-panel">
      <p className="eyebrow">Historial</p>
      <h2>Viajes recientes</h2>
      <div className="history-list">
        {trips.length === 0 && <p>No hay viajes registrados.</p>}
        {trips.map((trip) => (
          <article key={trip.id} className="history-item">
            <div>
              <strong>{trip.pickup_address} a {trip.dropoff_address}</strong>
              <span>{tripStatusLabel(trip.status)} · {paymentMethodLabel(trip.payment_method)}{trip.passenger_rating ? ` · ${trip.passenger_rating} estrellas` : ""}</span>
            </div>
            <div>
              <strong>{money(trip.fare_amount)}</strong>
              <span>{Math.round(trip.distance_meters / 100) / 10} km</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DriverView({ session }) {
  const [online, setOnline] = useState(false);
  const [trip, setTrip] = useState(null);
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const soundEnabledRef = useRef(false);
  const seenRequestIds = useRef(new Set());
  const didInitialLoad = useRef(false);
  const disabled = session.user.role !== "driver";

  useEffect(() => {
    if (!disabled) {
      loadDriverTrip();
      loadRequests();
      const timer = setInterval(loadRequests, 5000);
      return () => clearInterval(timer);
    }
  }, [disabled]);

  async function updateAvailability(next) {
    setOnline(next);
    const position = await getBrowserPosition();
    try {
      await api("/api/drivers/me/availability", {
        method: "PATCH",
        token: session.token,
        body: JSON.stringify({ online: next, lat: position.lat, lng: position.lng })
      });
      setMessage(next ? "Conductor online." : "Conductor fuera de linea.");
      await loadDriverTrip();
      await loadRequests();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadDriverTrip() {
    try {
      const data = await api("/api/trips/active", { token: session.token });
      setTrip(data.trip);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadRequests() {
    try {
      const data = await api("/api/trips/driver/requests", { token: session.token });
      const nextRequests = data.trips || [];
      notifyForNewRequests(nextRequests, seenRequestIds, didInitialLoad, soundEnabledRef);
      setRequests(nextRequests);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function enableSound() {
    playNotificationSound();
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    setMessage("Sonido de pedidos activado.");
  }

  async function acceptRequest(tripId) {
    try {
      const data = await api(`/api/trips/${tripId}/accept`, {
        method: "POST",
        token: session.token
      });
      setTrip(data.trip);
      setMessage("Pedido aceptado.");
      await loadRequests();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function rejectRequest(tripId) {
    try {
      await api(`/api/trips/${tripId}/reject`, {
        method: "POST",
        token: session.token
      });
      setRequests((current) => current.filter((request) => request.id !== tripId));
      setMessage("Pedido rechazado.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function sendLocation() {
    if (!trip) {
      setMessage("No hay viaje activo asignado.");
      return;
    }
    const position = await getBrowserPosition();
    try {
      await api(`/api/trips/${trip.id}/location`, {
        method: "POST",
        token: session.token,
        body: JSON.stringify({ lat: position.lat, lng: position.lng, speedKmh: 0 })
      });
      setMessage("Ubicacion enviada al pasajero.");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function updateDriverTripStatus(status) {
    if (!trip) {
      setMessage("No hay viaje activo asignado.");
      return;
    }
    try {
      const data = await api(`/api/trips/${trip.id}/status`, {
        method: "PATCH",
        token: session.token,
        body: JSON.stringify({ status })
      });
      setTrip(data.trip);
      if (status === "completed") {
        setTrip(null);
      }
      setMessage(`Viaje actualizado: ${tripStatusLabel(status)}.`);
    } catch (err) {
      setMessage(err.message);
    }
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
          <button className="secondary" onClick={loadDriverTrip}>Actualizar pedido</button>
          <button className="secondary" onClick={loadRequests}>Ver pedidos</button>
          <button className="secondary" onClick={enableSound}>{soundEnabled ? "Sonido activo" : "Activar sonido"}</button>
          <button className="secondary" onClick={sendLocation}>Enviar ubicacion</button>
          <p>La ubicacion se guarda en PostGIS y se usa para asignar viajes cercanos.</p>
          <div className="request-box">
            <strong>Pedidos disponibles</strong>
            {requests.length === 0 && <span>No hay pedidos pendientes.</span>}
            {requests.map((request) => (
              <DriverRequestCard key={request.id} request={request} onAccept={acceptRequest} onReject={rejectRequest} />
            ))}
          </div>
          {trip ? (
            <>
              <dl className="receipt">
                <dt>Viaje</dt><dd>{tripStatusLabel(trip.status)}</dd>
                <dt>Origen</dt><dd>{trip.pickup_address}</dd>
                <dt>Destino</dt><dd>{trip.dropoff_address}</dd>
                <dt>Total</dt><dd>{money(trip.fare_amount)}</dd>
              </dl>
              <div className="actions">
                <button className="secondary" onClick={() => updateDriverTripStatus("driver_arriving")}>En camino</button>
                <button className="secondary" onClick={() => updateDriverTripStatus("in_progress")}>Iniciar</button>
                <button className="primary" onClick={() => updateDriverTripStatus("completed")}>Finalizar</button>
              </div>
            </>
          ) : (
            <p>No hay viaje activo asignado.</p>
          )}
          {message && <p className={message.includes("No ") || message.includes("error") ? "error" : "ok"}>{message}</p>}
        </div>
      )}
    </section>
  );
}

function PaymentsView({ session, initialStatus }) {
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
      {initialStatus && <PaymentReturn status={initialStatus} />}
      <form className="form-grid one" onSubmit={createPreference}>
        <input value={tripId} onChange={(e) => setTripId(e.target.value)} placeholder="ID del viaje" />
        <button className="primary">Crear preferencia</button>
      </form>
      {result && <a className="pay-link" href={result.initPoint || result.sandboxInitPoint}>Abrir checkout</a>}
    </section>
  );
}

function PaymentReturn({ status }) {
  const copy = {
    success: ["Pago aprobado", "Mercado Pago confirmo el pago. El viaje queda listo para continuar."],
    failure: ["Pago rechazado", "Mercado Pago no pudo aprobar el pago. Podes volver a intentarlo."],
    pending: ["Pago pendiente", "El pago quedo pendiente de confirmacion."]
  }[status] || ["Pago", "Estado recibido desde Mercado Pago."];

  return (
    <div className={`payment-return ${status}`}>
      <strong>{copy[0]}</strong>
      <span>{copy[1]}</span>
    </div>
  );
}

function AdminView({ session }) {
  const [dashboard, setDashboard] = useState(null);
  const [users, setUsers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [fareRule, setFareRule] = useState(null);
  const [message, setMessage] = useState("");
  const [userActionMessage, setUserActionMessage] = useState("");
  const [driverDrafts, setDriverDrafts] = useState({});

  useEffect(() => {
    if (session.user.role === "admin") {
      loadAdminData();
    }
  }, [session]);

  async function loadAdminData() {
    setMessage("");
    try {
      const [dashboardData, usersData, tripsData, fareData] = await Promise.all([
        api("/api/admin/dashboard", { token: session.token }),
        api("/api/admin/users", { token: session.token }),
        api("/api/admin/trips", { token: session.token }),
        api("/api/admin/fare-rules", { token: session.token })
      ]);
      setDashboard(dashboardData);
      setUsers(usersData.users || []);
      setTrips(tripsData.trips || []);
      setFareRule(fareData.fareRule);
      setDriverDrafts((current) => {
        const next = { ...current };
        for (const user of usersData.users || []) {
          if (user.role !== "driver" || next[user.id]) continue;
          next[user.id] = {
            vehicleMake: user.vehicle_make || "",
            vehicleModel: user.vehicle_model || "",
            vehicleColor: user.vehicle_color || "",
            plate: user.plate || ""
          };
        }
        return next;
      });
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function saveFareRule(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      city: form.get("city"),
      baseFare: Number(form.get("baseFare")),
      minimumFare: Number(form.get("minimumFare")),
      pricePerKm: Number(form.get("pricePerKm")),
      pricePerMinute: Number(form.get("pricePerMinute")),
      platformFeePercent: Number(form.get("platformFeePercent")),
      cancellationGraceMinutes: Number(form.get("cancellationGraceMinutes"))
    };
    try {
      const data = await api("/api/admin/fare-rules", {
        method: "PUT",
        token: session.token,
        body: JSON.stringify(body)
      });
      setFareRule(data.fareRule);
      setMessage("Tarifas actualizadas.");
      await loadAdminData();
    } catch (err) {
      setMessage(err.message);
    }
  }

  function updateDriverDraft(userId, field, value) {
    setDriverDrafts((current) => ({
      ...current,
      [userId]: { ...(current[userId] || {}), [field]: value }
    }));
  }

  async function verifyDriver(userId, status) {
    setUserActionMessage("");
    try {
      await api(`/api/admin/drivers/${userId}/verification`, {
        method: "PATCH",
        token: session.token,
        body: JSON.stringify({ status, ...(driverDrafts[userId] || {}) })
      });
      setMessage(`Conductor ${verificationLabel(status).toLowerCase()}.`);
      await loadAdminData();
    } catch (err) {
      setUserActionMessage(err.message);
    }
  }

  if (session.user.role !== "admin") return <EmptyState title="Solo administradores" text="El panel controla tarifas, verificacion y auditoria." />;
  return (
    <section className="admin-stack">
      <div className="panel">
        <div className="section-row">
          <div>
            <p className="eyebrow">Operacion</p>
            <h2>Panel local</h2>
          </div>
          <button className="secondary" onClick={loadAdminData}>Actualizar</button>
        </div>
        <div className="metrics">
          {dashboard && Object.entries(dashboard.metrics).map(([key, value]) => (
            <div className="metric" key={key}><span>{adminMetricLabel(key)}</span><strong>{String(value)}</strong></div>
          ))}
        </div>
        {message && <p className="ok">{message}</p>}
      </div>

      <div className="grid two">
        <section className="panel">
          <p className="eyebrow">Tarifas</p>
          <h2>Reglas activas</h2>
          {fareRule && (
            <form className="form-grid one" onSubmit={saveFareRule}>
              <label>Localidad<input name="city" defaultValue={fareRule.city} /></label>
              <label>Tarifa base<input name="baseFare" type="number" defaultValue={fareRule.base_fare} /></label>
              <label>Tarifa minima<input name="minimumFare" type="number" defaultValue={fareRule.minimum_fare} /></label>
              <label>Precio por km<input name="pricePerKm" type="number" defaultValue={fareRule.price_per_km} /></label>
              <label>Precio por minuto<input name="pricePerMinute" type="number" defaultValue={fareRule.price_per_minute} /></label>
              <label>Comision plataforma %<input name="platformFeePercent" type="number" defaultValue={fareRule.platform_fee_percent} /></label>
              <label>Minutos gracia cancelacion<input name="cancellationGraceMinutes" type="number" defaultValue={fareRule.cancellation_grace_minutes} /></label>
              <button className="primary">Guardar tarifas</button>
            </form>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">Usuarios</p>
          <h2>Registrados</h2>
          {userActionMessage && <p className="error">{userActionMessage}</p>}
          <div className="admin-list">
            {users.map((user) => (
              <article className="admin-item" key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email} · {roleLabel(user.role)}</span>
                  {user.role === "driver" && <span>{adminVehicleLabel(user)} · {verificationLabel(user.verification_status)}</span>}
                  {user.role === "driver" && !hasVehicleProfile(user) && (
                    <div className="admin-vehicle-fields">
                      <input value={driverDrafts[user.id]?.vehicleMake || ""} onChange={(event) => updateDriverDraft(user.id, "vehicleMake", event.target.value)} placeholder="Marca" />
                      <input value={driverDrafts[user.id]?.vehicleModel || ""} onChange={(event) => updateDriverDraft(user.id, "vehicleModel", event.target.value)} placeholder="Modelo" />
                      <input value={driverDrafts[user.id]?.vehicleColor || ""} onChange={(event) => updateDriverDraft(user.id, "vehicleColor", event.target.value)} placeholder="Color" />
                      <input value={driverDrafts[user.id]?.plate || ""} onChange={(event) => updateDriverDraft(user.id, "plate", event.target.value)} placeholder="Patente" />
                    </div>
                  )}
                </div>
                {user.role === "driver" && (
                  <div className="mini-actions">
                    <span className={`verification-badge ${user.verification_status}`}>{verificationLabel(user.verification_status)}</span>
                    <button className="secondary" disabled={user.verification_status === "approved"} onClick={() => verifyDriver(user.id, "approved")}>Aprobar</button>
                    <button className="secondary" disabled={user.verification_status === "rejected"} onClick={() => verifyDriver(user.id, "rejected")}>Rechazar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Viajes</p>
        <h2>Ultimos pedidos</h2>
        <div className="admin-list">
          {trips.map((trip) => (
            <article className="admin-item" key={trip.id}>
              <div>
                <strong>{trip.pickup_address} a {trip.dropoff_address}</strong>
                <span>{tripStatusLabel(trip.status)} · {paymentMethodLabel(trip.payment_method)} · Pasajero: {trip.passenger_name}</span>
                <span>Conductor: {trip.driver_name || "Sin asignar"}</span>
                <span className={trip.passenger_rating ? "rating-line rated" : "rating-line"}>
                  Calificacion: {trip.passenger_rating ? `${"★".repeat(Number(trip.passenger_rating))} (${trip.passenger_rating}/5)` : "Sin calificar"}
                </span>
                {trip.passenger_rating_comment && <span>Comentario: {trip.passenger_rating_comment}</span>}
              </div>
              <div>
                <strong>{money(trip.fare_amount)}</strong>
                <span>{Math.round(trip.distance_meters / 100) / 10} km</span>
              </div>
            </article>
          ))}
        </div>
      </section>
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

function formatKm(meters) {
  return `${Math.round(Number(meters || 0) / 100) / 10} km`;
}

function createMapIcon(label, type) {
  return L.divIcon({
    className: `localride-marker ${type}`,
    html: `<span>${label}</span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 38],
    popupAnchor: [0, -36]
  });
}

function paymentMethodLabel(value) {
  return {
    mercado_pago: "Mercado Pago",
    cash: "Efectivo"
  }[value] || value;
}

function vehicleLabel(driver) {
  return [driver.vehicle_color, driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(" ") || "Vehiculo asignado";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function notifyForNewRequests(requests, seenRef, didInitialLoadRef, soundEnabledRef) {
  const currentIds = new Set(requests.map((request) => request.id));
  const hasNewRequest = [...currentIds].some((id) => !seenRef.current.has(id));

  if (didInitialLoadRef.current && hasNewRequest && soundEnabledRef.current) {
    playNotificationSound();
  }

  seenRef.current = currentIds;
  didInitialLoadRef.current = true;
}

function playNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.24, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
    gain.connect(context.destination);

    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.12);
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.12);
      oscillator.stop(context.currentTime + index * 0.12 + 0.18);
    });

    setTimeout(() => context.close(), 700);
  } catch {
    // El sonido es una mejora de UX; si el navegador lo bloquea, la app sigue funcionando.
  }
}

function roleLabel(value) {
  return {
    passenger: "Pasajero",
    driver: "Conductor",
    admin: "Administrador"
  }[value] || value;
}

function verificationLabel(value) {
  return {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado"
  }[value] || value;
}

function hasVehicleProfile(user) {
  return Boolean(user.vehicle_make && user.vehicle_model && user.vehicle_color && user.plate);
}

function adminVehicleLabel(user) {
  if (!hasVehicleProfile(user)) return "Datos del vehiculo incompletos";
  return `${user.vehicle_color} ${user.vehicle_make} ${user.vehicle_model} · ${user.plate}`;
}

function adminMetricLabel(value) {
  return {
    tripsToday: "Viajes hoy",
    revenue: "Facturacion",
    onlineDrivers: "Conductores online",
    pendingDriverVerifications: "Conductores pendientes"
  }[value] || value;
}

async function searchRioColorado(query, localPlaces = searchLocalPopularPlaces(query)) {
  const parsedAddress = parseStreetNumber(query);
  const searches = buildLocalSearches(query);

  const structuredSearches = parsedAddress ? [
    structuredAddressParams(parsedAddress, "Rio Colorado", "Rio Negro"),
    structuredAddressParams(parsedAddress, "La Adela", "La Pampa")
  ] : [];

  const resultSets = await Promise.allSettled([
    ...structuredSearches.map(searchAddress),
    ...searches.map(searchAddress),
    searchOverpassPlaces(query)
  ]);
  const byPlaceId = new Map();
  for (const place of localPlaces) {
    byPlaceId.set(place.place_id, place);
  }
  for (const place of resultSets.flatMap((result) => result.status === "fulfilled" ? result.value : [])) {
    const enhancedPlace = withTypedAddressLabel(place, query);
    byPlaceId.set(enhancedPlace.place_id || displayAddress(enhancedPlace), enhancedPlace);
  }
  return [...byPlaceId.values()].slice(0, 8);
}

function searchLocalPopularPlaces(query) {
  const normalizedQuery = normalizeText(query.trim());
  if (normalizedQuery.length < 3) return [];

  return LOCAL_POPULAR_PLACES
    .filter((place) => place.aliases.some((alias) => {
      const normalizedAlias = normalizeText(alias);
      return normalizedAlias.includes(normalizedQuery) || normalizedQuery.includes(normalizedAlias);
    }))
    .map((place) => ({
      place_id: `local-${place.id}`,
      lat: String(place.lat),
      lon: String(place.lng),
      localride_label: place.label,
      name: place.name,
      address: {
        amenity: place.name,
        town: "Rio Colorado"
      }
    }));
}

function buildLocalSearches(query) {
  const normalized = normalizeText(query);
  const searches = [
    `${query}, Rio Colorado, Rio Negro, Argentina`,
    `${query}, La Adela, La Pampa, Argentina`
  ];

  if (!parseStreetNumber(query) && !searchLocalPopularPlaces(query).length) {
    searches.unshift(query);
  }

  const popularCategory = popularPlaceCategory(normalized);
  if (popularCategory) {
    searches.push(
      `${popularCategory} Rio Colorado Rio Negro Argentina`,
      `${popularCategory} La Adela La Pampa Argentina`
    );
  }

  return [...new Set(searches)];
}

function popularPlaceCategory(normalizedQuery) {
  if (/(escuela|colegio|jardin|jardin de infantes|secundaria|primaria)/.test(normalizedQuery)) return "escuela";
  if (/(super|supermercado|anonima|cooperativa obrera|mercado|almacen|despensa|kiosco)/.test(normalizedQuery)) return "supermercado";
  if (/(hospital|clinica|sanatorio|salud|guardia)/.test(normalizedQuery)) return "hospital";
  if (/(municipalidad|comisaria|policia|banco|terminal|plaza|club|farmacia|tienda|negocio|ropa|ferreteria|panaderia|carniceria|libreria|veterinaria|heladeria|restaurant|restaurante|bar|cafe)/.test(normalizedQuery)) return normalizedQuery;
  return "";
}

async function searchOverpassPlaces(query) {
  const normalizedQuery = normalizeText(query.trim());
  if (normalizedQuery.length < 3 || parseStreetNumber(query) || searchLocalPopularPlaces(query).length) return [];

  const overpassQuery = `
    [out:json][timeout:8];
    (
      node["name"](-39.10,-64.24,-38.88,-63.95);
      way["name"](-39.10,-64.24,-38.88,-63.95);
      relation["name"](-39.10,-64.24,-38.88,-63.95);
    );
    out center tags 80;
  `;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: overpassQuery })
  });
  if (!response.ok) return [];

  const data = await response.json();
  return (data.elements || [])
    .filter((element) => isUsefulPlace(element.tags || {}))
    .map(overpassElementToPlace)
    .filter(Boolean)
    .filter((place) => matchesPlaceQuery(place, normalizedQuery))
    .slice(0, 8);
}

function isUsefulPlace(tags) {
  return Boolean(
    tags.shop ||
    tags.amenity ||
    tags.office ||
    tags.tourism ||
    tags.leisure ||
    tags.craft ||
    tags.brand ||
    tags.operator
  );
}

function overpassElementToPlace(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!lat || !lon || !tags.name) return null;

  const road = tags["addr:street"] || "";
  const houseNumber = tags["addr:housenumber"] || "";
  const city = tags["addr:city"] || "Rio Colorado / La Adela";
  return {
    place_id: `osm-${element.type}-${element.id}`,
    lat: String(lat),
    lon: String(lon),
    name: tags.name,
    localride_label: [tags.name, [road, houseNumber].filter(Boolean).join(" "), city].filter(Boolean).join(" "),
    address: {
      amenity: tags.amenity,
      shop: tags.shop,
      office: tags.office,
      tourism: tags.tourism,
      leisure: tags.leisure,
      road,
      house_number: houseNumber,
      town: city
    },
    tags
  };
}

function matchesPlaceQuery(place, normalizedQuery) {
  const tags = place.tags || {};
  const haystack = normalizeText([
    place.name,
    place.localride_label,
    tags.shop,
    tags.amenity,
    tags.office,
    tags.craft,
    tags.brand,
    tags.operator
  ].filter(Boolean).join(" "));
  const category = popularPlaceCategory(normalizedQuery);
  return haystack.includes(normalizedQuery) || (category && haystack.includes(normalizeText(category)));
}

function structuredAddressParams(parsedAddress, city, state) {
  return new URLSearchParams({
    street: `${parsedAddress.number} ${parsedAddress.street}`,
    city,
    state,
    country: "Argentina",
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    countrycodes: "ar",
    viewbox: serviceAreaViewbox,
    bounded: "1",
    limit: "5"
  });
}

async function searchAddress(input) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams({
    q: input,
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    countrycodes: "ar",
    viewbox: serviceAreaViewbox,
    bounded: "1",
    limit: "5"
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  if (!response.ok) throw new Error("No se pudo buscar la direccion");
  return response.json();
}

async function fetchRoute(pickup, dropoff) {
  const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "false"
  });

  try {
    const response = await fetch(`${OSRM_URL}/route/v1/driving/${coords}?${params.toString()}`);
    if (!response.ok) throw new Error("Ruta no disponible");
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error("Ruta no encontrada");
    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    };
  } catch {
    return null;
  }
}

function placeToPoint(place) {
  return {
    address: displayAddress(place),
    lat: Number(place.lat),
    lng: Number(place.lon)
  };
}

function displayAddress(place) {
  return place.localride_label || shortAddress(place);
}

function shortAddress(place) {
  const address = place.address || {};
  const placeName = place.name || place.namedetails?.name || address.amenity || address.shop || address.office || address.leisure || address.tourism || address.building;
  const street = address.road || address.pedestrian || address.footway || address.path;
  const city = address.town || address.city || address.village || "Rio Colorado / La Adela";
  if (placeName && normalizeText(placeName) !== normalizeText(street || "")) {
    const detail = [street, address.house_number].filter(Boolean).join(" ");
    return [placeName, detail, city].filter(Boolean).join(" ");
  }

  const parts = [
    street || placeName || address.name,
    address.house_number,
    address.suburb || address.neighbourhood,
    city
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : place.display_name;
}

function parseStreetNumber(value) {
  const match = value.trim().match(/^(.+?)\s+(\d+[a-zA-Z]?)$/);
  if (!match) return null;
  return { street: match[1].trim(), number: match[2].trim() };
}

function withTypedAddressLabel(place, query) {
  const parsedAddress = parseStreetNumber(query);
  const address = place.address || {};
  const road = address.road || address.pedestrian || address.name;
  if (!parsedAddress || address.house_number || !road) return place;

  const roadMatches = normalizeText(parsedAddress.street).includes(normalizeText(road)) || normalizeText(road).includes(normalizeText(parsedAddress.street));
  if (!roadMatches) return place;

  const city = address.town || address.city || address.village || "Rio Colorado / La Adela";
  return {
    ...place,
    localride_label: `${toTitleCase(parsedAddress.street)} ${parsedAddress.number} ${city}`
  };
}

function normalizeText(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toTitleCase(value) {
  return value.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function tripStatusLabel(status) {
  return {
    requested: "Solicitado",
    accepted: "Aceptado",
    driver_arriving: "Conductor en camino",
    in_progress: "Viaje iniciado",
    completed: "Finalizado",
    cancelled: "Cancelado"
  }[status] || status;
}

function getPaymentRoute() {
  const path = window.location.pathname;
  if (path.includes("/payments/success")) return "success";
  if (path.includes("/payments/failure")) return "failure";
  if (path.includes("/payments/pending")) return "pending";
  return "";
}

function loadSavedRidePoints() {
  try {
    const saved = JSON.parse(localStorage.getItem("localride-last-ride-points") || "null");
    if (!saved?.pickup?.lat || !saved?.pickup?.lng) return null;
    return saved;
  } catch {
    return null;
  }
}

createRoot(document.getElementById("root")).render(<App />);
