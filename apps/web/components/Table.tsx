// Table per DESIGN.md: sentence-case `label` secondary headers (no band, no zebra),
// 1px #141414 row separators, numbers right-aligned mono tabular, row hover surface.

export interface Column<Row> {
  key: string;
  header: string;
  align?: "left" | "right";
  mono?: boolean;
  render?: (row: Row) => React.ReactNode;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  rowHeight,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, i: number) => React.Key;
  /** Row becomes clickable (cursor + hover) when set. */
  onRowClick?: (row: Row) => void;
  /** String (W15: "group" for hover-revealed actions) or per-row function (W13: enter animation). */
  rowClassName?: string | ((row: Row) => string);
  /** W14: row pitch override (analytics ranking uses 53px). */
  rowHeight?: string;
}) {
  return (
    <table className="w-full border-collapse text-body">
      <thead>
        <tr className="h-9">
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              className={`label pr-4 text-secondary last:pr-0 ${
                col.align === "right" ? "text-right" : "text-left"
              }`}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={rowHeight ? { height: rowHeight } : undefined}
            className={`${rowHeight ? "" : "h-[var(--row-height)] "}border-t border-border ${
              onRowClick ? "cursor-pointer hover:bg-muted hover:text-foreground" : ""
            } ${typeof rowClassName === "string" ? rowClassName : (rowClassName?.(row) ?? "")}`}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={`pr-4 last:pr-0 ${
                  col.align === "right" ? "text-right" : "text-left"
                } ${col.mono || col.align === "right" ? "font-mono tabular-nums" : ""}`}
              >
                {col.render ? col.render(row) : ((row as Record<string, React.ReactNode>)[col.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
