const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';

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

  private async getCsrfToken(forceRefresh = false): Promise<string> {
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

  private async sendRequest(path: string, init?: RequestInit, retryOnCsrfFailure = true): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!this.isSafeMethod(method)) {
      const csrfToken = await this.getCsrfToken();
      headers.set('x-csrf-token', csrfToken);
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
      throw new Error(await parseError(response));
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
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', {
      method: 'POST',
    });
  }

  async googleLogin(payload: { token: string }): Promise<{ user: AuthUser }> {
    return this.request('/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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

  async createCanvasRoom(payload?: { name?: string; isPublic?: boolean }): Promise<{
    roomId: string;
  }> {
    const response = await this.request<{ room: { slug: string } }>('/rooms', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    });
    return { roomId: response.room.slug };
  }

  async getCanvasRoom(roomId: string): Promise<{ room: { slug: string } }> {
    return this.request(`/rooms/${roomId}`);
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
