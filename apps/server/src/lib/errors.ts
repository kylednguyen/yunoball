/** HTTP error carrying a status code; the error middleware renders it as
 * `{"detail": ...}`, matching the previous FastAPI wire format. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public headers?: Record<string, string>,
  ) {
    super(detail);
  }
}
