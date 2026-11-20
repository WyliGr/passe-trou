// Table per §7: 42px rows, 1px rules inset to padding, 12px muted sentence-case headers,
// numbers right-aligned in mono, no zebra, no header band.

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
  rowHeight,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, i: number) => React.Key;
  /** Row pitch override (default var(--row-height) = 42px; analytics ranking uses 53px). */
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
              className={`pr-4 text-small font-normal text-muted last:pr-0 ${
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
            className="border-t border-rule"
            style={{ height: rowHeight ?? "var(--row-height)" }}
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
