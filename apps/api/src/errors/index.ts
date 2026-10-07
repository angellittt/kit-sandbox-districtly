export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  type?: string;
  constructor(message: string, type?: string) {
    super(message);
    this.name = "NotFoundError";
    this.type = type;
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnprocessableEntityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnprocessableEntityError";
  }
}
