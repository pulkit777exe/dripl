const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface FileSummary {
  id: string;
  name: string;
  preview: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileDetails extends FileSummary {
  shareToken: string | null;
  sharePermission: 'view' | 'edit' | null;
  shareExpiresAt: string | null;
  content: unknown[];
  encryptedPayload: { iv: string; data: string } | null;
}

export interface ShareCreateResponse {
  token: string;
  permission: 'view' | 'edit';
  expiresAt: string | null;
  shareUrl: string;
}

export interface SharedFileResponse {
  file: {
    id: string;
    name: string;
    updatedAt: string;
  };
  permission: 'view' | 'edit';
  encryptedPayload: { iv: string; data: string } | null;
  elements: unknown[] | null;
}

export interface SharedFileSummary {
  id: string;
  name: string;
  preview: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  sharedAt: string;
  sharedBy: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
}

async function parseError(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

class ApiClient {
  private csrfToken: string | null = null;
  private csrfTokenPromise: Promise<string> | null = null;

  constructor(private readonly baseUrl: string) {}

  private isSafeMethod(method: string): boolean {
    return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  }

  private resolveCsrfUrl(): string {
    try {
      return new URL('/csrf-token', this.baseUrl).toString();
    } catch {
      return '/csrf-token';
    }
  }

  private async fetchCsrfToken(): Promise<string> {
    const response = await fetch(this.resolveCsrfUrl(), {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to initialize security token');
    }

    const payload = (await response.json()) as { token?: string };
    if (!payload.token) {
      throw new Error('Failed to initialize security token');
    }

    this.csrfToken = payload.token;
    return payload.token;
  }

  async getCsrfToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      this.csrfToken = null;
    }

    if (this.csrfToken) {
      return this.csrfToken;
    }

    if (!this.csrfTokenPromise) {
      this.csrfTokenPromise = this.fetchCsrfToken().finally(() => {
        this.csrfTokenPromise = null;
      });
    }

    return this.csrfTokenPromise;
  }

  private getSessionToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)dripl-session=([^;]*)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  }

  private setSessionCookie(token: string): void {
    if (typeof document === 'undefined') return;
    // Set non-httpOnly cookie on current domain so client can read it
    // and send as Authorization header for cross-origin requests
    const secure = window.location.protocol === 'https:';
    document.cookie = `dripl-session=${encodeURIComponent(token)}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  private async sendRequest(
    path: string,
    init?: RequestInit,
    retryOnCsrfFailure = true
  ): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!this.isSafeMethod(method)) {
      const csrfToken = await this.getCsrfToken();
      headers.set('x-csrf-token', csrfToken);
    }

    // Send session token as Authorization header for cross-origin requests
    const sessionToken = this.getSessionToken();
    if (sessionToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${sessionToken}`);
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers,
    });

    if (response.status === 403 && retryOnCsrfFailure && !this.isSafeMethod(method)) {
      const errorMessage = await parseError(response.clone());
      if (errorMessage === 'CSRF token missing' || errorMessage === 'CSRF token invalid') {
        const csrfToken = await this.getCsrfToken(true);
        headers.set('x-csrf-token', csrfToken);
        return fetch(`${this.baseUrl}${path}`, {
          ...init,
          credentials: 'include',
          headers,
        });
      }
    }

    return response;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.sendRequest(path, init);

    if (!response.ok) {
      const error = new Error(await parseError(response)) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async register(payload: {
    email: string;
    password: string;
    name?: string;
  }): Promise<{ user?: AuthUser; message?: string; pendingVerification?: boolean }> {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async login(payload: { email: string; password: string }): Promise<{ user: AuthUser }> {
    const response = await this.request<{ user: AuthUser; sessionToken?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (response.sessionToken) {
      this.setSessionCookie(response.sessionToken);
    }
    return response;
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', {
      method: 'POST',
    });
    // Clear the session cookie on the client domain
    if (typeof document !== 'undefined') {
      document.cookie = 'dripl-session=; path=/; max-age=0';
    }
  }

  async googleLogin(payload: { token: string }): Promise<{ user: AuthUser }> {
    const response = await this.request<{ user: AuthUser; sessionToken?: string }>('/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (response.sessionToken) {
      this.setSessionCookie(response.sessionToken);
    }
    return response;
  }

  async forgotPassword(payload: { email: string }): Promise<{ ok: boolean }> {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async resetPassword(payload: { token: string; password: string }): Promise<{ ok: boolean }> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async verifyEmail(payload: { token: string }): Promise<{ message: string }> {
    return this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async resendVerification(payload: { email: string }): Promise<{ ok: boolean }> {
    return this.request('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateProfile(payload: { name?: string; image?: string }): Promise<{ user: AuthUser }> {
    return this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean }> {
    return this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async me(): Promise<{ user: AuthUser }> {
    return this.request('/auth/me');
  }

  async listFiles(params?: {
    search?: string;
    folderId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ files: FileSummary[]; total: number; page: number; limit: number }> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.folderId) searchParams.set('folderId', params.folderId);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return this.request(`/files${query ? `?${query}` : ''}`);
  }

  async listSharedFiles(params?: {
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ files: SharedFileSummary[]; total: number; page: number; limit: number }> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set('search', params.search);
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return this.request(`/files/shared${query ? `?${query}` : ''}`);
  }

  async getWsTicket(signal?: AbortSignal): Promise<string> {
    const response = await this.request<{ ticket?: string }>('/auth/ws-ticket', {
      method: 'POST',
      signal,
    });
    if (!response.ticket) throw new Error('Authentication ticket was not returned');
    return response.ticket;
  }

  async getShareWsTicket(token: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request<{ ticket?: string }>(
      `/share/${encodeURIComponent(token)}/ws-ticket`,
      { method: 'GET', signal }
    );
    if (!response.ticket) throw new Error('Share collaboration ticket was not returned');
    return response.ticket;
  }

  async createFile(payload?: {
    name?: string;
    folderId?: string | null;
    content?: unknown[];
    preview?: string | null;
  }): Promise<{ id: string; name: string }> {
    return this.request('/files', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    });
  }

  async getFile(fileId: string): Promise<{ file: FileDetails }> {
    return this.request(`/files/${fileId}`);
  }

  async updateFile(
    fileId: string,
    payload: {
      name?: string;
      folderId?: string | null;
      content?: unknown;
      preview?: string | null;
      expectedUpdatedAt?: string;
    }
  ): Promise<{ file: FileSummary }> {
    return this.request(`/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async shareFile(
    fileId: string,
    payload: {
      permission: 'view' | 'edit';
      expiresInHours?: number;
      expiresAt?: string;
    }
  ): Promise<ShareCreateResponse> {
    return this.request(`/files/${fileId}/share`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async revokeShare(fileId: string): Promise<void> {
    await this.request(`/files/${fileId}/share`, {
      method: 'DELETE',
    });
  }

  async getSharedFile(token: string): Promise<SharedFileResponse> {
    return this.request(`/share/${token}`);
  }

  async listFolders(): Promise<{ folders: FolderSummary[] }> {
    return this.request('/folders');
  }

  async createFolder(payload: { name: string; parentId?: string | null }): Promise<{
    folder: FolderSummary;
  }> {
    return this.request('/folders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateFolder(
    folderId: string,
    payload: { name?: string; parentId?: string | null }
  ): Promise<{
    folder: FolderSummary;
  }> {
    return this.request(`/folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.request(`/folders/${folderId}`, {
      method: 'DELETE',
    });
  }

  async listCanvasRooms(): Promise<{
    rooms: Array<{
      id: string;
      slug: string;
      name: string;
      isPublic: boolean;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    return this.request('/rooms');
  }

  async createCanvasRoom(payload?: {
    name?: string;
    isPublic?: boolean;
    content?: string;
  }): Promise<{
    room: { id: string; slug: string; name: string; isPublic: boolean; content: string };
    /** @deprecated Use room.slug; retained for older callers. */
    roomId: string;
  }> {
    const response = await this.request<{
      room: { id: string; slug: string; name: string; isPublic: boolean; content: string };
    }>('/rooms', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    });
    return { ...response, roomId: response.room.slug };
  }

  async getCanvasRoom(roomId: string): Promise<{
    room: { id: string; slug: string; name: string; isPublic: boolean; content: string };
  }> {
    return this.request(`/rooms/${roomId}`);
  }

  async updateCanvasRoom(
    roomId: string,
    payload: { name?: string; isPublic?: boolean; content?: string; expectedUpdatedAt?: string }
  ): Promise<{
    room: { id: string; slug: string; name: string; isPublic: boolean; content: string };
  }> {
    return this.request(`/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteCanvasRoom(roomId: string): Promise<void> {
    await this.request(`/rooms/${roomId}`, { method: 'DELETE' });
  }

  async getSharedRoom(token: string): Promise<{
    room: { id: string; slug: string; name: string; content: string; isPublic: boolean };
    permission: 'VIEW' | 'EDIT';
    expiresAt: string;
  }> {
    return this.request(`/rooms/share/${encodeURIComponent(token)}`);
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
