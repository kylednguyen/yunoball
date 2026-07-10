import { redirect } from "next/navigation";

/** Moved to /leaders (adds team/position filters and team rankings). */
export default async function LeaderboardsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const season = (await searchParams).season;
  redirect(typeof season === "string" ? `/leaders?season=${season}` : "/leaders");
}
