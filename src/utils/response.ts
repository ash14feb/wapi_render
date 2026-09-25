export function sendSuccess(res: import("express").Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function sendError(
  res: import("express").Response,
  code: string,
  message: string,
  status = 500,
  details?: unknown,
): void {
  res.status(status).json({ success: false, error: { code, message, details } });
}
