export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface ApiSuccess<T> {
  data: T;
  message?: string;
}
