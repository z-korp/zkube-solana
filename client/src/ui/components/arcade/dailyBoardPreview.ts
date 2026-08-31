import type { BoardRow, BoardState } from "@/backend/views";

const PREVIEW_ROWS = 3;

export interface PreviewRow {
  row: BoardRow;
  isYou: boolean;
  separated: boolean;
}

export function boardPreviewRows(
  state: BoardState | undefined,
  address: string | null,
): PreviewRow[] {
  if (!state) return [];
  const top = state.rows.slice(0, PREVIEW_ROWS);
  const yourRow =
    state.yourRow ??
    (address
      ? state.rows.find((candidate) => candidate.address === address)
      : undefined);
  const includesYou = Boolean(
    yourRow && top.some((candidate) => candidate.address === yourRow.address),
  );
  return [
    ...top.map((row) => ({
      row,
      isYou: Boolean(
        yourRow
          ? row.address === yourRow.address
          : address && row.address === address,
      ),
      separated: false,
    })),
    ...(yourRow && !includesYou
      ? [{ row: yourRow, isYou: true, separated: true }]
      : []),
  ];
}
