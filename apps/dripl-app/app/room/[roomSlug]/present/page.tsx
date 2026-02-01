import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ roomSlug: string }>;
}

export default async function RoomPresentPage({ params }: PageProps) {
  const { roomSlug } = await params;

  // Redirect to canvas with presentation mode
  redirect(`/canvas/${roomSlug}?mode=present`);
}

export function generateMetadata() {
  return {
    title: "Presentation Mode - Dripl",
    description: "Full-screen presentation of a collaborative canvas",
  };
}
