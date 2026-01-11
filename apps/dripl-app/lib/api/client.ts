const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const config: RequestInit = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // Important for cookies
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

  // Auth endpoints
  async signup(data: { email: string; password: string; name?: string }) {
    return this.request("/users/signup", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async login(data: { email: string; password: string }) {
    return this.request("/users/login", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async logout() {
    return this.request("/users/logout", {
      method: "POST",
    });
  }

  async getProfile() {
    return this.request("/users/profile", {
      method: "GET",
    });
  }

  // File endpoints
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
}

export const apiClient = new ApiClient(API_URL);
