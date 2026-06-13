// D1 data access. The user shape returned here is the same snake_case contract
// the client consumes (height_cm, dob, sex, ethnicity, org_id, ...).

export async function loadCurrentUser(env, userId) {
  return await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.dob, u.height_cm, u.sex, u.ethnicity,
            'member' AS role,
            o.id AS org_id, o.slug AS org_slug, o.name AS org_name
       FROM users u JOIN orgs o ON o.id = u.org_id
      WHERE u.id = ?`,
  ).bind(userId).first();
}

export async function insertCheckIn(env, { userId, orgId, kind, payload }) {
  await env.DB.prepare(
    `INSERT INTO check_ins (id, user_id, org_id, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, orgId, kind, JSON.stringify(payload), new Date().toISOString())
    .run();
}
