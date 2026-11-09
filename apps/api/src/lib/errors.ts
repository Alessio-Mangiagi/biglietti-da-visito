export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Risorsa') => new HttpError(404, `${what} non trovato`, 'NOT_FOUND');
export const unauthorized = (msg = 'Accesso richiesto') => new HttpError(401, msg, 'UNAUTHORIZED');
export const badRequest = (msg: string, code = 'BAD_REQUEST') => new HttpError(400, msg, code);
