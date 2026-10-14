export function configureCalendarPrimary(
  database: { query(sql: string): Promise<unknown> },
  staffId: string,
): Promise<void>;
