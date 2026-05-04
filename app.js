const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0
});

const defaultDrivers = [
  { id: 1, name: "Ana Ruiz", car: "Fiat Cronos", plate: "AB 314 CD", rating: 4.9, eta: 4, zone: "Centro", online: true },
  { id: 2, name: "Marcos Vega", car: "Toyota Etios", plate: "AC 811 QF", rating: 4.8, eta: 6, zone: "Norte", online: true },
  { id: 3, name: "Lucia Torres", car: "Renault Logan", plate: "AD 092 JK", rating: 4.7, eta: 8, zone: "Terminal", online: true },
  { id: 4, name: "Pablo Diaz", car: "Chevrolet Spin", plate: "AE 447 LM", rating: 4.9, eta: 10, zone: "Sur", online: false }
];

const defaultState = {
  city: "Mi localidad",
  fare: { base: 900, km: 420, wait: 3, fee: 12 },
  drivers: defaultDrivers,
  activeTrip: null,
  payments: [
    { id: "MP-DEMO-001", label: "Viaje Centro - Terminal", amount: 2840, status: "Aprobado" },
    { id: "CASH-002", label: "Viaje Barrio Norte", amount: 2100, status: "Efectivo" }
  ],
  trips: 12,
  revenue: 32800,
  rating: 4.86
};

const state = loadState();
let tripTimer = null;

const els = {
  cityName: document.querySelector("#cityName"),
  serviceStatus: document.querySelector("#serviceStatus"),
  mapGrid: document.querySelector("#mapGrid"),
  mapTitle: document.querySelector("#mapTitle"),
  mapSubtitle: document.querySelector("#mapSubtitle"),
  pickup: document.querySelector("#pickup"),
  dropoff: document.querySelector("#dropoff"),
  carType: document.querySelector("#carType"),
  passengers: document.querySelector("#passengers"),
  paymentMethod: document.querySelector("#paymentMethod"),
  fareEstimate: document.querySelector("#fareEstimate"),
  distanceEstimate: document.querySelector("#distanceEstimate"),
  surgeEstimate: document.querySelector("#surgeEstimate"),
  driverList: document.querySelector("#driverList"),
  requestFeed: document.querySelector("#requestFeed"),
  tripStatusTitle: document.querySelector("#tripStatusTitle"),
  tripCode: document.querySelector("#tripCode"),
  routeTimeline: document.querySelector("#routeTimeline"),
  tripProgress: document.querySelector("#tripProgress"),
  receipt: document.querySelector("#receipt"),
  paymentList: document.querySelector("#paymentList"),
  metrics: document.querySelector("#metrics"),
  toast: document.querySelector("#toast")
};

const tripSteps = [
  "Pedido confirmado",
  "Conductor asignado",
  "Conductor en camino",
  "Pasajero a bordo",
  "Viaje finalizado"
];

init();

function init() {
  renderAll();
  bindNavigation();
  bindForms();
  drawMap();
  restoreTripTimer();
}

