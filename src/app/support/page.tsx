import { SupportForm } from "./support-form";

export const dynamic = "force-dynamic";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  return <SupportForm from={typeof from === "string" ? from.slice(0, 300) : ""} />;
}
