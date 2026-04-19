const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_HTTP_URL ??
  'http://localhost:3002/api';

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

async function parseError(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: string };
    return parsed.error ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

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
      content?: unknown[];
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