function loadState() {
  const raw = localStorage.getItem("localride-state");
  if (!raw) return structuredClone(defaultState);

  try {
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem("localride-state", JSON.stringify(state));
}

function renderAll() {
  els.cityName.textContent = state.city;
  renderDrivers();
  renderRequestFeed();
  renderTrip();
  renderPayments();
  renderMetrics();
  updateEstimate();
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  document.querySelector("#quickRideButton").addEventListener("click", () => {
    showView("ride");
    els.pickup.focus();
  });

  document.querySelector("#panicButton").addEventListener("click", () => {
    toast("Seguridad: contacto de emergencia avisado en modo demo.");
  });
}

function showView(name) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${name}View`).classList.add("active");
}

function bindForms() {
  ["input", "change"].forEach((eventName) => {
    document.querySelector("#rideForm").addEventListener(eventName, updateEstimate);
  });

  document.querySelector("#rideForm").addEventListener("submit", (event) => {
    event.preventDefault();
    createTrip();
  });

  document.querySelector("#refreshDrivers").addEventListener("click", () => {
    state.drivers = state.drivers.map((driver) => ({
      ...driver,
      eta: Math.max(2, Math.min(14, driver.eta + Math.floor(Math.random() * 5) - 2))
    }));
    saveState();
    renderDrivers();
    drawMap();
    toast("Conductores actualizados.");
  });

  document.querySelector("#cancelTrip").addEventListener("click", cancelTrip);
  document.querySelector("#messageDriver").addEventListener("click", () => toast("Chat abierto en modo demo."));
  document.querySelector("#callDriver").addEventListener("click", () => toast("Llamada simulada al conductor."));

  document.querySelector("#driverOnline").addEventListener("change", (event) => {
    els.serviceStatus.textContent = event.target.checked ? "Servicio activo" : "Conductores pausados";
    toast(event.target.checked ? "Conductor disponible." : "Conductor fuera de linea.");
  });

  document.querySelector("#driverForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const localDriver = {
      id: 99,
      name: document.querySelector("#driverName").value || "Conductor local",
      car: document.querySelector("#driverCar").value || "Vehiculo",
      plate: document.querySelector("#driverPlate").value || "Sin patente",
      rating: 5,
      eta: 3,
      zone: document.querySelector("#driverZone").value || "Centro",
      online: document.querySelector("#driverOnline").checked
    };
    state.drivers = [localDriver, ...state.drivers.filter((driver) => driver.id !== 99)];
    saveState();
    renderDrivers();
    renderRequestFeed();
    toast("Perfil de conductor guardado.");
  });

  document.querySelector("#paymentConfig").addEventListener("submit", (event) => {
    event.preventDefault();
    state.fare.fee = Number(document.querySelector("#platformFee").value) || state.fare.fee;
    saveState();
    renderMetrics();
    toast("Configuracion guardada. El Access Token debe vivir en backend real.");
  });

  document.querySelector("#adminForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.city = document.querySelector("#adminCity").value || state.city;
    state.fare.base = Number(document.querySelector("#baseFare").value) || state.fare.base;
    state.fare.km = Number(document.querySelector("#kmFare").value) || state.fare.km;
    state.fare.wait = Number(document.querySelector("#waitMinutes").value) || state.fare.wait;
    saveState();
    renderAll();
    toast("Ajustes de localidad aplicados.");
  });

  document.querySelectorAll(".rating-row button").forEach((button) => {
    button.addEventListener("click", () => toast(`Gracias por calificar con ${button.dataset.star} estrellas.`));
  });
}

function calculateEstimate() {
  const pickupText = els.pickup.value.trim();
  const dropoffText = els.dropoff.value.trim();
  const seed = Math.max(1, pickupText.length + dropoffText.length);
  const distance = pickupText && dropoffText ? Math.max(1.4, Math.min(18, seed * 0.42)) : 0;
  const multiplier = { economy: 1, comfort: 1.25, xl: 1.55, moto: 0.72 }[els.carType.value] || 1;
  const demand = state.drivers.filter((driver) => driver.online).length < 3 ? 1.18 : 1;
  const passengerFee = Math.max(0, Number(els.passengers.value) - 1) * 120;
  const amount = distance ? Math.round((state.fare.base + distance * state.fare.km + passengerFee) * multiplier * demand) : 0;
  return { distance, amount, demand };
}

function updateEstimate() {
  const estimate = calculateEstimate();
  els.fareEstimate.textContent = currency.format(estimate.amount);
  els.distanceEstimate.textContent = `${estimate.distance.toFixed(1)} km`;
  els.surgeEstimate.textContent = estimate.demand > 1 ? "Alta" : "Normal";
  els.mapSubtitle.textContent = estimate.distance ? `${estimate.distance.toFixed(1)} km estimados hasta destino` : "Elige origen y destino para calcular tarifa";
}

function createTrip() {
  const estimate = calculateEstimate();
  if (!estimate.amount) {
    toast("Completa origen y destino para pedir.");
    return;
  }

  const driver = state.drivers.filter((item) => item.online).sort((a, b) => a.eta - b.eta)[0];
  if (!driver) {
    toast("No hay conductores disponibles en este momento.");
    return;
  }

  const trip = {
    id: `LR-${Date.now().toString().slice(-6)}`,
    pickup: els.pickup.value.trim(),
    dropoff: els.dropoff.value.trim(),
    carType: els.carType.options[els.carType.selectedIndex].text,
    paymentMethod: els.paymentMethod.value,
    note: document.querySelector("#note").value.trim(),
    amount: estimate.amount,
    distance: estimate.distance,
    driver,
    progress: 0,
    createdAt: new Date().toISOString()
  };

  state.activeTrip = trip;
  state.trips += 1;
  state.revenue += trip.amount;
  state.payments.unshift({
    id: trip.paymentMethod === "mercado-pago" ? `MP-${trip.id}` : `PAY-${trip.id}`,
    label: `${trip.pickup} - ${trip.dropoff}`,
    amount: trip.amount,
    status: trip.paymentMethod === "mercado-pago" ? "Pendiente demo" : "A cobrar"
  });
  saveState();
  renderAll();
  drawMap();
  showView("track");
  startTripTimer();
  toast(`Pedido confirmado. ${driver.name} llega en ${driver.eta} min.`);
}

function startTripTimer() {
  clearInterval(tripTimer);
  tripTimer = setInterval(() => {
    if (!state.activeTrip) {
      clearInterval(tripTimer);
      return;
    }
    state.activeTrip.progress = Math.min(100, state.activeTrip.progress + 12);
    if (state.activeTrip.progress >= 100) {
      const payment = state.payments.find((item) => item.id.endsWith(state.activeTrip.id));
      if (payment) payment.status = state.activeTrip.paymentMethod === "mercado-pago" ? "Aprobado demo" : "Completado";
      clearInterval(tripTimer);
      toast("Viaje finalizado.");
    }
    saveState();
    renderTrip();
    renderPayments();
  }, 2600);
}

function restoreTripTimer() {
  if (state.activeTrip && state.activeTrip.progress < 100) startTripTimer();
}

function cancelTrip() {
  if (!state.activeTrip || state.activeTrip.progress >= 100) {
    toast("No hay viaje activo para cancelar.");
    return;
  }
  state.activeTrip = null;
  saveState();
  renderTrip();
  drawMap();
  toast("Viaje cancelado. Puede aplicarse cargo segun politica local.");
}

function renderDrivers() {
  els.driverList.innerHTML = state.drivers
    .map((driver) => `
      <article class="driver-row">
        <div class="driver-main">
          <span class="driver-avatar">${initials(driver.name)}</span>
          <div>
            <strong>${driver.name}</strong>
            <span>${driver.car} · ${driver.plate}</span>
          </div>
        </div>
        <div>
          <strong>${driver.online ? `${driver.eta} min` : "Offline"}</strong>
          <span>★ ${driver.rating} · ${driver.zone}</span>
        </div>
      </article>
    `)
    .join("");
}

function renderRequestFeed() {
  const trip = state.activeTrip;
  els.requestFeed.innerHTML = trip
    ? `
      <article class="feed-item">
        <strong>${trip.pickup} → ${trip.dropoff}</strong>
        <p>${currency.format(trip.amount)} · ${trip.distance.toFixed(1)} km · ${trip.carType}</p>
      </article>
    `
    : `
      <article class="feed-item">
        <strong>Sin pedidos en cola</strong>
        <p>Los viajes nuevos apareceran aqui para aceptar o rechazar.</p>
      </article>
    `;
}

function renderTrip() {
  const trip = state.activeTrip;
  if (!trip) {
    els.tripStatusTitle.textContent = "Sin pedido activo";
    els.tripCode.textContent = "---";
    els.tripProgress.style.width = "0%";
    els.routeTimeline.innerHTML = emptyTimeline();
    els.receipt.innerHTML = emptyReceipt();
    renderRequestFeed();
    return;
  }

  const stepIndex = Math.min(tripSteps.length - 1, Math.floor(trip.progress / 25));
  els.tripStatusTitle.textContent = tripSteps[stepIndex];
  els.tripCode.textContent = trip.id;
  els.tripProgress.style.width = `${trip.progress}%`;
  els.routeTimeline.innerHTML = tripSteps.map((step, index) => `
    <div class="timeline-item ${index < stepIndex ? "done" : ""} ${index === stepIndex ? "active" : ""}">
      <i>${index + 1}</i>
      <div>
        <strong>${step}</strong>
        <p>${timelineCopy(index, trip)}</p>
      </div>
    </div>
  `).join("");
  els.receipt.innerHTML = `
    <dt>Conductor</dt><dd>${trip.driver.name}</dd>
    <dt>Vehiculo</dt><dd>${trip.driver.car}</dd>
    <dt>Patente</dt><dd>${trip.driver.plate}</dd>
    <dt>Origen</dt><dd>${trip.pickup}</dd>
    <dt>Destino</dt><dd>${trip.dropoff}</dd>
    <dt>Distancia</dt><dd>${trip.distance.toFixed(1)} km</dd>
    <dt>Pago</dt><dd>${paymentLabel(trip.paymentMethod)}</dd>
    <dt>Total</dt><dd>${currency.format(trip.amount)}</dd>
  `;
  renderRequestFeed();
}

function renderPayments() {
  els.paymentList.innerHTML = state.payments.map((payment) => `
    <article class="payment-row">
      <div>
        <strong>${payment.label}</strong>
        <span>${payment.id}</span>
      </div>
      <div>
        <strong>${currency.format(payment.amount)}</strong>
        <span>${payment.status}</span>
      </div>
    </article>
  `).join("");
}

function renderMetrics() {
  const fee = Math.round(state.revenue * (state.fare.fee / 100));
  els.metrics.innerHTML = `
    <div class="metric"><span>Viajes</span><strong>${state.trips}</strong></div>
    <div class="metric"><span>Facturacion</span><strong>${currency.format(state.revenue)}</strong></div>
    <div class="metric"><span>Comision</span><strong>${currency.format(fee)}</strong></div>
    <div class="metric"><span>Calificacion</span><strong>${state.rating}</strong></div>
  `;
  document.querySelector("#adminCity").value = state.city;
  document.querySelector("#baseFare").value = state.fare.base;
  document.querySelector("#kmFare").value = state.fare.km;
  document.querySelector("#waitMinutes").value = state.fare.wait;
  document.querySelector("#platformFee").value = state.fare.fee;
}

function drawMap() {
  els.mapGrid.innerHTML = `
    <span class="road main" style="left: -6%; top: 38%; width: 116%;"></span>
    <span class="road main" style="left: 4%; top: 68%; width: 78%; transform: rotate(16deg);"></span>
    <span class="road" style="left: 22%; top: -10%; width: 16px; height: 120%;"></span>
    <span class="road" style="left: 68%; top: -10%; width: 16px; height: 120%;"></span>
    ${state.drivers.filter((driver) => driver.online).map((driver, index) => {
      const left = 14 + index * 18 + Math.floor(Math.random() * 6);
      const top = 24 + (index % 3) * 18;
      return `<span class="car-pin" style="left:${left}%; top:${top}%;">${index + 1}</span>`;
    }).join("")}
    ${state.activeTrip ? `
      <span class="place-pin" style="left:22%; top:58%;">A</span>
      <span class="place-pin" style="left:74%; top:32%;">B</span>
      <span class="route-dot" style="left:${22 + state.activeTrip.progress * 0.52}%; top:${58 - state.activeTrip.progress * 0.26}%;"></span>
    ` : ""}
  `;

  if (state.activeTrip) {
    els.mapTitle.textContent = "Seguimiento en vivo";
    els.mapSubtitle.textContent = `${state.activeTrip.driver.name} · ${state.activeTrip.progress}% del recorrido`;
  } else {
    els.mapTitle.textContent = "Coches cerca";
  }
}

function emptyTimeline() {
  return tripSteps.map((step, index) => `
    <div class="timeline-item">
      <i>${index + 1}</i>
      <div>
        <strong>${step}</strong>
        <p>Esperando nuevo pedido.</p>
      </div>
    </div>
  `).join("");
}

function emptyReceipt() {
  return `
    <dt>Estado</dt><dd>Sin viaje</dd>
    <dt>Total</dt><dd>${currency.format(0)}</dd>
  `;
}

function timelineCopy(index, trip) {
  const copy = [
    "La solicitud quedo registrada.",
    `${trip.driver.name} acepto el viaje.`,
    `Llega a ${trip.pickup}.`,
    `Ruta hacia ${trip.dropoff}.`,
    "Recibo disponible y pago cerrado."
  ];
  return copy[index];
}

function paymentLabel(value) {
  return {
    "mercado-pago": "Mercado Pago",
    cash: "Efectivo",
    card: "Tarjeta"
  }[value] || value;
}

function initials(name) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2800);
}
