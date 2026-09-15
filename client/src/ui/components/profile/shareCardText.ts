export interface ShareTextData {
  readonly displayName: string;
  readonly guardianName: string;
  readonly realm: string;
  readonly objective: string;
  readonly objectiveTotal: bigint;
  readonly dailyScore: number;
  readonly streak: number;
}

export function shareCardText(data: ShareTextData, locales?: string): string {
  return [
    `${data.displayName} faced ${data.guardianName} in ${data.realm}.`,
    `${data.objective}: ${data.objectiveTotal.toString()}. Score: ${data.dailyScore.toLocaleString(locales)}.`,
    `${data.streak} day streak.`,
  ].join(" ");
}
