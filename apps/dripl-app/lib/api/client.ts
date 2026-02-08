const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002/api";

interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

interface AuthResponse {
  user: User;
  token?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const config: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
    };

    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: "An error occurred",
      }));
      throw new Error(error.error || "Request failed");
    }

    return response.json();
  }

  async signup(data: {
    email: string;
    password: string;
    name?: string;
  }): Promise<AuthResponse> {
    return this.request<AuthResponse>("/users/signup", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async login(data: {
    email: string;
    password: string;
  }): Promise<AuthResponse> {
    return this.request<AuthResponse>("/users/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async logout() {
    return this.request("/users/logout", {
      method: "POST",
    });
  }

  async getProfile(): Promise<{ user: User }> {
    return this.request<{ user: User }>("/users/profile", {
      method: "GET",
    });
  }

  async getFiles(): Promise<{ files: any[] }> {
    return this.request("/files", {
      method: "GET",
    });
  }

  async createFile(data: { name?: string }): Promise<{ file: any }> {
    return this.request("/files", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getFile(id: string) {
    return this.request(`/files/${id}`, {
      method: "GET",
    });
  }

  async updateFile(id: string, data: { name?: string; content?: string }) {
    return this.request(`/files/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteFile(id: string) {
    return this.request(`/files/${id}`, {
      method: "DELETE",
    });
  }

  async createRoom(data: {
    name?: string;
    isPublic?: boolean;
  }): Promise<{ room: any }> {
    return this.request("/rooms", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateRoom(
    slug: string,
    data: { name?: string; isPublic?: boolean; content?: string },
  ) {
    return this.request(`/rooms/${slug}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getRoom(slug: string): Promise<{ room: any }> {
    return this.request(`/rooms/${slug}`, {
      method: "GET",
    });
  }
}

export const apiClient = new ApiClient(API_URL);
