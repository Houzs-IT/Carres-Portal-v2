// Carres: give a Team member their scm.staff row (their "sales profile") when they do not have one yet, so
// Team › member › Sales venue › Showroom can be set for ANY member.
//
// No new storage and no second way of making the row. Houzs makes it in exactly one place: the
// scm.sync_user_to_staff trigger on public.users (migrations 0066 + 0234), fired AFTER INSERT OR UPDATE OF
// name, status. Every invite gets its row that way; a member without one is an account the trigger never
// reached (e.g. created before 0066, or disabled when 0234 made a disable a no-op). Re-firing the same trigger
// with a no-change `SET name = name` lets Houzs's own function build the row exactly as it would on a rename or
// a re-enable: the deterministic md5('houzs-user:'||id) uuid, a free EMP-#### code, initials, colour.
//
// A DISABLED member is left alone, the same as the trigger does (0234 rule 1): a disabled account gets no new
// sales profile. The caller then reports that plainly instead of claiming a save.

type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

/** The member's scm.staff id, creating the row through Houzs's user→staff sync when it is missing.
 *  Null when the member is disabled, does not exist, or the sync made no row. */
export async function ensureStaffRowForUser(db: D1Like, userId: number): Promise<string | null> {
  const existing = await db
    .prepare(`SELECT id FROM scm.staff WHERE user_id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (existing?.id) return String(existing.id);

  await db
    .prepare(`UPDATE users SET name = name WHERE id = ? AND status <> 'disabled'`)
    .bind(userId)
    .run();

  const made = await db
    .prepare(`SELECT id FROM scm.staff WHERE user_id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  return made?.id ? String(made.id) : null;
}
