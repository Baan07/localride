import { HttpError } from "../errors.js";

const SERVICE_AREA = {
  name: "Rio Colorado y La Adela",
  minLat: -39.06,
  maxLat: -38.94,
  minLng: -64.18,
  maxLng: -64.00
};

export function assertServiceCoverage(...points) {
  const outsidePoint = points.find((point) => !isInServiceArea(point));
  if (outsidePoint) {
    throw new HttpError(422, `Por ahora Rio Movil opera solo en ${SERVICE_AREA.name}`);
  }
}

export function isInServiceArea(point) {
  return (
    Number(point.lat) >= SERVICE_AREA.minLat &&
    Number(point.lat) <= SERVICE_AREA.maxLat &&
    Number(point.lng) >= SERVICE_AREA.minLng &&
    Number(point.lng) <= SERVICE_AREA.maxLng
  );
}

export function serviceAreaInfo() {
  return SERVICE_AREA;
}
