import { ResultExperience } from "./ResultExperience";

export default async function SharedAnswerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultExperience shareId={id} />;
}
