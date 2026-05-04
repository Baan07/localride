export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(message = "Recurso no encontrado") {
  return new HttpError(404, message);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.name === "ZodError") {
    return res.status(422).json({ error: "Datos invalidos", details: error.flatten() });
  }

  const status = error.status || 500;
  const message = status >= 500 ? "Error interno del servidor" : error.message;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: message, details: error.details });
}
