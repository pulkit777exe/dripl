export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Uniform success envelope: every 2xx JSON body sent through http-server's
 * `defineRoute` arrives as `{ data: <original-body> }` — the original body
 * wrapped whole, never restructured. 204 no-body deletes stay bodiless, and
 * errors stay `{ error, message, statusCode }`. Clients unwrap `data`
 * transparently and accept a raw body too (routes outside `defineRoute` —
 * auth, images, csrf, internal, ops — keep their historical shapes).
 */
export interface ApiSuccess<T> {
  data: T;
  message?: string;
}
