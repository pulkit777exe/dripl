import { apiClient as coreApiClient } from "@/lib/api";

type CompatApiClient = typeof coreApiClient & {
  signup: typeof coreApiClient.register;
  getProfile: typeof coreApiClient.me;
  getFiles: typeof coreApiClient.listFiles;
  createRoom: (data?: { name?: string }) => Promise<{
    room: { id: string; slug: string; name: string };
  }>;
  updateRoom: (
    slug: string,
    data: { name?: string; content?: string | unknown[] },
  ) => ReturnType<typeof coreApiClient.updateFile>;
  getRoom: (slug: string) => Promise<{
    room: { id: string; slug: string; name: string; content: unknown[] };
  }>;
  getRooms: () => Promise<{
    rooms: {
      id: string;
      slug: string;
      name: string;
      createdAt: string;
      updatedAt: string;
      isPublic: boolean;
    }[];
  }>;
  deleteRoom: typeof coreApiClient.deleteFile;
};

const compat = coreApiClient as CompatApiClient;

compat.signup = coreApiClient.register.bind(coreApiClient);
compat.getProfile = coreApiClient.me.bind(coreApiClient);
compat.getFiles = coreApiClient.listFiles.bind(coreApiClient);
compat.createRoom = async (data?: { name?: string }) => {
    const created = await coreApiClient.createFile({
      name: data?.name,
    });
    return {
      room: {
        id: created.id,
        slug: created.id,
        name: created.name,
      },
    };}
compat.updateRoom = async (
  slug: string,
  data: { name?: string; content?: string | unknown[] },
) => {
    const content =
      typeof data.content === "string"
        ? safeParseArray(data.content)
        : (data.content ?? undefined);
    return coreApiClient.updateFile(slug, {
      name: data.name,
      content: Array.isArray(content) ? content : undefined,
    });
  };
compat.getRoom = async (slug: string) => {
    const result = await coreApiClient.getFile(slug);
    return {
      room: {
        id: result.file.id,
        slug: result.file.id,
        name: result.file.name,
        content: result.file.content,
      },
    };}
compat.getRooms = async () => {
    const response = await coreApiClient.listFiles();
    return {
      rooms: response.files.map((file) => ({
        id: file.id,
        slug: file.id,
        name: file.name,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        isPublic: false,
      })),
    };
  };
compat.deleteRoom = coreApiClient.deleteFile.bind(coreApiClient);

export const apiClient = compat;

function safeParseArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
