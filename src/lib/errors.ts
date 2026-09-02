// Typed errors that route handlers can throw and the central error
// middleware (src/middleware/errorHandler.ts) turns into the right HTTP
// status + JSON shape. Keeps route handlers free of res.status(...).json(...)
// boilerplate for the error paths.

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Authentication required") {
    super(401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Not allowed") {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}
