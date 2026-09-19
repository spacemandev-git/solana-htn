import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@htn/shared';
import type { ZodError, ZodType } from 'zod';

/** Thrown anywhere in a handler; app.ts renders it as the ApiError shape. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly detail: string | undefined;

  constructor(status: ContentfulStatusCode, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  toApiError(): ApiError {
    return this.detail ? { error: this.code, detail: this.detail } : { error: this.code };
  }
}

export function fail(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  detail?: string,
): Response {
  return c.json(new HttpError(status, code, detail).toApiError(), status);
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ');
}

/** Reads + validates a JSON body, converting both failure modes to 400s. */
export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_request', formatIssues(parsed.error));
  }
  return parsed.data;
}
