import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ roomSlug: string }>;
}

export default async function RoomViewPage({ params }: PageProps) {
  const { roomSlug } = await params;

  // Server-side check for room existence would go here
  // For now, redirect to the main canvas with view mode param
  redirect(`/canvas/${roomSlug}?mode=view`);
}

export function generateMetadata({
  params,
}: {
  params: Promise<{ roomSlug: string }>;
}) {
  return {
    title: "View Room - Dripl",
    description: "Read-only view of a collaborative canvas",
  };
}
